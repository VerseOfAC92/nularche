// Masaüstü takvim eşitleme: Google / Apple hesap bağlantısı, kimlik bilgilerinin işletim sisteminin anahtar
// zinciriyle (safeStorage) şifreli saklanması, takvim bağlantıları (görüntüleme ya da isteğe bağlı veritabanı) ve
// arka planda eşitleme. Görüntüleme bağlantılarının etkinlikleri ve yerel takvim not oluşturmaz: Origin'deki
// `.nularche/calendar-events.json` önbelleğinde tutulur; Takvim ekranındaki değişiklikler doğrudan sağlayıcıya yazılır.
// Eşitleme kuralları core/calendar.ts'te, sağlayıcı istemcileri core/calendar-providers.ts'tedir.
// Kimlik bilgileri bu bilgisayardaki ayar klasöründe kalır; Origin'e yalnızca eşleme durumu yazılır.

import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { ipcMain, safeStorage, shell, type BrowserWindow } from "electron";
import { randomUUID } from "node:crypto";
import {
  addLink,
  CalendarError,
  fetchViewEvents,
  isCalendarProvider,
  isDbLink,
  readEventCache,
  toCached,
  writeEventCache,
  type CachedEvent,
  type EventTime,
  readCalendarState,
  removeLink,
  syncLink,
  writeCalendarState,
  type CalendarErrorCode,
  type CalendarLink,
  type CalendarProvider,
  type CalendarProviderId,
} from "../../core/src/calendar.ts";
import {
  CalDavCalendar,
  exchangeGoogleCode,
  GoogleCalendar,
  googleAuthUrl,
  GOOGLE_AUTH_URL,
  type CalDavCredentials,
  type GoogleCredentials,
} from "../../core/src/calendar-providers.ts";
import { NodeError, NodeStore } from "../../core/src/node-store.ts";
import { d } from "./i18n.ts";

/** Uçtan uca testlerde gerçek Anahtar Zinciri ve tarayıcı kullanılmaz. */
const dryRun = !!process.env.NULARCHE_E2E;
/** Testler için sağlayıcı adresleri değiştirilebilir. */
const google = {
  auth: process.env.NULARCHE_GOOGLE_AUTH || GOOGLE_AUTH_URL,
  token: process.env.NULARCHE_GOOGLE_TOKEN || undefined,
  api: process.env.NULARCHE_GOOGLE_API || undefined,
};
const CALDAV_SERVER = process.env.NULARCHE_CALDAV || undefined;
const GOOGLE_CONSOLE_URL = "https://console.cloud.google.com/apis/credentials";
const APPLE_PASSWORD_URL = "https://account.apple.com/account/manage";
/** Arka plan eşitleme aralığı. */
const INTERVAL_MS = 5 * 60_000;
const OAUTH_TIMEOUT_MS = 5 * 60_000;

interface StoredAccount {
  account: string;
  google?: GoogleCredentials;
  apple?: CalDavCredentials;
}

export interface CalendarContext {
  window: () => BrowserWindow | null;
  originRoot: () => string | null;
  configDir: () => string;
}

/** Arayüze dönen hata: kod arayüzde çevrilir, ileti ayrıntı olarak gösterilir. */
const failure = (e: unknown): { ok: false; code: CalendarErrorCode | "unknown"; error: string } => ({
  ok: false,
  code: e instanceof CalendarError || e instanceof NodeError ? e.code : "unknown",
  error: (e as Error).message,
});

const base64url = (b: Buffer) => b.toString("base64url");

/** Yerel takvimin önbellekteki anahtarı: hesap gerektirmez, Origin'de kalır. */
const LOCAL = "local";

function parseEventTime(raw: unknown): EventTime | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (r.allDay === true && typeof r.start === "string" && typeof r.end === "string" && day.test(r.start) && day.test(r.end) && r.end > r.start)
    return { allDay: true, start: r.start, end: r.end };
  if (r.allDay === false && typeof r.start === "number" && typeof r.end === "number" && Number.isFinite(r.start) && r.end > r.start)
    return { allDay: false, start: r.start, end: r.end };
  return null;
}

export function registerCalendarIpc(ctx: CalendarContext): { onOriginChanged: () => void } {
  const credFile = (p: CalendarProviderId) => path.join(ctx.configDir(), `calendar-${p}.bin`);
  const canEncrypt = () => dryRun || safeStorage.isEncryptionAvailable();

  async function readAccount(p: CalendarProviderId): Promise<StoredAccount | null> {
    try {
      const buf = await readFile(credFile(p));
      const text = dryRun ? buf.toString("utf8") : safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : null;
      return text ? (JSON.parse(text) as StoredAccount) : null;
    } catch {
      return null;
    }
  }

  async function saveAccount(p: CalendarProviderId, acc: StoredAccount): Promise<void> {
    await mkdir(ctx.configDir(), { recursive: true });
    const text = JSON.stringify(acc);
    await writeFile(credFile(p), dryRun ? Buffer.from(text) : safeStorage.encryptString(text), { mode: 0o600 });
  }

  function providerFor(p: CalendarProviderId, acc: StoredAccount): CalendarProvider | null {
    if (p === "google" && acc.google) return new GoogleCalendar(acc.google, { token: google.token, api: google.api });
    if (p === "apple" && acc.apple) return new CalDavCalendar({ server: CALDAV_SERVER, ...acc.apple });
    return null;
  }

  async function provider(p: CalendarProviderId): Promise<CalendarProvider | null> {
    const acc = await readAccount(p);
    return acc ? providerFor(p, acc) : null;
  }

  // --- Etkinlik önbelleği: okuma-değiştirme-yazma tek sırada ------------------------------------------
  let cacheQueue: Promise<unknown> = Promise.resolve();
  function withCache<T>(root: string, change: (cache: Record<string, CachedEvent[]>) => Record<string, CachedEvent[]> | Promise<Record<string, CachedEvent[]>>): Promise<void> {
    const run = cacheQueue.catch(() => undefined).then(async () => writeEventCache(root, await change(await readEventCache(root))));
    cacheQueue = run;
    return run;
  }

  // --- Eşitleme: bağlantılar sırayla, aynı anda tek eşitleme --------------------------------------
  let running: Promise<unknown> | null = null;
  let timer: NodeJS.Timeout | null = null;

  function announce(): void {
    ctx.window()?.webContents.send("nularche:calendar-synced");
  }

  /** Veritabanı silinmiş (ya da çöpe atılmış) bağlantılar kaldırılır: hata olarak gösterilmez, takvim yeniden açılınca
   *  yeni bir veritabanıyla bağlanır. Okunamayan başka durumlar (izin, bozuk dosya) bağlantıyı korur. */
  async function pruneMissing(root: string): Promise<void> {
    const store = new NodeStore(root);
    const state = await readCalendarState(root);
    const gone: string[] = [];
    for (const l of state.links) {
      if (!l.dbId) continue;
      try {
        const n = await store.read(l.dbId);
        if (!n.database) gone.push(l.id);
      } catch (e) {
        if (e instanceof NodeError && e.code === "not_found") gone.push(l.id);
      }
    }
    if (!gone.length) return;
    const current = await readCalendarState(root);
    await writeCalendarState(root, { ...current, links: current.links.filter((l) => !gone.includes(l.id)) });
  }

  async function syncAll(only?: (l: CalendarLink) => boolean): Promise<{ ok: boolean; errors: string[] }> {
    const root = ctx.originRoot();
    if (!root) return { ok: true, errors: [] };
    await pruneMissing(root);
    const store = new NodeStore(root);
    const errors: string[] = [];
    const providers = new Map<CalendarProviderId, CalendarProvider | null>();
    const initial = await readCalendarState(root);
    for (const link of initial.links) {
      if (only && !only(link)) continue;
      if (!providers.has(link.provider)) providers.set(link.provider, await provider(link.provider));
      const prov = providers.get(link.provider);
      let next: CalendarLink;
      if (!prov) next = { ...link, lastError: { code: "auth", message: d("cal.notConnected") } };
      else if (!isDbLink(link)) {
        try {
          const events = await fetchViewEvents(prov, link);
          await withCache(root, (cache) => ({ ...cache, [link.id]: events }));
          next = { ...link, lastSync: Date.now(), lastError: null };
        } catch (e) {
          const f = failure(e);
          next = { ...link, lastError: { code: f.code, message: f.error } };
          errors.push(f.error);
        }
      } else {
        try {
          const report = await syncLink(store, prov, link, { untitled: d("cal.untitled") });
          next = report.link;
          if (report.errors.length) {
            next = { ...next, lastError: { code: "unknown", message: report.errors.slice(0, 3).join("\n") } };
            errors.push(...report.errors);
          }
        } catch (e) {
          const f = failure(e);
          next = { ...link, lastError: { code: f.code, message: f.error } };
          errors.push(f.error);
        }
      }
      // Bağlantı eşitleme sırasında kaldırılmış olabilir: güncel durumu okuyup yalnızca bu bağlantıyı değiştir.
      const current = await readCalendarState(root);
      if (current.links.some((l) => l.id === link.id)) {
        await writeCalendarState(root, { ...current, links: current.links.map((l) => (l.id === link.id ? next : l)) });
      }
    }
    announce();
    return { ok: errors.length === 0, errors };
  }

  function queueSync(only?: (l: CalendarLink) => boolean) {
    const run = (running ?? Promise.resolve()).catch(() => undefined).then(() => syncAll(only));
    // Kuyruktaki son eşitleme bitince "eşitleniyor" durumu kalkar.
    const tracked: Promise<unknown> = run.finally(() => {
      if (running === tracked) running = null;
    });
    running = tracked;
    return run;
  }

  function schedule(): void {
    if (timer) clearInterval(timer);
    if (dryRun) return; // testler eşitlemeyi elle başlatır
    timer = setInterval(() => void queueSync().catch(() => undefined), INTERVAL_MS);
    timer.unref?.();
    setTimeout(() => void queueSync().catch(() => undefined), 5_000).unref?.();
  }

  // --- Google OAuth: geri dönüş adresi 127.0.0.1 üzerinde, PKCE ile ------------------------------
  async function authorizeGoogle(clientId: string, clientSecret: string): Promise<string> {
    const verifier = base64url(randomBytes(32));
    const challenge = base64url(createHash("sha256").update(verifier).digest());
    const state = base64url(randomBytes(16));
    return new Promise<string>((resolve, reject) => {
      let redirectUri = "";
      const page = (title: string) =>
        `<!doctype html><meta charset="utf-8"><title>Nularche</title><body style="font:16px system-ui;padding:40px;text-align:center"><h2>${title}</h2><p>${d("cal.closeTab")}</p></body>`;
      const server = createServer(async (req, res) => {
        const url = new URL(req.url ?? "/", redirectUri);
        if (url.pathname !== "/") return res.writeHead(404).end();
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        if (url.searchParams.get("state") !== state) return res.end(page(d("cal.authFailed")));
        const code = url.searchParams.get("code");
        if (!code) {
          res.end(page(d("cal.authFailed")));
          finish(new CalendarError("auth", url.searchParams.get("error") ?? "access_denied"));
          return;
        }
        try {
          const refreshToken = await exchangeGoogleCode({ clientId, clientSecret, code, redirectUri, verifier }, { token: google.token });
          res.end(page(d("cal.authDone")));
          finish(null, refreshToken);
        } catch (e) {
          res.end(page(d("cal.authFailed")));
          finish(e as Error);
        }
      });
      const timeout = setTimeout(() => finish(new CalendarError("auth", d("cal.authTimeout"))), OAUTH_TIMEOUT_MS);
      function finish(err: Error | null, token?: string) {
        clearTimeout(timeout);
        server.close();
        if (err) reject(err);
        else resolve(token!);
      }
      server.on("error", (e) => finish(e));
      server.listen(0, "127.0.0.1", () => {
        redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const url = googleAuthUrl({ clientId, redirectUri, challenge, state }, google.auth);
        if (!dryRun) void shell.openExternal(url);
      });
    });
  }

  // --- IPC -----------------------------------------------------------------------------------------
  ipcMain.handle("nularche:calendar-status", async () => {
    const root = ctx.originRoot();
    const accounts: Partial<Record<CalendarProviderId, string>> = {};
    for (const p of ["google", "apple"] as const) {
      const acc = await readAccount(p);
      if (acc) accounts[p] = acc.account;
    }
    if (root) await pruneMissing(root);
    const links = root ? (await readCalendarState(root)).links : [];
    const cache = root ? await readEventCache(root) : {};
    return {
      encryption: canEncrypt(),
      accounts,
      syncing: !!running,
      links: links.map(({ items, ...l }) => ({ ...l, count: l.dbId ? Object.keys(items).length : (cache[l.id]?.length ?? 0) })),
    };
  });

  ipcMain.handle("nularche:calendar-connect-google", async (_e, clientId: unknown, clientSecret: unknown) => {
    if (typeof clientId !== "string" || !clientId.trim() || typeof clientSecret !== "string" || !clientSecret.trim()) {
      return { ok: false, code: "invalid", error: d("cal.missingClient") };
    }
    if (!canEncrypt()) return { ok: false, code: "invalid", error: d("ai.noEncryption") };
    try {
      const creds = { clientId: clientId.trim(), clientSecret: clientSecret.trim(), refreshToken: await authorizeGoogle(clientId.trim(), clientSecret.trim()) };
      const account = await new GoogleCalendar(creds, { token: google.token, api: google.api }).account();
      await saveAccount("google", { account, google: creds });
      return { ok: true, account };
    } catch (e) {
      return failure(e);
    }
  });

  ipcMain.handle("nularche:calendar-connect-apple", async (_e, username: unknown, password: unknown) => {
    if (typeof username !== "string" || !username.trim() || typeof password !== "string" || !password.trim()) {
      return { ok: false, code: "invalid", error: d("cal.missingApple") };
    }
    if (!canEncrypt()) return { ok: false, code: "invalid", error: d("ai.noEncryption") };
    // Uygulamaya özel parolalar `abcd-efgh-ijkl-mnop` biçiminde gösterilir; boşluklarla yapıştırılabilir.
    const apple = { username: username.trim(), password: password.replace(/\s+/g, "") };
    try {
      const account = await new CalDavCalendar({ server: CALDAV_SERVER, ...apple }).account();
      await saveAccount("apple", { account, apple });
      return { ok: true, account };
    } catch (e) {
      return failure(e);
    }
  });

  ipcMain.handle("nularche:calendar-disconnect", async (_e, p: unknown) => {
    if (isCalendarProvider(p)) await rm(credFile(p), { force: true });
  });

  ipcMain.handle("nularche:calendar-calendars", async (_e, p: unknown) => {
    if (!isCalendarProvider(p)) return { ok: false, code: "invalid", error: "provider" };
    try {
      const prov = await provider(p);
      if (!prov) return { ok: false, code: "auth", error: d("cal.notConnected") };
      return { ok: true, calendars: await prov.listCalendars() };
    } catch (e) {
      return failure(e);
    }
  });

  ipcMain.handle("nularche:calendar-link", async (_e, input: unknown) => {
    const root = ctx.originRoot();
    const i = (input ?? {}) as Record<string, unknown>;
    const s = (v: unknown) => (typeof v === "string" && v ? v : null);
    // Veritabanı isteğe bağlıdır: yoksa takvim yalnızca Takvim ekranında görüntülenir (not oluşturulmaz).
    const dbId = s(i.dbId);
    const calendarId = s(i.calendarId);
    const dateProp = s(i.dateProp);
    if (!root || !calendarId || !!dbId !== !!dateProp || !isCalendarProvider(i.provider)) return { ok: false, code: "invalid", error: "input" };
    const { state, link } = addLink(await readCalendarState(root), {
      ...(dbId && dateProp ? { dbId, dateProp } : {}),
      provider: i.provider,
      calendarId,
      calendarName: s(i.calendarName) ?? calendarId,
    });
    await writeCalendarState(root, state);
    const res = await queueSync((l) => l.id === link.id);
    return { ok: true, linkId: link.id, errors: res.errors };
  });

  ipcMain.handle("nularche:calendar-unlink", async (_e, linkId: unknown) => {
    const root = ctx.originRoot();
    if (!root || typeof linkId !== "string") return;
    await running?.catch(() => undefined);
    await writeCalendarState(root, removeLink(await readCalendarState(root), linkId));
    await withCache(root, ({ [linkId]: _gone, ...rest }) => rest);
    announce();
  });

  // --- Takvim ekranı: görüntüleme bağlantılarının ve yerel takvimin etkinlikleri ----------------------
  ipcMain.handle("nularche:calendar-events", async () => {
    const root = ctx.originRoot();
    if (!root) return { calendars: [] };
    const links = (await readCalendarState(root)).links.filter((l) => !l.dbId);
    const cache = await readEventCache(root);
    return {
      calendars: [
        { id: LOCAL, provider: "local", name: d("cal.localCalendar"), events: cache[LOCAL] ?? [] },
        ...links.map((l) => ({ id: l.id, provider: l.provider, name: l.calendarName, events: cache[l.id] ?? [] })),
      ],
    };
  });

  /** Etkinlik oluşturur ya da günceller: yerel takvimde önbelleğe, bağlı takvimde sağlayıcıya yazar. */
  ipcMain.handle("nularche:calendar-event-save", async (_e, linkId: unknown, eventId: unknown, input: unknown) => {
    const root = ctx.originRoot();
    const i = (input ?? {}) as Record<string, unknown>;
    const when = parseEventTime(i.when);
    if (!root || typeof linkId !== "string" || typeof i.title !== "string" || !when) return { ok: false, code: "invalid", error: "input" };
    const id = typeof eventId === "string" && eventId ? eventId : null;
    const title = i.title.trim() || d("cal.untitled");
    // Ayrıntılar: verilmeyen alan değiştirilmez; boş dize alanı kaldırır.
    const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);
    const details = {
      description: text(i.description, 100_000),
      location: text(i.location, 2_000),
      url: typeof i.url === "string" ? (/^(https?:\/\/|$)/i.test(i.url.trim()) ? i.url.trim() : undefined) : undefined,
      alarm: i.alarm === null ? null : typeof i.alarm === "number" && Number.isFinite(i.alarm) && i.alarm >= 0 && i.alarm <= 40_320 ? Math.round(i.alarm) : undefined,
    };
    try {
      if (linkId === LOCAL) {
        const prev = id ? (await readEventCache(root))[LOCAL]?.find((x) => x.id === id) : undefined;
        const merged = {
          description: details.description ?? prev?.description,
          location: details.location ?? prev?.location,
          url: details.url ?? prev?.url,
          alarms: details.alarm === undefined ? prev?.alarms : details.alarm === null ? undefined : [details.alarm],
        };
        const ev: CachedEvent = {
          id: id ?? randomUUID(),
          title,
          when,
          ...(merged.description ? { description: merged.description } : {}),
          ...(merged.location ? { location: merged.location } : {}),
          ...(merged.url ? { url: merged.url } : {}),
          ...(merged.alarms?.length ? { alarms: merged.alarms } : {}),
        };
        await withCache(root, (c) => ({ ...c, [LOCAL]: [...(c[LOCAL] ?? []).filter((x) => x.id !== ev.id), ev] }));
        announce();
        return { ok: true, event: ev };
      }
      const link = (await readCalendarState(root)).links.find((l) => l.id === linkId && !l.dbId);
      const prov = link ? await provider(link.provider) : null;
      if (!link || !prov) return { ok: false, code: "auth", error: d("cal.notConnected") };
      let saved;
      if (id) {
        const current = await prov.getEvent(link.calendarId, id);
        if (!current) return { ok: false, code: "not_found", error: d("cal.eventGone") };
        saved = await prov.updateEvent(link.calendarId, current, { title, when, ...details });
      } else saved = await prov.createEvent(link.calendarId, { title, when, ...details });
      const ev = toCached(saved);
      await withCache(root, (c) => ({ ...c, [link.id]: [...(c[link.id] ?? []).filter((x) => x.id !== ev.id), ev] }));
      announce();
      return { ok: true, event: ev };
    } catch (e) {
      return failure(e);
    }
  });

  ipcMain.handle("nularche:calendar-event-delete", async (_e, linkId: unknown, eventId: unknown) => {
    const root = ctx.originRoot();
    if (!root || typeof linkId !== "string" || typeof eventId !== "string") return { ok: false, code: "invalid", error: "input" };
    try {
      if (linkId !== LOCAL) {
        const link = (await readCalendarState(root)).links.find((l) => l.id === linkId && !l.dbId);
        const prov = link ? await provider(link.provider) : null;
        if (!link || !prov) return { ok: false, code: "auth", error: d("cal.notConnected") };
        const current = await prov.getEvent(link.calendarId, eventId);
        if (current) await prov.deleteEvent(link.calendarId, current);
      }
      await withCache(root, (c) => ({ ...c, [linkId]: (c[linkId] ?? []).filter((x) => x.id !== eventId) }));
      announce();
      return { ok: true };
    } catch (e) {
      return failure(e);
    }
  });

  ipcMain.handle("nularche:calendar-sync", async () => {
    try {
      return await queueSync();
    } catch (e) {
      return { ok: false, errors: [(e as Error).message] };
    }
  });

  ipcMain.handle("nularche:calendar-help", (_e, which: unknown) => {
    if (dryRun) return;
    if (which === "google") return shell.openExternal(GOOGLE_CONSOLE_URL);
    if (which === "apple") return shell.openExternal(APPLE_PASSWORD_URL);
  });

  schedule();
  return { onOriginChanged: schedule };
}

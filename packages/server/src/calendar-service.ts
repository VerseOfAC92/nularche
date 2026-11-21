// Takvim işlemleri: masaüstü (Electron IPC) ve web sürümü aynı kodu kullanır. Hesap kimlik bilgilerinin nerede
// saklandığı (masaüstünde işletim sisteminin anahtar zinciri, web'de yalnızca bellek) ve sağlayıcı istemcisinin nasıl
// kurulduğu platforma bırakılır. Bağlantılar (`.nularche/calendar.json`) ve görüntüleme etkinlikleri
// (`.nularche/calendar-events.json`) Origin'de bu cihaza özeldir; eşitleme kuralları core/calendar.ts'tedir.

import {
  addLink,
  CalendarError,
  fetchViewEvents,
  isCalendarProvider,
  isDbLink,
  readCalendarState,
  readEventCache,
  removeLink,
  syncLink,
  toCached,
  writeCalendarState,
  writeEventCache,
  type CachedEvent,
  type CalendarErrorCode,
  type CalendarLink,
  type CalendarProvider,
  type CalendarProviderId,
  type EventTime,
} from "../../core/src/calendar.ts";
import type { CalDavCredentials, GoogleCredentials } from "../../core/src/calendar-providers.ts";
import { NodeError, NodeStore } from "../../core/src/node-store.ts";

export interface StoredAccount {
  account: string;
  google?: GoogleCredentials;
  apple?: CalDavCredentials;
}

/** Hesapların saklandığı yer (platforma özgü). */
export interface CalendarAccounts {
  read(p: CalendarProviderId): Promise<StoredAccount | null>;
  save(p: CalendarProviderId, account: StoredAccount): Promise<void>;
  remove(p: CalendarProviderId): Promise<void>;
}

export type CalendarText = "cal.untitled" | "cal.localCalendar" | "cal.eventGone" | "cal.notConnected";

export interface CalendarServiceContext {
  originRoot(): string | null;
  accounts: CalendarAccounts;
  provider(p: CalendarProviderId, account: StoredAccount): CalendarProvider | null;
  text(key: CalendarText): string;
  /** Bir eşitleme ya da değişiklik bittiğinde (arayüz yenilenir). */
  announce(): void;
}

export type CalendarFailure = { ok: false; code: CalendarErrorCode | "unknown"; error: string };

/** Arayüze dönen hata: kod arayüzde çevrilir, ileti ayrıntı olarak gösterilir. */
export const calendarFailure = (e: unknown): CalendarFailure => ({
  ok: false,
  code: e instanceof CalendarError || e instanceof NodeError ? e.code : "unknown",
  error: (e as Error).message,
});

/** Yerel takvimin önbellekteki anahtarı: hesap gerektirmez, Origin'de kalır. */
export const LOCAL_CALENDAR = "local";

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

export type CalendarService = ReturnType<typeof createCalendarService>;

export function createCalendarService(ctx: CalendarServiceContext) {
  async function provider(p: CalendarProviderId): Promise<CalendarProvider | null> {
    const acc = await ctx.accounts.read(p);
    return acc ? ctx.provider(p, acc) : null;
  }

  // --- Etkinlik önbelleği: okuma-değiştirme-yazma tek sırada ------------------------------------------
  let cacheQueue: Promise<unknown> = Promise.resolve();
  function withCache<T>(root: string, change: (cache: Record<string, CachedEvent[]>) => Record<string, CachedEvent[]> | Promise<Record<string, CachedEvent[]>>): Promise<void> {
    const run = cacheQueue.catch(() => undefined).then(async () => writeEventCache(root, await change(await readEventCache(root))));
    cacheQueue = run;
    return run;
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

  // --- Eşitleme: bağlantılar sırayla, aynı anda tek eşitleme --------------------------------------
  let running: Promise<unknown> | null = null;

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
      if (!prov) next = { ...link, lastError: { code: "auth", message: ctx.text("cal.notConnected") } };
      else if (!isDbLink(link)) {
        try {
          const events = await fetchViewEvents(prov, link);
          await withCache(root, (cache) => ({ ...cache, [link.id]: events }));
          next = { ...link, lastSync: Date.now(), lastError: null };
        } catch (e) {
          const f = calendarFailure(e);
          next = { ...link, lastError: { code: f.code, message: f.error } };
          errors.push(f.error);
        }
      } else {
        try {
          const report = await syncLink(store, prov, link, { untitled: ctx.text("cal.untitled") });
          next = report.link;
          if (report.errors.length) {
            next = { ...next, lastError: { code: "unknown", message: report.errors.slice(0, 3).join("\n") } };
            errors.push(...report.errors);
          }
        } catch (e) {
          const f = calendarFailure(e);
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
    ctx.announce();
    return { ok: errors.length === 0, errors };
  }

  function sync(only?: (l: CalendarLink) => boolean): Promise<{ ok: boolean; errors: string[] }> {
    const run = (running ?? Promise.resolve()).catch(() => undefined).then(() => syncAll(only));
    // Kuyruktaki son eşitleme bitince "eşitleniyor" durumu kalkar.
    const tracked: Promise<unknown> = run.finally(() => {
      if (running === tracked) running = null;
    });
    running = tracked;
    return run;
  }

  return {
    sync,
    provider,

    /** Bağlı hesaplar, bağlantılar ve eşitleme durumu (platforma özgü alanlar çağıran tarafından eklenir). */
    async status() {
      const root = ctx.originRoot();
      const accounts: Partial<Record<CalendarProviderId, string>> = {};
      for (const p of ["google", "apple"] as const) {
        const acc = await ctx.accounts.read(p);
        if (acc) accounts[p] = acc.account;
      }
      if (root) await pruneMissing(root);
      const links = root ? (await readCalendarState(root)).links : [];
      const cache = root ? await readEventCache(root) : {};
      return {
        accounts,
        syncing: !!running,
        links: links.map(({ items, ...l }) => ({ ...l, count: l.dbId ? Object.keys(items).length : (cache[l.id]?.length ?? 0) })),
      };
    },

    /** Hesabı doğrular ve kaydeder. */
    async connect(p: CalendarProviderId, account: Omit<StoredAccount, "account">): Promise<{ ok: true; account: string } | CalendarFailure> {
      try {
        const prov = ctx.provider(p, { account: "", ...account });
        if (!prov) return { ok: false, code: "invalid", error: "provider" };
        const name = await prov.account();
        await ctx.accounts.save(p, { account: name, ...account });
        return { ok: true, account: name };
      } catch (e) {
        return calendarFailure(e);
      }
    },

    async disconnect(p: unknown): Promise<void> {
      if (isCalendarProvider(p)) await ctx.accounts.remove(p);
    },

    async calendars(p: unknown) {
      if (!isCalendarProvider(p)) return { ok: false as const, code: "invalid" as const, error: "provider" };
      try {
        const prov = await provider(p);
        if (!prov) return { ok: false as const, code: "auth" as const, error: ctx.text("cal.notConnected") };
        return { ok: true as const, calendars: await prov.listCalendars() };
      } catch (e) {
        return calendarFailure(e);
      }
    },

    async link(input: unknown) {
      const root = ctx.originRoot();
      const i = (input ?? {}) as Record<string, unknown>;
      const s = (v: unknown) => (typeof v === "string" && v ? v : null);
      // Veritabanı isteğe bağlıdır: yoksa takvim yalnızca Takvim ekranında görüntülenir (not oluşturulmaz).
      const dbId = s(i.dbId);
      const calendarId = s(i.calendarId);
      const dateProp = s(i.dateProp);
      if (!root || !calendarId || !!dbId !== !!dateProp || !isCalendarProvider(i.provider)) return { ok: false as const, code: "invalid" as const, error: "input" };
      const { state, link } = addLink(await readCalendarState(root), {
        ...(dbId && dateProp ? { dbId, dateProp } : {}),
        provider: i.provider,
        calendarId,
        calendarName: s(i.calendarName) ?? calendarId,
      });
      await writeCalendarState(root, state);
      const res = await sync((l) => l.id === link.id);
      return { ok: true as const, linkId: link.id, errors: res.errors };
    },

    async unlink(linkId: unknown): Promise<void> {
      const root = ctx.originRoot();
      if (!root || typeof linkId !== "string") return;
      await running?.catch(() => undefined);
      await writeCalendarState(root, removeLink(await readCalendarState(root), linkId));
      await withCache(root, ({ [linkId]: _gone, ...rest }) => rest);
      ctx.announce();
    },

    // --- Takvim ekranı: görüntüleme bağlantılarının ve yerel takvimin etkinlikleri ----------------------
    async events() {
      const root = ctx.originRoot();
      if (!root) return { calendars: [] };
      const links = (await readCalendarState(root)).links.filter((l) => !l.dbId);
      const cache = await readEventCache(root);
      return {
        calendars: [
          { id: LOCAL_CALENDAR, provider: "local" as const, name: ctx.text("cal.localCalendar"), events: cache[LOCAL_CALENDAR] ?? [] },
          ...links.map((l) => ({ id: l.id, provider: l.provider, name: l.calendarName, events: cache[l.id] ?? [] })),
        ],
      };
    },

    /** Etkinlik oluşturur ya da günceller: yerel takvimde önbelleğe, bağlı takvimde sağlayıcıya yazar. */
    async eventSave(linkId: unknown, eventId: unknown, input: unknown) {
      const root = ctx.originRoot();
      const i = (input ?? {}) as Record<string, unknown>;
      const when = parseEventTime(i.when);
      if (!root || typeof linkId !== "string" || typeof i.title !== "string" || !when) return { ok: false as const, code: "invalid" as const, error: "input" };
      const id = typeof eventId === "string" && eventId ? eventId : null;
      const title = i.title.trim() || ctx.text("cal.untitled");
      // Ayrıntılar: verilmeyen alan değiştirilmez; boş dize alanı kaldırır.
      const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);
      const details = {
        description: text(i.description, 100_000),
        location: text(i.location, 2_000),
        url: typeof i.url === "string" ? (/^(https?:\/\/|$)/i.test(i.url.trim()) ? i.url.trim() : undefined) : undefined,
        alarm: i.alarm === null ? null : typeof i.alarm === "number" && Number.isFinite(i.alarm) && i.alarm >= 0 && i.alarm <= 40_320 ? Math.round(i.alarm) : undefined,
      };
      try {
        if (linkId === LOCAL_CALENDAR) {
          const prev = id ? (await readEventCache(root))[LOCAL_CALENDAR]?.find((x) => x.id === id) : undefined;
          const merged = {
            description: details.description ?? prev?.description,
            location: details.location ?? prev?.location,
            url: details.url ?? prev?.url,
            alarms: details.alarm === undefined ? prev?.alarms : details.alarm === null ? undefined : [details.alarm],
          };
          const ev: CachedEvent = {
            id: id ?? crypto.randomUUID(),
            title,
            when,
            ...(merged.description ? { description: merged.description } : {}),
            ...(merged.location ? { location: merged.location } : {}),
            ...(merged.url ? { url: merged.url } : {}),
            ...(merged.alarms?.length ? { alarms: merged.alarms } : {}),
          };
          await withCache(root, (c) => ({ ...c, [LOCAL_CALENDAR]: [...(c[LOCAL_CALENDAR] ?? []).filter((x) => x.id !== ev.id), ev] }));
          ctx.announce();
          return { ok: true as const, event: ev };
        }
        const link = (await readCalendarState(root)).links.find((l) => l.id === linkId && !l.dbId);
        const prov = link ? await provider(link.provider) : null;
        if (!link || !prov) return { ok: false as const, code: "auth" as const, error: ctx.text("cal.notConnected") };
        let saved;
        if (id) {
          const current = await prov.getEvent(link.calendarId, id);
          if (!current) return { ok: false as const, code: "not_found" as const, error: ctx.text("cal.eventGone") };
          saved = await prov.updateEvent(link.calendarId, current, { title, when, ...details });
        } else saved = await prov.createEvent(link.calendarId, { title, when, ...details });
        const ev = toCached(saved);
        await withCache(root, (c) => ({ ...c, [link.id]: [...(c[link.id] ?? []).filter((x) => x.id !== ev.id), ev] }));
        ctx.announce();
        return { ok: true as const, event: ev };
      } catch (e) {
        return calendarFailure(e);
      }
    },

    async eventDelete(linkId: unknown, eventId: unknown) {
      const root = ctx.originRoot();
      if (!root || typeof linkId !== "string" || typeof eventId !== "string") return { ok: false as const, code: "invalid" as const, error: "input" };
      try {
        if (linkId !== LOCAL_CALENDAR) {
          const link = (await readCalendarState(root)).links.find((l) => l.id === linkId && !l.dbId);
          const prov = link ? await provider(link.provider) : null;
          if (!link || !prov) return { ok: false as const, code: "auth" as const, error: ctx.text("cal.notConnected") };
          const current = await prov.getEvent(link.calendarId, eventId);
          if (current) await prov.deleteEvent(link.calendarId, current);
        }
        await withCache(root, (c) => ({ ...c, [linkId]: (c[linkId] ?? []).filter((x) => x.id !== eventId) }));
        ctx.announce();
        return { ok: true as const };
      } catch (e) {
        return calendarFailure(e);
      }
    },
  };
}

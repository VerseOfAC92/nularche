// Masaüstü takvim eşitleme: Google / Apple hesap bağlantısı, kimlik bilgilerinin işletim sisteminin anahtar
// zinciriyle (safeStorage) şifreli saklanması ve arka planda eşitleme. Takvim işlemlerinin kendisi web sürümüyle
// ortaktır (server/src/calendar-service.ts); bu dosya yalnızca masaüstüne özgü kısımları ve IPC'yi içerir.
// Kimlik bilgileri bu bilgisayardaki ayar klasöründe kalır; Origin'e yalnızca eşleme durumu yazılır.

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { ipcMain, safeStorage, shell, type BrowserWindow } from "electron";
import { CalendarError, type CalendarProviderId } from "../../core/src/calendar.ts";
import { CalDavCalendar, GoogleCalendar, GOOGLE_SCOPES } from "../../core/src/calendar-providers.ts";
import { calendarFailure, createCalendarService, type StoredAccount } from "../../server/src/calendar-service.ts";
import { authorizeGoogle, builtInGoogleClient, googleEndpoints } from "./google-auth.ts";
import { describeError } from "../../core/src/errors.ts";
import { d, desktopLang } from "./i18n.ts";

/** Uçtan uca testlerde gerçek Anahtar Zinciri ve tarayıcı kullanılmaz. */
const dryRun = !!process.env.NULARCHE_E2E;
/** Testler için sağlayıcı adresleri değiştirilebilir. */
const google = { token: googleEndpoints.token, api: process.env.NULARCHE_GOOGLE_API || undefined };
const CALDAV_SERVER = process.env.NULARCHE_CALDAV || undefined;
const GOOGLE_CONSOLE_URL = "https://console.cloud.google.com/apis/credentials";
const APPLE_PASSWORD_URL = "https://account.apple.com/account/manage";
/** Arka plan eşitleme aralığı. */
const INTERVAL_MS = 5 * 60_000;

export interface CalendarContext {
  window: () => BrowserWindow | null;
  originRoot: () => string | null;
  configDir: () => string;
}

export function registerCalendarIpc(ctx: CalendarContext): { onOriginChanged: () => void } {
  const credFile = (p: CalendarProviderId) => path.join(ctx.configDir(), `calendar-${p}.bin`);
  const canEncrypt = () => dryRun || safeStorage.isEncryptionAvailable();

  const service = createCalendarService({
    originRoot: ctx.originRoot,
    text: (key) => d(key),
    announce: () => ctx.window()?.webContents.send("nularche:calendar-synced"),
    provider: (p, acc) => {
      if (p === "google" && acc.google) return new GoogleCalendar(acc.google, { token: google.token, api: google.api });
      if (p === "apple" && acc.apple) return new CalDavCalendar({ server: CALDAV_SERVER, ...acc.apple });
      return null;
    },
    accounts: {
      async read(p) {
        try {
          const buf = await readFile(credFile(p));
          const text = dryRun ? buf.toString("utf8") : safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : null;
          return text ? (JSON.parse(text) as StoredAccount) : null;
        } catch {
          return null;
        }
      },
      async save(p, acc) {
        await mkdir(ctx.configDir(), { recursive: true });
        const text = JSON.stringify(acc);
        await writeFile(credFile(p), dryRun ? Buffer.from(text) : safeStorage.encryptString(text), { mode: 0o600 });
      },
      remove: (p) => rm(credFile(p), { force: true }),
    },
  });

  let timer: NodeJS.Timeout | null = null;
  function schedule(): void {
    if (timer) clearInterval(timer);
    if (dryRun) return; // testler eşitlemeyi elle başlatır
    timer = setInterval(() => void service.sync().catch(() => undefined), INTERVAL_MS);
    timer.unref?.();
    setTimeout(() => void service.sync().catch(() => undefined), 5_000).unref?.();
  }

  // --- IPC -----------------------------------------------------------------------------------------
  ipcMain.handle("nularche:calendar-status", async () => ({
    encryption: canEncrypt(),
    googleOneClick: dryRun || !!builtInGoogleClient(),
    ...(await service.status()),
  }));

  // Tek tıkla bağlanma: yerleşik Nularche istemcisiyle. Yerleşik istemci yoksa (yerel geliştirme derlemesi)
  // kullanıcının kendi istemcisi verilebilir.
  ipcMain.handle("nularche:calendar-connect-google", async (_e, clientId: unknown, clientSecret: unknown) => {
    const own = typeof clientId === "string" && clientId.trim() && typeof clientSecret === "string" && clientSecret.trim() ? { clientId: clientId.trim(), clientSecret: clientSecret.trim() } : null;
    const client = own ?? builtInGoogleClient();
    if (!client) return { ok: false, code: "invalid", error: d("cal.missingClient") };
    if (!canEncrypt()) return { ok: false, code: "invalid", error: d("ai.noEncryption") };
    try {
      const creds = { ...client, refreshToken: await authorizeGoogle(client, GOOGLE_SCOPES, (m) => new CalendarError("auth", m)) };
      return await service.connect("google", { google: creds });
    } catch (e) {
      return calendarFailure(e);
    }
  });

  ipcMain.handle("nularche:calendar-connect-apple", async (_e, username: unknown, password: unknown) => {
    if (typeof username !== "string" || !username.trim() || typeof password !== "string" || !password.trim()) {
      return { ok: false, code: "invalid", error: d("cal.missingApple") };
    }
    if (!canEncrypt()) return { ok: false, code: "invalid", error: d("ai.noEncryption") };
    // Uygulamaya özel parolalar `abcd-efgh-ijkl-mnop` biçiminde gösterilir; boşluklarla yapıştırılabilir.
    return service.connect("apple", { apple: { username: username.trim(), password: password.replace(/\s+/g, "") } });
  });

  ipcMain.handle("nularche:calendar-disconnect", (_e, p: unknown) => service.disconnect(p));
  ipcMain.handle("nularche:calendar-calendars", (_e, p: unknown) => service.calendars(p));
  ipcMain.handle("nularche:calendar-link", (_e, input: unknown) => service.link(input));
  ipcMain.handle("nularche:calendar-unlink", (_e, linkId: unknown) => service.unlink(linkId));
  ipcMain.handle("nularche:calendar-events", () => service.events());
  ipcMain.handle("nularche:calendar-event-save", (_e, linkId: unknown, eventId: unknown, input: unknown) => service.eventSave(linkId, eventId, input));
  ipcMain.handle("nularche:calendar-event-delete", (_e, linkId: unknown, eventId: unknown) => service.eventDelete(linkId, eventId));
  ipcMain.handle("nularche:calendar-sync", async () => {
    try {
      return await service.sync();
    } catch (e) {
      return { ok: false, errors: [describeError(e, desktopLang())] };
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

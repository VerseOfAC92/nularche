// Web sürümünün açılışı (nularche.verseofac.com/app): service worker bağlanır, giriş penceresi Google ile oturum açtırır,
// notlar belleğe yüklenince Google Takvim de (izin verildiyse) bağlanır ve uygulama arayüzü açılır. Sağlayıcı dışarıdan
// verilir: üretimde Google, denetimlerde sahte Drive ve Takvim.

import "../../../web-platform/src/globals.ts";
import type { GoogleEndpoints } from "../../../core/src/calendar-providers.ts";
import { startHost } from "../../../web-platform/src/host.ts";
import type { SyncStatus } from "../../../web-platform/src/session.ts";
import type { WebDriveStatus, WebSession } from "../desktop.ts";
import "../studio/fonts/nularche-font.css";
import { createWebCalendar } from "./calendar-web.ts";
import { showSignIn, type SignInProvider } from "./signin.ts";
import "./signin.css";

declare global {
  interface Window {
    /** Açık oturum (arayüzdeki Drive durumu, takvim, çıkış ve kilit kullanır). */
    nularcheWeb?: WebSession;
  }
}

export async function bootWeb(provider: SignInProvider, options: { calendarEndpoints?: GoogleEndpoints } = {}): Promise<WebSession> {
  await startHost("/app/sw.js", "/app/");
  let drive: WebDriveStatus = { state: "starting" };
  const listeners = new Set<() => void>();
  const onStatus = (s: SyncStatus) => {
    drive = s.state === "idle" ? { state: "idle", at: s.at } : s;
    listeners.forEach((cb) => cb());
  };
  const { origin, signed } = await showSignIn(provider, onStatus);
  const calendar = createWebCalendar({ originRoot: () => origin.store.root, google: signed.calendar, endpoints: options.calendarEndpoints });
  // Takvim bağlanamazsa (ör. izin verilmedi ya da ağ hatası) notlar yine açılır; Ayarlar'dan yeniden denenebilir.
  await calendar.autoConnect().catch((err) => console.warn("Google Takvim bağlanamadı:", err));
  const session: WebSession = {
    account: signed.account,
    encrypted: origin.root.encrypted,
    calendar: calendar.bridge,
    driveStatus: () => drive,
    onDriveStatus(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    async syncNow() {
      await origin.sync().catch(() => undefined);
    },
    async signOut() {
      calendar.close();
      await origin.close({ flush: true });
      await signed.signOut().catch(() => undefined);
      location.replace("/app/");
    },
  };
  window.nularcheWeb = session;
  await import("../main.tsx");
  return session;
}

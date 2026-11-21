// Web sürümünün açılışı (nularche.verseofac.com/app): service worker bağlanır, giriş penceresi Google ile oturum açtırır,
// notlar belleğe yüklenince Google Takvim de (izin verildiyse) bağlanır ve uygulama arayüzü açılır. Sağlayıcı dışarıdan
// verilir: üretimde Google, denetimlerde sahte Drive ve Takvim.

import "../../../web-platform/src/globals.ts";
import type { GoogleEndpoints } from "../../../core/src/calendar-providers.ts";
import { startHost } from "../../../web-platform/src/host.ts";
import type { SyncStatus } from "../../../web-platform/src/session.ts";
import type { WebDriveStatus, WebSession } from "../desktop.ts";
import "../studio/fonts/nularche-font.css";
import { createWebAi } from "./ai-web.ts";
import { createWebCalendar } from "./calendar-web.ts";
import { showSignIn, type SignInProvider } from "./signin.ts";
import "./signin.css";

declare global {
  interface Window {
    /** Açık oturum (arayüzdeki Drive durumu, takvim, çıkış ve kilit kullanır). */
    nularcheWeb?: WebSession;
  }
}

export async function bootWeb(provider: SignInProvider, options: { calendarEndpoints?: GoogleEndpoints; geminiApi?: string } = {}): Promise<WebSession> {
  await startHost("/app/sw.js", "/app/");
  let drive: WebDriveStatus = { state: "starting" };
  const listeners = new Set<() => void>();
  const onStatus = (s: SyncStatus) => {
    drive = s.state === "idle" ? { state: "idle", at: s.at } : s;
    listeners.forEach((cb) => cb());
  };
  // Kilitlemeden ya da çıkıştan sonra giriş penceresi bunu bildirir; adres temizlenir.
  const after = new URLSearchParams(location.search).get("ended");
  if (after) history.replaceState(null, "", "/app/");
  const { origin, signed } = await showSignIn(provider, onStatus, after === "locked" || after === "signed-out" ? after : null);
  const calendar = createWebCalendar({ originRoot: () => origin.store.root, google: signed.calendar, endpoints: options.calendarEndpoints });
  const ai = createWebAi({ originRoot: () => origin.store.root, api: options.geminiApi });
  // Takvim bağlanamazsa (ör. izin verilmedi ya da ağ hatası) notlar yine açılır; Ayarlar'dan yeniden denenebilir.
  await calendar.autoConnect().catch((err) => console.warn("Google Takvim bağlanamadı:", err));
  const session: WebSession = {
    account: signed.account,
    encrypted: origin.root.encrypted,
    calendar: calendar.bridge,
    ai: ai.bridge,
    driveStatus: () => drive,
    onDriveStatus(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    async syncNow() {
      await origin.sync().catch(() => undefined);
    },
    lock: () => end("locked"),
    signOut: () => end("signed-out"),
  };
  /** Oturumu bitirir: bekleyen değişiklikler gönderilir, bellek silinir, sayfa yeniden yüklenir (React durumu da gider). */
  async function end(how: "locked" | "signed-out") {
    removeEventListener("beforeunload", warn);
    calendar.close();
    ai.close();
    await origin.close({ flush: true });
    if (how === "signed-out") await signed.signOut().catch(() => undefined);
    location.replace(`/app/?ended=${how}`);
  }
  // Drive'a gönderilmemiş değişiklik varken sekme kapatılırsa tarayıcı uyarır.
  const warn = (e: BeforeUnloadEvent) => {
    if (!origin.pending()) return;
    e.preventDefault();
    void origin.sync().catch(() => undefined);
  };
  addEventListener("beforeunload", warn);
  window.nularcheWeb = session;
  await import("../main.tsx");
  return session;
}

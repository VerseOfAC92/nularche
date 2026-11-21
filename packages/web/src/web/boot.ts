// Web sürümünün açılışı (nularche.verseofac.com/app): service worker bağlanır, giriş penceresi Google ile oturum açtırır,
// notlar belleğe yüklenince uygulama arayüzü açılır. Sağlayıcı dışarıdan verilir: üretimde Google, denetimlerde sahte Drive.

import "../../../web-platform/src/globals.ts";
import { startHost } from "../../../web-platform/src/host.ts";
import "../studio/fonts/nularche-font.css";
import { showSignIn, type OpenedSession, type SignInProvider } from "./signin.ts";
import "./signin.css";

declare global {
  interface Window {
    /** Açık oturum (arayüzdeki çıkış ve kilit düğmeleri kullanır). */
    nularcheWeb?: OpenedSession;
  }
}

export async function bootWeb(provider: SignInProvider): Promise<OpenedSession> {
  await startHost("/app/sw.js", "/app/");
  const session = await showSignIn(provider);
  window.nularcheWeb = session;
  await import("../main.tsx");
  return session;
}

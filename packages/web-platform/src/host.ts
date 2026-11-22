// Sayfa tarafı: service worker'ı kaydeder ve ondan gelen /api, /files isteklerini API işleyicisine verir.
// İşleyici, Origin açılınca (oturum açma + parola) `setApiHandler` ile bağlanır; kilitlenince ya da çıkışta
// `setApiHandler(null)` ile kaldırılır ve istekler 503 alır.

import { answerRequest, isBridgeRequest, type ApiHandler } from "./bridge.ts";

let handler: ApiHandler | null = null;
let listening = false;

export function setApiHandler(next: ApiHandler | null): void {
  handler = next;
}

/**
 * Service worker'ı kaydeder ve sayfa onun denetimine girene kadar bekler (ilk ziyarette `clients.claim` ile).
 * Döndükten sonra /api ve /files istekleri güvenle yapılabilir.
 */
export async function startHost(scriptUrl: string, scope: string): Promise<void> {
  const sw = navigator.serviceWorker;
  // Kod giriş penceresinde kullanıcının dilinde açıklanır (ör. özel pencerede service worker kapalı olabilir).
  if (!sw) throw Object.assign(new Error("no_service_worker"), { code: "no_service_worker" });
  if (!listening) {
    listening = true;
    sw.addEventListener("message", (event: MessageEvent) => {
      const port = event.ports[0];
      if (!port || !isBridgeRequest(event.data)) return;
      void answerRequest(event.data, port, handler);
    });
    sw.startMessages();
  }
  await sw.register(scriptUrl, { scope, updateViaCache: "none" });
  await sw.ready;
  if (!sw.controller) await new Promise<void>((resolve) => sw.addEventListener("controllerchange", () => resolve(), { once: true }));
}

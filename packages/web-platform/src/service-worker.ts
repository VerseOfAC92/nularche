// Web sürümünün service worker'ı: sayfanın /api ve /files isteklerini, isteği yapan sayfadaki API işleyicisine
// iletir (bkz. bridge.ts). Başka hiçbir isteğe dokunmaz ve hiçbir şeyi önbelleğe ya da diske yazmaz; notlar yalnızca
// sayfanın belleğinde durur.

/// <reference lib="webworker" />
import { forwardRequest, shouldForward } from "./bridge.ts";

declare const self: ServiceWorkerGlobalScope;

self.addEventListener("install", () => void self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  if (!shouldForward(event.request, self.location.origin)) return;
  event.respondWith(
    (async () => {
      // İsteği yapan pencere; bir worker'dan (ör. pdf.js) geldiyse aynı kaynaktaki açık Nularche penceresi.
      let client = event.clientId ? await self.clients.get(event.clientId) : undefined;
      if (!client || client.type !== "window") client = (await self.clients.matchAll({ type: "window" }))[0];
      if (!client) {
        const tr = (self.navigator.language || "").toLowerCase().startsWith("tr");
        return new Response(JSON.stringify({ error: tr ? "Açık Nularche penceresi yok." : "No Nularche window is open." }), { status: 503, headers: { "content-type": "application/json" } });
      }
      const target = client;
      return forwardRequest(event.request, (message, transfer) => target.postMessage(message, transfer));
    })(),
  );
});

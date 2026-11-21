// Service worker ↔ sayfa taşıyıcısı (bridge.ts): iki taraf gerçek bir MessageChannel ile bağlanır; son testte sayfa
// tarafında gerçek API işleyicisi (server/src/api.ts) çalışır.

import "../src/globals.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { answerRequest, forwardRequest, shouldForward, type ApiHandler } from "../src/bridge.ts";

/** Service worker'ın `client.postMessage` çağrısının yerine: mesajı aynı süreçteki "sayfaya" verir. */
const via = (handler: ApiHandler | null) => (message: Parameters<typeof answerRequest>[0], transfer: Transferable[]) => {
  const port = transfer[0] as MessagePort;
  void answerRequest(structuredClone(message, { transfer: transfer.slice(1) }), port, handler);
};

test("bridge: yalnızca aynı kaynaktaki /api ve /files istekleri iletilir", () => {
  const o = "https://nularche.verseofac.com";
  assert.equal(shouldForward({ url: `${o}/api/nodes`, mode: "cors" }, o), true);
  assert.equal(shouldForward({ url: `${o}/files/a.png`, mode: "no-cors" }, o), true);
  assert.equal(shouldForward({ url: `${o}/files/a.png`, mode: "navigate" }, o), false, "sayfa geçişi ağa kalır");
  assert.equal(shouldForward({ url: `${o}/app/index.html`, mode: "same-origin" }, o), false);
  assert.equal(shouldForward({ url: "https://evil.example/api/nodes", mode: "cors" }, o), false);
  assert.equal(shouldForward({ url: `${o}/apix`, mode: "cors" }, o), false);
});

test("bridge: JSON, ikili gövde, başlıklar ve hata durumları aynen geçer", async () => {
  const handler: ApiHandler = async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/api/echo") {
      const body = new Uint8Array(await req.arrayBuffer());
      return new Response(JSON.stringify({ method: req.method, type: req.headers.get("content-type"), size: body.length, last: body.at(-1) }), {
        status: 201,
        headers: { "content-type": "application/json", "x-test": "1" },
      });
    }
    if (url.pathname === "/files/big.bin") return new Response(new Uint8Array(3 * 1024 * 1024).fill(7));
    if (url.pathname === "/api/empty") return new Response(null, { status: 204 });
    if (url.pathname === "/api/throw") throw new Error("patladı");
    return null;
  };
  const upload = new Uint8Array(5 * 1024 * 1024).fill(9);
  const r = await forwardRequest(new Request("https://x.test/api/echo", { method: "POST", body: upload, headers: { "content-type": "application/octet-stream" } }), via(handler));
  assert.equal(r.status, 201);
  assert.equal(r.headers.get("x-test"), "1");
  assert.deepEqual(await r.json(), { method: "POST", type: "application/octet-stream", size: upload.length, last: 9 });

  const big = await forwardRequest(new Request("https://x.test/files/big.bin"), via(handler));
  const bytes = new Uint8Array(await big.arrayBuffer());
  assert.equal(bytes.length, 3 * 1024 * 1024);
  assert.equal(bytes[bytes.length - 1], 7);

  assert.equal((await forwardRequest(new Request("https://x.test/api/empty"), via(handler))).status, 204);
  assert.equal((await forwardRequest(new Request("https://x.test/api/none"), via(handler))).status, 404);
  const thrown = await forwardRequest(new Request("https://x.test/api/throw"), via(handler));
  assert.equal(thrown.status, 500);
  assert.match((await thrown.json()).error, /patladı/);
  assert.equal((await forwardRequest(new Request("https://x.test/api/echo"), via(null))).status, 503, "kilitliyken 503");
});

test("bridge: sayfa yanıt vermezse istek zaman aşımıyla biter", async () => {
  const r = await forwardRequest(new Request("https://x.test/api/nodes"), () => undefined, 50);
  assert.equal(r.status, 504);
});

test("bridge: canlı olaylar (SSE) akar; okuyucu kapanınca işleyicinin isteği iptal edilir", async () => {
  const { EventHub } = await import("../../server/src/api.ts");
  const hub = new EventHub();
  let aborted: Promise<void> | null = null;
  const handler: ApiHandler = async (req) => {
    aborted = new Promise((resolve) => req.signal.addEventListener("abort", () => resolve()));
    return hub.stream(req.signal);
  };
  const res = await forwardRequest(new Request("https://x.test/api/events"), via(handler));
  assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  hub.emit("change");
  while (!text.includes("change")) text += decoder.decode((await reader.read()).value);
  assert.match(text, /change/);
  await reader.cancel();
  await Promise.race([aborted, new Promise((_, rej) => setTimeout(() => rej(new Error("iptal sayfaya ulaşmadı")), 1000))]);
});

test("bridge: gerçek API işleyicisi taşıyıcı üzerinden uçtan uca çalışır", async () => {
  // Çekirdeğin bellek içi dosya sisteminde çalışması api-handler.test.ts ile (npm run test:web-platform) denetlenir.
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { NodeStore } = await import("../../core/src/node-store.ts");
  const { AiActivity } = await import("../../core/src/ai-activity.ts");
  const { CommentStore } = await import("../../core/src/comments.ts");
  const { Anamnesis } = await import("../../core/src/anamnesis.ts");
  const { createApi, EventHub } = await import("../../server/src/api.ts");
  const store = new NodeStore(await mkdtemp(join(tmpdir(), "nularche-bridge-")));
  await store.ensureRoot();
  const api = createApi({ store, activity: new AiActivity(store.root), comments: new CommentStore(store), anamnesis: new Anamnesis(store), events: new EventHub() });
  const fetchVia = (url: string, init?: RequestInit) => forwardRequest(new Request(`https://x.test${url}`, init), via((r) => api.handle(r)));
  const created = await fetchVia("/api/nodes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Web", parentNodeId: null, body: "tarayıcıdan #web" }) });
  assert.equal(created.status, 201);
  const list = (await (await fetchVia("/api/nodes")).json()) as { nodes: { title: string }[] };
  assert.ok(list.nodes.some((n) => n.title === "Web"));
  const up = await fetchVia("/api/attachments?name=a.png", { method: "POST", body: new Uint8Array([137, 80, 78, 71]) });
  const { path: rel } = (await up.json()) as { path: string };
  const file = await fetchVia(`/files/${rel.split("/").map(encodeURIComponent).join("/")}`);
  assert.equal(file.headers.get("content-type"), "image/png");
  assert.equal((await file.arrayBuffer()).byteLength, 4);
});

// Ortak API işleyicisi (server/src/api.ts): HTTP sunucusu olmadan, standart Request/Response ile. Aynı test web
// platform katmanında da çalışır (npm run test:web-platform): tarayıcıdaki API ile masaüstündeki aynı davranır.

import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { AiActivity } from "../src/ai-activity.ts";
import { Anamnesis } from "../src/anamnesis.ts";
import { CommentStore } from "../src/comments.ts";
import { NodeStore } from "../src/node-store.ts";
import { createApi, EventHub } from "../../server/src/api.ts";

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "nularche-api-"));
  const store = new NodeStore(root);
  await store.ensureRoot();
  const events = new EventHub();
  const api = createApi({ store, activity: new AiActivity(store.root), comments: new CommentStore(store), anamnesis: new Anamnesis(store), events });
  const call = async (method: string, url: string, body?: unknown) => {
    const res = await api.handle(new Request(`http://app.local${url}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }) }));
    assert.ok(res, `${url} işlenmeli`);
    return { status: res.status, type: res.headers.get("content-type"), json: res.headers.get("content-type")?.includes("json") ? await res.json() : null, res };
  };
  return { api, call, events, store };
}

test("API: not oluşturma, okuma, güncelleme, çakışma ve arama", async () => {
  const { call } = await setup();
  const created = await call("POST", "/api/nodes", { title: "Plan", parentNodeId: null, body: "ilk #taslak" });
  assert.equal(created.status, 201);
  const id = created.json.id as string;
  const read = await call("GET", `/api/nodes/${id}`);
  assert.equal(read.json.body.trim(), "ilk #taslak");
  const upd = await call("PUT", `/api/nodes/${id}`, { body: "ikinci", baseRevision: read.json.revision });
  assert.equal(upd.status, 200);
  const stale = await call("PUT", `/api/nodes/${id}`, { body: "eski", baseRevision: read.json.revision });
  assert.equal(stale.status, 409, "eski sürümle yazma çakışma verir");
  assert.equal((await call("GET", "/api/search?q=ikinci")).json.results.length, 1);
  assert.equal((await call("GET", "/api/nodes/yok")).status, 404);
  assert.equal((await call("GET", "/api/bilinmeyen")).status, 404);
  assert.equal((await call("POST", "/api/nodes", "{bozuk")).status, 400);
});

test("API: ekler /files ile güvenli başlıklarla sunulur; gizli klasör ve Origin dışı reddedilir", async () => {
  const { api, call } = await setup();
  const up = await api.handle(new Request("http://app.local/api/attachments?name=resim.png", { method: "POST", body: new Uint8Array([137, 80, 78, 71]) }));
  const { path: rel } = (await up!.json()) as { path: string };
  const file = await call("GET", `/files/${rel.split("/").map(encodeURIComponent).join("/")}`);
  assert.equal(file.status, 200);
  assert.equal(file.type, "image/png");
  assert.equal(file.res.headers.get("content-security-policy"), "sandbox");
  assert.equal(new Uint8Array(await file.res.arrayBuffer()).length, 4);
  // Gizli klasör ve Origin dışı yollar geçersiz istek olarak reddedilir (dosya hiç okunmaz).
  assert.equal((await call("GET", "/files/.nularche/ui.json")).status, 400);
  assert.equal((await call("GET", "/files/..%2F..%2Fetc%2Fpasswd")).status, 400, "kodlanmış / ile Origin dışına çıkılamaz");
  assert.equal((await call("GET", "/files/Attachments/yok.png")).status, 404);
  assert.equal(await api.handle(new Request("http://app.local/index.html")), null, "arayüz dosyaları taşıyıcıya kalır");
});

test("API: sınırı aşan istek gövdesi reddedilir; anlık görüntüler yoksa açıkça bildirilir", async () => {
  const { api, call } = await setup();
  const big = await api.handle(new Request("http://app.local/api/attachments?name=a.bin", { method: "POST", body: new Uint8Array(201 * 1024 * 1024) }));
  assert.equal(big!.status, 400);
  const snaps = await call("GET", "/api/snapshots");
  assert.equal(snaps.status, 404);
  assert.equal(snaps.json.error, "unavailable");
});

test("API: canlı bildirimler akış olarak gelir ve iptal edilince kapanır", async () => {
  const { api, events } = await setup();
  const abort = new AbortController();
  const res = await api.handle(new Request("http://app.local/api/events", { signal: abort.signal }));
  assert.equal(res!.headers.get("content-type"), "text/event-stream");
  const reader = res!.body!.getReader();
  const dec = new TextDecoder();
  assert.match(dec.decode((await reader.read()).value), /bağlandı/);
  events.emit("change");
  assert.match(dec.decode((await reader.read()).value), /event: change/);
  abort.abort();
  assert.equal((await reader.read()).done, true);
});

test("API: değişen dosyanın arayüz olayı masaüstü ve web için aynı kuralla seçilir", async () => {
  const { changeEventFor } = await import("../../server/src/api.ts");
  assert.equal(changeEventFor("Plan.md"), "change");
  assert.equal(changeEventFor("Arche/Alt/Not.md"), "change");
  assert.equal(changeEventFor(".nularche/ai/requests/abc.json"), "ai", "Nularche AI cevabı ayrı olayla bildirilir");
  assert.equal(changeEventFor(".nularche/comments/x.json"), "comments");
  assert.equal(changeEventFor(".nularche/drive-sync.json"), null, "eşitleme durumu bildirilmez");
  assert.equal(changeEventFor(".trash/Plan.md"), null);
  assert.equal(changeEventFor("Plan.md.1234.tmp"), "change");
});

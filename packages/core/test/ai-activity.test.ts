import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { AiActivity, NodeStore, providerFromClient } from "../src/index.ts";

let dir: string;
let store: NodeStore;
let ai: AiActivity;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "nlc-act-"));
  store = new NodeStore(dir);
  ai = new AiActivity(dir);
});
afterEach(async () => rm(dir, { recursive: true, force: true }));

/** MCP sunucusundaki update_node akışının aynısı: anlık kopya al, güncelle, değişikliği kaydet. */
async function aiEdit(id: string, body: string) {
  const before = await store.read(id);
  const snapshot = await ai.snapshot(id, (await store.readRaw(before.path)).toString("utf8"));
  const after = await store.update(id, { body, baseRevision: before.revision });
  await ai.recordChange({ nodeId: id, title: after.title, snapshot, beforeRevision: before.revision, afterRevision: after.revision, at: Date.now() });
  return after;
}

test("istemci adından sağlayıcı tahmini", () => {
  assert.equal(providerFromClient("claude-ai"), "claude");
  assert.equal(providerFromClient("local-agent-mode-nularche"), "claude");
  assert.equal(providerFromClient("codex-mcp-client"), "chatgpt");
  assert.equal(providerFromClient("antigravity"), "gemini");
  assert.equal(providerFromClient("bilinmeyen"), null);
});

test("bağlanan istemciler kaydedilir", async () => {
  await ai.recordClient("claude-ai", "0.1");
  const again = await ai.recordClient("claude-ai", "0.2");
  const list = await ai.clients();
  assert.equal(list.length, 1);
  assert.equal(list[0].provider, "claude");
  assert.equal(list[0].version, "0.2");
  assert.ok(again.firstSeen <= again.lastSeen);
});

test("istek yaşam döngüsü, değişiklik kaydı ve geri alma", async () => {
  const node = await store.create({ title: "Toplantı", body: "ilk hali" });
  const req = await ai.createRequest({
    provider: "chatgpt",
    label: "Düzelt",
    instruction: "yazım hatalarını düzelt",
    nodeId: node.id,
    nodeTitle: node.title,
  });
  assert.equal(req.status, "pending");
  const taken = await ai.takeRequest(undefined, "codex-mcp-client");
  assert.equal(taken?.id, req.id);
  assert.equal(taken?.status, "received");
  await aiEdit(node.id, "ikinci hali");
  await aiEdit(node.id, "üçüncü hali");
  const done = await ai.completeRequest(req.id, "İki düzeltme yaptım.");
  assert.equal(done.status, "done");
  assert.equal((await ai.getRequest(req.id)).changes.length, 2);

  const res = await ai.undo(store, req.id);
  assert.deepEqual(res, { restored: ["Toplantı"], skipped: [] });
  assert.equal((await store.read(node.id)).body.trim(), "ilk hali");
  assert.ok((await ai.getRequest(req.id)).undoneAt);
});

test("geri alma, sonradan elle değiştirilmiş Node'u atlar", async () => {
  const node = await store.create({ title: "N", body: "a" });
  const req = await ai.createRequest({ provider: "claude", label: "x", instruction: "x" });
  await ai.takeRequest(req.id, "claude-ai");
  await aiEdit(node.id, "b");
  await store.update(node.id, { body: "kullanıcı değiştirdi" });
  const res = await ai.undo(store, req.id);
  assert.deepEqual(res.skipped, ["N"]);
  assert.equal((await store.read(node.id)).body.trim(), "kullanıcı değiştirdi");
});

test("etkin istek yokken değişiklik bağlanmaz; boş istek ve geçersiz kimlik reddedilir", async () => {
  const node = await store.create({ title: "N", body: "a" });
  assert.equal(await ai.recordChange({ nodeId: node.id, title: "N", snapshot: "x", beforeRevision: "1", afterRevision: "2", at: 0 }), null);
  await assert.rejects(ai.createRequest({ provider: null, label: "", instruction: "  " }));
  await assert.rejects(ai.getRequest("../../kacis"));
  assert.equal(await readFile(path.join(dir, "N.md"), "utf8").then(() => true), true);
});

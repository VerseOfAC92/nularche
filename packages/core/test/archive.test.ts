import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { zipSync } from "fflate";
import { exportArchive, importArchive, NodeError, NodeStore } from "../src/index.ts";

let a: string;
let b: string;
let src: NodeStore;
let dst: NodeStore;

beforeEach(async () => {
  a = await mkdtemp(path.join(tmpdir(), "nlc-a-"));
  b = await mkdtemp(path.join(tmpdir(), "nlc-b-"));
  src = new NodeStore(a);
  dst = new NodeStore(b);
});
afterEach(async () => {
  await rm(a, { recursive: true, force: true });
  await rm(b, { recursive: true, force: true });
});

test(".nlc tek Node'u alt Node'ları, ekleri ve bağlantılarıyla taşır", async () => {
  const proje = await src.create({ title: "Proje" });
  const img = await src.saveAttachment("şema.png", new Uint8Array([9, 9]));
  const alt = await src.create({ title: "Alt", parentNodeId: proje.id, body: `![ş](../${img})\n\n[Üst](../Proje.md)` });
  await src.update(proje.id, { body: "[Alt](Proje/Alt.md)", fields: { cover: img } });
  await src.create({ title: "Dışarıda" });

  const { data, manifest } = await exportArchive(src, { rootId: proje.id, kind: "nlc" });
  assert.equal(manifest.nodeCount, 2);
  assert.equal(manifest.attachmentCount, 1);
  assert.deepEqual(manifest.roots, ["nodes/Proje.md"]);

  await dst.create({ title: "Proje", parentNodeId: "shadow" }); // ad çakışması
  const res = await importArchive(dst, data);
  assert.equal(res.imported, 2);
  const nodes = await dst.list();
  const imported = nodes.find((n) => n.path === "Shadow/Proje 2.md")!;
  assert.ok(imported, nodes.map((n) => n.path).join(","));
  assert.deepEqual(res.rootIds, [imported.id]);
  assert.equal(imported.id, proje.id);
  const child = await dst.read("Shadow/Proje 2/Alt.md");
  assert.equal(child.id, alt.id);
  assert.match(child.body, /!\[ş\]\(\.\.\/\.\.\/ekler\/sema\.png\)/);
  assert.match(child.body, /\[Üst\]\(\.\.\/Proje%202\.md\)/);
  assert.match((await dst.read(imported.id)).body, /\[Alt\]\(Proje%202\/Alt\.md\)/);
  assert.equal((await dst.read(imported.id)).cover, "../ekler/sema.png");

  // Aynı arşivi tekrar içe aktarmak id çakışmasında yeni id üretir.
  const again = await importArchive(dst, data);
  assert.notEqual(again.rootIds[0], proje.id);
});

test(".nla tüm Origin'i yedekler", async () => {
  await src.create({ title: "Bir" });
  await src.capture("ham");
  const { data, manifest } = await exportArchive(src, { kind: "nla" });
  assert.equal(manifest.kind, "nla");
  assert.equal(manifest.nodeCount, 2);
  await dst.capture("ham");
  const res = await importArchive(dst, data, { parentNodeId: null });
  assert.equal(res.imported, 2);
  // Arşivdeki Shadow notu hedefin gelen kutusuna (çakışmasız adla) eklenir.
  assert.deepEqual((await dst.list()).map((n) => n.path).sort(), ["Bir.md", "Shadow/ham 2.md", "Shadow/ham.md"]);
  assert.equal((await dst.shadow()).inbox.length, 2);
});

test("bozuk ve tehlikeli arşivleri reddeder", async () => {
  await assert.rejects(importArchive(dst, new Uint8Array([1, 2, 3])), (e: unknown) => e instanceof NodeError && e.code === "invalid");
  const noManifest = zipSync({ "nodes/a.md": new TextEncoder().encode("x") });
  await assert.rejects(importArchive(dst, noManifest), /manifest/);
  const manifest = new TextEncoder().encode(JSON.stringify({ format: "nularche-archive", version: 1, roots: [] }));
  const evil = zipSync({
    "manifest.json": manifest,
    "nodes/../../kacis.md": new TextEncoder().encode("x"),
    "nodes/.gizli.md": new TextEncoder().encode("x"),
  });
  await assert.rejects(importArchive(dst, evil), /Node yok/);
  assert.deepEqual(await dst.list(), []);
});

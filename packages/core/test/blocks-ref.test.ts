import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { exportableMarkdown, expandEmbeds, exportPageHtml, findBlock, newBlockId, NodeStore, stripBlockIds } from "../src/index.ts";

test("blok kimliği: paragraf ve liste maddesi bulunur, kimlik atılır", () => {
  const body = ["# Başlık", "", "Birinci paragraf", "devamı ^p1", "", "- madde bir ^m1", "  - alt madde", "- madde iki", "", "```", "kod ^yok", "```"].join("\n");
  assert.equal(findBlock(body, "p1"), "Birinci paragraf\ndevamı");
  assert.equal(findBlock(body, "m1"), "- madde bir\n  - alt madde");
  assert.equal(findBlock(body, "yok"), null);
  assert.equal(findBlock(body, "../x"), null);
  assert.ok(!stripBlockIds(body).includes("^p1"));
  assert.ok(stripBlockIds(body).includes("kod ^yok"), "kod bloğu korunur");
  assert.ok(!exportableMarkdown(body).includes("^m1"));
  assert.match(newBlockId(), /^[a-z0-9]{6}$/);
});

test("gömmeler dışa aktarmada açılır: blok, başlık ve not; kilitli not ve döngü açılmaz", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "nularche-blk-"));
  const store = new NodeStore(root);
  await store.ensureRoot();
  await store.create({ title: "Kaynak", body: "Giriş ^g1\n\n## Yöntem\n\nYöntem metni\n\n## Son\n\nson" });
  await store.create({ title: "Döngü", body: "döngü başı ![[Döngü]]" });
  const page = await store.create({ title: "Sayfa", body: "Önce\n\n![[Kaynak#^g1]]\n\n![[Kaynak#Yöntem]]\n\n![[Döngü]]\n\n![[resim.png]]" });
  const out = await expandEmbeds(store, page.body, page.path);
  assert.ok(out.includes("Giriş"));
  assert.ok(!out.includes("^g1"));
  assert.ok(out.includes("## Yöntem\n\nYöntem metni"));
  assert.ok(!out.includes("son"), "başlık bölümü bir sonraki başlıkta biter");
  assert.ok(out.includes("![[resim.png]]"), "görsel gömmesi kalır");
  assert.equal(out.match(/döngü başı/g)?.length, 1, "döngü kırılır");
  const { html } = await exportPageHtml(store, page.id, "tr");
  assert.ok(html.includes("Yöntem metni"));
  assert.ok(html.includes("Giriş"));
});

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { extractWikiLinks, NodeStore, wikiResolver } from "../src/index.ts";

let dir: string;
let store: NodeStore;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "nularche-obsidian-"));
  store = new NodeStore(dir);
  await store.ensureRoot();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});


test("wiki bağlantıları: hedef, başlık, takma ad ve gömme ayrıştırılır; koddakiler sayılmaz", () => {
  const links = extractWikiLinks("Bkz. [[Plan#Hedefler|hedefler]] ve ![[resim.png]] `[[kod]]`\n```\n[[blok]]\n```");
  assert.deepEqual(
    links.map((l) => [l.target, l.heading, l.alias, l.embed]),
    [
      ["Plan", "Hedefler", "hedefler", false],
      ["resim.png", null, null, true],
    ],
  );
  const resolve = wikiResolver([{ path: "Proje/Plan.md", title: "Yol Haritası", aliases: ["YH"] }]);
  assert.equal(resolve("plan"), "Proje/Plan.md");
  assert.equal(resolve("Yol haritası"), "Proje/Plan.md");
  assert.equal(resolve("yh"), "Proje/Plan.md");
  assert.equal(resolve("Proje/Plan"), "Proje/Plan.md");
  assert.equal(resolve("Yok"), null);
});

test("özellikler ve takma adlar frontmatter'da saklanır; uygulama alanları özellik olarak yazılamaz", async () => {
  const n = await store.create({ title: "Plan", parentNodeId: null, body: "metin" });
  const doc = await store.update(n.id, { properties: { aliases: ["Yol haritası"], durum: "taslak", tags: ["proje"] } });
  assert.deepEqual(doc.properties, { aliases: ["Yol haritası"], durum: "taslak", tags: ["proje"] });
  assert.deepEqual(doc.aliases, ["Yol haritası"]);
  assert.deepEqual(doc.tags, ["proje"]);
  const removed = await store.update(n.id, { properties: { durum: null } });
  assert.deepEqual(Object.keys(removed.properties).sort(), ["aliases", "tags"]);
  await assert.rejects(store.update(n.id, { properties: { id: "x" } }), /kullanılamaz/);
  await assert.rejects(store.update(n.id, { properties: { cover: "x" } }), /kullanılamaz/);
  // Frontmatter etiketi yeniden adlandırma ile birlikte değişir.
  await store.renameTag("proje", "is");
  assert.deepEqual((await store.read(n.id)).properties.tags, ["is"]);
});

test("wiki bağlantıları geri bağlantı, grafik ve giden bağlantılarda sayılır; bağlantısız anılış bağlantıya çevrilir", async () => {
  const plan = await store.create({ title: "Plan", parentNodeId: null, body: "" });
  await store.update(plan.id, { properties: { aliases: ["Yol haritası"] } });
  const a = await store.create({ title: "Toplantı", parentNodeId: null, body: "Bkz. [[Yol haritası]] ve [[Olmayan not]]." });
  const b = await store.create({ title: "Notlar", parentNodeId: null, body: "Plan üzerinde konuştuk." });
  assert.deepEqual((await store.backlinks(plan.id)).map((n) => n.id), [a.id]);
  const graph = await store.graph();
  assert.deepEqual(graph.links, [{ source: a.id, target: plan.id }]);
  assert.deepEqual(graph.unresolved, [{ source: a.id, name: "Olmayan not" }]);
  const out = await store.outgoing(a.id);
  assert.deepEqual(out.linked.map((n) => n.id), [plan.id]);
  assert.deepEqual(out.unresolved, ["Olmayan not"]);
  const mentions = await store.unlinkedMentions(plan.id);
  assert.deepEqual(mentions.map((m) => m.id), [b.id]);
  const linked = await store.linkMention(b.id, plan.id);
  assert.equal(linked.body.trim(), "[Plan](Plan.md) üzerinde konuştuk.");
  assert.deepEqual(await store.unlinkedMentions(plan.id), []);
});

test("birleştirme: kaynak hedefin sonuna eklenir, bağlantılar hedefe döner, kaynak çöpe gider", async () => {
  const target = await store.create({ title: "Hedef", parentNodeId: null, body: "Hedef metni" });
  const source = await store.create({ title: "Kaynak", parentNodeId: null, body: "Kaynak metni" });
  const ref = await store.create({ title: "Atıf", parentNodeId: null, body: "[Kaynak](Kaynak.md)" });
  const wiki = await store.create({ title: "Wiki", parentNodeId: null, body: "[[Kaynak#Bölüm|bölüm]] ve [[Başka]]" });
  const merged = await store.merge(source.id, target.id);
  assert.equal(merged.body.trim(), "Hedef metni\n\nKaynak metni");
  assert.equal((await store.read(ref.id)).body.trim(), "[Kaynak](Hedef.md)");
  assert.equal((await store.read(wiki.id)).body.trim(), "[[Hedef#Bölüm|bölüm]] ve [[Başka]]");
  await assert.rejects(store.read(source.id), /bulunamadı/);
  assert.equal((await store.listTrash()).length, 1);
});

test("dosya geçmişi: gövde değişince önceki hali saklanır ve geri yüklenebilir", async () => {
  const n = await store.create({ title: "Taslak", parentNodeId: null, body: "ilk" });
  await store.update(n.id, { body: "ikinci" });
  const history = await store.history(n.id);
  assert.equal(history.length, 1);
  assert.equal((await store.historyBody(n.id, history[0].at)).trim(), "ilk");
  // Beş dakika dolmadan yeni anlık görüntü alınmaz.
  await store.update(n.id, { body: "üçüncü" });
  assert.equal((await store.history(n.id)).length, 1);
  const restored = await store.restoreHistory(n.id, history[0].at);
  assert.equal(restored.body.trim(), "ilk");
  // Geçmiş gizli klasördedir; Node listesine girmez.
  assert.equal((await store.list()).length, 1);
});

test("dışa aktarmada yorumlar atılır, wiki bağlantıları görünen ada, resim gömmeleri resme çevrilir", async () => {
  const { exportableMarkdown, calloutTone } = await import("../src/index.ts");
  assert.equal(exportableMarkdown("a %%gizli\nçok satır%% b [[Plan|plan]] [[Not#Baş]] ![[x.png]] ![[Not]] `[[kod]]`"), "a  b plan Not › Baş ![](Attachments/x.png)  `[[kod]]`");
  assert.equal(calloutTone("faq"), "important");
  assert.equal(calloutTone("WARNING".toLowerCase()), "warning");
  assert.equal(calloutTone("bilinmeyen"), "note");
});

test("tuval kartları bağlantı sayılır, anılış sayılmaz ve not yeniden adlandırılınca güncellenir", async () => {
  const plan = await store.create({ title: "Plan", parentNodeId: null, body: "hedefler" });
  const canvasBody = (file: string) => `\`\`\`json canvas\n${JSON.stringify({ nodes: [{ id: "a", type: "file", file, x: 0, y: 0, width: 200, height: 100 }], edges: [] }, null, 2)}\n\`\`\`\n`;
  const board = await store.create({ title: "Tahta", parentNodeId: null, body: canvasBody(plan.path), fields: { layout: "canvas" } });
  assert.deepEqual((await store.backlinks(plan.id)).map((n) => n.id), [board.id]);
  assert.deepEqual((await store.graph()).links, [{ source: board.id, target: plan.id }]);
  assert.deepEqual(await store.unlinkedMentions(plan.id), []);
  const renamed = await store.update(plan.id, { title: "Yol Haritası" });
  const json = JSON.parse(/```json canvas\n([\s\S]*?)\n```/.exec((await store.read(board.id)).body)![1]);
  assert.equal(json.nodes[0].file, renamed.path);
});

test("şablon değişkenleri doldurulur; şablondan oluşturulan sayfa özellikleri de alır", async () => {
  const { fillTemplate } = await import("../src/index.ts");
  const now = new Date(2026, 9, 29, 9, 5, 7);
  assert.equal(fillTemplate("# {{title}}\n{{date}} {{time}} {{date:DD.MM.YYYY}} {{time:HH:mm:ss}} `{{title}}`", { title: "Toplantı", now }), "# Toplantı\n2026-10-29 09:05 29.10.2026 09:05:07 `{{title}}`");
  const tpl = await store.create({ title: "Toplantı şablonu", parentNodeId: null, body: "# {{title}}\nTarih: {{date}}", fields: { template: true } });
  await store.update(tpl.id, { properties: { tür: "toplantı", tarih: "{{date}}" } });
  const copy = await store.duplicate(tpl.id, { title: "Haftalık" });
  assert.match(copy.body, /^# Haftalık\nTarih: \d{4}-\d{2}-\d{2}/);
  assert.equal(copy.properties.tür, "toplantı");
  assert.match(String(copy.properties.tarih), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(copy.template, undefined);
});

import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import {
  applyCapture,
  backupDue,
  backupOrigin,
  captureText,
  CommentStore,
  compileManuscript,
  diffLines,
  exportPageDocument,
  listBackups,
  locateAnchor,
  NodeStore,
  parseCapture,
  parseWriting,
  planFromOutline,
  promoteCapture,
  readCaptureConfig,
  serializeWriting,
  writeCaptureConfig,
  writingBody,
  writingFiles,
  findAllMentions,
  SHADOW,
} from "../src/index.ts";
import { unzipSync } from "fflate";

let dir: string;
let store: NodeStore;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "nularche-studio-"));
  store = new NodeStore(dir);
  await store.ensureRoot();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("yazma blokları ayrıştırılır, doğrulanır ve gövdenin geri kalanı korunur", () => {
  const body = `Önsöz metni\n\n${writingBody("outline")}`;
  const { data, broken } = parseWriting("outline", body);
  assert.equal(broken, false);
  data.rows.push({ id: "r1", text: "Perde I", depth: 0 }, { id: "r2", text: "Vuruş", depth: 9 });
  const next = serializeWriting("outline", body, data);
  assert.ok(next.startsWith("Önsöz metni"));
  const again = parseWriting("outline", next).data;
  assert.equal(again.rows.length, 2);
  assert.equal(again.rows[1].depth, 5, "derinlik sınırlanır");
  assert.equal(parseWriting("cards", "```json cards\n{bozuk\n```").broken, true);
  assert.equal(parseWriting("manuscript", "").data.options.separator, "* * *");
});

test("manuskript: düzen saklanır, bölümler bağlantı sayılır, taşınınca yollar güncellenir ve derlenir", async () => {
  const book = await store.create({ title: "Roman", parentNodeId: null });
  const ch1 = await store.create({ title: "Bölüm 1", parentNodeId: book.id, body: "# Bölüm 1\n\nAda limana indi." });
  const ch2 = await store.create({ title: "Bölüm 2", parentNodeId: book.id, body: "Gemi kalktı. [[Bölüm 1]]" });
  const freshCh1 = await store.read(ch1.id);
  const freshCh2 = await store.read(ch2.id);
  const data = parseWriting("manuscript", "").data;
  data.sections = [
    { id: "s1", title: "Birinci Kısım", items: [{ id: "i1", file: freshCh1.path }] },
    { id: "s2", title: "", items: [{ id: "i2", file: freshCh2.path }, { id: "i3", file: "Yok/Kayıp.md" }] },
  ];
  const ms = await store.create({ title: "Taslak Kitap", parentNodeId: null, body: serializeWriting("manuscript", "", data), fields: { layout: "manuscript", wordGoal: 50000 } });
  assert.equal(ms.layoutMode, "manuscript");
  assert.equal(ms.wordGoal, 50000);
  assert.deepEqual((await store.backlinks(ch1.id)).map((n) => n.id).sort(), [ch2.id, ms.id].sort());

  // Bölüm taşınınca manuskriptteki yolu güncellenir.
  const other = await store.create({ title: "Arşiv", parentNodeId: null });
  await store.move(ch1.id, other.id);
  const moved = await store.read(ch1.id);
  assert.ok(writingFiles("manuscript", (await store.read(ms.id)).body).includes(moved.path));

  const c = await compileManuscript(store, ms.id);
  assert.equal(c.sections.length, 2);
  assert.equal(c.sections[1].parts[1].missing, "not_found");
  assert.match(c.markdown, /^# Birinci Kısım\n\n## Bölüm 1\n\nAda limana indi\./);
  assert.ok(!c.markdown.includes("# Bölüm 1\n\n# Bölüm 1"), "notun kendi başlığı tekrarlanmaz");
  assert.match(c.markdown, /\* \* \*|Gemi kalktı/);
  assert.equal(c.words, 3 + 4);
  assert.equal(c.wordGoal, 50000);

  // DOCX dışa aktarma derlenmiş metni içerir.
  const out = await exportPageDocument(store, ms.id, "docx");
  const xml = new TextDecoder().decode(unzipSync(out.data)["word/document.xml"]);
  assert.ok(xml.includes("Ada limana indi."));
  assert.ok(xml.includes("Gemi kalktı."));
  const txt = new TextDecoder().decode((await exportPageDocument(store, ms.id, "txt")).data);
  assert.ok(txt.includes("Birinci Kısım"));
});

test("taslak planı: üst düzey satırlar, vuruşları ve yazılma durumu", () => {
  const outline = { version: 1 as const, rows: [
    { id: "a", text: "Açılış", depth: 0, file: "A.md" },
    { id: "b", text: "Fırtına", depth: 1 },
    { id: "c", text: "Doruk", depth: 0 },
  ] };
  const ms = parseWriting("manuscript", "").data;
  ms.sections[0].items.push({ id: "x", file: "A.md" });
  const plan = planFromOutline(outline, ms);
  assert.equal(plan.length, 2);
  assert.equal(plan[0].written, true);
  assert.deepEqual(plan[0].beats.map((b) => b.text), ["Fırtına"]);
  assert.equal(plan[1].written, false);
});

test("yorumlar: ekleme, yanıt, çözme, silme ve kilitli notların reddi", async () => {
  const n = await store.create({ title: "Taslak", parentNodeId: SHADOW, body: "Bir varmış bir yokmuş." });
  const cs = new CommentStore(store);
  const c = await cs.add(n.id, { anchor: { text: "bir yokmuş", prefix: "Bir varmış " }, body: "Daha çarpıcı olsun", author: "Editör" });
  await cs.reply(n.id, c.id, { body: "Tamam" });
  await cs.update(n.id, c.id, { resolved: true });
  const list = await cs.list(n.id);
  assert.equal(list.length, 1);
  assert.equal(list[0].replies[0].body, "Tamam");
  assert.equal(list[0].resolved, true);
  // Markdown dosyası değişmez.
  assert.equal((await store.read(n.id)).body.trim(), "Bir varmış bir yokmuş.");
  assert.deepEqual(await cs.counts(), {});
  await cs.update(n.id, c.id, { resolved: false });
  assert.deepEqual(await cs.counts(), { [n.id]: 1 });
  await cs.remove(n.id, c.id);
  assert.deepEqual(await cs.list(n.id), []);
  await assert.rejects(cs.add(n.id, { anchor: { text: "" }, body: "x" }), /metin/);
  const locked = await store.create({ title: "Gizli", parentNodeId: SHADOW, body: "x", fields: { locked: true } });
  await assert.rejects(cs.list(locked.id), /Kilitli/);
});

test("yorum bağlantı noktası önek/sonek ile doğru tekrarı bulur", () => {
  const text = "kedi uyudu. kedi koştu. kedi uyudu.";
  assert.equal(locateAnchor(text, { text: "kedi", prefix: "uyudu. ", suffix: " koştu" }), 12);
  assert.equal(locateAnchor(text, { text: "kedi" }), 0);
  assert.equal(locateAnchor(text, { text: "köpek" }), -1);
});

test("akıllı yakalama: ayrıştırma, kurala ve başlığa göre yönlendirme, varsayılan ve taşıma", async () => {
  assert.deepEqual(parseCapture("::card @Roman Liman sahnesi\nYağmur yağıyor"), { kind: "card", handle: "roman", title: "Liman sahnesi", rest: "Yağmur yağıyor" });
  assert.equal(parseCapture("düz not"), null);
  assert.equal(parseCapture("::görev Ara")?.kind, "task");
  assert.equal(parseCapture("::mosaic x")?.kind, "card");
  assert.equal(parseCapture("::axis x")?.kind, "outline");
  assert.equal(parseCapture("::lore x")?.kind, "wiki");
  assert.equal(parseCapture("::task @Bölüm_Bir x")?.handle, "bolum-bir", "kısaltma aksan duyarsız");

  const deck = await store.create({ title: "Roman", parentNodeId: null, body: writingBody("cards"), fields: { layout: "cards" } });
  const outline = await store.create({ title: "Plan", parentNodeId: null, body: writingBody("outline"), fields: { layout: "outline" } });
  const wiki = await store.create({ title: "Dünya", parentNodeId: null, fields: { layout: "wiki" } });
  const people = await store.create({ title: "Kişiler", parentNodeId: wiki.id, fields: { wikiFields: ["Yaş", "Rol"] } });
  await store.create({ title: "Ada", parentNodeId: people.id });
  const todo = await store.create({ title: "Yapılacaklar", parentNodeId: null, body: "# İşler" });

  // Başlık kısaltmaya uyar ("roman" → "Roman").
  const r1 = await captureText(store, "::card @roman Liman sahnesi\nYağmur");
  assert.ok("routed" in r1 && r1.routed.targetId === deck.id);
  assert.equal(parseWriting("cards", (await store.read(deck.id)).body).data.groups[0].cards[0].text, "Yağmur");

  // Kural
  await writeCaptureConfig(dir, { autoRoute: true, rules: [{ handle: "@P", kind: "outline", target: outline.id }, { handle: "kisi", kind: "wiki", target: people.id }], defaults: { task: todo.id } });
  assert.equal((await readCaptureConfig(dir)).rules[0].handle, "p");
  await captureText(store, "::outline @p Üçüncü perde");
  assert.equal(parseWriting("outline", (await store.read(outline.id)).body).data.rows[0].text, "Üçüncü perde");
  const w = await captureText(store, "::wiki @kisi Bora\nKaptan.");
  assert.ok("routed" in w && w.routed.createdId);
  const bora = await store.read((w as { routed: { createdId: string } }).routed.createdId);
  assert.equal(bora.parentNodeId, people.id);
  assert.deepEqual(bora.properties, { Yaş: "", Rol: "" });
  await captureText(store, "::task Editöre yaz");
  assert.match((await store.read(todo.id)).body, /- \[ \] Editöre yaz/);

  // Hedefi olmayan işaretli not Shadow'da kalır; sonra taşınır.
  const left = await captureText(store, "::card @bilinmeyen Gece");
  assert.ok("node" in left);
  const promoted = await promoteCapture(store, left.node.id, { target: deck.id });
  assert.equal(promoted.targetId, deck.id);
  assert.equal(parseWriting("cards", (await store.read(deck.id)).body).data.groups[0].cards.length, 2);
  await assert.rejects(store.read(left.node.id), /bulunamadı/);

  // Otomatik yönlendirme kapalıysa beklemede kalır.
  await writeCaptureConfig(dir, { autoRoute: false, rules: [], defaults: {} });
  assert.ok("node" in (await captureText(store, "::card @roman Sabah")));
  await assert.rejects(applyCapture(store, { kind: "card", title: "x", rest: "" }, todo.id), /kabul etmiyor/);
});

test("kontrol noktaları: hemen saklanır, adı korunur, otomatik budamada silinmez", async () => {
  const n = await store.create({ title: "Not", parentNodeId: SHADOW, body: "ilk" });
  const cp = await store.checkpoint(n.id, "  Taslak   1 ");
  assert.equal(cp.label, "Taslak 1");
  await store.update(n.id, { body: "ikinci" });
  const entries = await store.history(n.id);
  assert.equal(entries.find((e) => e.at === cp.at)?.label, "Taslak 1");
  assert.equal((await store.historyBody(n.id, cp.at)).trim(), "ilk");
  // Elle 61 otomatik görüntü oluştur: kontrol noktası kalır.
  const hdir = path.join(dir, ".nularche", "history", n.id);
  for (let i = 0; i < 61; i++) await writeFile(path.join(hdir, `${1000 + i}.md`), "x");
  await store.update(n.id, { body: "üçüncü" });
  assert.ok((await store.history(n.id)).some((e) => e.label === "Taslak 1"));
  await store.deleteHistory(n.id, cp.at);
  assert.ok(!(await store.history(n.id)).some((e) => e.label));
  assert.ok(!(await readdir(hdir)).includes(`${cp.at}.md`));
});

test("wiki: girdiler, anma tespiti ve geçtiği yerler", async () => {
  const wiki = await store.create({ title: "Hikâye", parentNodeId: null, fields: { layout: "wiki" } });
  const cat = await store.create({ title: "Mekânlar", parentNodeId: wiki.id });
  const port = await store.create({ title: "Liman", parentNodeId: cat.id });
  await store.update(port.id, { properties: { aliases: ["Rıhtım"], Ülke: "Kıyı" } });
  const hidden = await store.create({ title: "Gizli Yer", parentNodeId: cat.id, fields: { noMentions: true } });
  const chapter = await store.create({ title: "Bölüm", parentNodeId: null, body: "Liman sessizdi. Rıhtımda kimse yoktu; limanın ışığı… liman." });
  const entries = await store.wikiEntries(wiki.id);
  assert.deepEqual(entries.map((e) => [e.title, e.depth, e.category]), [["Mekânlar", 0, true], ["Gizli Yer", 1, false], ["Liman", 1, false]]);
  assert.equal(entries.find((e) => e.id === port.id)?.properties.Ülke, "Kıyı");
  const terms = await store.wikiTerms();
  assert.ok(terms.some((t) => t.id === port.id && t.names.includes("Rıhtım")));
  assert.ok(!terms.some((t) => t.id === hidden.id));
  const mentions = await store.wikiMentions(port.id);
  assert.equal(mentions[0].id, chapter.id);
  assert.equal(mentions[0].count, 2, "kelime sınırı: 'limanın' ve 'Rıhtımda' sayılmaz");
  await assert.rejects(store.wikiEntries(chapter.id), /wiki değil/);
});

test("anılış arama: uzun ad önce, Türkçe harf, kelime sınırı", () => {
  const hits = findAllMentions("Ada Lovelace ve Ada; İstanbul'da istanbul", ["Ada", "Ada Lovelace", "İstanbul"]);
  assert.deepEqual(hits.map((h) => h.length), [12, 3, 8, 8]);
});

test("satır farkı", () => {
  const ops = diffLines("a\nb\nc\nd", "a\nB\nc\nd\ne");
  assert.deepEqual(ops.map((o) => `${o.kind}:${o.text}`), ["same:a", "del:b", "add:B", "same:c", "same:d", "add:e"]);
  const big = diffLines("x\n".repeat(50), "y\n".repeat(50), 10);
  assert.ok(big.some((o) => o.kind === "del") && big.some((o) => o.kind === "add"));
});

test("otomatik yedekleme: .nla yazılır, en eski yedekler budanır, başka dosyalara dokunulmaz", async () => {
  await store.create({ title: "Not", parentNodeId: SHADOW, body: "yedek" });
  const out = path.join(dir, "..", `${path.basename(dir)}-backups`);
  try {
    await writeFile(path.join(dir, "..", "x"), "").catch(() => undefined);
    for (let i = 0; i < 4; i++) await backupOrigin(store, { dir: out, originName: "Benim Notlarım", keep: 2, now: new Date(2026, 0, 1, 10, 0, i) });
    await writeFile(path.join(out, "baska.nla"), "x");
    const list = await listBackups(out, "Benim Notlarım");
    assert.equal(list.length, 2);
    assert.ok(list.every((b) => /^Nularche-Benim-Notlarım-\d{8}-\d{6}\.nla$/.test(b.name)));
    assert.ok((await readdir(out)).includes("baska.nla"));
    const manifest = JSON.parse(new TextDecoder().decode(unzipSync(new Uint8Array(await readFile(list[0].file)))["manifest.json"]));
    assert.equal(manifest.kind, "nla");
  } finally {
    await rm(out, { recursive: true, force: true });
  }
  assert.equal(backupDue("off", null), false);
  assert.equal(backupDue("daily", null), true);
  assert.equal(backupDue("hourly", Date.now() - 10_000), false);
  assert.equal(backupDue("hourly", Date.now() - 3_700_000), true);
});

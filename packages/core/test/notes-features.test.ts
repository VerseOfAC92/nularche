import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { unzipSync } from "fflate";
import { afterEach, beforeEach, test } from "node:test";
import {
  bodyFacts,
  exportPageDocument,
  exportSite,
  extractTags,
  htmlToMarkdown,
  importFiles,
  isLockedBody,
  lockedBody,
  lockedPayload,
  NodeStore,
  readPrefs,
  renameTagInBody,
  rtfToText,
  SHADOW,
  writePrefs,
} from "../src/index.ts";

let dir: string;
let store: NodeStore;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "nularche-v15-"));
  store = new NodeStore(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("etiketler: kod, bağlantı, başlık ve renk kodları sayılmaz; Türkçe harfler desteklenir", () => {
  const body = "# Başlık\n\nBugün #toplantı ve #proje/nularche, (#iş) #2026 #00a8b5 #fff1\n\n`#kod` [x](a.md#bölüm)\n\n```\n#yok\n```\n#Toplantı tekrar";
  assert.deepEqual(extractTags(body), ["toplantı", "proje/nularche", "iş"]);
});

test("etiket yeniden adlandırma alt etiketleri de değiştirir, kodu korur", () => {
  const body = "#proje ve #proje/a ama #projeler değil `#proje`";
  assert.equal(renameTagInBody(body, "proje", "iş"), "#iş ve #iş/a ama #projeler değil `#proje`");
});

test("gövde bilgileri: özet, yapılacaklar, ilk görsel, sözcük sayısı", () => {
  const f = bodyFacts("Merhaba **dünya** #etiket\n\n- [ ] bir\n- [x] iki\n\n![r](Attachments/a.png)\n\n@[audio](Attachments/ses.webm)");
  assert.equal(f.todos, 2);
  assert.equal(f.done, 1);
  assert.equal(f.image, "Attachments/a.png");
  assert.equal(f.attachments, 2);
  assert.ok(f.excerpt.startsWith("Merhaba dünya #etiket"));
  assert.equal(f.words, 6);
});

test("kilitli gövde tanınır; etiket, özet ve arama dışında kalır", async () => {
  const payload = JSON.stringify({ v: 1, data: "abc" });
  const body = lockedBody(payload, "🔒 Kilitli not");
  assert.ok(isLockedBody(body));
  assert.equal(lockedPayload(body), payload);
  const n = await store.create({ title: "Gizli", body, fields: { locked: true } });
  const meta = (await store.list()).find((m) => m.id === n.id)!;
  assert.equal(meta.locked, true);
  assert.deepEqual(meta.tags, []);
  assert.equal(meta.excerpt, "");
  assert.equal((await store.search("abc")).length, 0);
  assert.equal((await store.search("gizli"))[0].snippet, "");
  await assert.rejects(exportPageDocument(store, n.id, "docx"));
});

test("Node listesi etiket, iğneleme ve yazı tipi alanlarını taşır; etiket araması ve yeniden adlandırma", async () => {
  const a = await store.create({ title: "A", body: "#iş notu" });
  await store.create({ title: "B", body: "#İş ve #ev" });
  await store.update(a.id, { fields: { pinned: true, font: "serif", fontSize: 18, sortChecked: true } });
  const list = await store.list();
  const ma = list.find((m) => m.id === a.id)!;
  assert.equal(ma.pinned, true);
  assert.equal(ma.font, "serif");
  assert.equal(ma.fontSize, 18);
  assert.deepEqual(await store.tags(), [
    { tag: "ev", count: 1 },
    { tag: "iş", count: 2 },
  ]);
  assert.equal((await store.search("#iş")).length, 2);
  assert.equal(await store.renameTag("iş", "çalışma"), 2);
  assert.match((await store.read(a.id)).body, /#çalışma notu/);
});

test("ekler listelenir ve yeniden adlandırılınca bağlantılar güncellenir", async () => {
  const p = await store.saveAttachment("foto.png", new Uint8Array([1, 2, 3]));
  const s = await store.saveAttachment("kayıt.webm", new Uint8Array([4]));
  const n = await store.create({ title: "Not", body: `![f](${p})\n\n@[audio](${s})` });
  const list = await store.listAttachments();
  assert.equal(list.length, 2);
  assert.deepEqual(list.find((x) => x.path === p)?.refs, [{ id: n.id, title: "Not" }]);
  assert.equal(list.find((x) => x.path === s)?.kind, "audio");
  const next = await store.renameAttachment(p, "Tatil Fotoğrafı");
  assert.equal(next, "Attachments/Tatil Fotografi.png");
  assert.match((await store.read(n.id)).body, /!\[f\]\(Attachments\/Tatil%20Fotografi\.png\)/);
});

test("tercihler .nularche/ui.json içinde saklanır ve null siler", async () => {
  await writePrefs(dir, { focusScene: "sea", recent: ["a"] });
  await writePrefs(dir, { recent: null, mathMode: "suggest" });
  assert.deepEqual(await readPrefs(dir), { focusScene: "sea", mathMode: "suggest" });
  assert.match(await readFile(path.join(dir, ".nularche", "ui.json"), "utf8"), /focusScene/);
});

test("HTML → Markdown: başlık, biçim, liste, yapılacak, tablo, hizalama", () => {
  const { title, body } = htmlToMarkdown(
    `<html><head><title>Alışveriş</title><style>p{}</style></head><body><h1>Liste</h1><div><b>Kalın</b> ve <i>italik</i> &amp; <a href="https://x.y">bağ</a></div><ul><li>süt</li><li>ekmek<ul><li>tam</li></ul></li></ul><ul class="checklist"><li class="checked">bitti</li><li>yapılacak</li></ul><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table><p style="text-align:center">orta</p></body></html>`,
  );
  assert.equal(title, "Alışveriş");
  assert.equal(
    body,
    "# Liste\n\n**Kalın** ve *italik* & [bağ](https://x.y)\n\n- süt\n- ekmek\n  - tam\n\n- [x] bitti\n- [ ] yapılacak\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n<div align=\"center\">\n\norta\n\n</div>",
  );
});

test("RTF → düz metin: Türkçe karakterler, unicode kaçışları ve paragraflar", () => {
  const rtf = "{\\rtf1\\ansi\\ansicpg1254{\\fonttbl\\f0 Helvetica;}{\\colortbl;\\red0\\green0\\blue0;}\\f0 \\'c7al\\'fd\\'fema \\b kal\\'fdn\\b0\\par ikinci \\u351?ey\\par}";
  assert.equal(rtfToText(rtf), "Çalışma kalın\nikinci şey");
});

test("içe aktarma: Markdown resimleri eklere kopyalanır, HTML data: resimleri kaydedilir, Shadow'a düşer", async () => {
  const enc = new TextEncoder();
  const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
  const res = await importFiles(
    store,
    [
      { path: "Notlar/Plan.md", data: enc.encode("---\ntitle: Yol Planı\n---\n\n![harita](resimler/harita.png)\n\n[dış](https://example.com)") },
      { path: "Notlar/resimler/harita.png", data: png },
      { path: "Notlar/Not.html", data: enc.encode(`<h1>HTML Not</h1><p>metin <img src="data:image/png;base64,${Buffer.from(png).toString("base64")}"></p>`) },
      { path: "Notlar/eski.rtf", data: enc.encode("{\\rtf1 Merhaba\\par d\\'fcnya}") },
      { path: "Notlar/yok.bin", data: new Uint8Array([0]) },
    ],
    SHADOW,
  );
  assert.equal(res.created.length, 3);
  assert.equal(res.attachments, 2);
  const plan = (await store.list()).find((n) => n.title === "Yol Planı")!;
  assert.equal(plan.archeId, null);
  assert.match((await store.read(plan.id)).body, /!\[harita\]\(\.\.\/Attachments\/harita\.png\)/);
  const html = (await store.list()).find((n) => n.title === "HTML Not")!;
  assert.match((await store.read(html.id)).body, /!\[\]\(\.\.\/Attachments\/Not-resim\.png\)/);
  const rtf = (await store.list()).find((n) => n.title === "eski")!;
  assert.equal((await store.read(rtf.id)).body.trim(), "Merhaba\ndünya");
});

test("DOCX ve RTF dışa aktarma: biçim, liste, hizalama ve resim", async () => {
  const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
  const img = await store.saveAttachment("r.png", png);
  const n = await store.create({
    title: "Rapor",
    body: `## Özet\n\n**Kalın** x<sup>2</sup> H<sub>2</sub>O ==vurgu== [bağ](https://a.b)\n\n<div align="center">\n\nOrtalı şğü\n\n</div>\n\n- bir\n  - iç\n1. sıra\n- [x] bitti\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n![r](${img})`,
  });
  const docx = await exportPageDocument(store, n.id, "docx");
  assert.equal(docx.name, "Rapor.docx");
  const files = unzipSync(docx.data);
  const xml = new TextDecoder().decode(files["word/document.xml"]);
  assert.match(xml, /<w:pStyle w:val="Heading2"\/>/);
  assert.match(xml, /<w:b\/><\/w:rPr><w:t xml:space="preserve">Kalın/);
  assert.match(xml, /superscript/);
  assert.match(xml, /<w:jc w:val="center"\/>/);
  assert.match(xml, /<w:highlight w:val="yellow"\/>/);
  assert.match(xml, /☑ /);
  assert.match(xml, /<w:tbl>/);
  assert.ok(files["word/media/image1.png"]);
  assert.ok(files["word/numbering.xml"]);
  const rtf = new TextDecoder().decode((await exportPageDocument(store, n.id, "rtf")).data);
  assert.match(rtf, /^\{\\rtf1/);
  assert.match(rtf, /\\qc/);
  assert.match(rtf, /\\u351\?/);
  assert.match(rtf, /\\pngblip/);
  assert.match(rtf, /HYPERLINK "https:\/\/a.b"/);
});

test("yayınlanan site kilitli notları içermez; ses ve çizim blokları HTML'e çevrilir", async () => {
  const a = await store.create({ title: "Açık", body: "@[audio](Attachments/s.webm)\n\n@[drawing](Attachments/c.png)", fields: { publish: true } });
  await store.saveAttachment("s.webm", new Uint8Array([1]));
  await store.saveAttachment("c.png", new Uint8Array([1]));
  await store.create({ title: "Kilitli", body: lockedBody("{}", "x"), fields: { publish: true, locked: true } });
  const { files } = await exportSite(store);
  const names = Object.keys(files);
  assert.ok(names.includes("Acik.html"));
  assert.ok(!names.some((f) => f.startsWith("Kilitli")));
  const html = new TextDecoder().decode(files["Acik.html"]);
  assert.match(html, /<audio controls preload="metadata" src="Attachments\/s.webm">/);
  assert.match(html, /<img class="drawing" src="Attachments\/c.png"/);
  void a;
});

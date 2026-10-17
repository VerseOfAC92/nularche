import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { unzipSync } from "fflate";
import { addRow, createDatabase, defaultDatabase, exportMarkdownZip, exportPageHtml, exportSite, NodeStore } from "../src/index.ts";

let dir: string;
let store: NodeStore;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "nlc-export-"));
  store = new NodeStore(dir);
});
afterEach(async () => rm(dir, { recursive: true, force: true }));

const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const names = { tags: "Etiketler", status: "Durum", todo: "Yapılacak", doing: "Sürüyor", done: "Bitti", table: "Tablo", board: "Pano" };

async function fixture() {
  const img = await store.saveAttachment("şema.png", new Uint8Array([137, 80, 78, 71]));
  const site = await store.create({ title: "Blog", fields: { publish: true, icon: "📰" } });
  const secret = await store.create({ title: "Gizli plan", body: "özel" });
  const db = await createDatabase(store, { title: "Yazılar", parentNodeId: site.id, db: defaultDatabase(names) });
  await addRow(store, db.id, { title: "İlk yazı", values: { Durum: "Bitti" }, body: "Merhaba **dünya**" });
  const fresh = await store.read(site.id);
  const dbPath = (await store.read(db.id)).path;
  const rel = path.posix.relative(path.posix.dirname(fresh.path), dbPath);
  const imgRel = path.posix.relative(path.posix.dirname(fresh.path), img);
  await store.update(site.id, {
    body: `> [!TIP]\n> İpucu metni\n\n![şema](${imgRel})\n\n[Gizli](${encodeURI(path.posix.relative(path.posix.dirname(fresh.path), secret.path))})\n\n@[database](${rel}#view=v_table)\n\n@[youtube](https://www.youtube.com/watch?v=dQw4w9WgXcQ)\n`,
  });
  return { site, secret, db, img };
}

test("statik site: yayınlanan sayfa ve alt sayfaları, veritabanı tablosu, ekler; yayınlanmayan sayfa sızmaz", async () => {
  const { img } = await fixture();
  const { files, pages } = await exportSite(store, { lang: "tr" });
  assert.equal(pages, 3, "Blog + Yazılar + İlk yazı");
  const paths = Object.keys(files).sort();
  assert.ok(paths.includes("index.html") && paths.includes("style.css") && paths.includes(".nojekyll"));
  assert.ok(paths.includes(img), "kullanılan ek kopyalanır");
  assert.ok(!paths.some((p) => p.includes("Gizli")), "yayınlanmayan sayfa dışarıda kalır");
  const blogFile = paths.find((p) => p.endsWith("Blog.html"))!;
  const blog = dec(files[blogFile]);
  assert.match(blog, /<blockquote class="callout callout-tip">/);
  assert.match(blog, /<span class="dead-link">Gizli<\/span>/, "gizli sayfaya bağlantı düz metin olur");
  assert.ok(!blog.includes("Gizli%20plan"), "gizli sayfanın yolu yazılmaz");
  assert.match(blog, /<table>.*İlk yazı.*Bitti/s, "gömülü veritabanı tablo olarak çizilir");
  assert.match(blog, /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/);
  assert.match(blog, /src="\.\.\/Attachments\/sema\.png"/);
  const rowFile = paths.find((p) => p.endsWith("Ilk yazi.html"))!;
  const row = dec(files[rowFile]);
  assert.match(row, /<table class="props"><tr><th>Durum<\/th><td>Bitti<\/td><\/tr><\/table>/);
  assert.match(row, /<strong>dünya<\/strong>/);
  assert.match(dec(files["index.html"]), /http-equiv="refresh"/, "tek kökte giriş sayfası yönlendirir");
});

test("yayınlanacak sayfa yoksa anlaşılır hata", async () => {
  await store.create({ title: "Taslak" });
  await assert.rejects(exportSite(store, { lang: "en" }), /Nothing to publish/);
});

test("tek sayfa HTML: resimler gömülü, diğer sayfalara bağlantı verilmez", async () => {
  const { site } = await fixture();
  const { name, html } = await exportPageHtml(store, site.id, "tr");
  assert.equal(name, "Blog.html");
  assert.match(html, /<style>/);
  assert.match(html, /src="data:image\/png;base64,/);
  assert.match(html, /<span class="dead-link">Gizli<\/span>/);
});

test("Markdown .zip: sayfa, alt sayfalar ve ekler Origin'deki yollarla", async () => {
  const { site, img } = await fixture();
  const { data, count } = await exportMarkdownZip(store, site.id);
  assert.equal(count, 3);
  const entries = Object.keys(unzipSync(data)).sort();
  assert.ok(entries.includes(img));
  assert.ok(entries.includes("Blog/Blog.md"));
  assert.ok(entries.some((e) => e.endsWith("Ilk yazi.md")));
  assert.ok(!entries.some((e) => e.includes("Gizli")));
});

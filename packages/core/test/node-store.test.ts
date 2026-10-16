import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { NodeError, NodeStore, SHADOW, slugify } from "../src/index.ts";

let dir: string;
let store: NodeStore;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "notlar-test-"));
  store = new NodeStore(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("not oluşturur, okur ve listeler", async () => {
  const note = await store.create({ title: "Toplantı Notları", body: "# Gündem\n\n- madde" });
  assert.equal(note.path, "Toplanti Notlari.md");
  const read = await store.read(note.id);
  assert.equal(read.title, "Toplantı Notları");
  assert.match(read.body, /- madde/);
  assert.deepEqual(
    (await store.list()).map((n) => n.id),
    [note.id],
  );
  assert.deepEqual(await store.read("Toplanti Notlari"), read);
});

test("alt sayfalar üst sayfanın klasörüne yazılır", async () => {
  const parent = await store.create({ title: "Projeler" });
  const child = await store.create({ title: "Uygulama", parentNodeId: parent.id });
  assert.equal(child.path, "Projeler/Uygulama.md");
  assert.equal(child.parentNodeId, parent.id);
  assert.deepEqual(
    (await store.list({ parentNodeId: parent.id })).map((n) => n.id),
    [child.id],
  );
  assert.deepEqual(
    (await store.list({ parentNodeId: null })).map((n) => n.id),
    [parent.id],
  );
});

test("eski revision ile güncelleme çakışma hatası verir", async () => {
  const note = await store.create({ title: "A", body: "bir" });
  const updated = await store.update(note.id, { body: "iki", baseRevision: note.revision });
  assert.notEqual(updated.revision, note.revision);
  await assert.rejects(
    store.update(note.id, { body: "üç", baseRevision: note.revision }),
    (e: unknown) => e instanceof NodeError && e.code === "conflict",
  );
  assert.equal((await store.read(note.id)).body.trim(), "iki");
});

test("başlık değişince dosya ve alt klasör yeniden adlandırılır, id korunur", async () => {
  const parent = await store.create({ title: "Eski" });
  const child = await store.create({ title: "Çocuk", parentNodeId: parent.id });
  const renamed = await store.update(parent.id, { title: "Yeni" });
  assert.equal(renamed.path, "Yeni.md");
  assert.equal((await store.read(child.id)).path, "Yeni/Cocuk.md");
});

test("taşıma ve kendi altına taşıma koruması", async () => {
  const a = await store.create({ title: "A" });
  const b = await store.create({ title: "B" });
  const moved = await store.move(b.id, a.id);
  assert.equal(moved.path, "A/B.md");
  await assert.rejects(store.move(a.id, b.id), (e: unknown) => e instanceof NodeError && e.code === "invalid");
  assert.equal((await store.move(b.id, null)).path, "B.md");
});

test("çöpe taşıma dosyayı ve alt sayfaları .trash altına koyar", async () => {
  const a = await store.create({ title: "A" });
  await store.create({ title: "Alt", parentNodeId: a.id });
  const res = await store.trash(a.id);
  assert.match(res.trashedTo, /^\.trash\//);
  assert.deepEqual(await store.list(), []);
  assert.equal((await readdir(path.join(dir, ".trash"))).length, 1);
});

test("vault dışına çıkan yollar reddedilir", async () => {
  await assert.rejects(store.read("../etc/passwd"), (e: unknown) => e instanceof NodeError);
  await assert.rejects(store.read("/etc/passwd"), (e: unknown) => e instanceof NodeError);
});

test("frontmatter'sız dosyalar okunurken değiştirilmez, düzenlenince sahiplenilir", async () => {
  await mkdir(path.join(dir, "Klasor"), { recursive: true });
  const file = path.join(dir, "Klasor", "Dis.md");
  await writeFile(file, "merhaba dünya\n");
  const [node] = await store.list();
  assert.equal(node.title, "Dis");
  assert.equal(await readFile(file, "utf8"), "merhaba dünya\n");
  assert.deepEqual((await store.list())[0].id, node.id); // türetilmiş id kararlı
  assert.equal((await store.read(node.id)).body, "merhaba dünya\n");
  await store.update(node.id, { body: "düzenlendi" });
  const text = await readFile(file, "utf8");
  assert.match(text, new RegExp(`^---\nid: ${node.id}\ntitle: Dis\n`));
  assert.equal((await store.read(node.id)).body, "düzenlendi\n");
});

test("node_modules taranmaz ve kopya id'li dosyalar yeniden yazılmaz", async () => {
  await mkdir(path.join(dir, "node_modules", "paket"), { recursive: true });
  await writeFile(path.join(dir, "node_modules", "paket", "README.md"), "# paket\n");
  const a = await store.create({ title: "A" });
  const copy = (await readFile(path.join(dir, "A.md"), "utf8")).replace("title: A", "title: B");
  await writeFile(path.join(dir, "B.md"), copy);
  const nodes = await store.list();
  assert.deepEqual(nodes.map((n) => n.title).sort(), ["A", "B"]);
  assert.equal(new Set(nodes.map((n) => n.id)).size, 2);
  assert.equal(nodes.find((n) => n.title === "A")!.id, a.id);
  assert.equal(await readFile(path.join(dir, "B.md"), "utf8"), copy);
});

test("arama başlığı öne alır ve Türkçe büyük/küçük harfe duyarsızdır", async () => {
  await store.create({ title: "İş planı", body: "bütçe" });
  await store.create({ title: "Günlük", body: "iş görüşmesi ve iş planı taslağı" });
  const hits = await store.search("İŞ PLANI");
  assert.equal(hits.length, 2);
  assert.equal(hits[0].title, "İş planı");
  assert.match(hits[1].snippet, /iş planı/);
});

test("append mevcut gövdeye paragraf ekler", async () => {
  const n = await store.create({ title: "A", body: "ilk" });
  const out = await store.append(n.id, "ikinci");
  assert.equal(out.body, "ilk\n\nikinci\n");
});

test("slugify Türkçe karakterleri sadeleştirir", () => {
  assert.equal(slugify("Çalışma / Ödev: 1"), "Calisma Odev 1");
  assert.equal(slugify("???"), "Adsiz");
});

test("yeniden adlandırma ve taşıma bağlantıları günceller", async () => {
  const a = await store.create({ title: "Hedef" });
  const b = await store.create({ title: "Kaynak", body: "Bkz. [Hedef](Hedef.md) ve ![r](ekler/r.png) ve [dış](https://x.y/a b)" });
  const folder = await store.create({ title: "Klasör" });
  await store.update(a.id, { title: "Yeni Hedef" });
  assert.match((await store.read(b.id)).body, /\[Hedef\]\(Yeni%20Hedef\.md\)/);
  await store.move(b.id, folder.id);
  const moved = await store.read(b.id);
  assert.equal(moved.path, "Klasor/Kaynak.md");
  assert.match(moved.body, /\(\.\.\/Yeni%20Hedef\.md\)/);
  assert.match(moved.body, /\(\.\.\/ekler\/r\.png\)/);
  assert.match(moved.body, /\(https:\/\/x\.y\/a b\)/);
  assert.deepEqual(
    (await store.backlinks(a.id)).map((n) => n.id),
    [b.id],
  );
});

test("sayfa alanları yazılır, silinir ve sıralamayı belirler", async () => {
  const p = await store.create({ title: "Üst" });
  const x = await store.create({ title: "Zeta", parentNodeId: p.id });
  const y = await store.create({ title: "Alfa", parentNodeId: p.id });
  const z = await store.create({ title: "Beta" });
  await store.update(x.id, { fields: { icon: "🚀", favorite: true, cover: "gradient-1" } });
  let n = await store.read(x.id);
  assert.equal(n.icon, "🚀");
  assert.equal(n.favorite, true);
  await store.update(x.id, { fields: { favorite: null } });
  n = await store.read(x.id);
  assert.equal(n.favorite, undefined);
  assert.equal(n.icon, "🚀");
  await assert.rejects(store.update(x.id, { fields: { bilinmeyen: 1 } as never }), (e: unknown) => e instanceof NodeError && e.code === "invalid");
  const order = await store.reorder(p.id, [z.id, x.id, y.id]);
  assert.deepEqual(
    order.map((m) => m.title),
    ["Beta", "Zeta", "Alfa"],
  );
});

test("ekler ekler/ klasörüne benzersiz adla yazılır ve not listesinde görünmez", async () => {
  const one = await store.saveAttachment("Ekran Görüntüsü.PNG", new Uint8Array([1, 2]));
  const two = await store.saveAttachment("Ekran Görüntüsü.PNG", new Uint8Array([3]));
  assert.equal(one, "ekler/Ekran-Goruntusu.png");
  assert.equal(two, "ekler/Ekran-Goruntusu-2.png");
  await writeFile(path.join(dir, "ekler", "not-gibi.md"), "x");
  assert.deepEqual(await store.list(), []);
  assert.equal((await store.create({ title: "ekler" })).path, "ekler 2.md");
});

test("Arche, Shadow ve bağlantısız Node'lar", async () => {
  const arche = await store.create({ title: "Proje" });
  const child = await store.create({ title: "Görev", parentNodeId: arche.id });
  const deep = await store.create({ title: "Alt görev", parentNodeId: child.id });
  assert.equal(arche.archeId, arche.id);
  assert.equal((await store.read(deep.id)).archeId, arche.id);
  const raw = await store.capture("# Ham fikir\nayrıntı");
  assert.equal(raw.title, "Ham fikir");
  assert.equal(raw.path, "Shadow/Ham fikir.md");
  assert.equal(raw.archeId, null);
  assert.equal(raw.parentNodeId, null);
  let view = await store.shadow();
  assert.deepEqual(
    view.inbox.map((n) => n.id),
    [raw.id],
  );
  assert.deepEqual(new Set(view.unlinked.map((n) => n.id)), new Set([child.id, deep.id]));
  await store.update(child.id, { body: "Bkz. [alt](Gorev/Alt%20gorev.md)" });
  await store.move(raw.id, arche.id);
  view = await store.shadow();
  assert.deepEqual(view.inbox, []);
  assert.deepEqual(
    view.unlinked.map((n) => n.id),
    [raw.id],
  );
  const back = await store.move(raw.id, SHADOW);
  assert.equal(back.path, "Shadow/Ham fikir.md");
  assert.equal((await store.create({ title: "Shadow" })).path, "Shadow 2.md");
});

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
  assert.equal(renamed.path, "Yeni/Yeni.md", "alt Node'u olan Node klasör notudur");
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
  assert.equal(slugify("???"), "Untitled");
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

test("ekler Attachments/ klasörüne benzersiz adla yazılır ve not listesinde görünmez", async () => {
  const one = await store.saveAttachment("Ekran Görüntüsü.PNG", new Uint8Array([1, 2]));
  const two = await store.saveAttachment("Ekran Görüntüsü.PNG", new Uint8Array([3]));
  assert.equal(one, "Attachments/Ekran-Goruntusu.png");
  assert.equal(two, "Attachments/Ekran-Goruntusu-2.png");
  await writeFile(path.join(dir, "Attachments", "not-gibi.md"), "x");
  assert.deepEqual(await store.list(), []);
  assert.equal((await store.create({ title: "attachments" })).path, "attachments 2.md");
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
  await store.update(child.id, { body: "Bkz. [alt](Alt%20gorev.md)" });
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

test("çöp: listelenir, alt Node'larıyla eski yerine geri gelir, üst yoksa Shadow'a gelir, kalıcı silinebilir", async () => {
  const arche = await store.create({ title: "Proje" });
  const page = await store.create({ title: "Plan", parentNodeId: arche.id, body: "içerik" });
  await store.create({ title: "Alt", parentNodeId: page.id });
  await store.trash(page.id);
  assert.equal((await store.list()).some((n) => n.id === page.id), false);
  let trash = await store.listTrash();
  assert.equal(trash.length, 1);
  assert.equal(trash[0].title, "Plan");
  assert.equal(trash[0].originalPath, "Proje/Plan/Plan.md");
  assert.equal(trash[0].childCount, 1);
  const restored = await store.restoreTrash(trash[0].entry);
  assert.equal(restored.id, page.id);
  assert.equal(restored.path, "Proje/Plan/Plan.md");
  assert.equal(restored.body.trim(), "içerik");
  assert.equal((await store.list()).find((n) => n.title === "Alt")?.parentNodeId, page.id);
  assert.deepEqual(await store.listTrash(), []);

  // Üst Node da çöpteyse geri gelen Node Shadow'a düşer.
  await store.trash(page.id);
  await store.trash(arche.id);
  trash = await store.listTrash();
  const planEntry = trash.find((e) => e.title === "Plan")!;
  const inShadow = await store.restoreTrash(planEntry.entry);
  assert.equal(inShadow.path, "Shadow/Plan/Plan.md");
  await store.deleteTrash(trash.find((e) => e.title === "Proje")!.entry);
  assert.deepEqual(await store.listTrash(), []);
  await assert.rejects(store.restoreTrash("../dışarı"), /Geçersiz/);
});

test("eski 'ekler' klasörü açılışta 'Attachments' olur; resim bağlantıları ve kapaklar güncellenir", async () => {
  await mkdir(path.join(dir, "ekler"), { recursive: true });
  await writeFile(path.join(dir, "ekler", "r.png"), "png");
  await mkdir(path.join(dir, "Proje"), { recursive: true });
  await writeFile(path.join(dir, "Proje.md"), "---\nid: p1\ntitle: Proje\ncover: ekler/r.png\n---\n\n![r](ekler/r.png)\n");
  await writeFile(path.join(dir, "Proje", "Alt.md"), "Çerçevesiz not ![r](../ekler/r.png) [dış](https://x.y)\n");
  await store.ensureRoot();
  assert.deepEqual(await readdir(path.join(dir, "Attachments")), ["r.png"]);
  await assert.rejects(readdir(path.join(dir, "ekler")));
  const p = await store.read("p1");
  assert.equal(p.path, "Proje/Proje.md", "eski düzen klasör notuna çevrilir");
  assert.equal(p.cover, "../Attachments/r.png");
  assert.equal(p.body.trim(), "![r](../Attachments/r.png)");
  assert.equal(await readFile(path.join(dir, "Proje", "Alt.md"), "utf8"), "Çerçevesiz not ![r](../Attachments/r.png) [dış](https://x.y)\n", "frontmatter eklenmez");
});

test("klasör notu düzeni: alt Node eklenince not klasörüne girer, taşınır, bağlantılar ve kapak korunur", async () => {
  const img = await store.saveAttachment("k.png", new Uint8Array([1]));
  const hub = await store.create({ title: "Merkez", body: "[Plan](Plan.md)" });
  const plan = await store.create({ title: "Plan", fields: { cover: img } });
  assert.equal(plan.path, "Plan.md");
  const step = await store.create({ title: "Adım", parentNodeId: plan.id, body: "[Merkez](../Merkez.md)" });
  // Plan alt Node aldı: "Plan/Plan.md" oldu; ona verilen bağlantı ve kapağı güncellendi.
  const p1 = await store.read(plan.id);
  assert.equal(p1.path, "Plan/Plan.md");
  assert.equal(p1.cover, `../${img}`);
  assert.equal((await store.read(hub.id)).body.trim(), "[Plan](Plan/Plan.md)");
  assert.equal((await store.read(step.id)).path, "Plan/Adim.md");
  assert.equal((await store.read("Plan")).id, plan.id, "klasör yoluyla bulunur");
  // Klasör notu başka bir Node'un altına taşınır: klasörüyle gider.
  const arch = await store.create({ title: "Arşiv" });
  await store.move(plan.id, arch.id);
  assert.equal((await store.read(plan.id)).path, "Arsiv/Plan/Plan.md");
  assert.equal((await store.read(plan.id)).cover, `../../${img}`);
  assert.equal((await store.read(step.id)).path, "Arsiv/Plan/Adim.md");
  assert.equal((await store.read(step.id)).body.trim(), "[Merkez](../../Merkez.md)");
  assert.equal((await store.read(step.id)).parentNodeId, plan.id);
  assert.equal((await store.read(plan.id)).parentNodeId, arch.id);
  assert.equal((await store.read(hub.id)).body.trim(), "[Plan](Arsiv/Plan/Plan.md)");
  // Yeniden adlandırma klasörü ve klasör notunu birlikte değiştirir.
  await store.update(plan.id, { title: "Yol haritası" });
  assert.equal((await store.read(plan.id)).path, "Arsiv/Yol haritasi/Yol haritasi.md");
  assert.equal((await store.read(step.id)).path, "Arsiv/Yol haritasi/Adim.md");
});

test("eski düzen (not.md + not/) açılışta klasör notuna çevrilir; dışarıdan eklenmiş dosyaya frontmatter yazılmaz", async () => {
  await mkdir(path.join(dir, "Kitap", "Bolum"), { recursive: true });
  await writeFile(path.join(dir, "Kitap.md"), "---\nid: k1\ntitle: Kitap\n---\n\n[1](Kitap/Bolum.md)\n");
  await writeFile(path.join(dir, "Kitap", "Bolum.md"), "---\nid: b1\ntitle: Bölüm\n---\n\n[Üst](../Kitap.md)\n");
  await writeFile(path.join(dir, "Kitap", "Bolum", "Sayfa.md"), "Düz not [Bölüm](../Bolum.md)\n");
  assert.equal((await store.read("b1")).parentNodeId, "k1", "eski düzen de okunur");
  await store.ensureRoot();
  const k = await store.read("k1");
  const b = await store.read("b1");
  assert.equal(k.path, "Kitap/Kitap.md");
  assert.equal(b.path, "Kitap/Bolum/Bolum.md");
  assert.equal(k.body.trim(), "[1](Bolum/Bolum.md)");
  assert.equal(b.body.trim(), "[Üst](../Kitap.md)");
  assert.equal(b.parentNodeId, "k1");
  assert.equal(await readFile(path.join(dir, "Kitap", "Bolum", "Sayfa.md"), "utf8"), "Düz not [Bölüm](Bolum.md)\n");
  assert.equal((await store.list()).find((n) => n.path === "Kitap/Bolum/Sayfa.md")?.parentNodeId, "b1");
  assert.equal(await store.normalizeLayout(), 0, "ikinci çalıştırma bir şey değiştirmez");
});

test("çoğaltma: alt Node'lar, iç bağlantılar, ilişkiler ve veritabanı şeması kopyaya yönlenir; şablon işareti taşınmaz", async () => {
  const tpl = await store.create({ title: "Proje şablonu", fields: { template: true, icon: "🚀" } });
  const tasks = await store.create({ title: "Görevler", parentNodeId: tpl.id, fields: { database: { properties: [{ id: "bagli", name: "Bağlı", type: "relation", target: "" }] } } });
  await store.update(tasks.id, { fields: { database: { properties: [{ id: "bagli", name: "Bağlı", type: "relation", target: tasks.id }] } } });
  const a = await store.create({ title: "A", parentNodeId: tasks.id, body: "[B](B.md)" });
  const b = await store.create({ title: "B", parentNodeId: tasks.id, fields: { props: { bagli: [a.id] } } });
  await store.update(tpl.id, { body: "[Görevler](Gorevler/Gorevler.md)" });
  const fresh = await store.read(tpl.id);
  assert.equal(fresh.body.trim(), "[Görevler](Gorevler/Gorevler.md)");

  const copy = await store.duplicate(tpl.id, { parentNodeId: null, title: "Web sitesi" });
  assert.equal(copy.title, "Web sitesi");
  assert.equal(copy.icon, "🚀");
  assert.equal(copy.template, undefined);
  assert.notEqual(copy.id, tpl.id);
  const all = await store.list();
  const copyTasks = all.find((n) => n.parentNodeId === copy.id)!;
  const copyA = all.find((n) => n.parentNodeId === copyTasks.id && n.title === "A")!;
  const copyB = all.find((n) => n.parentNodeId === copyTasks.id && n.title === "B")!;
  assert.equal(copy.body.trim(), "[Görevler](Gorevler/Gorevler.md)");
  assert.equal(copy.path, "Web sitesi/Web sitesi.md");
  assert.deepEqual(copyB.props, { bagli: [copyA.id] }, "ilişki kopyadaki satıra yönlenir");
  assert.equal((copyTasks.database as { properties: { target: string }[] }).properties[0].target, copyTasks.id);
  assert.equal((await store.read(copyA.id)).body.trim(), "[B](B.md)");
  assert.deepEqual((await store.read(b.id)).props, { bagli: [a.id] }, "kaynak değişmez");
});

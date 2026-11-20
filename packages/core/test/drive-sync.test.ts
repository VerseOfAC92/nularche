// Origin ↔ Google Drive eşitlemesi: gerçek HTTP üzerinden sahte Drive sunucusuyla, Drive istemcisi ve eşitleme
// kurallarının birlikte doğrulanması.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { deriveKeys, DriveSyncError, GoogleDrive, LOCK_MARKER, NodeStore, readSyncState, syncable, syncOrigin } from "../src/index.ts";
import { startFakeDrive } from "./fake-drive.ts";

const fake = await startFakeDrive();
after(() => fake.close());
const api = () => new GoogleDrive({ clientId: "id", clientSecret: "s", refreshToken: "rt" }, { token: `${fake.url}/token`, api: `${fake.url}/drive/v3`, upload: `${fake.url}/upload/drive/v3` });

async function origin(files: Record<string, string> = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "nularche-drive-"));
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await writeFile(path.join(root, rel), text);
  }
  return root;
}
const read = (root: string, rel: string) => readFile(path.join(root, rel), "utf8");
const opts = { host: "Mac" };

test("hangi yollar eşitlenir: kullanıcının içeriği ve ayarları evet, bilgisayarın kendi kayıtları hayır", () => {
  assert.equal(syncable("Notlar/Plan.md"), true);
  assert.equal(syncable("Attachments/resim.png"), true);
  assert.equal(syncable(".nularche/ui.json"), true);
  assert.equal(syncable(".nularche/origin.json"), true);
  assert.equal(syncable(".nularche/comments/abc.json"), true);
  assert.equal(syncable(".nularche/epochs/abc/1.md"), true);
  assert.equal(syncable(".nularche/snippets/tema.css"), true);
  assert.equal(syncable(".nularche/history/abc/1.md"), false, "otomatik sürümler bu bilgisayarda kalır");
  assert.equal(syncable(".nularche/ai/requests/r.json"), false, "AI kayıtları bu bilgisayarda kalır");
  assert.equal(syncable(".nularche/calendar-events.json"), false, "takvim önbelleği bu bilgisayarda kalır");
  assert.equal(syncable(".nularche/calendar.json"), false);
  assert.equal(syncable(".nularche/sync-purge.json"), false);
  assert.equal(syncable(".nularche/yeni-ic-kayit.json"), false, "bilinmeyen iç kayıtlar varsayılan olarak eşitlenmez");
  assert.equal(syncable(".trash/A.md"), false);
  assert.equal(syncable(".nularche/drive-sync.json"), false);
  assert.equal(syncable(".nularche/sync-removed/2026-11-20/A.md"), false);
  assert.equal(syncable("Notlar/.Plan.md.1234.tmp"), false);
  assert.equal(syncable(".DS_Store"), false);
  assert.equal(syncable(".git/config"), false);
});

test("yerel Origin Drive'a yüklenir; ikinci bilgisayar aynı Origin'i indirir; değişiklikler iki yönde akar", async () => {
  const drive = api();
  assert.equal(await drive.account(), "alex@gmail.com");
  const a = await origin({ "Plan.md": "# Plan\n", "Proje/Görev.md": "görev", ".nularche/ui.json": '{"theme":"dark"}', "Attachments/big.bin": "x".repeat(6 * 1024 * 1024), ".nularche/history/n1/1.md": "eski", ".nularche/ai/requests/r.json": "{}" });
  const rootId = await drive.createRoot("Nularche");
  const r1 = await syncOrigin(a, drive, rootId, opts);
  assert.deepEqual(r1.errors, []);
  assert.equal(r1.counts.uploaded, 4);
  assert.equal(fake.byPath(rootId, "Proje/Görev.md")?.data.toString(), "görev", "klasörler Drive'da da oluşur");
  assert.equal(fake.byPath(rootId, "Attachments/big.bin")?.data.length, 6 * 1024 * 1024, "büyük dosya sürdürülebilir yüklemeyle gider");
  assert.equal(fake.byPath(rootId, ".nularche/drive-sync.json"), undefined, "eşitleme durumu yüklenmez");

  // İkinci bilgisayar: boş Origin, aynı kök klasör.
  const roots = await drive.findRoots();
  assert.equal(roots[0].id, rootId);
  const b = await origin();
  const r2 = await syncOrigin(b, drive, rootId, { host: "PC" });
  assert.equal(r2.counts.downloaded, 4);
  assert.equal(await read(b, "Proje/Görev.md"), "görev");
  assert.equal(await read(b, ".nularche/ui.json"), '{"theme":"dark"}', "ayarlar da gelir");

  // B'de düzenle → A'ya gelir; A'da sil → B'den kaldırılır (sync-removed altında saklanır).
  await writeFile(path.join(b, "Plan.md"), "# Plan\nB'den");
  assert.equal((await syncOrigin(b, drive, rootId, { host: "PC" })).counts.uploaded, 1);
  assert.equal((await syncOrigin(a, drive, rootId, opts)).counts.downloaded, 1);
  assert.equal(await read(a, "Plan.md"), "# Plan\nB'den");
  await rm(path.join(a, "Proje/Görev.md"));
  assert.equal((await syncOrigin(a, drive, rootId, opts)).counts.deletedRemote, 1);
  assert.equal(fake.byPath(rootId, "Proje/Görev.md"), undefined, "Drive'da çöpe taşındı");
  assert.equal((await syncOrigin(b, drive, rootId, { host: "PC" })).counts.deletedLocal, 1);
  assert.equal(existsSync(path.join(b, "Proje/Görev.md")), false);
  const removed = await readdir(path.join(b, ".nularche/sync-removed"));
  assert.equal(removed.length, 1, "uzakta silinen yerel dosya kaybolmaz");

  // Değişiklik yoksa hiçbir aktarım olmaz.
  const idle = await syncOrigin(a, drive, rootId, opts);
  assert.deepEqual(idle.counts, { uploaded: 0, downloaded: 0, deletedLocal: 0, deletedRemote: 0, conflicts: 0, merged: 0, cleaned: 0 });
  assert.equal(fake.byPath(rootId, ".nularche/history/n1/1.md"), undefined, "otomatik geçmiş Drive'a gitmez");
  assert.equal(fake.byPath(rootId, ".nularche/ai/requests/r.json"), undefined, "AI kayıtları Drive'a gitmez");
});

test("iki tarafta da değişen dosya: Drive'daki sürüm yerine geçer, yerel sürüm çakışma kopyası olarak saklanır", async () => {
  const drive = api();
  const rootId = await drive.createRoot("Nularche");
  const a = await origin({ "Not.md": "ilk" });
  await syncOrigin(a, drive, rootId, opts);
  fake.edit(fake.byPath(rootId, "Not.md")!.id, "telefondan");
  await writeFile(path.join(a, "Not.md"), "bilgisayardan");
  const r = await syncOrigin(a, drive, rootId, { host: "Mac", now: new Date(2026, 10, 20, 14, 5).getTime() });
  assert.equal(r.counts.conflicts, 1);
  assert.equal(await read(a, "Not.md"), "telefondan");
  const copy = (await readdir(a)).find((f) => f.includes("conflict"))!;
  assert.equal(copy, "Not (conflict Mac 2026-11-20 14.05).md");
  assert.equal(await read(a, copy), "bilgisayardan");
  assert.ok(fake.byPath(rootId, copy), "çakışma kopyası da Drive'a gider");
  const state = await readSyncState(a);
  assert.ok(state?.files["Not.md"] && state.files[copy]);
});

test("ilk bağlantıda iki tarafta da olan dosyalar birleşir: aynısı eşleşir, farklısı kaybolmaz", async () => {
  const drive = api();
  const rootId = await drive.createRoot("Nularche");
  const seed = await origin({ "Ortak.md": "aynı", "Farklı.md": "drive", "Sadece drive.md": "d" });
  await syncOrigin(seed, drive, rootId, opts);
  const local = await origin({ "Ortak.md": "aynı", "Farklı.md": "yerel", "Sadece yerel.md": "y" });
  const r = await syncOrigin(local, drive, rootId, { host: "PC" });
  assert.deepEqual([r.counts.uploaded, r.counts.downloaded, r.counts.conflicts], [2, 2, 1]);
  assert.equal(await read(local, "Farklı.md"), "drive");
  assert.ok((await readdir(local)).some((f) => f.startsWith("Farklı (conflict PC")));
  assert.equal(await read(local, "Sadece drive.md"), "d");
  assert.equal(fake.byPath(rootId, "Sadece yerel.md")?.data.toString(), "y");
});

test("silme ve düzenleme çakışırsa düzenleme kazanır", async () => {
  const drive = api();
  const rootId = await drive.createRoot("Nularche");
  const a = await origin({ "X.md": "1" });
  await syncOrigin(a, drive, rootId, opts);
  await rm(path.join(a, "X.md"));
  fake.edit(fake.byPath(rootId, "X.md")!.id, "2");
  const r = await syncOrigin(a, drive, rootId, opts);
  assert.equal(r.counts.downloaded, 1);
  assert.equal(await read(a, "X.md"), "2");
});

test("Drive'a daha önce gitmiş bilgisayara özel kayıtlar kalıcı silinir, yereldekiler kalır", async () => {
  const drive = api();
  const rootId = await drive.createRoot("Nularche");
  const dot = await drive.createFolder(rootId, rootId, ".nularche");
  const hist = await drive.createFolder(rootId, dot.id, "history");
  await drive.upload(rootId, { parent: hist.id, name: "eski.md", data: new TextEncoder().encode("şifresiz eski sürüm") });
  await drive.upload(rootId, { parent: dot.id, name: "calendar-events.json", data: new TextEncoder().encode("{}") });
  const a = await origin({ "Not.md": "n", ".nularche/history/eski.md": "yerel" });
  const r = await syncOrigin(a, drive, rootId, opts);
  assert.equal(r.counts.cleaned, 3, "iki dosya ve boşalan history klasörü");
  assert.ok(!fake.files.has(hist.id), "kayıt klasörü de kalktı");
  assert.ok(fake.removed.includes("eski.md") && fake.removed.includes("calendar-events.json"), "çöpe değil, kalıcı silinmeli");
  assert.equal(await read(a, ".nularche/history/eski.md"), "yerel");
});

test("ayar dosyası iki bilgisayarda farklı anahtarlarla değişirse birleştirilir, çakışma kopyası oluşmaz", async () => {
  const drive = api();
  const rootId = await drive.createRoot("Nularche");
  const a = await origin({ ".nularche/ui.json": JSON.stringify({ theme: "dark", font: "Lora" }) });
  await syncOrigin(a, drive, rootId, opts);
  const b = await origin();
  await syncOrigin(b, drive, rootId, { host: "PC" });
  await writeFile(path.join(a, ".nularche/ui.json"), JSON.stringify({ theme: "light", font: "Lora" }));
  await writeFile(path.join(b, ".nularche/ui.json"), JSON.stringify({ theme: "dark", font: "Lora", recent: ["x"] }));
  await syncOrigin(b, drive, rootId, { host: "PC" });
  const r = await syncOrigin(a, drive, rootId, opts);
  assert.equal(r.counts.merged, 1);
  assert.equal(r.counts.conflicts, 0);
  assert.deepEqual(JSON.parse(await read(a, ".nularche/ui.json")), { theme: "light", font: "Lora", recent: ["x"] });
  assert.ok(!(await readdir(path.join(a, ".nularche"))).some((f) => f.includes("conflict")));
  await syncOrigin(b, drive, rootId, { host: "PC" });
  assert.deepEqual(JSON.parse(await read(b, ".nularche/ui.json")), { theme: "light", font: "Lora", recent: ["x"] });
});

test("not kilitlenince: eski sürümleri ve Epoch'ları silinir; Drive'daki şifresiz dosyası kalıcı silinip şifreli hâli yeniden yüklenir", async () => {
  const drive = api();
  const rootId = await drive.createRoot("Nularche");
  const a = await origin();
  const store = new NodeStore(a);
  await store.ensureRoot();
  const note = await store.create({ title: "Gizli", body: "maaş bilgisi" });
  await store.update(note.id, { body: "maaş bilgisi v2" });
  await store.checkpoint(note.id, "İlk taslak");
  assert.equal((await store.history(note.id)).length, 2);
  await syncOrigin(a, drive, rootId, opts);
  const before = fake.byPath(rootId, note.path)!;
  assert.ok(fake.byPath(rootId, `.nularche/epochs/${note.id}/labels.json`), "Epoch'lar eşitlenir");
  assert.equal(fake.byPath(rootId, `.nularche/history/${note.id}`), undefined, "otomatik sürümler eşitlenmez");

  await store.update(note.id, { body: `${LOCK_MARKER}\n\n{"v":1,"data":"şifreli"}` });
  assert.deepEqual(await store.history(note.id), [], "şifresiz eski sürümler ve Epoch'lar silindi");
  const r = await syncOrigin(a, drive, rootId, opts);
  assert.deepEqual(r.errors, []);
  assert.equal(fake.files.has(before.id), false, "şifresiz dosya Drive'dan kalıcı silindi (sürüm geçmişiyle)");
  const after = fake.byPath(rootId, note.path)!;
  assert.notEqual(after.id, before.id);
  assert.ok(!after.data.toString().includes("maaş"), "Drive'daki not şifreli");
  assert.equal(fake.byPath(rootId, `.nularche/epochs/${note.id}/labels.json`), undefined, "Epoch'lar Drive'dan kalıcı silindi");
  assert.equal(existsSync(path.join(a, ".nularche/sync-purge.json")), false, "silme listesi tamamlanınca kalkar");
});

test("açılışta: kilitli notun geçmişinde kalmış şifresiz sürümler silinir; eski düzendeki Epoch'lar taşınır", async () => {
  const a = await origin();
  const store = new NodeStore(a);
  await store.ensureRoot();
  const note = await store.create({ title: "Eski", body: `${LOCK_MARKER}\n\nx` });
  const open = await store.create({ title: "Açık", body: "a" });
  await mkdir(path.join(a, ".nularche/history", note.id), { recursive: true });
  await writeFile(path.join(a, ".nularche/history", note.id, "100.md"), "---\nid: x\n---\nşifresiz eski hâl");
  await mkdir(path.join(a, ".nularche/history", open.id), { recursive: true });
  await writeFile(path.join(a, ".nularche/history", open.id, "200.md"), "---\nid: y\n---\nepoch");
  await writeFile(path.join(a, ".nularche/history", open.id, "300.md"), "---\nid: y\n---\notomatik");
  await writeFile(path.join(a, ".nularche/history", open.id, "labels.json"), JSON.stringify({ 200: "Taslak" }));
  assert.equal(await store.purgeLockedPlaintext(), 1);
  assert.equal(existsSync(path.join(a, ".nularche/history", note.id, "100.md")), false);
  assert.equal(await store.migrateEpochs(), 1);
  assert.ok(existsSync(path.join(a, ".nularche/epochs", open.id, "200.md")));
  assert.deepEqual((await store.history(open.id)).map((e) => [e.at, e.label ?? null]), [[300, null], [200, "Taslak"]]);
});

test("uçtan uca şifreli kök: Drive'da içerik ve dosya adları okunamaz; parolayla başka bilgisayar açar", async () => {
  const drive = api();
  const keys = await deriveKeys("çok gizli parola", "c2FsdHNhbHRzYWx0c2FsdA");
  const rootId = await drive.createRoot("Nularche", { salt: "c2FsdHNhbHRzYWx0c2FsdA", check: "x" });
  const a = await origin({ "Notlar/Maaş.md": "maaş bilgisi", ".nularche/ui.json": "{}" });
  await syncOrigin(a, drive, rootId, { host: "Mac", keys });
  const stored = [...fake.files.values()].filter((f) => f.appProperties.nularcheRoot === rootId);
  assert.equal(stored.length, 2);
  for (const f of stored) {
    assert.match(f.name, /^[0-9a-f]{40}\.nlce$/, "dosya adı yolu ele vermez");
    assert.ok(!f.data.toString("latin1").includes("maaş") && !f.data.toString("utf8").includes("Maaş"), "içerik şifreli");
    assert.equal(f.parents[0], rootId, "şifreli kök düzdür (klasör adları da gizli)");
  }
  const b = await origin();
  const r = await syncOrigin(b, drive, rootId, { host: "PC", keys: await deriveKeys("çok gizli parola", "c2FsdHNhbHRzYWx0c2FsdA") });
  assert.equal(r.counts.downloaded, 2);
  assert.equal(await read(b, "Notlar/Maaş.md"), "maaş bilgisi");
  await writeFile(path.join(b, "Notlar/Maaş.md"), "güncel");
  await syncOrigin(b, drive, rootId, { host: "PC", keys });
  assert.equal((await syncOrigin(a, drive, rootId, { host: "Mac", keys })).counts.downloaded, 1);
  assert.equal(await read(a, "Notlar/Maaş.md"), "güncel");
  const wrong = await syncOrigin(await origin(), drive, rootId, { host: "X", keys: await deriveKeys("yanlış parola", "c2FsdHNhbHRzYWx0c2FsdA") });
  assert.equal(wrong.counts.downloaded, 0, "yanlış parolayla hiçbir şey açılmaz");
});

test("Drive tarafı birden boş görünürse (kök silinmiş) yerel dosyalar silinmez, eşitleme durur", async () => {
  const drive = api();
  const rootId = await drive.createRoot("Nularche");
  const a = await origin({ "A.md": "1", "B.md": "2" });
  await syncOrigin(a, drive, rootId, opts);
  for (const f of fake.files.values()) if (f.appProperties.nularcheRoot === rootId) f.trashed = true;
  await assert.rejects(syncOrigin(a, drive, rootId, opts), (e: unknown) => e instanceof DriveSyncError && e.code === "empty_remote");
  assert.equal(await read(a, "A.md"), "1");
});

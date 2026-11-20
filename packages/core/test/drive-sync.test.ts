// Origin ↔ Google Drive eşitlemesi: gerçek HTTP üzerinden sahte Drive sunucusuyla, Drive istemcisi ve eşitleme
// kurallarının birlikte doğrulanması.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { GoogleDrive, readSyncState, syncable, syncOrigin } from "../src/index.ts";
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

test("hangi yollar eşitlenir", () => {
  assert.equal(syncable("Notlar/Plan.md"), true);
  assert.equal(syncable(".nularche/ui.json"), true);
  assert.equal(syncable(".nularche/drive-sync.json"), false);
  assert.equal(syncable(".nularche/sync-removed/2026-11-20/A.md"), false);
  assert.equal(syncable("Notlar/.Plan.md.1234.tmp"), false);
  assert.equal(syncable(".DS_Store"), false);
  assert.equal(syncable(".git/config"), false);
});

test("yerel Origin Drive'a yüklenir; ikinci bilgisayar aynı Origin'i indirir; değişiklikler iki yönde akar", async () => {
  const drive = api();
  assert.equal(await drive.account(), "alex@gmail.com");
  const a = await origin({ "Plan.md": "# Plan\n", "Proje/Görev.md": "görev", ".nularche/ui.json": '{"theme":"dark"}', "Attachments/big.bin": "x".repeat(6 * 1024 * 1024) });
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
  assert.deepEqual(idle.counts, { uploaded: 0, downloaded: 0, deletedLocal: 0, deletedRemote: 0, conflicts: 0 });
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

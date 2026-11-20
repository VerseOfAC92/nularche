// Anlık görüntü geçmişi: içerik adresli, artımlı, şifreli; tek dosya ya da Origin'in tamamı geri yüklenir; kilitlenen
// notun şifresiz eski sürümleri anlık görüntülerden de silinir.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { NodeStore, SnapshotStore } from "../src/index.ts";
import { lockedBody } from "../src/note-text.ts";

async function objectsIn(dir: string): Promise<string[]> {
  const base = path.join(dir, "objects");
  const out: string[] = [];
  for (const shard of await readdir(base).catch(() => [] as string[])) for (const n of await readdir(path.join(base, shard))) out.push(n);
  return out;
}

async function allBytes(dir: string): Promise<Buffer> {
  const parts: Buffer[] = [];
  const walk = async (d: string) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else parts.push(await readFile(p));
    }
  };
  await walk(dir);
  return Buffer.concat(parts);
}

test("anlık görüntü: artımlı, değişmeyen içerik yeniden yazılmaz, değişiklik yoksa otomatik alınmaz", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "nularche-snap-"));
  const store = new NodeStore(root);
  await store.ensureRoot();
  const a = await store.create({ title: "Birinci", body: "ilk metin" });
  await store.create({ title: "İkinci", body: "ikinci metin" });
  const snaps = new SnapshotStore(root, { key: randomBytes(32) });
  const first = await snaps.create({ auto: true });
  assert.ok(first);
  assert.equal(first.added, first.files);
  const objects1 = await objectsIn(snaps.dir);
  assert.equal(await snaps.create({ auto: true }), null, "değişiklik yoksa otomatik anlık görüntü alınmaz");
  await store.update(a.id, { body: "değişti" });
  const second = (await snaps.create({ auto: true }))!;
  assert.equal(second.changed, 1);
  assert.equal(second.added, 0);
  const objects2 = await objectsIn(snaps.dir);
  assert.equal(objects2.length, objects1.length + 1, "yalnızca değişen dosya yeni nesne olur");
  const list = await snaps.list();
  assert.equal(list.length, 2);
  assert.equal(list[0].id, second.id, "en yeni başta");
});

test("anlık görüntü: şifreli saklanır; anahtarsız okunamaz", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "nularche-snap-"));
  const store = new NodeStore(root);
  await store.ensureRoot();
  await store.create({ title: "Gizli plan", body: "çok-gizli-içerik-123" });
  const key = randomBytes(32);
  const snaps = new SnapshotStore(root, { key });
  const s = (await snaps.create({ label: "elle" }))!;
  const raw = await allBytes(snaps.dir);
  assert.ok(!raw.includes(Buffer.from("çok-gizli-içerik-123")), "içerik şifreli");
  assert.ok(!raw.includes(Buffer.from("Gizli plan")), "dosya adları da şifreli listede");
  assert.deepEqual(await new SnapshotStore(root).list(), [], "anahtarsız liste okunamaz");
  assert.equal((await new SnapshotStore(root, { key: randomBytes(32) }).list()).length, 0, "başka anahtarla da");
  assert.equal((await snaps.list())[0].label, "elle");
  assert.equal((await snaps.list())[0].id, s.id);
});

test("anlık görüntü: tek dosya ve Origin'in tamamı geri yüklenir; geri yükleme de geri alınabilir", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "nularche-snap-"));
  const store = new NodeStore(root);
  await store.ensureRoot();
  const a = await store.create({ title: "Not A", body: "A1" });
  const b = await store.create({ title: "Not B", body: "B1" });
  await writeFile(path.join(root, "ek.txt"), "ek-1");
  const snaps = new SnapshotStore(root, { key: randomBytes(32) });
  const s1 = (await snaps.create())!;

  await store.update(a.id, { body: "A2" });
  await store.update(b.id, { body: "B2" });
  await rm(path.join(root, "ek.txt"));
  const c = await store.create({ title: "Not C", body: "sonradan" });

  const files = await snaps.files(s1.id);
  const st = (p: string) => files.find((f) => f.path === p)?.status;
  assert.equal(st(a.path), "changed");
  assert.equal(st("ek.txt"), "deleted");
  assert.equal(st(c.path), "added");

  // Tek dosya
  const one = await snaps.restore(s1.id, { paths: [a.path] });
  assert.equal(one.restored, 1);
  store.invalidate();
  assert.equal((await store.read(a.id)).body.trim(), "A1");
  assert.equal((await store.read(b.id)).body.trim(), "B2", "diğerleri değişmez");

  // Tamamı: sonradan eklenen not kaldırılır, silinen ek geri gelir.
  const all = await snaps.restore(s1.id);
  store.invalidate();
  assert.ok(all.before, "önce şimdiki hâlin anlık görüntüsü alınır");
  assert.equal((await store.read(b.id)).body.trim(), "B1");
  assert.equal(await readFile(path.join(root, "ek.txt"), "utf8"), "ek-1");
  await assert.rejects(stat(path.join(root, c.path)));
  assert.ok(!(await store.list()).some((n) => n.id === c.id));

  // Geri yüklemeyi geri al
  await snaps.restore(all.before!);
  store.invalidate();
  assert.equal((await store.read(c.id)).body.trim(), "sonradan");
  assert.equal((await store.read(b.id)).body.trim(), "B2");
});

test("anlık görüntü: not kilitlenince şifresiz eski sürümleri silinir; şifreli sürüm kalır", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "nularche-snap-"));
  const store = new NodeStore(root);
  await store.ensureRoot();
  const key = randomBytes(32);
  const snaps = new SnapshotStore(root, { key });
  store.lockPurgeHooks.add((ids) => snaps.purgeNotes(ids));
  const n = await store.create({ title: "Günlük", body: "şifresiz-sır" });
  const other = await store.create({ title: "Diğer", body: "kalır" });
  const s1 = (await snaps.create())!;
  const before = await snaps.files(s1.id);
  assert.ok(before.some((f) => f.path === n.path));

  await store.update(n.id, { body: lockedBody('{"v":1}', "🔒"), fields: { locked: true } });
  const after = await snaps.files(s1.id);
  assert.ok(!after.some((f) => f.path === n.path && f.status !== "added"), "şifresiz sürüm anlık görüntüden çıktı");
  assert.ok(after.some((f) => f.path === other.path && f.status === "same"));

  const s2 = (await snaps.create())!;
  assert.equal(await snaps.purgeNotes([n.id]), 0, "şifreli sürüm silinmez");
  assert.ok((await snaps.files(s2.id)).some((f) => f.path === n.path && f.status === "same"));
});

test("anlık görüntü: geçersiz yol ve kimlik reddedilir", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "nularche-snap-"));
  const snaps = new SnapshotStore(root);
  await writeFile(path.join(root, "a.md"), "x");
  const s = (await snaps.create())!;
  await assert.rejects(snaps.restore("../../etc", {}), /Geçersiz/);
  await assert.rejects(snaps.read(s.id, "../a.md"), /yok/);
  await assert.rejects(snaps.restore(s.id, { paths: ["../dışarı.md"] }).then(() => stat(path.join(root, "..", "dışarı.md"))));
});

import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { dateValue, NodeStore, parseQuery, runQuery } from "../src/index.ts";
import { lockedBody } from "../src/note-text.ts";

test("Speculum: sözdizimi ve göreli tarihler", () => {
  const q = parseQuery("tag: #proje\nwhere: durum = Açık\nwhere: has son\nsort: başlık desc\nlimit: 9999\nshow: tablo\nfields: durum, son\nbozuk satır");
  assert.deepEqual(q.tags, ["proje"]);
  assert.equal(q.where.length, 2);
  assert.equal(q.where[1].op, "has");
  assert.equal(q.limit, 500);
  assert.equal(q.show, "table");
  assert.equal(q.errors.length, 1);
  const now = Date.parse("2026-11-20T12:00:00");
  assert.equal(new Date(dateValue("-7d", now)!).getDate(), 13);
});

test("Speculum: etiket, Arche, özellik, metin ve görevler; kilitli içerik ve kendi notu hariç", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "nularche-q-"));
  const store = new NodeStore(root);
  await store.ensureRoot();
  const tez = await store.create({ title: "Tez", parentNodeId: null });
  const a = await store.create({ title: "Bölüm 1", parentNodeId: tez.id, body: "#taslak bellek üzerine\n\n- [ ] kaynak ekle\n- [x] giriş" });
  await store.update(a.id, { properties: { durum: "Açık", sayfa: 12 } });
  const b = await store.create({ title: "Bölüm 2", parentNodeId: tez.id, body: "#taslak arşiv" });
  await store.update(b.id, { properties: { durum: "Bitti", sayfa: 30 } });
  await store.create({ title: "Gizli", parentNodeId: tez.id, body: lockedBody("{}", "x") });
  const self = await store.create({ title: "Pano", parentNodeId: tez.id, body: "#taslak" });

  let r = await runQuery(store, "tag: #taslak", { selfId: self.id });
  assert.deepEqual(r.rows.map((x) => x.title).sort(), ["Bölüm 1", "Bölüm 2"]);
  r = await runQuery(store, "arche: Tez\nwhere: durum = açık\nshow: table\nfields: durum, sayfa");
  assert.deepEqual(r.rows.map((x) => [x.title, x.values.durum, x.values.sayfa]), [["Bölüm 1", "Açık", "12"]]);
  r = await runQuery(store, "where: sayfa > 20");
  assert.deepEqual(r.rows.map((x) => x.title), ["Bölüm 2"]);
  r = await runQuery(store, "text: bellek");
  assert.deepEqual(r.rows.map((x) => x.title), ["Bölüm 1"]);
  r = await runQuery(store, "show: tasks\narche: Tez");
  assert.deepEqual(r.tasks.map((t) => t.text), ["kaynak ekle"]);
  r = await runQuery(store, "show: count\nwhere: updated >= -1d");
  assert.ok(r.total >= 4);
  r = await runQuery(store, "sort: sayfa desc\nwhere: has sayfa");
  assert.deepEqual(r.rows.map((x) => x.title), ["Bölüm 2", "Bölüm 1"]);
});

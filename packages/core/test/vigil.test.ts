import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { cleanVigils, isDue, lastOccurrence, nextRun, NodeStore, upcomingRuns, writeDigest, type Vigil } from "../src/index.ts";

const at = (s: string) => new Date(s).getTime(); // yerel saat
const weekly: Vigil = { id: "v1", name: "Haftalık", enabled: true, schedule: { freq: "weekly", weekday: 1, time: "09:00" }, action: { kind: "digest", days: 7 } };

test("Vigil: haftalık, günlük ve aylık zamanlama", () => {
  // 2026-11-20 cuma → sonraki pazartesi 23 Kasım 09:00
  assert.equal(nextRun(weekly.schedule, at("2026-11-20T12:00:00")), at("2026-11-23T09:00:00"));
  assert.equal(lastOccurrence(weekly.schedule, at("2026-11-20T12:00:00")), at("2026-11-16T09:00:00"));
  assert.equal(nextRun({ freq: "daily", time: "07:30" }, at("2026-11-20T07:29:00")), at("2026-11-20T07:30:00"));
  assert.equal(nextRun({ freq: "monthly", day: 31, time: "10:00" }, at("2026-11-20T00:00:00")), at("2026-11-28T10:00:00"), "aylık gün 28 ile sınırlı");
  assert.equal(upcomingRuns(weekly, at("2026-11-01T00:00:00"), at("2026-11-30T23:00:00")).length, 5);
});

test("Vigil: çalışma zamanı geldi mi; kaçırılan bir kez yapılır", () => {
  const now = at("2026-11-18T14:00:00"); // çarşamba
  assert.equal(isDue(weekly, now), true, "pazartesi kaçırıldı");
  assert.equal(isDue({ ...weekly, lastRun: at("2026-11-16T09:01:00") }, now), false);
  assert.equal(isDue({ ...weekly, enabled: false }, now), false);
  assert.equal(isDue(weekly, now, at("2026-11-17T00:00:00")), false, "oluşturulmadan önceki an sayılmaz");
  assert.equal(cleanVigils([weekly, { id: "../x" }, { ...weekly, id: "v2", schedule: { freq: "yearly", time: "x" } }]).length, 1);
});

test("Vigil: yerel özet notu yeni ve güncellenen notları bağlantılarıyla yazar", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "nularche-vg-"));
  const store = new NodeStore(root);
  await store.ensureRoot();
  const tez = await store.create({ title: "Tez", parentNodeId: null });
  await store.create({ title: "Yeni Bölüm", parentNodeId: tez.id, body: "- [ ] yaz\nSoru :: Cevap" });
  const doc = await writeDigest(store, { days: 7, title: "Haftalık özet", lang: "tr" });
  assert.equal(doc.archeId, null, "Shadow'a yazılır");
  assert.match(doc.body, /## Yeni notlar \(2\)/);
  assert.match(doc.body, /\[Yeni Bölüm\]\(\.\.\/Tez\/Yeni%20B%C3%B6l%C3%BCm\.md\)|\[Yeni Bölüm\]\([^)]+\)/);
  assert.match(doc.body, /Açık görevleri olan notlar/);
  assert.match(doc.body, /Anamnesis/);
});

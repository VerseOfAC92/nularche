import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { extractCards, intervalDays, Anamnesis, NodeStore, retrievability, review } from "../src/index.ts";

const DAY = 86_400_000;

test("Anamnesis: kartlar notlardan çıkarılır", () => {
  const body = ["# Sözlük", "", "- Ephemeral :: geçici", "Başkent nedir? :: Ankara ^k1", "Mitoz ::: Hücre bölünmesi", "```", "kod :: değil", "```", "`a :: b` satır içi", "http://x.y düz metin", "- [ ] görev :: cevap"].join("\n");
  const cards = extractCards(body, { id: "n1", title: "Sözlük", archeId: null });
  assert.deepEqual(
    cards.map((c) => [c.front, c.back]),
    [["Ephemeral", "geçici"], ["Başkent nedir?", "Ankara"], ["Mitoz", "Hücre bölünmesi"], ["Hücre bölünmesi", "Mitoz"], ["görev", "cevap"]],
  );
  assert.equal(new Set(cards.map((c) => c.id)).size, cards.length);
  assert.equal(extractCards(body, { id: "n1", title: "x", archeId: null })[0].id, cards[0].id, "kimlik kararlı");
});

test("FSRS: aralıklar büyür, unutma kısaltır, kolay daha uzun", () => {
  const t0 = Date.parse("2026-01-01T09:00:00Z");
  assert.ok(Math.abs(retrievability(intervalDays(10), 10) - 0.9) < 0.02, "hedef hatırlama ~%90");
  const again = review(undefined, 1, t0);
  assert.equal(again.due - t0, 10 * 60_000);
  const good = review(undefined, 3, t0);
  const easy = review(undefined, 4, t0);
  assert.ok(easy.due > good.due);
  const g2 = review(good, 3, good.due);
  assert.ok(g2.due - good.due > good.due - t0, "ikinci aralık daha uzun");
  const lapse = review(g2, 1, g2.due);
  assert.equal(lapse.lapses, 1);
  assert.ok(lapse.stability < g2.stability);
  const g3 = review(g2, 3, g2.due);
  assert.ok(g3.difficulty <= g2.difficulty + 1e-9 || g3.difficulty < 10);
  assert.ok((g3.due - g2.due) / DAY > 5);
});

test("Anamnesis: kuyruk, günlük yeni kart sınırı ve değerlendirme", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "nularche-mn-"));
  const store = new NodeStore(root);
  await store.ensureRoot();
  await store.create({ title: "Kartlar", body: Array.from({ length: 5 }, (_, i) => `Soru ${i} :: Cevap ${i}`).join("\n") });
  const mn = new Anamnesis(store);
  let q = await mn.queue({ newPerDay: 3 });
  assert.equal(q.counts.total, 5);
  assert.equal(q.queue.length, 3);
  for (const c of q.queue) await mn.grade(c.id, 3);
  q = await mn.queue({ newPerDay: 3 });
  assert.equal(q.queue.length, 0, "günlük sınır doldu");
  assert.equal(q.counts.reviewedToday, 3);
  q = await mn.queue({ newPerDay: 3, now: Date.now() + 30 * DAY });
  assert.ok(q.counts.due >= 3, "vadesi gelenler");
  await assert.rejects(mn.grade("../x", 3));
});

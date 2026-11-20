import assert from "node:assert/strict";
import { test } from "node:test";
import { guessLang, readability } from "../src/index.ts";

const easyTr = "Ali topu at. Ayşe ipi tut. Kedi süt içti. Ev çok sıcak. Biz top oynadık. Sen de gel. Bu gün çok güzel. Annem çay yaptı. Babam eve geldi. Kuş uçtu gitti.";
const hardTr =
  "Uluslararası ilişkilerdeki karmaşıklaşan güvenlik paradigmalarının, ekonomik bütünleşme süreçleriyle etkileşiminin değerlendirilmesinde, kurumsallaşmış çok taraflı işbirliği mekanizmalarının sürdürülebilirliğine ilişkin yapısal belirsizliklerin giderilmesi, karar alıcıların öngörülebilirlik kapasitesinin artırılmasını zorunlu kılmaktadır ve bu durum uluslararasılaştırılmış düzenlemelerin yeniden yorumlanmasını gerektirmektedir.";

test("okunabilirlik: kısa metinde hesaplanmaz", () => {
  assert.equal(readability("Kısa bir metin."), null);
});

test("okunabilirlik: Türkçe (Ateşman) kolay ve zor metni ayırır", () => {
  const easy = readability(easyTr)!;
  assert.equal(easy.lang, "tr");
  assert.ok(easy.score >= 80, `kolay: ${easy.score}`);
  const hard = readability(`${hardTr} ${hardTr}`)!;
  assert.ok(hard.score < 30, `zor: ${hard.score}`);
  assert.equal(hard.level, "veryHard");
});

test("okunabilirlik: İngilizce (Flesch)", () => {
  const text = "The cat sat on the mat. It was a sunny day and the dog ran to the park with the boy. They had fun. Then they went home for tea and cake. It was good. The end came soon for this short tale.";
  assert.equal(guessLang(text), "en");
  const r = readability(text)!;
  assert.equal(r.lang, "en");
  assert.ok(r.score > 70, String(r.score));
});

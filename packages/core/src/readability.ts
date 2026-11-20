// Okunabilirlik: Türkçe metinlerde Ateşman (1997), İngilizce metinlerde Flesch okuma kolaylığı formülü. İkisi de
// 0–100 arası bir puan verir (yüksek = kolay). Puan cümle başına kelime ve kelime başına hece ortalamalarından
// hesaplanır; çok kısa metinlerde anlamlı olmadığından 30 kelimenin altında hesaplanmaz.

export type ReadabilityLang = "tr" | "en";
export type ReadabilityLevel = "veryEasy" | "easy" | "medium" | "hard" | "veryHard";

export interface Readability {
  score: number;
  lang: ReadabilityLang;
  level: ReadabilityLevel;
  words: number;
  sentences: number;
  /** Cümle başına ortalama kelime. */
  wordsPerSentence: number;
  /** Kelime başına ortalama hece. */
  syllablesPerWord: number;
}

export const READABILITY_MIN_WORDS = 30;

const WORD_RE = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu;
const TR_VOWELS = /[aeıioöuüâîû]/g;
const TR_HINT = /[çğışöüÇĞİŞÖÜ]|\b(?:ve|bir|bu|için|ile|da|de|ama|çok|olan|gibi)\b/g;
const EN_HINT = /\b(?:the|and|of|to|is|in|that|with|for|this|was)\b/gi;

/** Metnin dili: Türkçeye özgü harfler ve sık kelimeler ile İngilizcenin sık kelimeleri sayılarak; eşitlikte `fallback`. */
export function guessLang(text: string, fallback: ReadabilityLang = "tr"): ReadabilityLang {
  const sample = text.slice(0, 20_000);
  const tr = sample.match(TR_HINT)?.length ?? 0;
  const en = sample.match(EN_HINT)?.length ?? 0;
  if (tr === en) return fallback;
  return tr > en ? "tr" : "en";
}

function syllablesTr(word: string): number {
  return Math.max(1, word.toLocaleLowerCase("tr").match(TR_VOWELS)?.length ?? 0);
}

function syllablesEn(word: string): number {
  let w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 1;
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|[^laeiouy]ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  return Math.max(1, w.match(/[aeiouy]{1,2}/g)?.length ?? 1);
}

/** Cümle sayısı: . ! ? … ile biten parçalar; satır sonları (başlık, liste maddesi) da cümle sınırıdır. */
function countSentences(text: string): number {
  return text
    .split(/(?<=[.!?…])\s+|\n+/)
    .filter((s) => WORD_RE.test(s) && ((WORD_RE.lastIndex = 0), true)).length;
}

function levelOf(score: number, lang: ReadabilityLang): ReadabilityLevel {
  // Ateşman: 90+ çok kolay, 70–89 kolay, 50–69 orta, 30–49 zor, <30 çok zor. Flesch: 80+, 60–79, 50–59, 30–49, <30.
  const [a, b, c, d] = lang === "tr" ? [90, 70, 50, 30] : [80, 60, 50, 30];
  return score >= a ? "veryEasy" : score >= b ? "easy" : score >= c ? "medium" : score >= d ? "hard" : "veryHard";
}

export function readability(text: string, lang?: ReadabilityLang): Readability | null {
  const words = text.match(WORD_RE) ?? [];
  if (words.length < READABILITY_MIN_WORDS) return null;
  const l = lang ?? guessLang(text);
  const syllables = words.reduce((s, w) => s + (l === "tr" ? syllablesTr(w) : syllablesEn(w)), 0);
  const sentences = Math.max(1, countSentences(text));
  const wps = words.length / sentences;
  const spw = syllables / words.length;
  const raw = l === "tr" ? 198.825 - 40.175 * spw - 2.61 * wps : 206.835 - 1.015 * wps - 84.6 * spw;
  const score = Math.round(Math.min(100, Math.max(0, raw)));
  return { score, lang: l, level: levelOf(score, l), words: words.length, sentences, wordsPerSentence: Math.round(wps * 10) / 10, syllablesPerWord: Math.round(spw * 100) / 100 };
}

// İkon seçicisinin emoji listesi: bütün Unicode emojileri (emoji-data.json, scripts/gen-emoji-data.ts üretir), işletim
// sisteminin çizebildikleriyle sınırlı. Veri yalnızca seçici ilk açıldığında yüklenir.

import { supportedOnly } from "./supported.ts";

export interface EmojiItem {
  emoji: string;
  group: number;
  en: string;
  tr: string;
  /** Küçük harfli arama sözcükleri (Türkçe ve İngilizce adlar ve anahtar sözcükler). */
  words: string;
  /** Ten rengi çeşitleri, açıktan koyuya (yalnızca destekleyen emojilerde). */
  tones?: string[];
}

export interface EmojiData {
  /** Grup anahtarları (smileys-emotion, people-body…), listedeki `group` bu dizinin sırasıdır. */
  groups: string[];
  items: EmojiItem[];
}

type Row = [string, number, string, string, string, string[]?];

let loading: Promise<EmojiData> | null = null;

export function loadEmoji(): Promise<EmojiData> {
  loading ??= import("./emoji-data.json").then((m) => {
    const raw = m.default as unknown as { groups: string[]; list: Row[] };
    const items = raw.list.map(([emoji, group, en, tr, words, tones]) => ({ emoji, group, en, tr, words, ...(tones ? { tones } : {}) }));
    return { groups: raw.groups, items: supportedOnly(items, (x) => x.emoji) };
  });
  return loading;
}

/** Ten rengi seçildiyse emojinin o tondaki hâli (çeşidi yoksa kendisi). `tone`: 0 = sarı, 1–5 = açıktan koyuya. */
export const withTone = (item: EmojiItem, tone: number): string => (tone > 0 && item.tones ? item.tones[tone - 1] : item.emoji);

/** Arama: her sözcük adlarda ya da anahtar sözcüklerde geçmeli (Türkçe büyük/küçük harf kurallarıyla). */
export function searchEmoji(items: EmojiItem[], query: string): EmojiItem[] {
  const terms = query.toLocaleLowerCase("tr").split(/\s+/).filter(Boolean);
  if (!terms.length) return items;
  const hits = items.filter((x) => terms.every((term) => x.words.includes(term) || x.emoji === term));
  // Adı aramayla başlayanlar önce.
  const first = terms[0];
  const starts = (x: EmojiItem) => x.en.toLowerCase().startsWith(first) || x.tr.toLocaleLowerCase("tr").startsWith(first);
  return [...hits.filter(starts), ...hits.filter((x) => !starts(x))];
}

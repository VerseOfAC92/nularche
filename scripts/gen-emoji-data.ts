// İkon seçicisinin emoji verisini üretir: packages/web/src/emoji/emoji-data.json.
// Kaynaklar (sürümleri sabit; üretim sırasında indirilir, uygulama paketine yalnızca çıktı girer):
//   emojibase-data (MIT): bütün Unicode emojileri, grupları, sıraları ve ten rengi çeşitleri (İngilizce adlar).
//   Unicode CLDR annotations (Unicode-3.0): emojilerin Türkçe ve İngilizce adları ve arama sözcükleri.
// Hangi emojinin gösterileceğine çalışma anında, işletim sisteminin yazı tipinin çizebildiğine bakılarak karar verilir
// (packages/web/src/emoji/supported.ts). Kullanım: node scripts/gen-emoji-data.ts

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { projectRoot } from "../packages/core/src/config.ts";

const EMOJIBASE = "18.0.0";
const CLDR = "49.0.0";
const CDN = "https://cdn.jsdelivr.net/npm";

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return (await res.json()) as T;
}

interface Emoji {
  unicode: string;
  hexcode: string;
  label: string;
  group?: number;
  order?: number;
  tags?: string[];
  skins?: Emoji[];
}
type Annotations = Record<string, { default?: string[]; tts?: string[] }>;

const base = await get<Emoji[]>(`${CDN}/emojibase-data@${EMOJIBASE}/en/compact.json`);
const groups = (await get<{ groups: { key: string; order: number }[] }>(`${CDN}/emojibase-data@${EMOJIBASE}/en/messages.json`)).groups;
const cldr = async (lang: string): Promise<Annotations> => ({
  ...(await get<{ annotationsDerived: { annotations: Annotations } }>(`${CDN}/cldr-annotations-derived-full@${CLDR}/annotationsDerived/${lang}/annotations.json`)).annotationsDerived.annotations,
  ...(await get<{ annotations: { annotations: Annotations } }>(`${CDN}/cldr-annotations-full@${CLDR}/annotations/${lang}/annotations.json`)).annotations.annotations,
});
const tr = await cldr("tr");
const en = await cldr("en");
const find = (a: Annotations, e: string) => a[e] ?? a[e.replace(/️/g, "")];

/** Ten rengi değiştiricileri (açık → koyu). */
const TONES = ["1F3FB", "1F3FC", "1F3FD", "1F3FE", "1F3FF"];
const KEPT = groups.filter((g) => g.key !== "component").sort((a, b) => a.order - b.order);
const groupIndex = new Map(KEPT.map((g, i) => [g.order, i]));

const clean = (words: string[]) => [...new Set(words.map((w) => w.toLocaleLowerCase("tr").trim()).filter(Boolean))];
const list = base
  .filter((e) => e.group !== undefined && groupIndex.has(e.group))
  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  .map((e) => {
    const t = find(tr, e.unicode);
    const n = find(en, e.unicode);
    const enName = n?.tts?.[0] ?? e.label;
    const trName = t?.tts?.[0] ?? enName;
    const words = clean([enName, trName, ...(e.tags ?? []), ...(n?.default ?? []), ...(t?.default ?? [])]);
    // Tek kişilik ten rengi çeşitleri: sırası açık → koyu; birden çok ton içerenler (çiftler) seçicide yok.
    const tones = TONES.map((tone) => e.skins?.find((s) => s.hexcode.split("-").filter((h) => TONES.includes(h)).length === 1 && s.hexcode.includes(tone))?.unicode);
    const row: (string | number | string[])[] = [e.unicode, groupIndex.get(e.group!)!, enName, trName, words.join(" ")];
    if (tones.every(Boolean)) row.push(tones as string[]);
    return row;
  });

const out = {
  source: `emojibase-data ${EMOJIBASE} (MIT), Unicode CLDR annotations ${CLDR} (Unicode-3.0)`,
  groups: KEPT.map((g) => g.key),
  list,
};
const file = path.join(projectRoot(), "packages", "web", "src", "emoji", "emoji-data.json");
await writeFile(file, `${JSON.stringify(out)}\n`);
console.log(`${list.length} emoji, ${KEPT.length} groups → ${path.relative(projectRoot(), file)}`);

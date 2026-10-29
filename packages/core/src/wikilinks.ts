// Obsidian biçimi wiki bağlantıları: `[[Not]]`, `[[Not#Başlık]]`, `[[Not|görünen ad]]` ve gömme `![[Not]]`.
// Nularche kendi bağlantılarını göreli Markdown bağlantısı olarak yazar; wiki bağlantıları başka araçlardan gelen
// (ya da elle yazılan) notlarda okunur ve başlık, dosya adı ya da takma ada (alias) göre çözülür.

import path from "node:path";
import { maskCode } from "./note-text.ts";

export interface WikiLink {
  /** Bağlantının yazıldığı hedef (başlık, dosya adı ya da yol); `#` ve `|` kısmı hariç. */
  target: string;
  heading: string | null;
  alias: string | null;
  embed: boolean;
  /** Gövdedeki tam metin, ör. `![[Plan#Hedefler|hedefler]]`. */
  raw: string;
  index: number;
}

const WIKI_RE = /(!?)\[\[([^\]\n|#]*)(?:#([^\]\n|]*))?(?:\|([^\]\n]*))?\]\]/g;

export function extractWikiLinks(body: string): WikiLink[] {
  const out: WikiLink[] = [];
  for (const m of maskCode(body).matchAll(WIKI_RE)) {
    const target = m[2].trim();
    if (!target && !m[3]) continue;
    out.push({ target, heading: m[3]?.trim() || null, alias: m[4]?.trim() || null, embed: m[1] === "!", raw: body.slice(m.index!, m.index! + m[0].length), index: m.index! });
  }
  return out;
}

/** Karşılaştırma anahtarı: büyük/küçük harf ve `.md` uzantısı önemsiz. */
export const wikiKey = (s: string) =>
  s
    .trim()
    .replace(/\.md$/i, "")
    .toLocaleLowerCase("tr");

export interface WikiTarget {
  path: string;
  title: string;
  aliases: string[];
}

/** Wiki hedefi → vault yolu çözücüsü. Yol eşleşmesi (`Klasör/Not`) başlık, dosya adı ve takma addan önce gelir. */
export function wikiResolver(targets: WikiTarget[]): (name: string) => string | null {
  const byPath = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const t of targets) {
    byPath.set(wikiKey(t.path), t.path);
    for (const n of [t.title, path.posix.basename(t.path), ...t.aliases]) {
      const k = wikiKey(n);
      if (k && !byName.has(k)) byName.set(k, t.path);
    }
  }
  return (name) => {
    const k = wikiKey(name);
    if (!k) return null;
    return byPath.get(k) ?? byName.get(k) ?? byName.get(wikiKey(path.posix.basename(name))) ?? null;
  };
}

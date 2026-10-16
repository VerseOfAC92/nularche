// Not dosyası biçimi: YAML frontmatter + Markdown gövde. Ayrıştırma ve yazmanın tek sahibi.

import { createHash } from "node:crypto";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export interface Frontmatter {
  id?: unknown;
  title?: unknown;
  created?: unknown;
  updated?: unknown;
  [key: string]: unknown;
}

export interface ParsedFile {
  frontmatter: Frontmatter;
  body: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseNodeFile(text: string): ParsedFile {
  const match = FRONTMATTER_RE.exec(text);
  if (!match) return { frontmatter: {}, body: text };
  let data: unknown;
  try {
    data = parseYaml(match[1]);
  } catch {
    // Bozuk frontmatter: içeriği kaybetmemek için tüm metni gövde say.
    return { frontmatter: {}, body: text };
  }
  const frontmatter = data && typeof data === "object" && !Array.isArray(data) ? (data as Frontmatter) : {};
  // serializeNodeFile frontmatter sonrası bir boş satır bırakır; onu gövdeye katma.
  return { frontmatter, body: text.slice(match[0].length).replace(/^\r?\n/, "") };
}

export function serializeNodeFile(frontmatter: Frontmatter, body: string): string {
  const yaml = stringifyYaml(frontmatter, { lineWidth: 0 }).trimEnd();
  const normalizedBody = body.endsWith("\n") || body === "" ? body : `${body}\n`;
  return `---\n${yaml}\n---\n\n${normalizedBody.replace(/^\n+/, "")}`;
}

export function revisionOf(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

const TR_MAP: Record<string, string> = { ç: "c", ğ: "g", ı: "i", İ: "I", ö: "o", ş: "s", ü: "u", Ç: "C", Ğ: "G", Ö: "O", Ş: "S", Ü: "U" };

/** Başlıktan dosya adı üretir; okunabilirliği korur, dosya sistemi için güvenli karakterler bırakır. */
export function slugify(title: string): string {
  const base = title
    .replace(/[çğıİöşüÇĞÖŞÜ]/g, (c) => TR_MAP[c] ?? c)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9 _-]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 80)
    .trim();
  return base || "Adsiz";
}

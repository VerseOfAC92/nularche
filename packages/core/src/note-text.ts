// Not gövdesinden türetilen bilgiler: #etiketler, kilit biçimi, düz metin özeti, ilk görsel, yapılacak ve ek bilgisi.
// Hem çekirdek (liste, arama, MCP) hem arayüz (editör vurgusu, etiket tıklama) bu modülü kullanır; Node API'si içermez.

/** `#etiket`: harf ya da rakamla başlar, en az bir harf içerir; `/`, `-` ve `_` ile alt etiket yazılabilir (`#proje/nularche`). */
export const TAG_RE = /(^|[\s(])#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu;
const HAS_LETTER = /\p{L}/u;

/** Kilitli notun gövdesi bu satırla başlar; içerik altındaki kod bloğunda şifrelidir (bkz. web/src/lock.ts). */
export const LOCK_MARKER = "<!-- nularche:locked v1 -->";
export const LOCK_FENCE = "nularche-locked";

export function isLockedBody(body: string): boolean {
  return body.trimStart().startsWith(LOCK_MARKER);
}

/** Kilitli gövdedeki şifreli yükü (JSON) döndürür; kilitli değilse null. */
export function lockedPayload(body: string): string | null {
  if (!isLockedBody(body)) return null;
  const m = new RegExp("```" + LOCK_FENCE + "\\n([\\s\\S]*?)\\n```").exec(body);
  return m ? m[1].trim() : null;
}

/** Şifreli yükten kilitli gövdeyi üretir. `notice` açıklama satırıdır (başka editörlerde görünür). */
export function lockedBody(payload: string, notice: string): string {
  return `${LOCK_MARKER}\n${notice}\n\n\`\`\`${LOCK_FENCE}\n${payload}\n\`\`\`\n`;
}

/** Kod blokları ve satır içi kodlar boşlukla değiştirilir (konumlar korunur); etiket ve hesaplama aramalarında kullanılır. */
export function maskCode(body: string): string {
  return body
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, (m) => m.replace(/[^\n]/g, " "))
    .replace(/`[^`\n]+`/g, (m) => " ".repeat(m.length));
}

/** Etiketin karşılaştırma anahtarı: Türkçe küçük harf. */
export const tagKey = (tag: string) => tag.toLocaleLowerCase("tr");

/** Harf içermeyenler (#2026) ve renk kodları (#00a8b5, #fff1) etiket sayılmaz. */
function isTag(name: string): boolean {
  const hexColor = /^(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(name) && /\d/.test(name);
  return HAS_LETTER.test(name) && !hexColor;
}

/** Gövdedeki etiketler (ilk yazıldıkları biçimiyle, tekrarsız). Kod, bağlantı adresleri ve başlık işaretleri sayılmaz. */
export function extractTags(body: string): string[] {
  if (isLockedBody(body)) return [];
  const text = maskCode(body).replace(/\]\([^)]*\)/g, (m) => " ".repeat(m.length));
  const seen = new Map<string, string>();
  for (const m of text.matchAll(TAG_RE)) {
    const name = m[2].replace(/[/-]+$/, "");
    if (!name || !isTag(name)) continue;
    const key = tagKey(name);
    if (!seen.has(key)) seen.set(key, name);
  }
  return [...seen.values()];
}

/** Gövdedeki `#eski` etiketlerini (alt etiketleri dahil: `#eski/x` → `#yeni/x`) yeniden adlandırır. Kod bloklarına dokunmaz. */
export function renameTagInBody(body: string, from: string, to: string): string {
  if (isLockedBody(body)) return body;
  const masked = maskCode(body);
  const fromKey = tagKey(from);
  let out = "";
  let last = 0;
  for (const m of masked.matchAll(TAG_RE)) {
    const name = m[2].replace(/[/-]+$/, "");
    const key = tagKey(name);
    if (key !== fromKey && !key.startsWith(`${fromKey}/`)) continue;
    const start = m.index! + m[1].length + 1;
    out += body.slice(last, start) + to + name.slice(from.length);
    last = start + name.length;
  }
  return out + body.slice(last);
}

/** Markdown'dan okunabilir düz metin (özetler ve sayımlar için kaba ama güvenli bir dönüşüm). */
export function plainText(body: string): string {
  if (isLockedBody(body)) return "";
  // Obsidian sözdizimi önce sadeleşir: yorumlar atılır, [[wiki]] bağlantıları görünen adlarına iner.
  return exportableMarkdown(body)
    .replace(/^(```|~~~)[^\n]*\n([\s\S]*?)^\1[ \t]*$/gm, "$2")
    .replace(/^@\[(youtube|database|audio|drawing)\]\([^)]*\)[ \t]*$/gm, "")
    .replace(/<\/?(details|summary|div|span|sup|sub|u|mark|br)\b[^>]*>/gi, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^> ?\[![\w-]+\][+-]?[ \t]*/gm, "")
    .replace(/\[\^[^\]\s]+\]:?/g, "")
    .replace(/\$\$?([^$\n]+?)\$\$?/g, "$1")
    .replace(/^[ \t]*(#{1,6}|>|[-*+]( \[[ xX]\])?|\d+[.)])[ \t]+/gm, "")
    .replace(/^\s*\|?[ \t]*:?-{3,}.*$/gm, "")
    // Vurgu işaretleri yalnızca sözcüğe bitişikse silinir ("4 * 189" gibi hesaplar korunur).
    .replace(/(\*{1,3}|_{1,3}|~~|==)(?=\S)|(?<=\S)(\*{1,3}|_{1,3}|~~|==)/g, "")
    .replace(/[`|]+/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** Sözcük sayısı (harf/rakam dizileri; kesme ve tire içeren sözcükler tek sayılır). */
export function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

export interface BodyFacts {
  tags: string[];
  locked: boolean;
  excerpt: string;
  /** Gövdedeki ilk görselin (göreli) adresi. */
  image: string | null;
  /** İşaretli/işaretsiz yapılacak sayıları. */
  todos: number;
  done: number;
  /** Resim dışındaki ek bağlantıları ve ses/çizim blokları sayısı. */
  attachments: number;
  words: number;
}

export function bodyFacts(body: string): BodyFacts {
  const locked = isLockedBody(body);
  if (locked) return { tags: [], locked, excerpt: "", image: null, todos: 0, done: 0, attachments: 0, words: 0 };
  const masked = maskCode(body);
  const plain = plainText(body);
  const image = /!\[[^\]]*\]\(([^)\s]+)\)|^@\[drawing\]\(([^)\s]+)\)/m.exec(masked);
  const todos = masked.match(/^[ \t]*[-*+] \[ \]/gm)?.length ?? 0;
  const done = masked.match(/^[ \t]*[-*+] \[[xX]\]/gm)?.length ?? 0;
  const files = (masked.match(/(?<![!@])\[[^\]]*\]\((?![a-z]+:)[^)\s]*Attachments\/[^)\s]+\)/gi)?.length ?? 0) + (masked.match(/^@\[(audio|drawing)\]\(/gm)?.length ?? 0);
  const images = masked.match(/!\[[^\]]*\]\(/g)?.length ?? 0;
  return {
    tags: extractTags(body),
    locked,
    excerpt: plain.replace(/\n/g, " ").slice(0, 220),
    image: image ? (image[1] ?? image[2]) : null,
    todos: todos + done,
    done,
    attachments: files + images,
    words: countWords(plain),
  };
}

/**
 * Dışa aktarma için Obsidian sözdizimini sadeleştirir: `%%yorum%%` atılır (yayımlanmaz), `[[Not|ad]]` görünen ada,
 * `![[resim.png]]` Attachments resmine çevrilir; not gömmeleri (`![[Not]]`) atılır. Kod blokları değişmez.
 */
export function exportableMarkdown(body: string): string {
  const masked = maskCode(body);
  let out = "";
  let last = 0;
  for (const m of masked.matchAll(/%%[\s\S]*?%%|(!?)\[\[([^\]|#\n]*)(?:#([^\]|\n]*))?(?:\|([^\]\n]*))?\]\]/g)) {
    out += body.slice(last, m.index);
    last = m.index! + m[0].length;
    if (m[0].startsWith("%%")) continue;
    const [, bang, target, heading, alias] = m;
    if (bang) out += /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(target) ? `![](${target.includes("/") ? target : `Attachments/${target}`})` : "";
    else out += alias?.trim() || (heading ? `${target.trim()}${target.trim() ? " › " : ""}${heading.trim()}` : target.trim());
  }
  return out + body.slice(last);
}

/** Kutu (callout) türleri: GitHub'ın beş türü ve Obsidian'ın ek türleri (tür adı dosyada olduğu gibi kalır). */
export const CALLOUT_KINDS = ["note", "tip", "important", "warning", "caution"] as const;
export type CalloutKind = (typeof CALLOUT_KINDS)[number];

/** Obsidian'ın ek kutu türleri, beş temel renkten birine eşlenir (tür adı dosyada olduğu gibi kalır). */
const CALLOUT_TONE: Record<string, CalloutKind> = {
  info: "note", abstract: "note", summary: "note", tldr: "note", todo: "note", quote: "note", cite: "note", example: "important",
  hint: "tip", success: "tip", check: "tip", done: "tip", question: "important", help: "important", faq: "important",
  attention: "warning", failure: "caution", fail: "caution", missing: "caution", danger: "caution", error: "caution", bug: "caution",
};
/** Obsidian türünü beş temel renkten birine eşler. */
export const calloutTone = (kind: string): CalloutKind => ((CALLOUT_KINDS as readonly string[]).includes(kind) ? (kind as CalloutKind) : (CALLOUT_TONE[kind] ?? "note"));

/**
 * Şablon değişkenleri (Obsidian "Templates"): `{{title}}`, `{{date}}`, `{{time}}` ve biçimli `{{date:YYYY-MM-DD}}`,
 * `{{time:HH:mm}}`. Biçim belirteçleri: YYYY, YY, MM, M, DD, D, HH, H, mm, ss. Kod blokları değişmez.
 */
export function fillTemplate(text: string, vars: { title: string; now: Date }): string {
  const d = vars.now;
  const p = (n: number) => String(n).padStart(2, "0");
  const tokens: Record<string, string> = {
    YYYY: String(d.getFullYear()),
    YY: String(d.getFullYear()).slice(2),
    MM: p(d.getMonth() + 1),
    M: String(d.getMonth() + 1),
    DD: p(d.getDate()),
    D: String(d.getDate()),
    HH: p(d.getHours()),
    H: String(d.getHours()),
    mm: p(d.getMinutes()),
    ss: p(d.getSeconds()),
  };
  const format = (f: string) => f.replace(/YYYY|YY|MM|M|DD|D|HH|H|mm|ss/g, (t) => tokens[t]);
  const masked = maskCode(text);
  let out = "";
  let last = 0;
  for (const m of masked.matchAll(/\{\{\s*(title|date|time)(?::([^}]*))?\s*\}\}/g)) {
    out += text.slice(last, m.index);
    last = m.index! + m[0].length;
    const [, name, fmt] = m;
    out += name === "title" ? vars.title : format(fmt?.trim() || (name === "date" ? "YYYY-MM-DD" : "HH:mm"));
  }
  return out + text.slice(last);
}

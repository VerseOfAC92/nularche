// Yazma projeleri (2.0): manuskript, taslak (outline) ve kart destesi sayfaları.
// Tuval gibi verileri notun gövdesindeki tek bir JSON bloğundadır (```json manuscript|outline|cards). Böylece dosya düz
// Markdown olarak kalır, başka bir editörde açılabilir ve Git ile izlenebilir. Bloklardaki `file` alanları Origin
// yollarıdır; bağlantı grafiği bunları bağlantı sayar ve not taşınınca/yeniden adlandırılınca güncellenir.
// Bu modül saf işlevlerden oluşur (dosya sistemi yok); hem çekirdek hem arayüz aynı ayrıştırıcıyı kullanır.

export type WritingKind = "manuscript" | "outline" | "cards";
export const WRITING_KINDS: readonly WritingKind[] = ["manuscript", "outline", "cards"];

export interface ManuscriptItem {
  id: string;
  /** Bölümün Origin yolu. */
  file: string;
}

export interface ManuscriptSection {
  id: string;
  title: string;
  color?: string;
  items: ManuscriptItem[];
}

export interface ManuscriptOptions {
  /** Derlemede her dosyanın başlığı yazılır. */
  fileTitles: boolean;
  /** Derlemede bölüm (section) başlıkları yazılır. */
  sectionTitles: boolean;
  /** Dosyalar arasına konan ayraç ("" = yok). */
  separator: string;
}

export interface ManuscriptData {
  version: 1;
  sections: ManuscriptSection[];
  /** Manuskriptin izlediği taslak sayfasının Origin yolu. */
  outline?: string;
  options: ManuscriptOptions;
}

export interface OutlineRow {
  id: string;
  text: string;
  /** 0 = I. düzey, 1 = II. düzey, 2 = III. düzey… */
  depth: number;
  notes?: string;
  color?: string;
  /** Satıra bağlı not (sahne/bölüm). */
  file?: string;
  done?: boolean;
}

export interface OutlineData {
  version: 1;
  rows: OutlineRow[];
}

export interface IndexCard {
  id: string;
  title: string;
  text: string;
  color?: string;
  file?: string;
}

export interface CardGroup {
  id: string;
  title: string;
  color?: string;
  cards: IndexCard[];
}

export interface CardsData {
  version: 1;
  groups: CardGroup[];
  /** Kart boyutu. */
  size?: "s" | "m" | "l";
}

export interface WritingDataMap {
  manuscript: ManuscriptData;
  outline: OutlineData;
  cards: CardsData;
}

/** Outline'da izin verilen en derin düzey. */
export const MAX_OUTLINE_DEPTH = 5;
export const DEFAULT_SEPARATOR = "* * *";

export function newWritingId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

const blockRe = (kind: WritingKind) => new RegExp("```json " + kind + "\\n([\\s\\S]*?)\\n```");

export function emptyWriting<K extends WritingKind>(kind: K): WritingDataMap[K] {
  if (kind === "manuscript") return { version: 1, sections: [{ id: newWritingId(), title: "", items: [] }], options: { fileTitles: true, sectionTitles: true, separator: DEFAULT_SEPARATOR } } as unknown as WritingDataMap[K];
  if (kind === "outline") return { version: 1, rows: [] } as unknown as WritingDataMap[K];
  return { version: 1, groups: [{ id: newWritingId(), title: "", cards: [] }] } as unknown as WritingDataMap[K];
}

/** Yeni bir yazma sayfasının gövdesi. */
export function writingBody(kind: WritingKind, data: WritingDataMap[WritingKind] = emptyWriting(kind)): string {
  return "```json " + kind + "\n" + JSON.stringify(data, null, 2) + "\n```\n";
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const optStr = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const id = (v: unknown): string => (typeof v === "string" && /^[\w-]{1,64}$/.test(v) ? v : newWritingId());

function normManuscript(raw: Record<string, unknown>): ManuscriptData {
  const o = rec(raw.options);
  const sections = arr(raw.sections).map((s) => {
    const r = rec(s);
    return {
      id: id(r.id),
      title: str(r.title),
      ...(optStr(r.color) ? { color: optStr(r.color) } : {}),
      items: arr(r.items)
        .map(rec)
        .filter((i) => typeof i.file === "string" && i.file)
        .map((i) => ({ id: id(i.id), file: String(i.file) })),
    };
  });
  return {
    version: 1,
    sections: sections.length ? sections : [{ id: newWritingId(), title: "", items: [] }],
    ...(optStr(raw.outline) ? { outline: optStr(raw.outline) } : {}),
    options: {
      fileTitles: o.fileTitles !== false,
      sectionTitles: o.sectionTitles !== false,
      separator: typeof o.separator === "string" ? o.separator.slice(0, 40) : DEFAULT_SEPARATOR,
    },
  };
}

function normOutline(raw: Record<string, unknown>): OutlineData {
  return {
    version: 1,
    rows: arr(raw.rows).map((x) => {
      const r = rec(x);
      const depth = Math.min(MAX_OUTLINE_DEPTH, Math.max(0, Math.floor(Number(r.depth) || 0)));
      return {
        id: id(r.id),
        text: str(r.text),
        depth,
        ...(optStr(r.notes) ? { notes: optStr(r.notes) } : {}),
        ...(optStr(r.color) ? { color: optStr(r.color) } : {}),
        ...(optStr(r.file) ? { file: optStr(r.file) } : {}),
        ...(r.done === true ? { done: true } : {}),
      };
    }),
  };
}

function normCards(raw: Record<string, unknown>): CardsData {
  const groups = arr(raw.groups).map((g) => {
    const r = rec(g);
    return {
      id: id(r.id),
      title: str(r.title),
      ...(optStr(r.color) ? { color: optStr(r.color) } : {}),
      cards: arr(r.cards).map((c) => {
        const k = rec(c);
        return {
          id: id(k.id),
          title: str(k.title),
          text: str(k.text),
          ...(optStr(k.color) ? { color: optStr(k.color) } : {}),
          ...(optStr(k.file) ? { file: optStr(k.file) } : {}),
        };
      }),
    };
  });
  const size = raw.size === "s" || raw.size === "l" ? raw.size : undefined;
  return { version: 1, groups: groups.length ? groups : [{ id: newWritingId(), title: "", cards: [] }], ...(size ? { size } : {}) };
}

/**
 * Gövdedeki bloğu okur ve doğrular. Blok yoksa boş veri döner; JSON bozuksa `broken: true` (arayüz bu durumda
 * üzerine yazmaz, kullanıcının elle düzeltmesine izin verir).
 */
export function parseWriting<K extends WritingKind>(kind: K, body: string): { data: WritingDataMap[K]; broken: boolean } {
  const m = blockRe(kind).exec(body);
  if (!m) return { data: emptyWriting(kind), broken: false };
  try {
    const raw = rec(JSON.parse(m[1]));
    const data = kind === "manuscript" ? normManuscript(raw) : kind === "outline" ? normOutline(raw) : normCards(raw);
    return { data: data as WritingDataMap[K], broken: false };
  } catch {
    return { data: emptyWriting(kind), broken: true };
  }
}

/** Bloğu yeni veriyle değiştirir (gövdenin geri kalanı korunur); blok yoksa sona ekler. */
export function serializeWriting<K extends WritingKind>(kind: K, body: string, data: WritingDataMap[K]): string {
  const block = "```json " + kind + "\n" + JSON.stringify(data, null, 2) + "\n```";
  const re = blockRe(kind);
  if (re.test(body)) return body.replace(re, () => block);
  const sep = body.trim() === "" ? "" : body.endsWith("\n\n") ? "" : body.endsWith("\n") ? "\n" : "\n\n";
  return `${body}${sep}${block}\n`;
}

/** Bloğun başvurduğu Origin yolları (sırasıyla, tekrarsız). */
export function writingFiles(kind: WritingKind, body: string): string[] {
  if (!blockRe(kind).test(body)) return [];
  const { data, broken } = parseWriting(kind, body);
  if (broken) return [];
  const out: string[] = [];
  if (kind === "manuscript") {
    const d = data as ManuscriptData;
    for (const s of d.sections) for (const i of s.items) out.push(i.file);
    if (d.outline) out.push(d.outline);
  } else if (kind === "outline") {
    for (const r of (data as OutlineData).rows) if (r.file) out.push(r.file);
  } else {
    for (const g of (data as CardsData).groups) for (const c of g.cards) if (c.file) out.push(c.file);
  }
  return [...new Set(out)];
}

/** Taşınan dosyaların (eski → yeni yol) başvurularını günceller; değişiklik yoksa gövde aynen döner. */
export function rewriteWritingFiles(kind: WritingKind, body: string, moved: Map<string, string>): string {
  if (!blockRe(kind).test(body)) return body;
  const { data, broken } = parseWriting(kind, body);
  if (broken) return body;
  let changed = false;
  const map = (p: string | undefined) => {
    if (p && moved.has(p)) {
      changed = true;
      return moved.get(p)!;
    }
    return p;
  };
  if (kind === "manuscript") {
    const d = data as ManuscriptData;
    for (const s of d.sections) for (const i of s.items) i.file = map(i.file)!;
    if (d.outline) d.outline = map(d.outline);
  } else if (kind === "outline") {
    for (const r of (data as OutlineData).rows) if (r.file) r.file = map(r.file);
  } else {
    for (const g of (data as CardsData).groups) for (const c of g.cards) if (c.file) c.file = map(c.file);
  }
  return changed ? serializeWriting(kind, body, data) : body;
}

/** Sayfa düzeni bir yazma türüyse onu döndürür. */
export function writingKindOf(layout: string | undefined): WritingKind | null {
  return (WRITING_KINDS as readonly string[]).includes(layout ?? "") ? (layout as WritingKind) : null;
}

/** Taslağı izleyen manuskriptte bir satırın planı: bağlı dosya manuskriptte varsa yazılmış, yoksa planlanmış. */
export interface PlannedRow {
  row: OutlineRow;
  /** Satırın altındaki daha derin satırlar (vuruşlar / beats). */
  beats: OutlineRow[];
  written: boolean;
}

/** Taslağın üst düzey satırlarını (ve vuruşlarını) manuskriptteki dosyalarla eşleştirir. */
export function planFromOutline(outline: OutlineData, manuscript: ManuscriptData): PlannedRow[] {
  const files = new Set(manuscript.sections.flatMap((s) => s.items.map((i) => i.file)));
  const top = Math.min(...outline.rows.map((r) => r.depth), MAX_OUTLINE_DEPTH);
  const out: PlannedRow[] = [];
  for (const [i, row] of outline.rows.entries()) {
    if (row.depth !== top) continue;
    const beats: OutlineRow[] = [];
    for (let j = i + 1; j < outline.rows.length && outline.rows[j].depth > row.depth; j++) beats.push(outline.rows[j]);
    out.push({ row, beats, written: !!row.file && files.has(row.file) });
  }
  return out;
}

/** Metinde adlardan birinin kelime sınırlarıyla geçtiği tüm konumlar (Türkçe büyük/küçük harf duyarsız). */
export function findAllMentions(text: string, names: string[]): { index: number; length: number }[] {
  const lower = text.toLocaleLowerCase("tr");
  const out: { index: number; length: number }[] = [];
  // Uzun adlar önce: "Ada Lovelace" ile "Ada" çakışırsa uzun olan sayılır.
  for (const name of [...new Set(names.map((x) => x.trim()).filter((x) => x.length >= 2))].sort((x, y) => y.length - x.length)) {
    const n = name.toLocaleLowerCase("tr");
    for (let i = lower.indexOf(n); i >= 0; i = lower.indexOf(n, i + n.length)) {
      const before = lower[i - 1];
      const after = lower[i + n.length];
      if ((before && /[\p{L}\p{N}_]/u.test(before)) || (after && /[\p{L}\p{N}_]/u.test(after))) continue;
      if (out.some((o) => i < o.index + o.length && o.index < i + n.length)) continue;
      out.push({ index: i, length: n.length });
    }
  }
  return out.sort((x, y) => x.index - y.index);
}

// ------------------------------------------------------------------ Satır karşılaştırma (sürüm karşılaştırma)

export type DiffOp = { kind: "same" | "add" | "del"; text: string };

/**
 * İki metnin satır farkı (en uzun ortak alt dizi). Çok uzun metinlerde bellek sınırı için ortak baş/son satırlar
 * ayrılır ve kalan kısım için tablo kurulur; tablo çok büyükse kalan kısım "silindi + eklendi" olarak verilir.
 */
export function diffLines(before: string, after: string, maxCells = 4_000_000): DiffOp[] {
  const a = before.split("\n");
  const b = after.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) (endA--, endB--);
  const head: DiffOp[] = a.slice(0, start).map((text) => ({ kind: "same", text }));
  const tail: DiffOp[] = a.slice(endA).map((text) => ({ kind: "same", text }));
  const ma = a.slice(start, endA);
  const mb = b.slice(start, endB);
  if (ma.length * mb.length > maxCells) {
    return [...head, ...ma.map((text) => ({ kind: "del", text }) as DiffOp), ...mb.map((text) => ({ kind: "add", text }) as DiffOp), ...tail];
  }
  const n = ma.length;
  const m = mb.length;
  const table = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * (m + 1) + j] = ma[i] === mb[j] ? table[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(table[(i + 1) * (m + 1) + j], table[i * (m + 1) + j + 1]);
    }
  }
  const mid: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (ma[i] === mb[j]) (mid.push({ kind: "same", text: ma[i] }), i++, j++);
    else if (table[(i + 1) * (m + 1) + j] >= table[i * (m + 1) + j + 1]) mid.push({ kind: "del", text: ma[i++] });
    else mid.push({ kind: "add", text: mb[j++] });
  }
  while (i < n) mid.push({ kind: "del", text: ma[i++] });
  while (j < m) mid.push({ kind: "add", text: mb[j++] });
  return [...head, ...mid, ...tail];
}

/**
 * Bağlantı noktasının metindeki yeri: önce önek+metin+sonek, sonra önek+metin, metin+sonek, en sonda yalnızca metin.
 * Bulunamazsa -1 (yorum yerinden kopmuştur).
 */
export function locateAnchor(text: string, anchor: { text: string; prefix?: string; suffix?: string }): number {
  const { prefix = "", suffix = "" } = anchor;
  const tries: [string, number][] = [
    [prefix + anchor.text + suffix, prefix.length],
    [prefix + anchor.text, prefix.length],
    [anchor.text + suffix, 0],
    [anchor.text, 0],
  ];
  for (const [needle, offset] of tries) {
    if (!needle) continue;
    const i = text.indexOf(needle);
    if (i >= 0) return i + offset;
  }
  return -1;
}

// Kaynakça ve atıflar. Kaynaklar Origin'deki bir BibTeX (`.bib`) ya da CSL-JSON (`.json`) dosyasından okunur;
// notlarda Pandoc biçimiyle atıf yapılır: `[@anahtar]`, `[@anahtar, s. 12]`, `[bkz. @a; @b]`, yazar adı olmadan
// `[-@anahtar]`. Dışa aktarmada (HTML, Word, yayınlanan site, Codex derlemesi) atıflar seçilen stile göre metne
// dönüştürülür ve sona kaynakça eklenir. Yerleşik stiller: APA 7, Chicago (yazar-tarih), MLA 9, IEEE (numaralı).
// Ayrıştırma ve biçimlendirme bu modüldedir (arayüz de kullanır); dosya okuma citations-store.ts içindedir.


// ------------------------------------------------------------------ veri modeli (CSL-JSON alt kümesi)

export interface CslName {
  family?: string;
  given?: string;
  literal?: string;
}

export interface CslItem {
  id: string;
  type: string;
  title?: string;
  author?: CslName[];
  editor?: CslName[];
  issued?: { "date-parts"?: (number | string)[][]; literal?: string };
  "container-title"?: string;
  publisher?: string;
  "publisher-place"?: string;
  volume?: string;
  issue?: string;
  page?: string;
  edition?: string;
  DOI?: string;
  URL?: string;
  genre?: string;
}

export type CitationStyle = "apa" | "chicago" | "mla" | "ieee";
export const CITATION_STYLES: CitationStyle[] = ["apa", "chicago", "mla", "ieee"];
export type CitationLang = "tr" | "en";

export interface LibraryProblem {
  file: string;
  message: string;
}

export interface Library {
  items: Map<string, CslItem>;
  sources: string[];
  problems: LibraryProblem[];
}

// ------------------------------------------------------------------ BibTeX

const TYPE_MAP: Record<string, string> = {
  article: "article-journal",
  book: "book",
  booklet: "book",
  inbook: "chapter",
  incollection: "chapter",
  inproceedings: "paper-conference",
  conference: "paper-conference",
  phdthesis: "thesis",
  mastersthesis: "thesis",
  thesis: "thesis",
  techreport: "report",
  report: "report",
  manual: "report",
  online: "webpage",
  electronic: "webpage",
  www: "webpage",
  misc: "document",
  unpublished: "manuscript",
};

const ACCENTS: Record<string, Record<string, string>> = {
  '"': { a: "ä", o: "ö", u: "ü", e: "ë", i: "ï", A: "Ä", O: "Ö", U: "Ü" },
  "'": { a: "á", e: "é", i: "í", o: "ó", u: "ú", c: "ć", n: "ń", s: "ś", A: "Á", E: "É", I: "Í", O: "Ó", U: "Ú" },
  "`": { a: "à", e: "è", i: "ì", o: "ò", u: "ù", A: "À", E: "È" },
  "^": { a: "â", e: "ê", i: "î", o: "ô", u: "û", A: "Â", E: "Ê", I: "Î", O: "Ô", U: "Û" },
  "~": { a: "ã", n: "ñ", o: "õ", A: "Ã", N: "Ñ", O: "Õ" },
  c: { c: "ç", s: "ş", C: "Ç", S: "Ş", g: "ģ" },
  u: { g: "ğ", G: "Ğ", a: "ă", A: "Ă" },
  v: { c: "č", s: "š", z: "ž", C: "Č", S: "Š", Z: "Ž", r: "ř", e: "ě" },
  ".": { I: "İ", z: "ż", Z: "Ż" },
  "=": { a: "ā", e: "ē", o: "ō" },
  H: { o: "ő", u: "ű", O: "Ő", U: "Ű" },
};

/** LaTeX'ten düz metne: aksanlar, özel karakterler ve süslü parantezler. */
export function latexToText(s: string): string {
  return s
    .replace(/\\([\\"'`^~=.])\s*\{?\s*(\\?[A-Za-z])\s*\}?/g, (m, acc: string, ch: string) => ACCENTS[acc]?.[ch.replace("\\", "")] ?? (ch === "\\i" ? "ı" : m))
    .replace(/\\([cuvH])\s*\{\s*(\\?[A-Za-z])\s*\}/g, (m, acc: string, ch: string) => ACCENTS[acc]?.[ch.replace("\\", "")] ?? m)
    .replace(/\\([cuvH])\s+([A-Za-z])/g, (m, acc: string, ch: string) => ACCENTS[acc]?.[ch] ?? m)
    .replace(/\\i\b\s?/g, "ı")
    .replace(/\\ss\b\s?/g, "ß")
    .replace(/\\(?:o)\b\s?/g, "ø")
    .replace(/\\([&%$#_{}])/g, "$1")
    .replace(/\\(?:textit|emph|textbf|textsc|textrm|mathrm|url)\s*\{([^{}]*)\}/g, "$1")
    .replace(/---/g, "—")
    .replace(/--/g, "–")
    .replace(/~/g, " ")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitNames(raw: string): CslName[] {
  // " and " yalnızca süslü parantez dışındaysa ayırır: `{Türk Dil Kurumu and Ortakları}` tek addır.
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  const words = raw.split(/(\s+)/);
  for (const w of words) {
    for (const ch of w) depth += ch === "{" ? 1 : ch === "}" ? -1 : 0;
    if (depth === 0 && /^and$/i.test(w.trim()) && w.trim()) {
      parts.push(cur.trim());
      cur = "";
    } else cur += w;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts.map((p) => {
    if (/^\{.*\}$/.test(p) && !/^\{[^{}]*\}\s/.test(p)) return { literal: latexToText(p) };
    if (p.includes(",")) {
      const [family, ...rest] = p.split(",");
      return { family: latexToText(family), given: latexToText(rest.join(",")) };
    }
    const tokens = p.split(/\s+/);
    if (tokens.length === 1) return { family: latexToText(p) };
    // "Ad Soyad" ya da "Ad von Soyad": küçük harfle başlayan ön ek soyada katılır.
    let i = tokens.length - 1;
    while (i > 1 && /^[a-zß-ÿ]/.test(tokens[i - 1])) i--;
    return { family: latexToText(tokens.slice(i).join(" ")), given: latexToText(tokens.slice(0, i).join(" ")) };
  });
}

/** BibTeX metnini CSL kayıtlarına çevirir; okunamayan kayıtlar `problems` içinde bildirilir. */
export function parseBibtex(text: string): { items: CslItem[]; problems: string[] } {
  const items: CslItem[] = [];
  const problems: string[] = [];
  const macros: Record<string, string> = { jan: "1", feb: "2", mar: "3", apr: "4", may: "5", jun: "6", jul: "7", aug: "8", sep: "9", oct: "10", nov: "11", dec: "12" };
  let i = 0;
  const n = text.length;
  while (i < n) {
    const at = text.indexOf("@", i);
    if (at < 0) break;
    const head = /^@\s*([A-Za-z]+)\s*([{(])/.exec(text.slice(at, at + 64));
    if (!head) {
      i = at + 1;
      continue;
    }
    const kind = head[1].toLowerCase();
    const open = head[2];
    const close = open === "{" ? "}" : ")";
    const j = at + head[0].length;
    // Kaydın sonu: dengeli parantez.
    let depth = 1;
    let k = j;
    let inQuote = false;
    for (; k < n && depth > 0; k++) {
      const ch = text[k];
      if (ch === "\\") {
        k++;
        continue;
      }
      if (ch === '"' && depth === 1 && open === "{") inQuote = !inQuote;
      if (inQuote) continue;
      if (ch === "{" || (open === "(" && ch === "(")) depth++;
      else if (ch === "}" || (open === "(" && ch === close)) depth--;
    }
    const body = text.slice(j, k - 1);
    i = k;
    if (kind === "comment" || kind === "preamble") continue;
    const fields = parseFields(body, macros);
    if (kind === "string") {
      for (const [key, value] of Object.entries(fields.values)) macros[key] = value;
      continue;
    }
    const key = fields.key?.trim();
    if (!key) {
      problems.push(`@${kind}: anahtar yok`);
      continue;
    }
    items.push(bibToCsl(kind, key, fields.values));
  }
  return { items, problems };
}

function parseFields(body: string, macros: Record<string, string>): { key?: string; values: Record<string, string> } {
  const values: Record<string, string> = {};
  let i = 0;
  let key: string | undefined;
  const first = /^\s*([^,={}\s]+)\s*,/.exec(body);
  if (first && !body.slice(0, first[0].length).includes("=")) {
    key = first[1];
    i = first[0].length;
  }
  while (i < body.length) {
    const m = /^\s*([\w:.+-]+)\s*=\s*/.exec(body.slice(i));
    if (!m) break;
    const name = m[1].toLowerCase();
    i += m[0].length;
    let value = "";
    // Değer parçaları `#` ile birleştirilebilir.
    for (;;) {
      while (/\s/.test(body[i] ?? "")) i++;
      const ch = body[i];
      if (ch === "{") {
        let depth = 0;
        const start = i;
        for (; i < body.length; i++) {
          if (body[i] === "\\") {
            i++;
            continue;
          }
          if (body[i] === "{") depth++;
          else if (body[i] === "}" && --depth === 0) break;
        }
        value += body.slice(start + 1, i);
        i++;
      } else if (ch === '"') {
        const start = ++i;
        let depth = 0;
        for (; i < body.length; i++) {
          if (body[i] === "\\") {
            i++;
            continue;
          }
          if (body[i] === "{") depth++;
          else if (body[i] === "}") depth--;
          else if (body[i] === '"' && depth === 0) break;
        }
        value += body.slice(start, i);
        i++;
      } else {
        const m2 = /^[^,#\s}]+/.exec(body.slice(i));
        if (!m2) break;
        const word = m2[0];
        value += macros[word.toLowerCase()] ?? word;
        i += word.length;
      }
      while (/\s/.test(body[i] ?? "")) i++;
      if (body[i] === "#") {
        i++;
        continue;
      }
      break;
    }
    values[name] = value;
    while (/[\s,]/.test(body[i] ?? "")) i++;
  }
  return { key, values };
}

function bibToCsl(kind: string, id: string, f: Record<string, string>): CslItem {
  const t = (k: string) => (f[k] !== undefined ? latexToText(f[k]) : undefined);
  const url = t("url") ?? (f.howpublished?.match(/\\url\{([^}]+)\}/)?.[1] ?? undefined);
  const type = kind === "misc" && url ? "webpage" : (TYPE_MAP[kind] ?? "document");
  const date = f.date ?? f.year;
  const year = date ? /(\d{4})/.exec(date)?.[1] : undefined;
  const month = f.month ? Number(/\d+/.exec(f.month)?.[0] ?? NaN) : NaN;
  const item: CslItem = { id, type };
  if (f.title) item.title = t("title");
  if (f.author) item.author = splitNames(f.author);
  if (f.editor) item.editor = splitNames(f.editor);
  if (year) item.issued = { "date-parts": [Number.isFinite(month) ? [Number(year), month] : [Number(year)]] };
  else if (date) item.issued = { literal: latexToText(date) };
  const container = t("journal") ?? t("journaltitle") ?? t("booktitle");
  if (container) item["container-title"] = container;
  const publisher = t("publisher") ?? t("institution") ?? t("school") ?? t("organization");
  if (publisher) item.publisher = publisher;
  if (f.address ?? f.location) item["publisher-place"] = t("address") ?? t("location");
  if (f.volume) item.volume = t("volume");
  if (f.number ?? f.issue) item.issue = t("number") ?? t("issue");
  if (f.pages) item.page = t("pages")!.replace(/\s*[-–]+\s*/, "–");
  if (f.edition) item.edition = t("edition");
  if (f.doi) item.DOI = t("doi")!.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
  if (url) item.URL = url;
  if (kind === "phdthesis") item.genre = "PhD thesis";
  if (kind === "mastersthesis") item.genre = "Master's thesis";
  return item;
}

/** CSL-JSON dizisini doğrular; `id` ve `type` taşımayan kayıtlar atlanır. */
export function parseCslJson(text: string): { items: CslItem[]; problems: string[] } {
  const data = JSON.parse(text) as unknown;
  const list = Array.isArray(data) ? data : data && typeof data === "object" && Array.isArray((data as { items?: unknown }).items) ? (data as { items: unknown[] }).items : null;
  if (!list) return { items: [], problems: ["CSL-JSON bir dizi olmalı"] };
  const items: CslItem[] = [];
  const problems: string[] = [];
  for (const x of list) {
    if (x && typeof x === "object" && typeof (x as CslItem).id === "string" && (x as CslItem).id) items.push({ ...(x as CslItem), type: typeof (x as CslItem).type === "string" ? (x as CslItem).type : "document", id: String((x as CslItem).id) });
    else problems.push("kimliği olmayan kayıt atlandı");
  }
  return { items, problems };
}

// ------------------------------------------------------------------ atıf sözdizimi

export interface CiteRef {
  key: string;
  prefix: string;
  locator: string;
  suppressAuthor: boolean;
}

export interface CiteCluster {
  raw: string;
  index: number;
  refs: CiteRef[];
}

/** `[ … @anahtar … ]` atıf kümesi (bağlantı metni olan `[…](…)` ve dipnot `[^…]` hariç). */
export const CITE_CLUSTER = /\[(?!\^)([^[\]\n]*?-?@[\p{L}\d_][\p{L}\d_:.#$%&+?<>~/-]*[^[\]\n]*)\](?![([])/gu;
const CITE_KEY = /(-?)@([\p{L}\d_][\p{L}\d_:.#$%&+?<>~/-]*?)(?=[\s,;]|$)/u;

/** Atıf kümesinin içeriğini (köşeli parantezsiz) parçalarına ayırır; geçersizse null. */
export function parseCluster(inner: string): CiteRef[] | null {
  const refs: CiteRef[] = [];
  for (const part of inner.split(";")) {
    const m = CITE_KEY.exec(part);
    if (!m) return null;
    const prefix = part.slice(0, m.index).trim();
    const locator = part
      .slice(m.index + m[0].length)
      .replace(/^\s*,\s*/, "")
      .trim();
    refs.push({ key: m[2].replace(/[.:]+$/, ""), prefix, locator, suppressAuthor: m[1] === "-" });
  }
  return refs.length ? refs : null;
}

const maskCodeSpans = (body: string) =>
  body.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, (m) => m.replace(/[^\n]/g, " ")).replace(/`[^`\n]+`/g, (m) => " ".repeat(m.length));

export function findCitations(body: string): CiteCluster[] {
  const out: CiteCluster[] = [];
  for (const m of maskCodeSpans(body).matchAll(CITE_CLUSTER)) {
    const refs = parseCluster(m[1]);
    if (refs) out.push({ raw: body.slice(m.index!, m.index! + m[0].length), index: m.index!, refs });
  }
  return out;
}

// ------------------------------------------------------------------ biçimlendirme

const L = {
  tr: { and: "ve", etal: "vd.", nd: "t.y.", p: "s.", pp: "ss.", refs: "Kaynakça", works: "Kaynakça", ed: "Ed.", eds: "Ed.", in: "İçinde", retrieved: "Erişim adresi", vol: "C.", no: "S." },
  en: { and: "and", etal: "et al.", nd: "n.d.", p: "p.", pp: "pp.", refs: "References", works: "Works Cited", ed: "Ed.", eds: "Eds.", in: "In", retrieved: "Retrieved from", vol: "vol.", no: "no." },
} as const;

export function yearOf(item: CslItem): string | null {
  const dp = item.issued?.["date-parts"]?.[0]?.[0];
  if (dp !== undefined && dp !== null && String(dp).trim()) return String(dp);
  return item.issued?.literal ?? null;
}

const familyOf = (n: CslName) => n.literal ?? n.family ?? n.given ?? "";
const initials = (given: string | undefined, spaced = true) =>
  (given ?? "")
    .split(/[\s]+/)
    .filter(Boolean)
    .map((g) => g.split("-").map((p) => `${p[0]}.`).join("-"))
    .join(spaced ? " " : "");

function inTextNames(item: CslItem, style: CitationStyle, lang: CitationLang): string {
  const names = item.author?.length ? item.author : (item.editor ?? []);
  const l = L[lang];
  if (!names.length) return item.title ? (style === "mla" ? `"${shortTitle(item.title)}"` : `*${shortTitle(item.title)}*`) : item.id;
  const f = names.map(familyOf);
  if (f.length === 1) return f[0];
  if (f.length === 2) return style === "apa" ? `${f[0]} & ${f[1]}` : `${f[0]} ${l.and} ${f[1]}`;
  if (style === "chicago" && f.length === 3) return `${f[0]}, ${f[1]}, ${l.and} ${f[2]}`;
  return `${f[0]} ${l.etal}`;
}

const shortTitle = (t: string) => {
  const words = t.split(/\s+/);
  return words.length > 4 ? `${words.slice(0, 4).join(" ")}…` : t;
};

/** Sayfa bilgisini stile göre biçimler: "12" → "s. 12" (APA), "12" (Chicago/MLA). */
function locatorText(locator: string, style: CitationStyle, lang: CitationLang): string {
  if (!locator) return "";
  if (/^[\d\s–-]+$/.test(locator)) {
    if (style === "chicago" || style === "mla") return locator.replace(/-/g, "–");
    return `${/[–-]/.test(locator) ? L[lang].pp : L[lang].p} ${locator.replace(/-/g, "–")}`;
  }
  return locator;
}

export interface FormatContext {
  style: CitationStyle;
  lang: CitationLang;
  /** IEEE: anahtar → numara (ilk geçiş sırasıyla). */
  numbers: Map<string, number>;
}

/** Bir atıf kümesini metin içi atıfa çevirir; bilinmeyen anahtarlar `?anahtar` olarak kalır. */
export function formatCluster(refs: CiteRef[], items: Map<string, CslItem>, ctx: FormatContext): string {
  const { style, lang } = ctx;
  if (style === "ieee") {
    const parts = refs.map((r) => {
      if (!items.has(r.key)) return `?${r.key}`;
      if (!ctx.numbers.has(r.key)) ctx.numbers.set(r.key, ctx.numbers.size + 1);
      const loc = locatorText(r.locator, style, lang);
      return `${ctx.numbers.get(r.key)}${loc ? `, ${loc}` : ""}`;
    });
    return `[${parts.join("], [")}]`;
  }
  const parts = refs.map((r) => {
    const item = items.get(r.key);
    if (!item) return `?${r.key}`;
    const year = yearOf(item) ?? L[lang].nd;
    const loc = locatorText(r.locator, style, lang);
    const who = r.suppressAuthor ? "" : inTextNames(item, style, lang);
    let s: string;
    if (style === "apa") s = [who, year, loc].filter(Boolean).join(", ");
    else if (style === "chicago") s = `${who ? `${who} ` : ""}${year}${loc ? `, ${loc}` : ""}`;
    else s = `${who}${loc ? ` ${loc}` : ""}`.trim() || year;
    return `${r.prefix ? `${r.prefix} ` : ""}${s}`;
  });
  return `(${parts.join("; ")})`;
}

function nameList(names: CslName[], style: CitationStyle, lang: CitationLang): string {
  const l = L[lang];
  const fmt = (n: CslName, i: number) => {
    if (n.literal) return n.literal;
    if (style === "apa") return `${n.family ?? ""}${n.given ? `, ${initials(n.given)}` : ""}`;
    if (style === "ieee") return `${n.given ? `${initials(n.given)} ` : ""}${n.family ?? ""}`;
    // Chicago ve MLA: ilk yazar "Soyad, Ad", diğerleri "Ad Soyad".
    return i === 0 ? `${n.family ?? ""}${n.given ? `, ${n.given}` : ""}` : `${n.given ? `${n.given} ` : ""}${n.family ?? ""}`;
  };
  if (style === "mla" && names.length >= 3) return `${fmt(names[0], 0)}, ${l.etal}`;
  if (style === "apa" && names.length > 20) names = [...names.slice(0, 19), names[names.length - 1]];
  const list = names.map(fmt);
  if (list.length === 1) return list[0];
  const last = list.pop()!;
  if (style === "apa") return `${list.join(", ")}, & ${last}`;
  if (style === "ieee") return list.length === 1 ? `${list[0]} ${l.and} ${last}` : `${list.join(", ")}, ${l.and} ${last}`;
  return list.length === 1 ? `${list[0]}, ${l.and} ${last}` : `${list.join(", ")}, ${l.and} ${last}`;
}

const endDot = (s: string) => (/[.?!]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);
const isContained = (t: string) => ["article-journal", "article-magazine", "article-newspaper", "chapter", "paper-conference", "entry-encyclopedia", "webpage", "post-weblog"].includes(t);
const doiUrl = (item: CslItem) => (item.DOI ? `https://doi.org/${item.DOI}` : (item.URL ?? ""));

/** Kaynakçadaki bir kaydın Markdown metni (italik için `*`). */
export function formatEntry(item: CslItem, style: CitationStyle, lang: CitationLang, number?: number): string {
  const l = L[lang];
  const year = yearOf(item);
  const names = item.author?.length ? item.author : item.editor;
  const edSuffix = !item.author?.length && item.editor?.length ? ` (${item.editor.length > 1 ? l.eds : l.ed})` : "";
  const who = names?.length ? nameList(names, style, lang) + edSuffix : "";
  const title = item.title ?? item.id;
  const contained = isContained(item.type) && !!item["container-title"];
  const container = item["container-title"] ?? "";
  const vol = item.volume ?? "";
  const iss = item.issue ?? "";
  const pages = item.page?.replace(/-/g, "–") ?? "";
  const pub = [item["publisher-place"], item.publisher].filter(Boolean).join(": ");
  const link = doiUrl(item);
  switch (style) {
    case "apa": {
      const head = `${who ? `${endDot(who)} ` : ""}(${year ?? l.nd}). `;
      if (contained && item.type.startsWith("article")) {
        return `${head}${endDot(title)} *${container}*${vol ? `, *${vol}*` : ""}${iss ? `(${iss})` : ""}${pages ? `, ${pages}` : ""}.${link ? ` ${link}` : ""}`;
      }
      if (contained) return `${head}${endDot(title)} ${l.in} *${container}*${pages ? ` (${l.pp} ${pages})` : ""}.${item.publisher ? ` ${endDot(item.publisher)}` : ""}${link ? ` ${link}` : ""}`;
      return `${head}*${title}*${item.edition ? ` (${item.edition}. ed.)` : ""}${item.genre ? ` [${item.genre}]` : ""}.${item.publisher ? ` ${endDot(item.publisher)}` : ""}${link ? ` ${link}` : ""}`;
    }
    case "chicago": {
      const head = `${who ? `${endDot(who)} ` : ""}${year ?? l.nd}. `;
      if (contained && item.type.startsWith("article")) return `${head}"${endDot(title)}" *${container}*${vol ? ` ${vol}` : ""}${iss ? ` (${iss})` : ""}${pages ? `: ${pages}` : ""}.${link ? ` ${link}.` : ""}`;
      if (contained) return `${head}"${endDot(title)}" ${l.in} *${container}*${pages ? `, ${pages}` : ""}.${pub ? ` ${endDot(pub)}` : ""}${link ? ` ${link}.` : ""}`;
      return `${head}*${endDot(title)}*${pub ? ` ${endDot(pub)}` : ""}${link ? ` ${link}.` : ""}`;
    }
    case "mla": {
      const head = who ? `${endDot(who)} ` : "";
      if (contained) {
        const bits = [`*${container}*`, vol && `${l.vol} ${vol}`, iss && `${l.no} ${iss}`, year, pages && `${/[–-]/.test(pages) ? l.pp : l.p} ${pages}`].filter(Boolean);
        return `${head}"${endDot(title)}" ${bits.join(", ")}.${link ? ` ${link}.` : ""}`;
      }
      return `${head}*${endDot(title)}* ${[item.publisher, year].filter(Boolean).join(", ")}.`;
    }
    case "ieee": {
      const n = number ? `[${number}] ` : "";
      const head = `${n}${who ? `${who}, ` : ""}`;
      if (contained && item.type.startsWith("article")) {
        return `${head}"${title}," *${container}*${vol ? `, ${l.vol} ${vol}` : ""}${iss ? `, ${l.no} ${iss}` : ""}${pages ? `, ${/[–-]/.test(pages) ? l.pp : l.p} ${pages}` : ""}${year ? `, ${year}` : ""}.${item.DOI ? ` doi: ${item.DOI}.` : ""}`;
      }
      if (contained) return `${head}"${title}," ${lang === "tr" ? "içinde" : "in"} *${container}*${year ? `, ${year}` : ""}${pages ? `, ${/[–-]/.test(pages) ? l.pp : l.p} ${pages}` : ""}.`;
      return `${head}*${title}*.${pub ? ` ${pub}` : ""}${year ? `, ${year}` : ""}.`;
    }
  }
}

function sortKey(item: CslItem): string {
  const names = item.author?.length ? item.author : (item.editor ?? []);
  return `${names.map(familyOf).join(" ") || item.title || item.id} ${yearOf(item) ?? ""}`.toLocaleLowerCase("tr");
}

export interface RenderedCitations {
  markdown: string;
  cited: string[];
  missing: string[];
}

/** Bir kaynakça bölümünün yerini işaretleyen satır (yoksa kaynakça metnin sonuna eklenir). */
export const BIBLIOGRAPHY_MARKER = /^[ \t]*\{\{(?:bibliography|kaynakça|kaynakca)\}\}[ \t]*$/im;

/** Gövdedeki atıfları biçimlendirir ve kaynakçayı ekler. Atıf yoksa gövde aynen döner. */
export function renderCitations(body: string, items: Map<string, CslItem>, style: CitationStyle, lang: CitationLang): RenderedCitations {
  const clusters = findCitations(body);
  if (!clusters.length) return { markdown: body.replace(BIBLIOGRAPHY_MARKER, ""), cited: [], missing: [] };
  const ctx: FormatContext = { style, lang, numbers: new Map() };
  const cited: string[] = [];
  const missing = new Set<string>();
  let out = "";
  let last = 0;
  for (const c of clusters) {
    out += body.slice(last, c.index) + formatCluster(c.refs, items, ctx);
    last = c.index + c.raw.length;
    for (const r of c.refs) {
      if (!items.has(r.key)) missing.add(r.key);
      else if (!cited.includes(r.key)) cited.push(r.key);
    }
  }
  out += body.slice(last);
  if (!cited.length) return { markdown: out.replace(BIBLIOGRAPHY_MARKER, ""), cited, missing: [...missing] };
  const ordered = style === "ieee" ? [...cited].sort((a, b) => ctx.numbers.get(a)! - ctx.numbers.get(b)!) : [...cited].sort((a, b) => sortKey(items.get(a)!).localeCompare(sortKey(items.get(b)!), lang));
  const heading = style === "mla" ? L[lang].works : L[lang].refs;
  const entries = ordered.map((k) => formatEntry(items.get(k)!, style, lang, ctx.numbers.get(k)));
  const plainSection = `## ${heading}\n\n${entries.join("\n\n")}`;
  const markdown = BIBLIOGRAPHY_MARKER.test(out) ? out.replace(BIBLIOGRAPHY_MARKER, plainSection) : `${out.trimEnd()}\n\n${plainSection}\n`;
  return { markdown, cited, missing: [...missing] };
}

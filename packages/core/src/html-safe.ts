// Ham HTML ve bağlantı adresleri için izin listesi temizliği (statik site ve HTML dışa aktarma).
// Notlardaki Markdown içinde geçen ham HTML'den yalnızca Nularche'nin kendi ürettiği güvenli etiketler ve öznitelikler
// geçer (açılır blok, hizalama/girinti, metin rengi, üs/alt simge, alt çizgi, vurgu); geri kalan her şey metin olarak
// kaçırılır. Çıktı yalnızca izin verilen parçalardan yeniden kurulduğu için gizlenmiş saldırılar (ör. `java&#09;script:`,
// olay öznitelikleri, bilinmeyen etiketler) geçemez. Arayüzde aynı işi DOMPurify yapar (web/src/editor/linked-nodes.tsx).

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Etiket → izin verilen öznitelikler ve değer biçimleri. */
const ALLOWED: Record<string, Record<string, RegExp>> = {
  details: { open: /^(|open)$/ },
  summary: {},
  div: { align: /^(left|center|right|justify)$/, dir: /^(ltr|rtl|auto)$/, "data-indent": /^\d{1,2}$/, "data-embed": /^\d{1,6}$/ },
  span: {
    style: /^\s*color:\s*(#[0-9a-fA-F]{3,8}|rgba?\(\s*[\d.\s,%]+\)|[a-zA-Z]{3,20})\s*;?\s*$/,
    class: /^callout-mark$/,
    "data-kind": /^[a-z]{1,20}$/,
  },
  sup: {},
  sub: {},
  u: {},
  mark: {},
  small: {},
  kbd: {},
  br: {},
};
const VOID = new Set(["br"]);

const TOKEN = /<!--[\s\S]*?-->|<\/?([a-zA-Z][\w-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>|[^<]+|</g;
const ATTR = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

const decodeEntities = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);?/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/** Ham HTML'i izin listesine göre yeniden kurar; izin verilmeyen etiketler metin olarak görünür. */
export function sanitizeRawHtml(html: string): string {
  let out = "";
  for (const m of html.matchAll(TOKEN)) {
    const [raw, name, attrs] = m;
    if (raw.startsWith("<!--")) continue; // yorumlar atılır
    if (!name) {
      out += raw === "<" ? "&lt;" : esc(decodeEntities(raw));
      continue;
    }
    const tag = name.toLowerCase();
    const allowed = ALLOWED[tag];
    if (!allowed) {
      out += esc(raw);
      continue;
    }
    if (raw.startsWith("</")) {
      if (!VOID.has(tag)) out += `</${tag}>`;
      continue;
    }
    let kept = "";
    for (const a of (attrs ?? "").matchAll(ATTR)) {
      const key = a[1].toLowerCase();
      const value = decodeEntities(a[2] ?? a[3] ?? a[4] ?? "");
      const rule = allowed[key];
      if (rule && rule.test(value)) kept += value === "" && key === "open" ? " open" : ` ${key}="${esc(value)}"`;
    }
    out += `<${tag}${kept}>`;
  }
  return out;
}

/**
 * Bağlantı ya da görsel adresini denetler: http(s), mailto, tel, sayfa içi (#) ve göreli adresler geçer; görsellerde
 * ayrıca `data:image/…`. Kontrol karakterleri ve boşluklarla gizlenmiş `javascript:` gibi adresler boş döner.
 */
export function safeUrl(href: string, opts: { image?: boolean } = {}): string {
  const value = decodeEntities(href ?? "").trim();
  // Tarayıcılar şemadaki boşluk ve kontrol karakterlerini yok sayar: denetim de onlarsız yapılır.
  const compact = value.replace(/[\u0000- \u007f-\u009f]/g, "").toLowerCase();
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(compact)?.[1];
  if (!scheme) return value;
  if (scheme === "http" || scheme === "https" || scheme === "mailto" || scheme === "tel") return value;
  if (opts.image && /^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml);/.test(compact)) return value;
  return "";
}

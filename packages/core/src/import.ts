// Dışarıdan not içe aktarma: Markdown, düz metin, HTML (Apple Notlar, tarayıcılar, Evernote dışa aktarımları) ve RTF
// dosyalarını Node'a çevirir. Dosyaların başvurduğu yerel resim ve ekler (aynı seçimde varsa) `Attachments/` klasörüne
// kopyalanır ve bağlantılar yeni konuma göre yazılır. Diske yazma yalnızca NodeStore üzerinden yapılır.

import path from "node:path";
import { relativeLink } from "./links.ts";
import { parseNodeFile } from "./node-file.ts";
import { SHADOW, type NodeDoc, type NodeStore } from "./node-store.ts";

const { posix } = path;

export interface ImportFile {
  /** Seçime göre POSIX yolu (klasör içe aktarılırken alt klasörlerle, ör. `Notlar/Plan.md`). */
  path: string;
  data: Uint8Array;
}

export const IMPORTABLE_EXTS = [".md", ".markdown", ".txt", ".html", ".htm", ".rtf"];

export interface FileImportResult {
  created: { id: string; title: string }[];
  skipped: string[];
  attachments: number;
}

// ------------------------------------------------------------------ HTML → Markdown

interface HNode {
  tag: string;
  attrs: Record<string, string>;
  children: (HNode | string)[];
}

const VOID = new Set(["br", "hr", "img", "meta", "link", "input", "col", "area", "base", "wbr", "source"]);
const SKIP = new Set(["head", "script", "style", "title", "noscript", "template", "svg", "object"]);

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", laquo: "«", raquo: "»", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”" } as Record<string, string>)[e.toLowerCase()] ?? m;
  });
}

function parseHtml(html: string): HNode {
  const root: HNode = { tag: "root", attrs: {}, children: [] };
  const stack: HNode[] = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!doctype[^>]*>|<\/?([a-zA-Z][\w:-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|[^<]+|</g;
  let skipDepth = 0;
  for (const m of html.matchAll(re)) {
    const raw = m[0];
    const top = stack[stack.length - 1];
    if (raw.startsWith("<!")) continue;
    if (m[1]) {
      const tag = m[1].toLowerCase();
      if (raw.startsWith("</")) {
        if (SKIP.has(tag) && skipDepth > 0) {
          skipDepth--;
          continue;
        }
        if (skipDepth) continue;
        const idx = stack.map((n) => n.tag).lastIndexOf(tag);
        if (idx > 0) stack.length = idx;
        continue;
      }
      if (SKIP.has(tag) && !m[3]) {
        skipDepth++;
        continue;
      }
      if (skipDepth) continue;
      const attrs: Record<string, string> = {};
      for (const a of (m[2] ?? "").matchAll(/([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
        attrs[a[1].toLowerCase()] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? "");
      }
      const node: HNode = { tag, attrs, children: [] };
      // <p> ve <li> kapanmadan yenisi açılırsa öncekini kapat.
      if ((tag === "p" || tag === "li") && top.tag === tag) stack.pop();
      stack[stack.length - 1].children.push(node);
      if (!VOID.has(tag) && !m[3]) stack.push(node);
    } else if (!skipDepth) top.children.push(decodeEntities(raw));
  }
  return root;
}

interface HtmlCtx {
  /** Resim adresini (data: URI ya da göreli yol) Markdown hedefine çevirir; çözülemezse null. */
  image: (src: string) => string | null;
  link: (href: string) => string;
}

const BLOCK = new Set(["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "pre", "table", "hr", "section", "article", "header", "footer", "main", "figure", "aside", "nav", "details", "body", "html"]);

function inlineMd(nodes: (HNode | string)[], ctx: HtmlCtx): string {
  let out = "";
  for (const n of nodes) {
    if (typeof n === "string") {
      out += n.replace(/\s+/g, " ").replace(/([*_`[\]\\])/g, "\\$1");
      continue;
    }
    const inner = () => inlineMd(n.children, ctx);
    const style = n.attrs.style ?? "";
    switch (n.tag) {
      case "b":
      case "strong":
        out += wrap(inner(), "**");
        break;
      case "i":
      case "em":
        out += wrap(inner(), "*");
        break;
      case "s":
      case "strike":
      case "del":
        out += wrap(inner(), "~~");
        break;
      case "u":
      case "sup":
      case "sub":
        out += `<${n.tag}>${inner()}</${n.tag}>`;
        break;
      case "mark":
        out += wrap(inner(), "==");
        break;
      case "code":
        out += `\`${textOf(n)}\``;
        break;
      case "br":
        out += "\n";
        break;
      case "a": {
        const text = inner().trim();
        const href = n.attrs.href ? ctx.link(n.attrs.href) : "";
        out += href && text ? `[${text}](${href})` : text;
        break;
      }
      case "img": {
        const target = n.attrs.src ? ctx.image(n.attrs.src) : null;
        if (target) out += `![${(n.attrs.alt ?? "").replace(/[[\]]/g, "")}](${target})`;
        break;
      }
      case "input":
        if (n.attrs.type === "checkbox") out += "checked" in n.attrs ? "[x] " : "[ ] ";
        break;
      case "span": {
        let s = inner();
        if (/font-weight:\s*(bold|[6-9]00)/i.test(style)) s = wrap(s, "**");
        if (/font-style:\s*italic/i.test(style)) s = wrap(s, "*");
        if (/text-decoration:[^;]*line-through/i.test(style)) s = wrap(s, "~~");
        if (/text-decoration:[^;]*underline/i.test(style)) s = `<u>${s}</u>`;
        out += s;
        break;
      }
      default:
        out += BLOCK.has(n.tag) ? `\n${blockMd(n.children, ctx).trim()}\n` : inner();
    }
  }
  return out;
}

function wrap(s: string, mark: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s)!;
  return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : s;
}

function textOf(n: HNode | string): string {
  return typeof n === "string" ? n : n.children.map(textOf).join("");
}

function listMd(n: HNode, ctx: HtmlCtx, depth: number): string {
  const ordered = n.tag === "ol";
  let i = Number(n.attrs.start) || 1;
  const lines: string[] = [];
  for (const li of n.children) {
    if (typeof li === "string" || li.tag !== "li") continue;
    const nested = li.children.filter((c): c is HNode => typeof c !== "string" && (c.tag === "ul" || c.tag === "ol"));
    const rest = li.children.filter((c) => !nested.includes(c as HNode));
    let text = inlineMd(rest, ctx).replace(/\s*\n\s*/g, " ").trim();
    const checkbox = /^\[([ x])\] /.exec(text);
    const checked = li.attrs.class?.includes("checked") || li.attrs["data-checked"] === "true";
    let marker = ordered ? `${i++}.` : "-";
    if (checkbox) {
      text = text.slice(4);
      marker = `- [${checkbox[1]}]`;
    } else if (/checklist|task/i.test(`${n.attrs.class ?? ""}${li.attrs.class ?? ""}`)) marker = `- [${checked ? "x" : " "}]`;
    lines.push(`${"  ".repeat(depth)}${marker} ${text}`);
    for (const sub of nested) lines.push(listMd(sub, ctx, depth + 1));
  }
  return lines.join("\n");
}

function blockMd(nodes: (HNode | string)[], ctx: HtmlCtx): string {
  const out: string[] = [];
  let inline: (HNode | string)[] = [];
  const flush = () => {
    const text = inlineMd(inline, ctx)
      .split("\n")
      .map((l) => l.trim())
      .join("\n")
      .trim();
    if (text) out.push(text);
    inline = [];
  };
  for (const n of nodes) {
    if (typeof n === "string" || !BLOCK.has(n.tag)) {
      inline.push(n);
      continue;
    }
    flush();
    switch (n.tag) {
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        out.push(`${"#".repeat(Number(n.tag[1]))} ${inlineMd(n.children, ctx).replace(/\s+/g, " ").trim()}`);
        break;
      case "ul":
      case "ol":
        out.push(listMd(n, ctx, 0));
        break;
      case "blockquote":
        out.push(
          blockMd(n.children, ctx)
            .split("\n")
            .map((l) => (l ? `> ${l}` : ">"))
            .join("\n"),
        );
        break;
      case "pre":
        out.push(`\`\`\`\n${textOf(n).replace(/\n$/, "")}\n\`\`\``);
        break;
      case "hr":
        out.push("---");
        break;
      case "table": {
        const rows: string[][] = [];
        const collect = (x: HNode) => {
          for (const c of x.children) {
            if (typeof c === "string") continue;
            if (c.tag === "tr") rows.push(c.children.filter((d): d is HNode => typeof d !== "string" && (d.tag === "td" || d.tag === "th")).map((d) => inlineMd(d.children, ctx).replace(/\s+/g, " ").replace(/\|/g, "\\|").trim()));
            else collect(c);
          }
        };
        collect(n);
        if (rows.length) {
          const cols = Math.max(...rows.map((r) => r.length));
          const pad = (r: string[]) => `| ${[...r, ...Array(cols - r.length).fill("")].join(" | ")} |`;
          out.push([pad(rows[0]), `| ${Array(cols).fill("---").join(" | ")} |`, ...rows.slice(1).map(pad)].join("\n"));
        }
        break;
      }
      default: {
        const style = n.attrs.style ?? "";
        const align = n.attrs.align ?? /text-align:\s*(center|right|justify)/i.exec(style)?.[1];
        const inner = blockMd(n.children, ctx);
        if (align && /^(center|right|justify)$/i.test(align) && inner) out.push(`<div align="${align.toLowerCase()}">\n\n${inner}\n\n</div>`);
        else if (inner) out.push(inner);
      }
    }
  }
  flush();
  return out.join("\n\n");
}

export function htmlToMarkdown(html: string, ctx: Partial<HtmlCtx> = {}): { title: string | null; body: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const tree = parseHtml(html);
  const body = blockMd(tree.children, { image: ctx.image ?? ((s) => (/^https?:/.test(s) ? s : null)), link: ctx.link ?? ((h) => h) })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title: title ? decodeEntities(title).trim() || null : null, body };
}

// ------------------------------------------------------------------ RTF → düz metin

const RTF_SKIP = new Set(["fonttbl", "colortbl", "stylesheet", "info", "pict", "header", "footer", "headerl", "headerr", "footerl", "footerr", "listtable", "listoverridetable", "rsidtbl", "generator", "xmlnstbl", "themedata", "colorschememapping", "latentstyles", "datastore", "mmathPr", "expandedcolortbl"]);

export function rtfToText(rtf: string): string {
  let out = "";
  let i = 0;
  let codepage = "windows-1252";
  const stack: { skip: boolean; uc: number }[] = [];
  let skip = false;
  let uc = 1;
  let pendingSkip = 0;
  let hexBytes: number[] = [];
  const flushHex = () => {
    if (!hexBytes.length) return;
    try {
      out += new TextDecoder(codepage).decode(new Uint8Array(hexBytes));
    } catch {
      out += String.fromCharCode(...hexBytes);
    }
    hexBytes = [];
  };
  while (i < rtf.length) {
    const ch = rtf[i];
    if (ch === "{") {
      flushHex();
      stack.push({ skip, uc });
      i++;
    } else if (ch === "}") {
      flushHex();
      const s = stack.pop();
      if (s) ({ skip, uc } = s);
      i++;
    } else if (ch === "\\") {
      const m = /^\\(?:([a-zA-Z]+)(-?\d+)? ?|'([0-9a-fA-F]{2})|([^a-zA-Z]))/.exec(rtf.slice(i, i + 40));
      if (!m) {
        i++;
        continue;
      }
      i += m[0].length;
      if (m[3]) {
        if (pendingSkip > 0) pendingSkip--;
        else if (!skip) hexBytes.push(parseInt(m[3], 16));
        continue;
      }
      flushHex();
      if (m[4]) {
        if (m[4] === "*") skip = true;
        else if (!skip && m[4] === "~") out += " ";
        else if (!skip && (m[4] === "\\" || m[4] === "{" || m[4] === "}")) out += m[4];
        else if (!skip && (m[4] === "\n" || m[4] === "\r")) out += "\n";
        continue;
      }
      const word = m[1];
      const arg = m[2] ? Number(m[2]) : undefined;
      if (RTF_SKIP.has(word)) skip = true;
      else if (word === "ansicpg" && arg) codepage = `windows-${arg}`;
      else if (word === "uc" && arg !== undefined) uc = arg;
      else if (skip) continue;
      else if (word === "par" || word === "line" || word === "sect" || word === "page") out += "\n";
      else if (word === "tab") out += "\t";
      else if (word === "cell") out += " | ";
      else if (word === "row") out += "\n";
      else if (word === "emdash") out += "—";
      else if (word === "endash") out += "–";
      else if (word === "bullet") out += "•";
      else if (word === "lquote") out += "‘";
      else if (word === "rquote") out += "’";
      else if (word === "ldblquote") out += "“";
      else if (word === "rdblquote") out += "”";
      else if (word === "u" && arg !== undefined) {
        out += String.fromCharCode(arg < 0 ? arg + 65536 : arg);
        pendingSkip = uc;
      }
    } else {
      if (ch === "\r" || ch === "\n") {
        i++;
        continue;
      }
      flushHex();
      if (pendingSkip > 0) pendingSkip--;
      else if (!skip) out += ch;
      i++;
    }
  }
  flushHex();
  return out
    .replace(/�/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ------------------------------------------------------------------ İçe aktarma

const MIME_EXT: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp", "image/svg+xml": ".svg", "image/heic": ".heic" };

function decodeUri(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Dosyaları `parentNodeId` altına (varsayılan Shadow) Node olarak içe aktarır. Desteklenmeyen dosyalar (resimler dahil)
 * tek başına Node olmaz; yalnızca bir notun başvurduğu ekler olarak kopyalanır.
 */
export async function importFiles(store: NodeStore, files: ImportFile[], parentNodeId: string | null = SHADOW): Promise<FileImportResult> {
  const byPath = new Map(files.map((f) => [posix.normalize(f.path.replace(/\\/g, "/")), f]));
  const copied = new Map<string, string>();
  const result: FileImportResult = { created: [], skipped: [], attachments: 0 };
  const dec = new TextDecoder();

  /** Bir notun göreli başvurusunu seçimdeki dosyaya çözer, eki kopyalar ve Attachments yolunu döndürür. */
  const attach = async (fromFile: string, href: string): Promise<string | null> => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith("file:")) return null;
    const clean = decodeUri(href.replace(/^file:\/\//, "").replace(/^<|>$/g, "").split(/[?#]/)[0]);
    const target = posix.normalize(posix.join(posix.dirname(fromFile), clean));
    const file = byPath.get(target) ?? byPath.get(clean);
    if (!file || IMPORTABLE_EXTS.includes(posix.extname(target).toLowerCase())) return null;
    let saved = copied.get(target);
    if (!saved) {
      saved = await store.saveAttachment(posix.basename(target), file.data);
      copied.set(target, saved);
      result.attachments++;
    }
    return saved;
  };

  for (const [rel, file] of byPath) {
    const ext = posix.extname(rel).toLowerCase();
    if (!IMPORTABLE_EXTS.includes(ext)) continue;
    const name = posix.basename(rel, posix.extname(rel));
    try {
      let title = name;
      let body: string;
      const refs: [string, string][] = []; // [orijinal başvuru, Attachments yolu]
      if (ext === ".md" || ext === ".markdown") {
        const parsed = parseNodeFile(dec.decode(file.data));
        body = parsed.body;
        if (typeof parsed.frontmatter.title === "string" && parsed.frontmatter.title.trim()) title = parsed.frontmatter.title.trim();
        for (const m of body.matchAll(/!?\[[^\]]*\]\((<[^>]+>|[^)\s]+)(?:\s+"[^"]*")?\)/g)) {
          const saved = await attach(rel, m[1]);
          if (saved) refs.push([m[1], saved]);
        }
      } else if (ext === ".txt") {
        body = dec.decode(file.data).replace(/\r\n?/g, "\n");
      } else if (ext === ".rtf") {
        body = rtfToText(new TextDecoder("latin1").decode(file.data));
      } else {
        const pendingImages: { src: string; token: string }[] = [];
        const html = dec.decode(file.data);
        const converted = htmlToMarkdown(html, {
          image: (src) => {
            const token = `nularche-import-${pendingImages.length}`;
            pendingImages.push({ src, token });
            return token;
          },
        });
        body = converted.body;
        if (converted.title) title = converted.title;
        for (const img of pendingImages) {
          let saved: string | null = null;
          const data = /^data:([\w/+.-]+);base64,(.*)$/s.exec(img.src);
          if (data) {
            saved = await store.saveAttachment(`${name}-resim${MIME_EXT[data[1]] ?? ".png"}`, new Uint8Array(Buffer.from(data[2], "base64")));
            result.attachments++;
          } else saved = await attach(rel, img.src);
          if (saved) refs.push([img.token, saved]);
          else if (/^https?:/.test(img.src)) refs.push([img.token, `url:${img.src}`]);
          else body = body.replace(new RegExp(`!\\[[^\\]]*\\]\\(${img.token}\\)`, "g"), "");
        }
      }
      const heading = /^#\s+(.+)$/m.exec(body);
      if (title === name && heading && ext !== ".txt") title = heading[1].replace(/[*_`]/g, "").trim() || title;
      const node: NodeDoc = await store.create({ title, parentNodeId, body: "" });
      for (const [from, to] of refs) {
        const target = to.startsWith("url:") ? to.slice(4) : relativeLink(node.path, to);
        body = body.split(`(${from})`).join(`(${target})`).split(`(${from} `).join(`(${target} `);
      }
      await store.update(node.id, { body });
      result.created.push({ id: node.id, title: node.title });
    } catch {
      result.skipped.push(rel);
    }
  }
  return result;
}

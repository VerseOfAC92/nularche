// Kelime işlemci biçimleri: bir Node'u RTF (TextEdit, Pages, Word) ya da DOCX (Word, Pages, LibreOffice) olarak üretir.
// Markdown önce `marked` ile ayrıştırılıp basit bir blok/metin parçası modeline çevrilir; iki yazıcı da bu modeli kullanır.

import path from "node:path";
import { zipSync } from "fflate";
import { Lexer, type Token, type Tokens } from "marked";
import { resolveLink } from "./links.ts";
import { ATTACHMENTS_DIR, NodeError, type NodeStore } from "./node-store.ts";
import { exportableMarkdown, isLockedBody, plainText } from "./note-text.ts";

const { posix } = path;

interface Run {
  text: string;
  b?: boolean;
  i?: boolean;
  u?: boolean;
  s?: boolean;
  code?: boolean;
  sup?: boolean;
  sub?: boolean;
  mark?: boolean;
  color?: string;
  link?: string;
  /** Satır sonu (<br>). */
  br?: boolean;
}

interface ImageRef {
  data: Uint8Array;
  type: "png" | "jpeg" | "gif";
  width: number;
  height: number;
}

type Align = "left" | "center" | "right" | "justify";

type Block =
  | { kind: "p"; runs: Run[]; align?: Align; rtl?: boolean; indent?: number; quote?: boolean }
  | { kind: "h"; level: number; runs: Run[]; align?: Align; rtl?: boolean }
  | { kind: "li"; runs: Run[]; depth: number; ordered: boolean; index: number; checked?: boolean }
  | { kind: "code"; text: string }
  | { kind: "hr" }
  | { kind: "table"; rows: Run[][][] }
  | { kind: "image"; image: ImageRef };

type Style = Omit<Run, "text" | "br">;

/** PNG/JPEG/GIF boyutlarını dosya başlığından okur. */
function imageSize(data: Uint8Array, type: ImageRef["type"]): { width: number; height: number } | null {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (type === "png" && data.length > 24) return { width: dv.getUint32(16), height: dv.getUint32(20) };
  if (type === "gif" && data.length > 10) return { width: dv.getUint16(6, true), height: dv.getUint16(8, true) };
  if (type === "jpeg") {
    let i = 2;
    while (i + 9 < data.length) {
      if (data[i] !== 0xff) return null;
      const marker = data[i + 1];
      const len = dv.getUint16(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) };
      }
      i += 2 + len;
    }
  }
  return null;
}

async function loadImage(store: NodeStore, notePath: string, href: string): Promise<ImageRef | null> {
  const target = resolveLink(notePath, href);
  if (!target || !target.startsWith(`${ATTACHMENTS_DIR}/`) || !(await store.pathExists(target))) return null;
  const ext = posix.extname(target).toLowerCase();
  const type = ext === ".png" ? "png" : ext === ".jpg" || ext === ".jpeg" ? "jpeg" : ext === ".gif" ? "gif" : null;
  if (!type) return null;
  const data = new Uint8Array(await store.readRaw(target));
  const size = imageSize(data, type);
  return size ? { data, type, ...size } : null;
}

/** Markdown gövdesini blok modeline çevirir. */
async function toBlocks(store: NodeStore, notePath: string, body: string): Promise<Block[]> {
  const md = exportableMarkdown(body)
    .replace(/^@\[youtube\]\(([^)\s]+)\)[ \t]*$/gm, "[$1]($1)")
    .replace(/^@\[database\]\(([^)\s]+)\)[ \t]*$/gm, "")
    .replace(/^@\[audio\]\(([^)\s]+)\)[ \t]*$/gm, "🔊 [$1]($1)")
    .replace(/^@\[drawing\]\(([^)\s]+)\)[ \t]*$/gm, "![]($1)")
    .replace(/^> \[!([\w-]+)\][+-]?[ \t]*(.*)$/gm, (_m, k: string, title: string) => `> **${title.trim() || k.toUpperCase()}**`)
    .replace(/<\/?(details|summary)>/g, "");
  const tokens = new Lexer({ gfm: true }).lex(md);
  const out: Block[] = [];
  let align: Align | undefined;
  let rtl = false;
  let indent = 0;

  const inline = (toks: Token[] | undefined, base: Style = {}): Run[] => {
    const runs: Run[] = [];
    let style: Style = { ...base };
    const stack: Style[] = [];
    for (const tk of toks ?? []) {
      switch (tk.type) {
        case "text": {
          const t = tk as Tokens.Text;
          if (t.tokens?.length) runs.push(...inline(t.tokens, style));
          else pushText(runs, decode(t.text), style);
          break;
        }
        case "strong":
          runs.push(...inline((tk as Tokens.Strong).tokens, { ...style, b: true }));
          break;
        case "em":
          runs.push(...inline((tk as Tokens.Em).tokens, { ...style, i: true }));
          break;
        case "del":
          runs.push(...inline((tk as Tokens.Del).tokens, { ...style, s: true }));
          break;
        case "codespan":
          runs.push({ ...style, text: decode((tk as Tokens.Codespan).text), code: true });
          break;
        case "br":
          runs.push({ text: "", br: true });
          break;
        case "link":
          runs.push(...inline((tk as Tokens.Link).tokens, { ...style, link: (tk as Tokens.Link).href }));
          break;
        case "image":
          pushText(runs, (tk as Tokens.Image).text || "", style);
          break;
        case "escape":
          pushText(runs, (tk as Tokens.Escape).text, style);
          break;
        case "html": {
          const raw = (tk as Tokens.HTML).raw;
          const open = /^<(sup|sub|u|mark|span)\b([^>]*)>$/i.exec(raw.trim());
          const close = /^<\/(sup|sub|u|mark|span)>$/i.exec(raw.trim());
          if (open) {
            stack.push(style);
            const tag = open[1].toLowerCase();
            const color = /color:\s*([^;"']+)/i.exec(open[2])?.[1]?.trim();
            style = { ...style, ...(tag === "sup" ? { sup: true } : tag === "sub" ? { sub: true } : tag === "u" ? { u: true } : tag === "mark" ? { mark: true } : color ? { color } : {}) };
          } else if (close) style = stack.pop() ?? base;
          else if (/^<br\s*\/?>$/i.test(raw.trim())) runs.push({ text: "", br: true });
          break;
        }
        default:
          if ("text" in tk && typeof tk.text === "string") pushText(runs, decode(tk.text), style);
      }
    }
    return runs;
  };

  const pushImages = async (toks: Token[] | undefined) => {
    for (const tk of toks ?? []) {
      if (tk.type === "image") {
        const img = await loadImage(store, notePath, (tk as Tokens.Image).href);
        if (img) out.push({ kind: "image", image: img });
      }
    }
  };

  const walk = async (toks: Token[], quote = false, depth = 0): Promise<void> => {
    for (const tk of toks) {
      switch (tk.type) {
        case "heading": {
          const h = tk as Tokens.Heading;
          out.push({ kind: "h", level: h.depth, runs: inline(h.tokens), align, rtl });
          break;
        }
        case "paragraph": {
          const p = tk as Tokens.Paragraph;
          const onlyImages = p.tokens.every((x) => x.type === "image" || (x.type === "text" && !x.raw.trim()));
          if (onlyImages) await pushImages(p.tokens);
          else out.push({ kind: "p", runs: highlight(inline(p.tokens)), align, rtl, indent, quote });
          break;
        }
        case "text": {
          const t = tk as Tokens.Text;
          out.push({ kind: "p", runs: inline(t.tokens ?? [{ type: "text", raw: t.raw, text: t.text } as Tokens.Text]), align, rtl, indent, quote });
          break;
        }
        case "blockquote":
          await walk((tk as Tokens.Blockquote).tokens, true, depth);
          break;
        case "list": {
          const l = tk as Tokens.List;
          let index = typeof l.start === "number" ? l.start : 1;
          for (const item of l.items) {
            const [first, ...rest] = item.tokens;
            const firstRuns = first && (first.type === "text" || first.type === "paragraph") ? inline((first as Tokens.Text).tokens ?? []) : [];
            out.push({ kind: "li", runs: firstRuns, depth, ordered: l.ordered, index: index++, checked: item.task ? !!item.checked : undefined });
            const nested = first && (first.type === "text" || first.type === "paragraph") ? rest : item.tokens;
            await walk(nested, quote, depth + 1);
          }
          break;
        }
        case "code":
          out.push({ kind: "code", text: (tk as Tokens.Code).text });
          break;
        case "hr":
          out.push({ kind: "hr" });
          break;
        case "table": {
          const t = tk as Tokens.Table;
          out.push({ kind: "table", rows: [t.header.map((c) => inline(c.tokens, { b: true })), ...t.rows.map((r) => r.map((c) => inline(c.tokens)))] });
          break;
        }
        case "html": {
          const raw = (tk as Tokens.HTML).raw.trim();
          const open = /^<div\b([^>]*)>/i.exec(raw);
          if (open) {
            align = (/align="(center|right|justify|left)"/i.exec(open[1])?.[1] as Align | undefined) ?? undefined;
            rtl = /dir="rtl"/i.test(open[1]);
            indent = Number(/data-indent="(\d+)"/.exec(open[1])?.[1] ?? 0);
          }
          if (/<\/div>\s*$/i.test(raw)) {
            align = undefined;
            rtl = false;
            indent = 0;
          }
          break;
        }
      }
    }
  };
  await walk(tokens);
  return out;
}

const decode = (s: string) =>
  s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m, e: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " })[e] ?? m);

function pushText(runs: Run[], text: string, style: Style): void {
  if (text) runs.push({ ...style, text });
}

/** `==vurgu==` sözdizimini (Markdown standardında yok) vurgulu parçaya çevirir. */
function highlight(runs: Run[]): Run[] {
  const out: Run[] = [];
  let on = false;
  for (const r of runs) {
    if (r.code || !r.text.includes("==")) {
      out.push(on ? { ...r, mark: true } : r);
      continue;
    }
    r.text.split("==").forEach((part, i) => {
      if (i > 0) on = !on;
      if (part) out.push({ ...r, text: part, mark: on || r.mark });
    });
  }
  return out;
}

// ---------------------------------------------------------------- RTF

function rtfText(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (ch === "\\" || ch === "{" || ch === "}") out += `\\${ch}`;
    else if (ch === "\n") out += "\\line ";
    else if (ch === "\t") out += "\\tab ";
    else if (code < 128) out += ch;
    else if (code < 0x10000) out += `\\u${code > 32767 ? code - 65536 : code}?`;
    else {
      // UTF-16 vekil çifti
      const hi = 0xd800 + ((code - 0x10000) >> 10);
      const lo = 0xdc00 + ((code - 0x10000) & 0x3ff);
      out += `\\u${hi - 65536}?\\u${lo - 65536}?`;
    }
  }
  return out;
}

const hexByte = (n: number) => n.toString(16).padStart(2, "0");

function parseColor(c: string | undefined): [number, number, number] | null {
  const m = c ? /^#([0-9a-f]{6})$/i.exec(c) : null;
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function renderRtf(title: string, blocks: Block[]): string {
  const colors: string[] = ["0;102;204", "0;0;0"]; // 1: bağlantı mavisi, 2: siyah
  const colorIndex = (c: string | undefined) => {
    const rgb = parseColor(c);
    if (!rgb) return 0;
    const key = rgb.join(";");
    let i = colors.indexOf(key);
    if (i < 0) i = colors.push(key) - 1;
    return i + 1;
  };
  const runs = (rs: Run[]) =>
    rs
      .map((r) => {
        if (r.br) return "\\line ";
        const fmt = [
          r.b ? "\\b" : "",
          r.i ? "\\i" : "",
          r.u || r.link ? "\\ul" : "",
          r.s ? "\\strike" : "",
          r.sup ? "\\super" : "",
          r.sub ? "\\sub" : "",
          r.code ? "\\f1" : "",
          r.mark ? "\\highlight7" : "",
          r.link ? "\\cf1" : r.color ? `\\cf${colorIndex(r.color)}` : "",
        ].join("");
        const text = `{${fmt}${fmt ? " " : ""}${rtfText(r.text)}}`;
        return r.link ? `{\\field{\\*\\fldinst{HYPERLINK "${rtfText(r.link)}"}}{\\fldrslt ${text}}}` : text;
      })
      .join("");
  const para = (align?: Align, rtl?: boolean) =>
    `\\pard${align === "center" ? "\\qc" : align === "right" ? "\\qr" : align === "justify" ? "\\qj" : ""}${rtl ? "\\rtlpar" : ""}\\sa160`;
  const sizes = [0, 48, 36, 30, 26, 24, 24];
  const body: string[] = [`\\pard\\sa240{\\b\\fs56 ${rtfText(title)}}\\par`];
  for (const b of blocks) {
    switch (b.kind) {
      case "h":
        body.push(`${para(b.align, b.rtl)}\\sb240{\\b\\fs${sizes[b.level] ?? 24} ${runs(b.runs)}}\\par`);
        break;
      case "p":
        body.push(`${para(b.align, b.rtl)}${b.quote ? "\\li560\\cf2" : b.indent ? `\\li${b.indent * 560}` : ""} ${runs(b.runs)}\\par`);
        break;
      case "li": {
        const bullet = b.checked !== undefined ? (b.checked ? "☑" : "☐") : b.ordered ? `${b.index}.` : "•";
        const li = 360 + b.depth * 360;
        body.push(`\\pard\\sa80\\li${li + 280}\\fi-280 ${rtfText(bullet)}\\tab ${runs(b.runs)}\\par`);
        break;
      }
      case "code":
        body.push(`\\pard\\sa160\\li280{\\f1\\fs20 ${rtfText(b.text)}}\\par`);
        break;
      case "hr":
        body.push("\\pard\\brdrb\\brdrs\\brdrw10\\brsp20\\sa160\\par");
        break;
      case "table":
        for (const row of b.rows) {
          const width = Math.floor(9000 / Math.max(1, row.length));
          const cells = row.map((_c, i) => `\\clbrdrt\\brdrs\\clbrdrl\\brdrs\\clbrdrb\\brdrs\\clbrdrr\\brdrs\\cellx${width * (i + 1)}`).join("");
          body.push(`\\trowd\\trgaph80${cells}${row.map((c) => `\\pard\\intbl ${runs(c)}\\cell`).join("")}\\row`);
        }
        body.push("\\pard\\par");
        break;
      case "image": {
        if (b.image.type === "gif") break;
        const max = 9000; // twip
        const twW = b.image.width * 15;
        const scale = twW > max ? max / twW : 1;
        const hex = Array.from(b.image.data, hexByte).join("");
        body.push(
          `\\pard\\sa160{\\pict${b.image.type === "png" ? "\\pngblip" : "\\jpegblip"}\\picw${b.image.width}\\pich${b.image.height}\\picwgoal${Math.round(twW * scale)}\\pichgoal${Math.round(b.image.height * 15 * scale)} ${hex}}\\par`,
        );
        break;
      }
    }
  }
  const colorTable = `{\\colortbl;${colors.map((c) => c.split(";").map((v, i) => `\\${["red", "green", "blue"][i]}${v}`).join("") + ";").join("")}}`;
  return `{\\rtf1\\ansi\\ansicpg1254\\deff0{\\fonttbl{\\f0\\fswiss Helvetica;}{\\f1\\fmodern Menlo;}}${colorTable}\\f0\\fs24\n${body.join("\n")}\n}`;
}

// ---------------------------------------------------------------- DOCX

const xmlEsc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function renderDocx(title: string, blocks: Block[]): Uint8Array {
  const rels: string[] = [];
  const media: Record<string, Uint8Array> = {};
  let relId = 10;
  let numUsed = false;
  const run = (r: Run): string => {
    if (r.br) return "<w:r><w:br/></w:r>";
    const rgb = parseColor(r.color);
    const props = [
      r.b ? "<w:b/>" : "",
      r.i ? "<w:i/>" : "",
      r.u || r.link ? '<w:u w:val="single"/>' : "",
      r.s ? "<w:strike/>" : "",
      r.code ? '<w:rFonts w:ascii="Menlo" w:hAnsi="Menlo" w:cs="Menlo"/>' : "",
      r.link ? '<w:color w:val="0066CC"/>' : rgb ? `<w:color w:val="${rgb.map(hexByte).join("").toUpperCase()}"/>` : "",
      r.mark ? '<w:highlight w:val="yellow"/>' : "",
      r.sup ? '<w:vertAlign w:val="superscript"/>' : r.sub ? '<w:vertAlign w:val="subscript"/>' : "",
    ].join("");
    const parts = r.text.split("\n");
    const text = parts.map((p, i) => `${i ? "<w:br/>" : ""}<w:t xml:space="preserve">${xmlEsc(p)}</w:t>`).join("");
    const xml = `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}${text}</w:r>`;
    if (!r.link || !/^(https?|mailto):/i.test(r.link)) return xml;
    const id = `rId${relId++}`;
    rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xmlEsc(r.link)}" TargetMode="External"/>`);
    return `<w:hyperlink r:id="${id}">${xml}</w:hyperlink>`;
  };
  const runs = (rs: Run[]) => rs.map(run).join("");
  const pPr = (inner: string) => (inner ? `<w:pPr>${inner}</w:pPr>` : "");
  const jc = (a?: Align) => (a && a !== "left" ? `<w:jc w:val="${a === "justify" ? "both" : a}"/>` : "");
  const body: string[] = [`<w:p>${pPr('<w:pStyle w:val="Title"/>')}${run({ text: title })}</w:p>`];
  for (const b of blocks) {
    switch (b.kind) {
      case "h":
        body.push(`<w:p>${pPr(`<w:pStyle w:val="Heading${Math.min(b.level, 6)}"/>${b.rtl ? "<w:bidi/>" : ""}${jc(b.align)}`)}${runs(b.runs)}</w:p>`);
        break;
      case "p":
        body.push(
          `<w:p>${pPr(`${b.quote ? '<w:pStyle w:val="Quote"/>' : ""}${b.rtl ? "<w:bidi/>" : ""}${b.indent ? `<w:ind w:left="${b.indent * 567}"/>` : ""}${jc(b.align)}`)}${runs(b.runs)}</w:p>`,
        );
        break;
      case "li": {
        if (b.checked !== undefined) {
          body.push(`<w:p>${pPr(`<w:ind w:left="${360 + b.depth * 360}"/>`)}${run({ text: b.checked ? "☑ " : "☐ " })}${runs(b.runs)}</w:p>`);
        } else {
          numUsed = true;
          body.push(`<w:p>${pPr(`<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${Math.min(b.depth, 8)}"/><w:numId w:val="${b.ordered ? 2 : 1}"/></w:numPr>`)}${runs(b.runs)}</w:p>`);
        }
        break;
      }
      case "code":
        for (const line of b.text.split("\n")) body.push(`<w:p>${pPr('<w:pStyle w:val="Code"/>')}${run({ text: line, code: true })}</w:p>`);
        break;
      case "hr":
        body.push('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="AAAAAA"/></w:pBdr></w:pPr></w:p>');
        break;
      case "table": {
        const cols = Math.max(...b.rows.map((r) => r.length));
        const w = Math.floor(9000 / Math.max(1, cols));
        const rows = b.rows
          .map((r) => `<w:tr>${r.map((c) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/></w:tcPr><w:p>${runs(c)}</w:p></w:tc>`).join("")}</w:tr>`)
          .join("");
        body.push(
          `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="BBBBBB"/>`).join("")}</w:tblBorders></w:tblPr><w:tblGrid>${`<w:gridCol w:w="${w}"/>`.repeat(cols)}</w:tblGrid>${rows}</w:tbl><w:p/>`,
        );
        break;
      }
      case "image": {
        const n = Object.keys(media).length + 1;
        const ext = b.image.type === "jpeg" ? "jpeg" : b.image.type;
        const name = `image${n}.${ext}`;
        media[`word/media/${name}`] = b.image.data;
        const id = `rId${relId++}`;
        rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`);
        const maxEmu = 5_760_000; // ~16 cm
        let cx = b.image.width * 9525;
        let cy = b.image.height * 9525;
        if (cx > maxEmu) {
          cy = Math.round((cy * maxEmu) / cx);
          cx = maxEmu;
        }
        body.push(
          `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="${name}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${n}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`,
        );
        break;
      }
    }
  }
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${W} xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1304" w:bottom="1440" w:left="1304" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const heading = (n: number, size: number) =>
    `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr></w:style>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri" w:eastAsia="Calibri"/><w:sz w:val="24"/><w:lang w:val="tr-TR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="52"/></w:rPr></w:style>${[48, 36, 30, 26, 24, 24].map((s, i) => heading(i + 1, s)).join("")}<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="567"/></w:pPr><w:rPr><w:i/><w:color w:val="555555"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/></w:pPr><w:rPr><w:rFonts w:ascii="Menlo" w:hAnsi="Menlo"/><w:sz w:val="20"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/></w:pPr></w:style><w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/></w:style></w:styles>`;
  const lvl = (i: number, ordered: boolean) =>
    `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${ordered ? (i % 3 === 1 ? "lowerLetter" : i % 3 === 2 ? "lowerRoman" : "decimal") : "bullet"}"/><w:lvlText w:val="${ordered ? `%${i + 1}.` : ["•", "◦", "▪"][i % 3]}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 + i * 360}" w:hanging="360"/></w:pPr></w:lvl>`;
  const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering ${W}><w:abstractNum w:abstractNumId="0">${Array.from({ length: 9 }, (_v, i) => lvl(i, false)).join("")}</w:abstractNum><w:abstractNum w:abstractNumId="1">${Array.from({ length: 9 }, (_v, i) => lvl(i, true)).join("")}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${numUsed ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' : ""}${rels.join("")}</Relationships>`;
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>${numUsed ? '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' : ""}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEsc(title)}</dc:title><dc:creator>Nularche</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
  const enc = new TextEncoder();
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": enc.encode(types),
    "_rels/.rels": enc.encode(rootRels),
    "docProps/core.xml": enc.encode(core),
    "word/document.xml": enc.encode(document),
    "word/styles.xml": enc.encode(styles),
    "word/_rels/document.xml.rels": enc.encode(docRels),
    ...media,
  };
  if (numUsed) files["word/numbering.xml"] = enc.encode(numbering);
  return zipSync(files);
}

export type DocFormat = "rtf" | "docx" | "txt";

/** Sayfayı RTF, DOCX ya da düz metin olarak üretir. Kilitli sayfalar dışa aktarılamaz. */
export async function exportPageDocument(store: NodeStore, ref: string, format: DocFormat): Promise<{ name: string; data: Uint8Array; mime: string }> {
  const node = await store.read(ref);
  if (node.locked || isLockedBody(node.body)) throw new NodeError("invalid", "Kilitli not dışa aktarılamaz; önce kilidi kaldırın.");
  const base = node.title.replace(/[\\/:*?"<>|]/g, "-");
  if (format === "txt") return { name: `${base}.txt`, data: new TextEncoder().encode(`${node.title}\n\n${plainText(node.body)}\n`), mime: "text/plain; charset=utf-8" };
  const blocks = await toBlocks(store, node.path, node.body);
  if (format === "rtf") return { name: `${base}.rtf`, data: new TextEncoder().encode(renderRtf(node.title, blocks)), mime: "application/rtf" };
  return { name: `${base}.docx`, data: renderDocx(node.title, blocks), mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
}

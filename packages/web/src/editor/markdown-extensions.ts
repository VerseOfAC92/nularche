// Resmi Markdown desteği olmayan Shard (blok) türleri için Markdown okuma/yazma kuralları.
// Hepsi başka Markdown araçlarında da okunabilir kalacak biçimler seçildi:
//   Callout      → GitHub uyarısı:      > [!NOTE] …
//   Açılır blok  → HTML:                <details><summary>…</summary> … </details>
//   YouTube      → tek satır:            @[youtube](https://…)
//   Metin rengi  → HTML:                <span style="color: …">…</span>
//   Tablo genişliği → görünmez yorum:   <!-- nularche-table widths=120,200,0 --> (GFM tablosunun hemen önünde)

import { mergeAttributes, Node, type MarkdownLexerConfiguration, type MarkdownToken } from "@tiptap/core";
import { Details, DetailsContent, DetailsSummary } from "@tiptap/extension-details";
import { Table } from "@tiptap/extension-table";
import { TextStyle } from "@tiptap/extension-text-style";
import Youtube from "@tiptap/extension-youtube";
import { CALLOUT_KINDS, calloutTone, type CalloutKind } from "../../../core/src/note-text.ts";

type AnyNode = { attrs?: Record<string, unknown>; content?: unknown };

/** Render sırasında düğüm JSON ya da ProseMirror düğümü olabilir; çocukları dizi olarak döndürür. */
function childrenOf(node: AnyNode): AnyNode[] {
  const c = node.content as { content?: AnyNode[] } | AnyNode[] | undefined;
  if (Array.isArray(c)) return c;
  return c?.content ?? [];
}

export { CALLOUT_KINDS, type CalloutKind };

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (kind: CalloutKind) => ReturnType;
    };
  }
}

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      kind: {
        default: "note",
        parseHTML: (el) => el.getAttribute("data-type") || el.getAttribute("data-kind") || "note",
        renderHTML: (attrs) => ({ "data-type": attrs.kind, "data-kind": calloutTone(String(attrs.kind)) }),
      },
      /** `> [!info] Başlık` satırındaki başlık (yoksa null). */
      title: { default: null, parseHTML: (el) => el.getAttribute("data-title"), renderHTML: (a) => (a.title ? { "data-title": a.title } : {}) },
      /** Kutu katlama işareti: "+" açık, "-" kapalı, "" katlanmaz. */
      fold: { default: "", parseHTML: (el) => el.getAttribute("data-fold") ?? "", renderHTML: (a) => (a.fold ? { "data-fold": a.fold } : {}) },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-callout]", contentElement: ".callout-body" }, { tag: "div[data-callout]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const title = node.attrs.title ? [["div", { class: "callout-title", contenteditable: "false" }, String(node.attrs.title)]] : [];
    return ["div", mergeAttributes(HTMLAttributes, { "data-callout": "" }), ...title, ["div", { class: "callout-body" }, 0]] as never;
  },

  addCommands() {
    return {
      setCallout:
        (kind) =>
        ({ commands }) =>
          commands.wrapIn(this.name, { kind }),
    };
  },

  markdownTokenizer: {
    name: "callout",
    level: "block",
    start: (src: string) => src.indexOf("> [!"),
    tokenize(src: string, _tokens: MarkdownToken[], lexer: MarkdownLexerConfiguration) {
      const m = /^> ?\[!([\w-]+)\]([+-]?)[ \t]*([^\n]*)(?:\n|$)((?:>[^\n]*(?:\n|$))*)/.exec(src);
      if (!m) return undefined;
      const inner = m[4]
        .split("\n")
        .map((line) => line.replace(/^> ?/, ""))
        .join("\n");
      return { type: "callout", raw: m[0], kind: m[1].toLowerCase(), fold: m[2], title: m[3].trim() || null, tokens: lexer.blockTokens(inner) };
    },
  },

  parseMarkdown: (token: MarkdownToken, h: any) => {
    const content = token.tokens?.length ? h.parseChildren(token.tokens) : [];
    const tk = token as { kind?: string; fold?: string; title?: string | null };
    return h.createNode("callout", { kind: tk.kind ?? "note", fold: tk.fold ?? "", title: tk.title ?? null }, content.length ? content : [h.createNode("paragraph")]);
  },

  renderMarkdown: (node: AnyNode, h: any) => {
    // GitHub'ın beş türü büyük harfle (GitHub uyumu), ek türler dosyadaki gibi küçük harfle yazılır.
    const raw = String(node.attrs?.kind ?? "note");
    const kind = (CALLOUT_KINDS as readonly string[]).includes(raw) ? raw.toUpperCase() : raw;
    const title = node.attrs?.title ? ` ${String(node.attrs.title)}` : "";
    const body: string = h.renderChildren(childrenOf(node), "\n\n");
    return `> [!${kind}]${String(node.attrs?.fold ?? "")}${title}\n${body
      .split("\n")
      .map((line) => (line ? `> ${line}` : ">"))
      .join("\n")}`;
  },
});

export const MdDetails = Details.extend({
  markdownTokenizer: {
    name: "details",
    level: "block",
    start: (src: string) => src.indexOf("<details"),
    tokenize(src: string, _tokens: MarkdownToken[], lexer: MarkdownLexerConfiguration) {
      const head = /^<details( open)?>\s*<summary>([\s\S]*?)<\/summary>/.exec(src);
      if (!head) return undefined;
      const re = /<\/?details\b[^>]*>/g;
      re.lastIndex = head[0].length;
      let depth = 1;
      for (let m = re.exec(src); m; m = re.exec(src)) {
        depth += m[0].startsWith("</") ? -1 : 1;
        if (depth === 0) {
          const inner = src.slice(head[0].length, m.index).trim();
          let raw = src.slice(0, re.lastIndex);
          const nl = /^[ \t]*\n?/.exec(src.slice(re.lastIndex));
          if (nl) raw += nl[0];
          return {
            type: "details",
            raw,
            open: !!head[1],
            summaryTokens: lexer.inlineTokens(head[2].trim()),
            tokens: lexer.blockTokens(inner),
          };
        }
      }
      return undefined;
    },
  },

  parseMarkdown: (token: MarkdownToken, h: any) => {
    const t = token as MarkdownToken & { open?: boolean; summaryTokens?: MarkdownToken[] };
    const content = t.tokens?.length ? h.parseChildren(t.tokens) : [];
    return h.createNode("details", { open: !!t.open }, [
      h.createNode("detailsSummary", null, h.parseInline(t.summaryTokens ?? [])),
      h.createNode("detailsContent", null, content.length ? content : [h.createNode("paragraph")]),
    ]);
  },

  renderMarkdown: (node: AnyNode, h: any) => {
    const [summary, content] = childrenOf(node);
    const summaryMd = summary ? h.renderChildren(childrenOf(summary)) : "";
    const contentMd = content ? h.renderChildren(childrenOf(content), "\n\n") : "";
    return `<details${node.attrs?.open ? " open" : ""}>\n<summary>${summaryMd}</summary>\n\n${contentMd}\n\n</details>`;
  },
});

export const MdDetailsSummary = DetailsSummary.extend({
  renderMarkdown: (node: AnyNode, h: any) => h.renderChildren(childrenOf(node)),
});

export const MdDetailsContent = DetailsContent.extend({
  renderMarkdown: (node: AnyNode, h: any) => h.renderChildren(childrenOf(node), "\n\n"),
});

export const MdYoutube = Youtube.extend({
  markdownTokenizer: {
    name: "youtube",
    level: "block",
    start: (src: string) => src.indexOf("@[youtube]("),
    tokenize(src: string) {
      const m = /^@\[youtube\]\(([^)\s]+)\)[ \t]*(?:\n|$)/.exec(src);
      return m ? { type: "youtube", raw: m[0], src: m[1] } : undefined;
    },
  },
  parseMarkdown: (token: MarkdownToken, h: any) => h.createNode("youtube", { src: (token as { src?: string }).src }),
  renderMarkdown: (node: AnyNode) => `@[youtube](${String(node.attrs?.src ?? "")})`,
});

export const MdTextStyle = TextStyle.extend({
  renderMarkdown: (node: AnyNode & { attrs?: { color?: string } }, h: any) => {
    const inner: string = h.renderChildren(node);
    const color = node.attrs?.color;
    return color ? `<span style="color: ${color}">${inner}</span>` : inner;
  },
});

// --- Tablo: sütun genişlikleri -------------------------------------------------------------------------

/** GFM tablosu genişlik taşımaz; kullanıcının sürükleyerek ayarladığı sütun genişlikleri tablonun önündeki görünmez
 *  bir HTML yorumunda saklanır (0: ayarlanmamış sütun). Başka Markdown araçlarında tablo olduğu gibi görünür. */
const WIDTHS_RE = /^<!--\s*nularche-table\s+widths=([\d,]+)\s*-->[ \t]*\n(?:[ \t]*\n)*/;
const base = Table.config;

/** İlk satırdaki hücrelerin sütun genişlikleri (birleştirilmiş hücreler sütun sayısınca açılır). */
function columnWidths(node: AnyNode): number[] {
  const first = childrenOf(node)[0];
  if (!first) return [];
  const out: number[] = [];
  for (const cell of childrenOf(first)) {
    const span = Number(cell.attrs?.colspan ?? 1) || 1;
    const w = cell.attrs?.colwidth as number[] | null | undefined;
    for (let i = 0; i < span; i++) out.push(Math.max(0, Math.round(w?.[i] ?? 0)));
  }
  return out;
}

export const MdTable = Table.extend({
  renderMarkdown: (node: AnyNode, h: any, ctx: any) => {
    const md: string = (base.renderMarkdown as any)(node, h, ctx);
    const widths = columnWidths(node);
    return widths.some((w) => w > 0) ? `<!-- nularche-table widths=${widths.join(",")} -->\n${md.replace(/^\n+/, "")}` : md;
  },
  markdownTokenizer: {
    name: "table",
    level: "block",
    start: (src: string) => {
      const m = /<!--\s*nularche-table\s+widths=/.exec(src);
      const plain = (base.markdownTokenizer as any).start(src);
      return m && (plain < 0 || m.index < plain) ? m.index : plain;
    },
    tokenize(src: string, tokens: MarkdownToken[], helper: MarkdownLexerConfiguration) {
      const tokenize = (base.markdownTokenizer as any).tokenize as (s: string, t: MarkdownToken[], h: MarkdownLexerConfiguration) => MarkdownToken | undefined;
      const m = WIDTHS_RE.exec(src);
      if (!m) return tokenize(src, tokens, helper);
      // Düz GFM tablosunu Markdown okuyucunun kendisi ayrıştırır; özel ayrıştırıcı yalnızca kaçışlı borulu tablolar içindir.
      const rest = src.slice(m[0].length);
      const own = tokenize(rest, tokens, helper);
      const table = own ?? (helper.blockTokens(rest.split(/\n[ \t]*\n/)[0]) as MarkdownToken[])[0];
      if (!table || table.type !== "table" || !table.raw) return undefined;
      return { ...table, raw: m[0] + table.raw, widths: m[1].split(",").map((x) => Number(x) || 0) } as MarkdownToken;
    },
  },
  parseMarkdown: (token: MarkdownToken & { widths?: number[] }, h: any) => {
    const table = (base.parseMarkdown as any)(token, h);
    const widths = token.widths;
    if (!widths?.some((w) => w > 0)) return table;
    for (const row of table.content ?? []) {
      let col = 0;
      for (const cell of row.content ?? []) {
        const span = Number(cell.attrs?.colspan ?? 1) || 1;
        const w = widths.slice(col, col + span);
        col += span;
        if (w.length === span && w.every((x) => x > 0)) cell.attrs = { ...(cell.attrs ?? {}), colwidth: w };
      }
    }
    return table;
  },
});

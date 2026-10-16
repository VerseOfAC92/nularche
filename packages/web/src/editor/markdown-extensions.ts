// Resmi Markdown desteği olmayan Shard (blok) türleri için Markdown okuma/yazma kuralları.
// Hepsi başka Markdown araçlarında da okunabilir kalacak biçimler seçildi:
//   Callout      → GitHub uyarısı:      > [!NOTE] …
//   Açılır blok  → HTML:                <details><summary>…</summary> … </details>
//   YouTube      → tek satır:            @[youtube](https://…)
//   Metin rengi  → HTML:                <span style="color: …">…</span>

import { mergeAttributes, Node, type MarkdownLexerConfiguration, type MarkdownToken } from "@tiptap/core";
import { Details, DetailsContent, DetailsSummary } from "@tiptap/extension-details";
import { TextStyle } from "@tiptap/extension-text-style";
import Youtube from "@tiptap/extension-youtube";

type AnyNode = { attrs?: Record<string, unknown>; content?: unknown };

/** Render sırasında düğüm JSON ya da ProseMirror düğümü olabilir; çocukları dizi olarak döndürür. */
function childrenOf(node: AnyNode): AnyNode[] {
  const c = node.content as { content?: AnyNode[] } | AnyNode[] | undefined;
  if (Array.isArray(c)) return c;
  return c?.content ?? [];
}

export const CALLOUT_KINDS = ["note", "tip", "important", "warning", "caution"] as const;
export type CalloutKind = (typeof CALLOUT_KINDS)[number];

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
        parseHTML: (el) => el.getAttribute("data-kind") || "note",
        renderHTML: (attrs) => ({ "data-kind": attrs.kind }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-callout]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-callout": "" }), 0];
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
      const m = /^> ?\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][^\n]*(?:\n|$)((?:>[^\n]*(?:\n|$))*)/i.exec(src);
      if (!m) return undefined;
      const inner = m[2]
        .split("\n")
        .map((line) => line.replace(/^> ?/, ""))
        .join("\n");
      return { type: "callout", raw: m[0], kind: m[1].toLowerCase(), tokens: lexer.blockTokens(inner) };
    },
  },

  parseMarkdown: (token: MarkdownToken, h: any) => {
    const content = token.tokens?.length ? h.parseChildren(token.tokens) : [];
    return h.createNode("callout", { kind: (token as { kind?: string }).kind ?? "note" }, content.length ? content : [h.createNode("paragraph")]);
  },

  renderMarkdown: (node: AnyNode, h: any) => {
    const kind = String(node.attrs?.kind ?? "note").toUpperCase();
    const body: string = h.renderChildren(childrenOf(node), "\n\n");
    return `> [!${kind}]\n${body
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

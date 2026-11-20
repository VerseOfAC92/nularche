// Atıf (`[@anahtar, s. 12; @diğer]`): editörde seçili stile göre biçimlenmiş bir çip olarak görünür, dosyada Pandoc
// sözdizimiyle düz metin kalır. Tıklayınca atıfın metni düzenlenir (sayfa, ön ek eklemek ya da silmek için).

import { InputRule, mergeAttributes, Node, type MarkdownToken } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { parseCluster } from "../../../core/src/citations.ts";
import { askText } from "../ask.tsx";
import { citeLabel, useCitations } from "../citations.ts";
import { t } from "../i18n/index.ts";


const ANCHORED = /^\[(?!\^)([^[\]\n]*?-?@[\p{L}\d_][\p{L}\d_:.#$%&+?<>~/-]*[^[\]\n]*)\](?![([])/u;

function CitationView({ node, updateAttributes, deleteNode, selected }: NodeViewProps) {
  useCitations();
  const raw = String(node.attrs.raw);
  const { text, title, missing } = citeLabel(raw);
  return (
    <NodeViewWrapper
      as="span"
      className={`cite-chip ${missing.length ? "missing" : ""} ${selected ? "selected" : ""}`}
      contentEditable={false}
      title={missing.length ? t("cite.missing", { keys: missing.join(", ") }) : title}
      data-cite={raw}
      onClick={async () => {
        const next = await askText(t("cite.edit"), raw);
        if (next === null) return;
        if (!next.trim()) return deleteNode();
        const clean = next.trim().startsWith("[") ? next.trim() : `[${next.trim()}]`;
        if (parseCluster(clean.slice(1, -1))) updateAttributes({ raw: clean });
      }}
    >
      {text}
    </NodeViewWrapper>
  );
}

export const Citation = Node.create({
  name: "citation",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { raw: { default: "[@]" } };
  },
  parseHTML() {
    return [{ tag: "span[data-cite]", getAttrs: (el) => ({ raw: (el as HTMLElement).getAttribute("data-cite") }) }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes({ "data-cite": HTMLAttributes.raw }), String(HTMLAttributes.raw)];
  },
  renderText: ({ node }) => String(node.attrs.raw),
  addNodeView() {
    return ReactNodeViewRenderer(CitationView);
  },
  addInputRules() {
    return [
      new InputRule({
        find: /(\[(?!\^)[^[\]\n]*-?@[\p{L}\d_][^[\]\n]*\])$/u,
        handler: ({ range, match, chain }) => {
          if (!parseCluster(match[1].slice(1, -1))) return null;
          chain().deleteRange(range).insertContentAt(range.from, { type: this.name, attrs: { raw: match[1] } }).run();
        },
      }),
    ];
  },
  markdownTokenizer: {
    name: "citation",
    level: "inline",
    start: (src: string) => {
      const m = /\[(?!\^)[^[\]\n]*@/.exec(src);
      return m ? m.index : -1;
    },
    tokenize(src: string) {
      const m = ANCHORED.exec(src);
      return m && parseCluster(m[1]) ? { type: "citation", raw: m[0] } : undefined;
    },
  },
  parseMarkdown: (token: MarkdownToken, h: any) => h.createNode("citation", { raw: token.raw }),
  renderMarkdown: (node: { attrs?: Record<string, unknown> }) => String(node.attrs?.raw ?? ""),
});

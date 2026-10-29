// Obsidian sözdizimi: wiki bağlantıları ve gömmeler (`[[Not]]`, `![[Not]]`), dipnot başvuruları (`[^1]`), satır içi ve
// blok matematik (`$…$`, `$$…$$`), `%%yorum%%`, Mermaid diyagramları ve blok taşıma.
// Bu yapılar ayrı editör düğümleridir ve Markdown'a okundukları gibi yazılır: düz metin olsalardı Markdown yazıcısı
// köşeli parantezleri ve ters eğik çizgileri kaçışlayıp (`\[\[Not\]\]`) dosyayı bozardı.

import { Extension, InputRule, mergeAttributes, Node, type MarkdownToken } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import katex from "katex";
import "katex/dist/katex.min.css";
import { Marked } from "marked";
import { createContext, useContext, useEffect, useState } from "react";
import { api, type NodeMeta } from "../api.ts";
import { exportableMarkdown } from "../../../core/src/note-text.ts";
import { t } from "../i18n/index.ts";
import { getPref } from "../prefs.ts";
import { fileUrl, toEditorMarkdown } from "./paths.ts";

export interface VaultHost {
  /** Wiki hedefini (başlık, dosya adı, yol ya da takma ad) nota çözer. */
  resolve: (name: string) => NodeMeta | null;
  open: (id: string) => void;
  /** Var olmayan wiki hedefi için not oluşturur ve açar. */
  create: (title: string) => void;
}

export const VaultHostContext = createContext<VaultHost | null>(null);

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    obsidian: {
      insertFootnote: () => ReturnType;
      insertMathBlock: () => ReturnType;
      toggleComment: () => ReturnType;
      moveBlock: (dir: -1 | 1) => ReturnType;
    };
  }
}

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

/** `[[hedef#başlık|ad]]` metnini parçalarına ayırır. */
export function parseWiki(raw: string): { embed: boolean; target: string; heading: string | null; alias: string | null } {
  const m = /^(!?)\[\[([^\]|#]*)(?:#([^\]|]*))?(?:\|([^\]]*))?\]\]$/.exec(raw);
  return m ? { embed: m[1] === "!", target: m[2].trim(), heading: m[3]?.trim() || null, alias: m[4]?.trim() || null } : { embed: false, target: raw, heading: null, alias: null };
}

/** Gömülen not metnini güvenli HTML'e çevirir (betikler, olay öznitelikleri ve javascript: adresleri atılır). */
/**
 * Gömmeler, tuval kartları ve sunum için ayrı Marked örneği: editörün Markdown eklentisi genel `marked` örneğine kendi
 * belirteçlerini ekler; onları burada kullanmak "Token … was not found" hatası verir. Matematik ve wiki bağlantıları da çizilir.
 */
const embedMarked = new Marked({ gfm: true });
embedMarked.use({
  extensions: [
    {
      name: "nlMathBlock",
      level: "block",
      start: (src: string) => src.indexOf("$$"),
      tokenizer(src: string) {
        const m = /^\$\$[ \t]*\n?([\s\S]+?)\n?[ \t]*\$\$[ \t]*(?:\n|$)/.exec(src);
        return m ? { type: "nlMathBlock", raw: m[0], text: m[1] } : undefined;
      },
      renderer: (tok) => `<div class="math-block">${renderTex(String(tok.text), true)}</div>`,
    },
    {
      name: "nlMath",
      level: "inline",
      start: (src: string) => src.indexOf("$"),
      tokenizer(src: string) {
        const m = /^\$(?!\$)([^$\s](?:(?:\\.|[^$\\\n])*?[^$\s\\])?)\$(?!\d)/.exec(src);
        return m ? { type: "nlMath", raw: m[0], text: m[1] } : undefined;
      },
      renderer: (tok) => renderTex(String(tok.text), false),
    },
    {
      name: "nlWiki",
      level: "inline",
      start: (src: string) => src.indexOf("[["),
      tokenizer(src: string) {
        const m = /^!?\[\[[^\]\n[]+\]\]/.exec(src);
        if (!m) return undefined;
        const w = parseWiki(m[0]);
        return { type: "nlWiki", raw: m[0], text: w.alias ?? (w.heading ? `${w.target} › ${w.heading}` : w.target) };
      },
      renderer: (tok) => `<span class="wiki-link">${String(tok.text).replace(/[<&]/g, (c) => (c === "<" ? "&lt;" : "&amp;"))}</span>`,
    },
  ],
});

export function safeHtml(md: string): string {
  // Yorumlar atılır, kutular kalın başlıklı alıntı olur (dışa aktarmadaki kuralların aynısı).
  const prepared = exportableMarkdown(md).replace(/^> \[!([\w-]+)\][+-]?[ \t]*(.*)$/gm, (_m, k: string, title: string) => `> **${title.trim() || k.toUpperCase()}**\n>`);
  const doc = new DOMParser().parseFromString(String(embedMarked.parse(prepared, { async: false })), "text/html");
  doc.querySelectorAll("script,iframe,object,embed,style,link,meta,form").forEach((el) => el.remove());
  doc.querySelectorAll("*").forEach((el) => {
    for (const a of [...el.attributes]) if (/^on/i.test(a.name) || /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
  });
  return doc.body.innerHTML;
}

/** Markdown'dan bir başlığın bölümünü (bir sonraki aynı ya da üst düzey başlığa kadar) alır. */
export function headingSection(md: string, heading: string): string | null {
  const lines = md.split("\n");
  const key = heading.trim().toLocaleLowerCase("tr");
  const start = lines.findIndex((l) => /^#{1,6}\s/.test(l) && l.replace(/^#+\s*/, "").trim().toLocaleLowerCase("tr") === key);
  if (start < 0) return null;
  const level = /^#+/.exec(lines[start])![0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^#{1,6}\s/.test(lines[i]) && /^#+/.exec(lines[i])![0].length <= level) (end = i), (i = lines.length);
  return lines.slice(start, end).join("\n");
}

// ------------------------------------------------------------------ Wiki bağlantısı ve gömme

function NoteEmbed({ note, heading }: { note: NodeMeta; heading: string | null }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api.read(note.id).then(
      (d) => {
        if (!live) return;
        if (d.locked) return setHtml(`<p>🔒 ${t("ob.embedLocked")}</p>`);
        const body = heading ? (headingSection(d.body, heading) ?? "") : d.body;
        setHtml(safeHtml(toEditorMarkdown(body, d.path)));
      },
      () => live && setHtml(""),
    );
    return () => {
      live = false;
    };
  }, [note.id, note.updatedAt, heading]);
  return <div className="wiki-embed-body" dangerouslySetInnerHTML={{ __html: html ?? "…" }} />;
}

function WikiLinkView({ node, selected }: NodeViewProps) {
  const host = useContext(VaultHostContext);
  const w = parseWiki(String(node.attrs.raw));
  const note = w.target ? (host?.resolve(w.target) ?? null) : null;
  const label = w.alias ?? (w.heading ? `${w.target}${w.target ? " › " : ""}${w.heading}` : w.target);
  const open = (e: React.MouseEvent) => {
    e.preventDefault();
    if (note) host?.open(note.id);
    else if (w.target && !IMAGE_RE.test(w.target)) host?.create(w.target);
  };
  if (w.embed) {
    const isImage = IMAGE_RE.test(w.target);
    return (
      <NodeViewWrapper as="span" className={`wiki-embed ${selected ? "selected" : ""}`} contentEditable={false}>
        {isImage ? (
          <img src={fileUrl(w.target.includes("/") ? w.target : `Attachments/${w.target}`)} alt={w.alias ?? ""} style={w.alias && /^\d+$/.test(w.alias) ? { width: Number(w.alias) } : undefined} />
        ) : note ? (
          <>
            <button className="wiki-embed-title" onClick={open}>
              ↗ {note.title}
              {w.heading ? ` › ${w.heading}` : ""}
            </button>
            <NoteEmbed note={note} heading={w.heading} />
          </>
        ) : (
          <button className="wiki-link unresolved" onClick={open}>
            {String(node.attrs.raw)}
          </button>
        )}
      </NodeViewWrapper>
    );
  }
  return (
    <NodeViewWrapper
      as="span"
      className={`wiki-link ${note ? "" : "unresolved"} ${selected ? "selected" : ""}`}
      contentEditable={false}
      onClick={open}
      data-path={note?.path}
      data-heading={w.heading ?? undefined}
      title={note ? undefined : t("ob.createNote", { title: w.target })}
    >
      {label || String(node.attrs.raw)}
    </NodeViewWrapper>
  );
}

export const WikiLink = Node.create({
  name: "wikiLink",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { raw: { default: "[[]]" } };
  },
  parseHTML() {
    return [{ tag: "span[data-wiki]", getAttrs: (el) => ({ raw: (el as HTMLElement).getAttribute("data-wiki") }) }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes({ "data-wiki": HTMLAttributes.raw }), String(HTMLAttributes.raw)];
  },
  renderText: ({ node }) => String(node.attrs.raw),
  addNodeView() {
    return ReactNodeViewRenderer(WikiLinkView);
  },
  addInputRules() {
    return [
      new InputRule({
        find: /(!?\[\[[^\]\n[]+\]\])$/,
        handler: ({ range, match, chain }) => {
          chain().deleteRange(range).insertContentAt(range.from, { type: this.name, attrs: { raw: match[1] } }).run();
        },
      }),
    ];
  },
  markdownTokenizer: {
    name: "wikiLink",
    level: "inline",
    start: (src: string) => {
      const i = src.indexOf("[[");
      return i > 0 && src[i - 1] === "!" ? i - 1 : i;
    },
    tokenize(src: string) {
      const m = /^!?\[\[[^\]\n[]+\]\]/.exec(src);
      return m ? { type: "wikiLink", raw: m[0] } : undefined;
    },
  },
  parseMarkdown: (token: MarkdownToken, h: any) => h.createNode("wikiLink", { raw: token.raw }),
  renderMarkdown: (node: { attrs?: Record<string, unknown> }) => String(node.attrs?.raw ?? ""),
});

// ------------------------------------------------------------------ Dipnot başvurusu

function FootnoteView({ node, editor }: NodeViewProps) {
  const id = String(node.attrs.id);
  // Tanım: `[^id]:` ile başlayan paragrafın geri kalanı.
  let def = "";
  editor.state.doc.descendants((n) => {
    if (def) return false;
    if (n.type.name === "footnoteDef" && n.attrs.id === id) def = n.textContent.trim();
    return !n.isTextblock;
  });
  return (
    <NodeViewWrapper as="sup" className="footnote-ref" contentEditable={false} title={def || `[^${id}]`}>
      [{id}]
    </NodeViewWrapper>
  );
}

export const FootnoteRef = Node.create({
  name: "footnoteRef",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return { id: { default: "1" } };
  },
  parseHTML() {
    return [{ tag: "sup[data-footnote]", getAttrs: (el) => ({ id: (el as HTMLElement).getAttribute("data-footnote") }) }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["sup", { "data-footnote": HTMLAttributes.id }, `[${String(HTMLAttributes.id)}]`];
  },
  renderText: ({ node }) => `[^${String(node.attrs.id)}]`,
  addNodeView() {
    return ReactNodeViewRenderer(FootnoteView);
  },
  addCommands() {
    return {
      insertFootnote:
        () =>
        ({ state, chain }) => {
          let max = 0;
          state.doc.descendants((n) => {
            if (n.type.name === "footnoteRef") max = Math.max(max, Number(n.attrs.id) || 0);
          });
          const id = String(max + 1);
          const end = state.doc.content.size;
          return chain()
            .insertContent({ type: this.name, attrs: { id } })
            .insertContentAt(end, { type: "footnoteDef", attrs: { id } })
            .focus("end")
            .run();
        },
    };
  },
  markdownTokenizer: {
    name: "footnoteRef",
    level: "inline",
    start: (src: string) => src.indexOf("[^"),
    tokenize(src: string) {
      const m = /^\[\^([^\]\s]+)\]/.exec(src);
      return m ? { type: "footnoteRef", raw: m[0], id: m[1] } : undefined;
    },
  },
  parseMarkdown: (token: MarkdownToken, h: any) => h.createNode("footnoteRef", { id: (token as { id?: string }).id }),
  renderMarkdown: (node: { attrs?: Record<string, unknown> }) => `[^${String(node.attrs?.id ?? "")}]`,
});

/**
 * Dipnot tanımı `[^1]: metin`. Ayrı blok olarak okunur: tek kelimelik tanım (`[^1]: açıklama`) Markdown'da bağlantı
 * tanımı sözdizimine de uyar; düz paragraf olsaydı ayrıştırıcı onu bağlantı tanımı sayıp metni düşürürdü.
 */
export const FootnoteDef = Node.create({
  name: "footnoteDef",
  group: "block",
  content: "inline*",
  defining: true,
  addAttributes() {
    return { id: { default: "1" } };
  },
  parseHTML() {
    return [{ tag: "p[data-footnote-def]", getAttrs: (el) => ({ id: (el as HTMLElement).getAttribute("data-footnote-def") }) }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["p", { "data-footnote-def": HTMLAttributes.id, class: "footnote-def" }, 0];
  },
  markdownTokenizer: {
    name: "footnoteDef",
    level: "block",
    start: (src: string) => src.search(/^\[\^[^\]\s]+\]:/m),
    tokenize(src: string, _tokens: MarkdownToken[], lexer: any) {
      const m = /^\[\^([^\]\s]+)\]:[ \t]*([^\n]*(?:\n(?![ \t]*\n|\[\^)[^\n]+)*)(?:\n|$)/.exec(src);
      return m ? { type: "footnoteDef", raw: m[0], id: m[1], tokens: lexer.inlineTokens(m[2]) } : undefined;
    },
  },
  parseMarkdown: (token: MarkdownToken, h: any) => h.createNode("footnoteDef", { id: (token as { id?: string }).id }, token.tokens?.length ? h.parseInline(token.tokens) : []),
  renderMarkdown: (node: any, h: any) => `[^${String(node.attrs?.id ?? "")}]: ${h.renderChildren(node.content?.content ?? node.content ?? [])}`,
});

// ------------------------------------------------------------------ Matematik (KaTeX)

function renderTex(latex: string, display: boolean): string {
  try {
    return katex.renderToString(latex, { displayMode: display, throwOnError: false, output: "html" });
  } catch {
    return latex;
  }
}

function MathView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const display = node.type.name === "mathBlock";
  const latex = String(node.attrs.latex);
  const [draft, setDraft] = useState(latex);
  useEffect(() => setDraft(latex), [latex]);
  const editing = selected && editor.isEditable;
  const Tag = display ? "div" : "span";
  return (
    <NodeViewWrapper as={Tag} className={`math-${display ? "block" : "inline"} ${selected ? "selected" : ""}`}>
      <Tag className="math-render" contentEditable={false} dangerouslySetInnerHTML={{ __html: renderTex(latex || "\\square", display) }} />
      {editing &&
        (display ? (
          <textarea className="math-input" autoFocus value={draft} rows={Math.max(2, draft.split("\n").length)} onChange={(e) => (setDraft(e.target.value), updateAttributes({ latex: e.target.value }))} />
        ) : (
          <input className="math-input" autoFocus value={draft} onChange={(e) => (setDraft(e.target.value), updateAttributes({ latex: e.target.value }))} />
        ))}
    </NodeViewWrapper>
  );
}

const mathView = () => ReactNodeViewRenderer(MathView, { stopEvent: ({ event }) => (event.target as HTMLElement).classList?.contains("math-input") });

export const MathInline = Node.create({
  name: "mathInline",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return { latex: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "span[data-math]", getAttrs: (el) => ({ latex: (el as HTMLElement).getAttribute("data-math") }) }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", { "data-math": HTMLAttributes.latex }, `$${String(HTMLAttributes.latex)}$`];
  },
  renderText: ({ node }) => `$${String(node.attrs.latex)}$`,
  addNodeView: mathView,
  addInputRules() {
    return [
      new InputRule({
        // Para birimiyle karışmasın: `$`'dan sonra ve kapanıştan önce boşluk olmaz, kapanıştan sonra rakam gelmez.
        find: /(?:^|[^\\$\w])\$([^$\s](?:[^$\n]*[^$\s\\])?)\$$/,
        handler: ({ range, match, chain }) => {
          const start = range.to - match[1].length - 2;
          chain().deleteRange({ from: start, to: range.to }).insertContentAt(start, { type: this.name, attrs: { latex: match[1] } }).run();
        },
      }),
    ];
  },
  markdownTokenizer: {
    name: "mathInline",
    level: "inline",
    start: (src: string) => src.indexOf("$"),
    tokenize(src: string) {
      const m = /^\$(?!\$)([^$\s](?:(?:\\.|[^$\\\n])*?[^$\s\\])?)\$(?!\d)/.exec(src);
      return m ? { type: "mathInline", raw: m[0], latex: m[1] } : undefined;
    },
  },
  parseMarkdown: (token: MarkdownToken, h: any) => h.createNode("mathInline", { latex: (token as { latex?: string }).latex }),
  renderMarkdown: (node: { attrs?: Record<string, unknown> }) => `$${String(node.attrs?.latex ?? "")}$`,
});

export const MathBlock = Node.create({
  name: "mathBlock",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { latex: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "div[data-math-block]", getAttrs: (el) => ({ latex: (el as HTMLElement).getAttribute("data-math-block") }) }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", { "data-math-block": HTMLAttributes.latex }, `$$${String(HTMLAttributes.latex)}$$`];
  },
  addNodeView: mathView,
  addCommands() {
    return {
      insertMathBlock:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { latex: "" } }),
    };
  },
  markdownTokenizer: {
    name: "mathBlock",
    level: "block",
    start: (src: string) => src.indexOf("$$"),
    tokenize(src: string) {
      const m = /^\$\$[ \t]*\n?([\s\S]+?)\n?[ \t]*\$\$[ \t]*(?:\n|$)/.exec(src);
      return m ? { type: "mathBlock", raw: m[0], latex: m[1] } : undefined;
    },
  },
  parseMarkdown: (token: MarkdownToken, h: any) => h.createNode("mathBlock", { latex: (token as { latex?: string }).latex }),
  renderMarkdown: (node: { attrs?: Record<string, unknown> }) => `$$\n${String(node.attrs?.latex ?? "")}\n$$`,
});

// ------------------------------------------------------------------ %%Yorum%%, Mermaid ve blok taşıma

const decoKey = new PluginKey<DecorationSet>("nlObsidianDeco");

let mermaidSeq = 0;
/** Mermaid kod bloğunun altına çizilen diyagram (kitaplık ilk kullanımda yüklenir). */
function mermaidWidget(code: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "mermaid-render";
  el.contentEditable = "false";
  el.textContent = "…";
  void import("mermaid").then(async ({ default: mermaid }) => {
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: document.documentElement.dataset.theme === "light" ? "default" : "dark" });
    try {
      const { svg } = await mermaid.render(`nl-mermaid-${++mermaidSeq}`, code);
      el.innerHTML = svg;
    } catch (e) {
      el.textContent = `Mermaid: ${(e as Error).message ?? e}`;
      el.classList.add("error");
    }
  });
  return el;
}

function obsidianDecorations(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "codeBlock") {
      if (String(node.attrs.language).toLowerCase() === "mermaid") {
        const code = node.textContent;
        decos.push(Decoration.widget(pos + node.nodeSize, () => mermaidWidget(code), { side: -1, key: `mermaid:${code}` }));
      }
      return false;
    }
    if (!node.isText) return true;
    const text = node.text ?? "";
    for (const m of text.matchAll(/%%[\s\S]*?%%/g)) decos.push(Decoration.inline(pos + m.index!, pos + m.index! + m[0].length, { class: "nl-comment" }));
    return false;
  });
  return DecorationSet.create(doc, decos);
}

/** Seçimin bulunduğu liste öğesini ya da üst düzey bloğu bir önceki/sonraki kardeşiyle yer değiştirir. */
function moveBlock(state: EditorState, dir: -1 | 1) {
  const $from = state.selection.$from;
  let depth = $from.depth;
  while (depth > 1 && $from.node(depth).type.name !== "listItem" && $from.node(depth).type.name !== "taskItem") depth--;
  if (depth < 1) return null;
  const parent = $from.node(depth - 1);
  const index = $from.index(depth - 1);
  const target = index + dir;
  if (target < 0 || target >= parent.childCount) return null;
  const start = $from.before(depth);
  const node = $from.node(depth);
  const other = parent.child(target);
  const tr = state.tr;
  if (dir === -1) {
    const otherStart = start - other.nodeSize;
    tr.replaceWith(otherStart, start + node.nodeSize, [node, other]);
    tr.setSelection(TextSelection.create(tr.doc, state.selection.from - other.nodeSize, state.selection.to - other.nodeSize));
  } else {
    tr.replaceWith(start, start + node.nodeSize + other.nodeSize, [other, node]);
    tr.setSelection(TextSelection.create(tr.doc, state.selection.from + other.nodeSize, state.selection.to + other.nodeSize));
  }
  return tr.scrollIntoView();
}

export const ObsidianTools = Extension.create({
  name: "obsidianTools",
  addCommands() {
    return {
      toggleComment:
        () =>
        ({ state, chain }) => {
          const { from, to, empty } = state.selection;
          const text = state.doc.textBetween(from, to, "\n");
          if (!empty && /^%%[\s\S]*%%$/.test(text)) return chain().insertContentAt({ from, to }, text.slice(2, -2)).run();
          return chain().insertContentAt({ from, to }, `%%${text}%%`).setTextSelection(empty ? from + 2 : to + 4).run();
        },
      moveBlock:
        (dir) =>
        ({ state, dispatch }) => {
          const tr = moveBlock(state, dir);
          if (!tr) return false;
          dispatch?.(tr);
          return true;
        },
    };
  },
  addKeyboardShortcuts() {
    return {
      "Alt-ArrowUp": () => this.editor.commands.moveBlock(-1),
      "Alt-ArrowDown": () => this.editor.commands.moveBlock(1),
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: decoKey,
        state: {
          init: (_c, state) => obsidianDecorations(state.doc),
          apply: (tr, old) => (tr.docChanged ? obsidianDecorations(tr.doc) : old),
        },
        props: { decorations: (state) => decoKey.getState(state) },
      }),
      // Parantez ve tırnakları kapatma (Obsidian "Auto-pair"; Ayarlar'dan açılır). Seçim varsa sarar; aynı kapanış
      // karakteri imleçten sonra zaten varsa üzerinden geçer.
      new Plugin({
        props: {
          handleTextInput(view, from, to, text) {
            if (!getPref<boolean>("autoPair", false) || text.length !== 1 || view.state.selection.$from.parent.type.spec.code) return false;
            const close = PAIRS[text];
            const next = view.state.doc.textBetween(to, Math.min(to + 1, view.state.doc.content.size), "");
            if (Object.values(PAIRS).includes(text) && from === to && next === text && !close) {
              view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, to + 1)));
              return true;
            }
            if (!close) return false;
            if (from === to && next === text && text === close) {
              view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, to + 1)));
              return true;
            }
            const selected = view.state.doc.textBetween(from, to, "");
            const tr = view.state.tr.insertText(`${text}${selected}${close}`, from, to);
            view.dispatch(tr.setSelection(TextSelection.create(tr.doc, from + 1, from + 1 + selected.length)));
            return true;
          },
        },
      }),
    ];
  },
});

const PAIRS: Record<string, string> = { "(": ")", "[": "]", "{": "}", '"': '"', "“": "”" };

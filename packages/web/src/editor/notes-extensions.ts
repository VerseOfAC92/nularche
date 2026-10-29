// v1.5 editör uzantıları (Apple Notlar ve Writer özellikleri). Markdown'da karşılığı olmayan biçimler, başka araçlarda da
// okunabilen HTML ile saklanır:
//   Hizalama / yön / girinti → <div align="center" dir="rtl" data-indent="1"> … </div>   (GitHub da hizalamayı gösterir)
//   Üs / indis               → <sup>…</sup>, <sub>…</sub>
//   Tire işaretli liste      → "+ " işaretli madde listesi (CommonMark)
// Etiket vurgusu, bölüm daraltma, bul-değiştir ve matematik sonuçları yalnızca görünümdür (dosyaya yazılmaz).

import { Extension, Mark, mergeAttributes, type Editor, type MarkdownLexerConfiguration, type MarkdownToken } from "@tiptap/core";
import { Heading } from "@tiptap/extension-heading";
import { BulletList } from "@tiptap/extension-list";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { TAG_RE } from "../../../core/src/note-text.ts";
import { lineResult, readAssignment, type Vars } from "./math.ts";

type AnyNode = { attrs?: Record<string, unknown>; content?: unknown; type?: string };
type Align = "left" | "center" | "right" | "justify";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    blockStyle: {
      setTextAlign: (align: Align) => ReturnType;
      setTextDirection: (dir: "ltr" | "rtl") => ReturnType;
      indentBlock: () => ReturnType;
      outdentBlock: () => ReturnType;
    };
    superscript: { toggleSuperscript: () => ReturnType };
    subscript: { toggleSubscript: () => ReturnType };
    dashedList: { toggleDashedList: () => ReturnType };
  }
}

// ------------------------------------------------------------------ Blok biçimi: hizalama, yön, girinti

const STYLED = ["paragraph", "heading"];
const MAX_INDENT = 8;

/** Bloğun biçim özniteliklerini sarmalayıcı <div>'e çevirir; biçim yoksa içeriği olduğu gibi döndürür. */
function wrapStyled(attrs: Record<string, unknown> | undefined, inner: string, parentType?: string): string {
  if (!attrs || !inner || (parentType && /table|listItem|taskItem/.test(parentType))) return inner;
  const parts: string[] = [];
  if (attrs.textAlign && attrs.textAlign !== "left") parts.push(`align="${attrs.textAlign}"`);
  if (attrs.dir === "rtl") parts.push('dir="rtl"');
  if (Number(attrs.indent) > 0) parts.push(`data-indent="${Number(attrs.indent)}"`);
  return parts.length ? `<div ${parts.join(" ")}>\n\n${inner}\n\n</div>` : inner;
}

export const BlockStyle = Extension.create({
  name: "blockStyle",

  addGlobalAttributes() {
    return [
      {
        types: STYLED,
        attributes: {
          textAlign: {
            default: null,
            parseHTML: (el) => {
              const v = (el.style.textAlign || el.getAttribute("align") || "").toLowerCase();
              return ["center", "right", "justify"].includes(v) ? v : null;
            },
            renderHTML: (a) => (a.textAlign ? { style: `text-align: ${a.textAlign}` } : {}),
          },
          dir: {
            default: null,
            parseHTML: (el) => (el.getAttribute("dir") === "rtl" ? "rtl" : null),
            renderHTML: (a) => (a.dir ? { dir: a.dir } : {}),
          },
          indent: {
            default: 0,
            parseHTML: (el) => Math.min(MAX_INDENT, Number(el.getAttribute("data-indent")) || 0),
            renderHTML: (a) => (a.indent ? { "data-indent": a.indent, style: `margin-inline-start: ${a.indent * 2}em` } : {}),
          },
        },
      },
    ];
  },

  addCommands() {
    const update =
      (fn: (attrs: Record<string, unknown>) => Record<string, unknown>) =>
      ({ tr, state, dispatch }: { tr: Transaction; state: EditorState; dispatch?: (tr: Transaction) => void }) => {
        const { from, to } = state.selection;
        let changed = false;
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (!STYLED.includes(node.type.name)) return true;
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...fn(node.attrs) });
          changed = true;
          return false;
        });
        if (changed && dispatch) dispatch(tr);
        return changed;
      };
    return {
      setTextAlign: (align) => update(() => ({ textAlign: align === "left" ? null : align })),
      setTextDirection: (dir) => update(() => ({ dir: dir === "rtl" ? "rtl" : null })),
      indentBlock:
        () =>
        ({ editor, commands }) =>
          editor.isActive("listItem") ? commands.sinkListItem("listItem") : editor.isActive("taskItem") ? commands.sinkListItem("taskItem") : commands.command(update((a) => ({ indent: Math.min(MAX_INDENT, Number(a.indent ?? 0) + 1) }))),
      outdentBlock:
        () =>
        ({ editor, commands }) =>
          editor.isActive("listItem") ? commands.liftListItem("listItem") : editor.isActive("taskItem") ? commands.liftListItem("taskItem") : commands.command(update((a) => ({ indent: Math.max(0, Number(a.indent ?? 0) - 1) }))),
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Shift-l": () => this.editor.commands.setTextAlign("left"),
      "Mod-Shift-e": () => this.editor.commands.setTextAlign("center"),
      "Mod-Shift-r": () => this.editor.commands.setTextAlign("right"),
      "Mod-Shift-j": () => this.editor.commands.setTextAlign("justify"),
      "Mod-]": () => this.editor.commands.indentBlock(),
      "Mod-[": () => this.editor.commands.outdentBlock(),
    };
  },

  markdownTokenName: "styledBlock",
  markdownTokenizer: {
    name: "styledBlock",
    level: "block",
    start: (src: string) => src.indexOf("<div "),
    tokenize(src: string, _tokens: MarkdownToken[], lexer: MarkdownLexerConfiguration) {
      const m = /^<div((?:\s+(?:align|dir|data-indent)="[^"]*")+)\s*>\n\n([\s\S]*?)\n\n<\/div>[ \t]*(?:\n|$)/.exec(src);
      if (!m || m[2].includes("<div")) return undefined;
      const attr = (name: string) => new RegExp(`${name}="([^"]*)"`).exec(m[1])?.[1];
      return { type: "styledBlock", raw: m[0], align: attr("align"), dir: attr("dir"), indent: attr("data-indent"), tokens: lexer.blockTokens(m[2]) };
    },
  },
  parseMarkdown: (token: MarkdownToken, h: any) => {
    const t = token as MarkdownToken & { align?: string; dir?: string; indent?: string };
    const nodes: AnyNode[] = h.parseChildren(t.tokens ?? []);
    const align = ["center", "right", "justify"].includes(String(t.align)) ? t.align : null;
    return nodes.map((n) =>
      n.type && STYLED.includes(n.type)
        ? { ...n, attrs: { ...(n.attrs ?? {}), textAlign: align, dir: t.dir === "rtl" ? "rtl" : null, indent: Math.min(MAX_INDENT, Number(t.indent) || 0) } }
        : n,
    );
  },
});

type Parent = { parent?: (...a: any[]) => any };

export const MdParagraph = Paragraph.extend({
  renderMarkdown(this: Parent, node: any, h: any, ctx?: any) {
    return wrapStyled(node.attrs, this.parent?.(node, h, ctx) ?? "", ctx?.parentType);
  },
});

export const MdHeading = Heading.extend({
  renderMarkdown(this: Parent, node: any, h: any, ctx?: any) {
    return wrapStyled(node.attrs, this.parent?.(node, h, ctx) ?? "", ctx?.parentType);
  },
});

// ------------------------------------------------------------------ Üs ve indis

function scriptMark(name: "superscript" | "subscript", tag: "sup" | "sub", other: string, key: string) {
  return Mark.create({
    name,
    excludes: other,
    parseHTML: () => [{ tag }, { style: `vertical-align=${name === "superscript" ? "super" : "sub"}` }],
    renderHTML: ({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) => [tag, mergeAttributes(HTMLAttributes), 0],
    addCommands() {
      return {
        [`toggle${name[0].toUpperCase()}${name.slice(1)}`]:
          () =>
          ({ commands }: { commands: { toggleMark: (n: string) => boolean } }) =>
            commands.toggleMark(name),
      } as never;
    },
    addKeyboardShortcuts() {
      return { [key]: () => this.editor.commands.toggleMark(name) };
    },
    renderMarkdown: (node: any, h: any) => `<${tag}>${h.renderChildren(node)}</${tag}>`,
  });
}

export const Superscript = scriptMark("superscript", "sup", "subscript", "Mod-Shift-.");
export const Subscript = scriptMark("subscript", "sub", "superscript", "Mod-Shift-,");

// ------------------------------------------------------------------ Tire işaretli liste

export const DashedBulletList = BulletList.extend({
  addAttributes() {
    return {
      dashed: {
        default: false,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-dashed") === "true",
        renderHTML: (a: Record<string, unknown>) => (a.dashed ? { "data-dashed": "true" } : {}),
      },
    };
  },
  addCommands() {
    return {
      ...this.parent?.(),
      toggleDashedList:
        () =>
        ({ editor, chain }: { editor: Editor; chain: () => any }) => {
          if (editor.isActive("bulletList", { dashed: true })) return chain().toggleBulletList().run();
          if (editor.isActive("bulletList")) return chain().updateAttributes("bulletList", { dashed: true }).run();
          return chain().toggleBulletList().updateAttributes("bulletList", { dashed: true }).run();
        },
    };
  },
  addKeyboardShortcuts() {
    return { ...this.parent?.(), "Mod-Shift-6": () => this.editor.commands.toggleDashedList() };
  },
  parseMarkdown(this: Parent, token: any, h: any): any {
    const r = this.parent?.(token, h);
    if (r && !Array.isArray(r) && String(token.raw ?? "").trimStart().startsWith("+")) return { ...r, attrs: { ...(r.attrs ?? {}), dashed: true } };
    return r ?? [];
  },
  renderMarkdown(this: Parent, node: any, h: any, ctx: any) {
    const out: string = this.parent?.(node, h, ctx) ?? "";
    return node.attrs?.dashed ? out.replace(/^- /gm, "+ ") : out;
  },
});

// ------------------------------------------------------------------ #etiket vurgusu

const tagKey = new PluginKey("nlTags");

function tagDecorations(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos, parent) => {
    if (!node.isText || parent?.type.spec.code || node.marks.some((m) => m.type.name === "code" || m.type.name === "link")) return;
    for (const m of node.text!.matchAll(TAG_RE)) {
      const name = m[2].replace(/[/-]+$/, "");
      if (!/\p{L}/u.test(name)) continue;
      const from = pos + m.index! + m[1].length;
      decos.push(Decoration.inline(from, from + name.length + 1, { class: "nl-tag", "data-tag": name }));
    }
  });
  return DecorationSet.create(doc, decos);
}

export const TagHighlight = Extension.create({
  name: "tagHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: tagKey,
        state: {
          init: (_c, state) => tagDecorations(state.doc),
          apply: (tr, old) => (tr.docChanged ? tagDecorations(tr.doc) : old),
        },
        props: { decorations: (state) => tagKey.getState(state) },
      }),
    ];
  },
});

// ------------------------------------------------------------------ Bölümleri daralt (başlık altındaki içerik)

export const foldKey = new PluginKey<{ folded: number[] }>("nlFold");
type FoldMeta = { toggle?: number; set?: number[] };

/** Üst düzeydeki başlıkların konumları ve düzeyleri. */
export function headings(doc: PMNode): { pos: number; level: number; text: string }[] {
  const out: { pos: number; level: number; text: string }[] = [];
  doc.forEach((node, pos) => {
    if (node.type.name === "heading") out.push({ pos, level: Number(node.attrs.level), text: node.textContent });
  });
  return out;
}

function foldDecorations(state: EditorState, folded: number[]): DecorationSet {
  const decos: Decoration[] = [];
  const set = new Set(folded);
  let hideUntil: number | null = null; // açık bir daraltmanın düzeyi
  state.doc.forEach((node, pos) => {
    const isHeading = node.type.name === "heading";
    const level = isHeading ? Number(node.attrs.level) : 99;
    if (hideUntil !== null && level <= hideUntil) hideUntil = null;
    if (hideUntil !== null) {
      decos.push(Decoration.node(pos, pos + node.nodeSize, { class: "nl-folded" }));
      return;
    }
    if (!isHeading) return;
    const isFolded = set.has(pos);
    decos.push(
      Decoration.widget(
        pos + 1,
        (view: EditorView) => {
          const btn = document.createElement("span");
          btn.className = `nl-fold-toggle${isFolded ? " folded" : ""}`;
          btn.contentEditable = "false";
          btn.textContent = isFolded ? "▸" : "▾";
          btn.addEventListener("mousedown", (e) => {
            e.preventDefault();
            view.dispatch(view.state.tr.setMeta(foldKey, { toggle: pos } satisfies FoldMeta));
          });
          return btn;
        },
        { side: -1, key: `fold-${pos}-${isFolded}`, ignoreSelection: true },
      ),
    );
    if (isFolded) {
      decos.push(Decoration.node(pos, pos + node.nodeSize, { class: "nl-heading-folded" }));
      hideUntil = level;
    }
  });
  return DecorationSet.create(state.doc, decos);
}

export const HeadingFold = Extension.create({
  name: "headingFold",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: foldKey,
        state: {
          init: () => ({ folded: [] as number[] }),
          apply: (tr, value) => {
            const meta = tr.getMeta(foldKey) as FoldMeta | undefined;
            let folded = value.folded;
            if (tr.docChanged) folded = folded.map((p) => tr.mapping.mapResult(p)).filter((r) => !r.deleted).map((r) => r.pos);
            if (meta?.set) folded = meta.set;
            if (meta?.toggle !== undefined) folded = folded.includes(meta.toggle) ? folded.filter((p) => p !== meta.toggle) : [...folded, meta.toggle];
            return folded === value.folded ? value : { folded: folded.filter((p) => tr.doc.nodeAt(p)?.type.name === "heading") };
          },
        },
        props: { decorations: (state) => foldDecorations(state, foldKey.getState(state)!.folded) },
        // İmleç gizli bir bloğa girerse bölümü aç.
        appendTransaction: (_trs, _old, state) => {
          const folded = foldKey.getState(state)!.folded;
          if (!folded.length) return null;
          const $pos = state.selection.$from;
          if ($pos.depth < 1) return null;
          const top = $pos.before(1);
          const owner = headings(state.doc)
            .filter((h) => h.pos < top)
            .reverse();
          let level = 99;
          for (const h of owner) {
            if (h.level >= level) continue;
            level = h.level;
            if (folded.includes(h.pos)) return state.tr.setMeta(foldKey, { set: folded.filter((p) => p !== h.pos) } satisfies FoldMeta);
          }
          return null;
        },
      }),
    ];
  },
});

export function setFolded(editor: Editor, positions: number[]): void {
  editor.view.dispatch(editor.state.tr.setMeta(foldKey, { set: positions } satisfies FoldMeta));
}

// ------------------------------------------------------------------ Bul ve değiştir

export interface FindState {
  query: string;
  caseSensitive: boolean;
  /** ç=c, ş=s… gibi Türkçe harfleri eşit say. */
  ignoreAccents: boolean;
  matches: { from: number; to: number }[];
  index: number;
}

export const findKey = new PluginKey<FindState>("nlFind");
const ACCENTS: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u", é: "e", è: "e", á: "a", à: "a" };

function foldChar(c: string, s: FindState): string {
  let x = c;
  if (!s.caseSensitive) {
    const l = c.toLocaleLowerCase("tr");
    x = l.length === 1 ? l : c.toLowerCase().slice(0, 1);
  }
  if (s.ignoreAccents) {
    const lower = x.toLocaleLowerCase("tr");
    const base = ACCENTS[lower];
    if (base) x = x === lower ? base : base.toUpperCase();
  }
  return x;
}

function findMatches(doc: PMNode, s: FindState): { from: number; to: number }[] {
  if (!s.query) return [];
  const needle = [...s.query].map((c) => foldChar(c, s)).join("");
  const out: { from: number; to: number }[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = "";
    const map: number[] = [];
    node.forEach((child, offset) => {
      if (child.isText) {
        for (let i = 0; i < child.text!.length; i++) {
          text += foldChar(child.text![i], s);
          map.push(pos + 1 + offset + i);
        }
      } else {
        text += "￼";
        map.push(pos + 1 + offset);
      }
    });
    for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + Math.max(1, needle.length))) {
      out.push({ from: map[i], to: map[i + needle.length - 1] + 1 });
    }
    return false;
  });
  return out;
}

export const FindReplace = Extension.create({
  name: "findReplace",
  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: findKey,
        state: {
          init: () => ({ query: "", caseSensitive: false, ignoreAccents: false, matches: [], index: 0 }),
          apply: (tr, prev) => {
            const meta = tr.getMeta(findKey) as Partial<FindState> | undefined;
            if (!meta && !tr.docChanged) return prev;
            const next = { ...prev, ...meta };
            next.matches = findMatches(tr.doc, next);
            next.index = next.matches.length ? Math.min(Math.max(0, next.index), next.matches.length - 1) : 0;
            return next;
          },
        },
        props: {
          decorations(state) {
            const s = findKey.getState(state)!;
            if (!s.matches.length) return null;
            return DecorationSet.create(
              state.doc,
              s.matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === s.index ? "nl-find nl-find-current" : "nl-find" })),
            );
          },
        },
      }),
    ];
  },
});

export function setFind(editor: Editor, patch: Partial<FindState>, reveal = true): FindState {
  editor.view.dispatch(editor.state.tr.setMeta(findKey, patch));
  const s = findKey.getState(editor.state)!;
  const m = s.matches[s.index];
  if (reveal && m) {
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, m.from, m.to)).scrollIntoView());
  }
  return findKey.getState(editor.state)!;
}

export function replaceMatches(editor: Editor, replacement: string, all: boolean): number {
  const s = findKey.getState(editor.state)!;
  const targets = all ? s.matches : s.matches.slice(s.index, s.index + 1);
  if (!targets.length) return 0;
  const tr = editor.state.tr;
  for (const m of [...targets].reverse()) {
    if (replacement) tr.insertText(replacement, m.from, m.to);
    else tr.delete(m.from, m.to);
  }
  editor.view.dispatch(tr);
  return targets.length;
}

// ------------------------------------------------------------------ Yapılacak listesi araçları

/** İşlenecek yapılacak listeleri: imleç bir listedeyse o liste, değilse belgedeki tüm listeler. */
function targetTaskLists(state: EditorState): { pos: number; node: PMNode }[] {
  const $from = state.selection.$from;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === "taskList") return [{ pos: $from.before(d), node }];
  }
  const out: { pos: number; node: PMNode }[] = [];
  state.doc.descendants((node, pos) => {
    if (node.type.name === "taskList") {
      out.push({ pos, node });
      return false;
    }
    return true;
  });
  return out;
}

function rebuildLists(editor: Editor, lists: { pos: number; node: PMNode }[], pick: (items: PMNode[]) => PMNode[]): boolean {
  const { state } = editor;
  const tr = state.tr;
  let changed = false;
  for (const { pos, node } of [...lists].reverse()) {
    const items: PMNode[] = [];
    node.forEach((c) => items.push(c));
    const next = pick(items);
    if (next.length === items.length && next.every((n, i) => n === items[i])) continue;
    changed = true;
    tr.replaceWith(pos, pos + node.nodeSize, next.length ? node.type.create(node.attrs, next) : state.schema.nodes.paragraph.create());
  }
  if (changed) editor.view.dispatch(tr);
  return changed;
}

export function setAllTasks(editor: Editor, checked: boolean): boolean {
  const tr = editor.state.tr;
  let changed = false;
  for (const { pos, node } of targetTaskLists(editor.state)) {
    node.descendants((child, offset) => {
      if (child.type.name === "taskItem" && child.attrs.checked !== checked) {
        tr.setNodeMarkup(pos + 1 + offset, undefined, { ...child.attrs, checked });
        changed = true;
      }
    });
  }
  if (changed) editor.view.dispatch(tr);
  return changed;
}

export const deleteCheckedTasks = (editor: Editor) => rebuildLists(editor, targetTaskLists(editor.state), (items) => items.filter((i) => !i.attrs.checked));

export const moveCheckedToBottom = (editor: Editor) =>
  rebuildLists(editor, targetTaskLists(editor.state), (items) => [...items.filter((i) => !i.attrs.checked), ...items.filter((i) => i.attrs.checked)]);

function countChecked(doc: PMNode): number {
  let n = 0;
  doc.descendants((node) => {
    if (node.type.name === "taskItem" && node.attrs.checked) n++;
  });
  return n;
}

/** Sayfada "işaretlileri en alta taşı" açıksa, bir öğe işaretlendiğinde listesi yeniden sıralanır. */
export const TaskTools = Extension.create<Record<string, never>, { sortChecked: boolean }>({
  name: "taskTools",
  addStorage: () => ({ sortChecked: false }),
  addProseMirrorPlugins() {
    const storage = this.storage;
    return [
      new Plugin({
        appendTransaction: (trs, oldState, newState) => {
          if (!storage.sortChecked || !trs.some((t) => t.docChanged) || countChecked(newState.doc) <= countChecked(oldState.doc)) return null;
          const tr = newState.tr;
          let changed = false;
          const lists: { pos: number; node: PMNode }[] = [];
          newState.doc.descendants((node, pos) => {
            if (node.type.name === "taskList") lists.push({ pos, node });
          });
          for (const { pos, node } of lists.reverse()) {
            const items: PMNode[] = [];
            node.forEach((c) => items.push(c));
            const sorted = [...items.filter((i) => !i.attrs.checked), ...items.filter((i) => i.attrs.checked)];
            if (sorted.every((n, i) => n === items[i])) continue;
            tr.replaceWith(pos, pos + node.nodeSize, node.type.create(node.attrs, sorted));
            changed = true;
          }
          return changed ? tr : null;
        },
      }),
    ];
  },
});

// ------------------------------------------------------------------ Matematik sonuçları

export type MathMode = "off" | "suggest" | "insert";
const mathKey = new PluginKey("nlMath");

/** Belgedeki değişken tanımları (`ad = ifade`), `upto` konumundan önceki satırlardan. */
function collectVars(doc: PMNode, upto: number): Vars {
  const vars: Vars = new Map();
  doc.descendants((node, pos) => {
    if (pos >= upto) return false;
    if (!node.isTextblock) return true;
    if (node.type.name !== "codeBlock") {
      // Satır sonları (yumuşak ya da <br>) ayrı satır sayılır; yalnızca `upto` öncesindeki satırlar okunur.
      const end = Math.min(node.content.size, upto - pos - 1);
      for (const line of node.textBetween(0, Math.max(0, end), "\n", "\n").split("\n")) readAssignment(line, vars);
    }
    return false;
  });
  return vars;
}

/** İmlecin bulunduğu satır `ifade =` ile bitiyorsa önerilecek sonuç. */
function suggestion(state: EditorState, comma: boolean): { pos: number; text: string } | null {
  const { $from, empty } = state.selection;
  if (!empty || !$from.parent.isTextblock || $from.parent.type.name === "codeBlock") return null;
  // İmleç satırın sonunda olmalı (paragraf sonu ya da satır sonundan hemen önce).
  const after = $from.parent.textBetween($from.parentOffset, $from.parent.content.size, "\n", "\n");
  if (after && !after.startsWith("\n")) return null;
  const text = $from.parent.textBetween(0, $from.parentOffset, "\n", "\n").split("\n").pop() ?? "";
  if (!/=\s*$/.test(text)) return null;
  const result = lineResult(text, collectVars(state.doc, $from.pos - text.length), comma);
  return result === null ? null : { pos: $from.pos, text: `${/\s$/.test(text) ? "" : " "}${result}` };
}

export const MathResults = Extension.create<Record<string, never>, { mode: MathMode; comma: boolean }>({
  name: "mathResults",
  addStorage: () => ({ mode: "suggest" as MathMode, comma: false }),
  addProseMirrorPlugins() {
    const storage = this.storage;
    return [
      new Plugin({
        key: mathKey,
        props: {
          decorations(state) {
            if (storage.mode === "off") return null;
            const s = suggestion(state, storage.comma);
            if (!s) return null;
            const el = document.createElement("span");
            el.className = "nl-math-ghost";
            el.textContent = s.text;
            el.title = "Tab";
            return DecorationSet.create(state.doc, [Decoration.widget(s.pos, el, { side: 1, key: `math-${s.text}` })]);
          },
          handleKeyDown(view, event) {
            if (storage.mode === "off" || event.key !== "Tab" || event.shiftKey) return false;
            const s = suggestion(view.state, storage.comma);
            if (!s) return false;
            view.dispatch(view.state.tr.insertText(s.text, s.pos));
            return true;
          },
          handleTextInput(view, from, to, text) {
            if (storage.mode !== "insert" || text !== "=" || from !== to) return false;
            const $pos = view.state.doc.resolve(from);
            if ($pos.parent.type.name === "codeBlock") return false;
            const after = $pos.parent.textBetween($pos.parentOffset, $pos.parent.content.size, "\n", "\n");
            if (after && !after.startsWith("\n")) return false;
            const before = $pos.parent.textBetween(0, $pos.parentOffset, "\n", "\n").split("\n").pop() ?? "";
            const line = `${before}=`;
            const result = lineResult(line, collectVars(view.state.doc, from - before.length), storage.comma);
            if (result === null) return false;
            view.dispatch(view.state.tr.insertText(`= ${result}`, from, to));
            return true;
          },
        },
      }),
    ];
  },
});

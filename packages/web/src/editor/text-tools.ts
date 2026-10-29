// Seçili metin üzerinde çalışan araçlar: harf dönüşümleri, stili kopyala/yapıştır, Markdown olarak kopyala/yapıştır,
// düz metin olarak yapıştır (stili eşleştir).

import type { Editor } from "@tiptap/core";
import type { Mark } from "@tiptap/pm/model";
import { desktop } from "../desktop.ts";
import { getLang } from "../i18n/index.ts";
import { fileUrl, fromEditorMarkdown, toEditorMarkdown } from "./paths.ts";

type Case = "upper" | "lower" | "title";

function transform(text: string, kind: Case, atWordStart: boolean): string {
  const locale = getLang() === "tr" ? "tr" : "en";
  if (kind === "upper") return text.toLocaleUpperCase(locale);
  if (kind === "lower") return text.toLocaleLowerCase(locale);
  let start = atWordStart;
  let out = "";
  for (const ch of text) {
    out += start ? ch.toLocaleUpperCase(locale) : ch.toLocaleLowerCase(locale);
    start = !/[\p{L}\p{N}'’]/u.test(ch);
  }
  return out;
}

/** Seçimdeki metnin harflerini dönüştürür; biçimler (kalın, renk…) korunur. Seçim yoksa imleçteki sözcük kullanılır. */
export function changeCase(editor: Editor, kind: Case): void {
  const { state } = editor;
  let { from, to } = state.selection;
  if (from === to) {
    const $pos = state.selection.$from;
    const text = $pos.parent.textContent;
    let a = $pos.parentOffset;
    let b = a;
    while (a > 0 && /[\p{L}\p{N}]/u.test(text[a - 1])) a--;
    while (b < text.length && /[\p{L}\p{N}]/u.test(text[b])) b++;
    if (a === b) return;
    from = $pos.start() + a;
    to = $pos.start() + b;
  }
  const tr = state.tr;
  const parts: { pos: number; end: number; text: string; marks: readonly Mark[] }[] = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return true;
    const s = Math.max(from, pos);
    const e = Math.min(to, pos + node.nodeSize);
    if (e > s) parts.push({ pos: s, end: e, text: node.text!.slice(s - pos, e - pos), marks: node.marks });
    return false;
  });
  for (const p of parts.reverse()) {
    const before = state.doc.textBetween(Math.max(0, p.pos - 1), p.pos, "\n", " ");
    const next = transform(p.text, kind, !before || !/[\p{L}\p{N}'’]/u.test(before));
    if (next !== p.text) tr.replaceWith(p.pos, p.end, state.schema.text(next, p.marks));
  }
  if (tr.docChanged) editor.view.dispatch(tr.scrollIntoView());
}

let copiedStyle: { marks: Mark[]; block: { type: string; attrs: Record<string, unknown> } } | null = null;

export function copyStyle(editor: Editor): void {
  const { $from } = editor.state.selection;
  const node = editor.state.doc.nodeAt(editor.state.selection.from);
  copiedStyle = {
    marks: [...(node?.isText ? node.marks : ($from.marks() as Mark[]))],
    block: { type: $from.parent.type.name, attrs: { ...$from.parent.attrs } },
  };
}

export function pasteStyle(editor: Editor): void {
  if (!copiedStyle) return;
  const { from, to } = editor.state.selection;
  const tr = editor.state.tr;
  if (from !== to) {
    for (const mark of Object.values(editor.schema.marks)) if (mark.name !== "link") tr.removeMark(from, to, mark);
    for (const m of copiedStyle.marks) if (m.type.name !== "link") tr.addMark(from, to, m);
  }
  const type = editor.schema.nodes[copiedStyle.block.type];
  if (type?.isTextblock) tr.setBlockType(from, to, type, copiedStyle.block.attrs);
  editor.view.dispatch(tr);
}

async function readClipboard(): Promise<string> {
  if (desktop?.readClipboard) return desktop.readClipboard();
  return navigator.clipboard.readText();
}

async function writeClipboard(text: string): Promise<void> {
  if (desktop) return desktop.copy(text);
  return navigator.clipboard.writeText(text);
}

/** Seçimi (yoksa tüm sayfayı) Markdown olarak panoya kopyalar; bağlantılar notun konumuna göre göreli yazılır. */
export async function copyAsMarkdown(editor: Editor, notePath = ""): Promise<void> {
  const { from, to, empty } = editor.state.selection;
  await writeClipboard(rangeMarkdown(editor, empty ? 0 : from, empty ? editor.state.doc.content.size : to, notePath));
}

/** Belgenin bir aralığını Markdown'a çevirir; `notePath` verilirse bağlantılar o nota göre göreli yazılır. */
export function rangeMarkdown(editor: Editor, from: number, to: number, notePath = ""): string {
  // cut() kesilen aralığı üst yapısıyla (liste, alıntı…) birlikte verir; slice() liste öğelerini sarmalayıcısız bırakırdı.
  const json = editor.state.doc.cut(from, to).toJSON();
  const md = (editor as unknown as { markdown: { serialize: (j: unknown) => string } }).markdown.serialize(json);
  return notePath ? fromEditorMarkdown(md, notePath) : md;
}

/** Panodaki Markdown metnini biçimlenmiş olarak yapıştırır. */
export async function pasteAsMarkdown(editor: Editor, notePath = ""): Promise<void> {
  const text = await readClipboard();
  if (!text) return;
  editor.chain().focus().insertContent(notePath ? toEditorMarkdown(text, notePath) : text, { contentType: "markdown" } as never).run();
}

/** Panodaki metni biçimsiz (bulunduğu yerin stiliyle) yapıştırır. */
export async function pastePlain(editor: Editor): Promise<void> {
  const text = await readClipboard();
  if (!text) return;
  const { state } = editor;
  const marks = state.selection.$from.marks();
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let tr = state.tr.replaceSelectionWith(state.schema.text(lines[0] || " ", marks), false);
  if (!lines[0]) tr = tr.delete(tr.selection.from - 1, tr.selection.from);
  for (const line of lines.slice(1)) {
    tr = tr.split(tr.selection.from);
    if (line) tr = tr.insertText(line);
  }
  editor.view.dispatch(tr.scrollIntoView());
}

export { fileUrl };

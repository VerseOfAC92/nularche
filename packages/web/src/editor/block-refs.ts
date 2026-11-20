// Blok kimlikleri editörde: satır sonundaki ` ^kimlik` soluk gösterilir; `[[Not#^kimlik]]` ya da `[[Not#Başlık]]`
// bağlantısıyla açılan notta o bloğa kaydırılır ve kısa süre vurgulanır. "Blok bağlantısını kopyala" imlecin
// bulunduğu bloğa (yoksa) kimlik ekler ve bağlantıyı panoya yazar (bkz. core/src/blocks.ts).

import { Extension, type Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { BLOCK_ID_AT_END, newBlockId } from "../../../core/src/blocks.ts";

const key = new PluginKey<DecorationSet>("nlBlockIds");

/** Metin bloğunun düz metni: satır içi her düğüm bir karakter sayılır, böylece göreli konumlar belge konumuna eşlenir. */
const flatText = (node: PMNode) => node.textBetween(0, node.content.size, undefined, "￼");

function decorations(doc: PMNode): DecorationSet {
  const out: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (node.type.name === "codeBlock") return false;
    const text = flatText(node);
    const m = BLOCK_ID_AT_END.exec(text);
    if (m) out.push(Decoration.inline(pos + 1 + m.index, pos + 1 + text.length, { class: "block-id", title: `^${m[1]}` }));
    return false;
  });
  return DecorationSet.create(doc, out);
}

export const BlockIds = Extension.create({
  name: "blockIds",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        state: { init: (_c, state) => decorations(state.doc), apply: (tr, old) => (tr.docChanged ? decorations(tr.doc) : old) },
        props: { decorations: (state) => key.getState(state) },
      }),
    ];
  },
});

/**
 * İmlecin bulunduğu bloğun bağlantı çapası: başlıksa başlık metni, değilse `^kimlik` (blokta kimlik yoksa eklenir).
 * Kod bloğunda ya da boş blokta null.
 */
export function anchorAtCursor(editor: Editor): string | null {
  const { $from } = editor.state.selection;
  const block = $from.parent;
  if (!block.isTextblock || block.type.name === "codeBlock" || !block.textContent.trim()) return null;
  if (block.type.name === "heading") return BLOCK_ID_AT_END.exec(block.textContent) ? `^${BLOCK_ID_AT_END.exec(block.textContent)![1]}` : block.textContent.trim();
  const existing = BLOCK_ID_AT_END.exec(flatText(block));
  if (existing) return `^${existing[1]}`;
  const id = newBlockId();
  const end = $from.end();
  editor.view.dispatch(editor.state.tr.insertText(` ^${id}`, end));
  return `^${id}`;
}

// ------------------------------------------------------------------ Çapaya git

let pending: { path: string; anchor: string } | null = null;

/** Bağlantıyla açılacak notun içinde gidilecek çapa (not yüklenince `takePendingAnchor` ile alınır). */
export function setPendingAnchor(path: string, anchor: string): void {
  pending = { path, anchor };
}

export function takePendingAnchor(path: string): string | null {
  if (!pending || pending.path !== path) return null;
  const a = pending.anchor;
  pending = null;
  return a;
}

/** Çapanın bloğuna imleci koyar, görünür alana kaydırır ve kısa süre vurgular. */
export function scrollToAnchor(editor: Editor, anchor: string): boolean {
  const want = anchor.trim();
  const isBlock = want.startsWith("^");
  const heading = want.toLocaleLowerCase("tr");
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (!node.isTextblock) return true;
    if (isBlock ? BLOCK_ID_AT_END.exec(flatText(node))?.[1] === want.slice(1) : node.type.name === "heading" && node.textContent.trim().toLocaleLowerCase("tr") === heading) found = pos;
    return false;
  });
  if (found < 0) return false;
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, found + 1)).scrollIntoView());
  const dom = editor.view.nodeDOM(found);
  if (dom instanceof HTMLElement) {
    dom.scrollIntoView({ block: "center" });
    dom.classList.add("anchor-flash");
    setTimeout(() => dom.classList.remove("anchor-flash"), 1600);
  }
  return true;
}

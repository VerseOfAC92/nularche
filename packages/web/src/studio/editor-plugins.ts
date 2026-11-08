// Stüdyo editör eklentileri (2.0):
//   • Wiki anma tespiti: wiki girdilerinin adları ve takma adları notlarda noktalı çizgiyle işaretlenir; ⌘/Ctrl-tıklama
//     girdiyi açar, ⌘/Ctrl ile üzerine gelmek önizler. Markdown değişmez (yalnızca görünüm süslemesi).
//   • Yorumlar: yorumlanan pasajlar vurgulanır; tıklayınca yorum panelinde o yorum açılır.
//   • Metin kısaltmaları: kısaltmayı yazıp boşluk ya da noktalama yazınca açılımına çevrilir ({{date}} vb. doldurulur).
// Veriler (terimler, yorumlar, kısaltmalar) App ve yorum paneli tarafından `setStudioData` ile verilir; editörler
// kendi notlarının id'sini `data-note-id` özniteliğinden okur.

import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { fillTemplate } from "../../../core/src/note-text.ts";
import { findAllMentions, locateAnchor } from "../../../core/src/writing.ts";
import type { CommentAnchor, WikiTerm } from "../api.ts";

export interface TextShortcut {
  abbr: string;
  text: string;
}

interface StudioData {
  wikiTerms: WikiTerm[];
  /** Not id'si → yorum bağlantı noktaları. */
  comments: Map<string, { id: string; anchor: CommentAnchor; resolved?: boolean }[]>;
  activeComment: string | null;
  shortcuts: TextShortcut[];
  mentionsOn: boolean;
}

const data: StudioData = { wikiTerms: [], comments: new Map(), activeComment: null, shortcuts: [], mentionsOn: true };
const views = new Set<EditorView>();
const key = new PluginKey<DecorationSet>("nlStudio");

const handlers: { openNode?: (id: string) => void; openComment?: (noteId: string, commentId: string) => void } = {};

export function setStudioHandlers(h: typeof handlers): void {
  Object.assign(handlers, h);
}

export function setStudioData(patch: Partial<Omit<StudioData, "comments">> & { comments?: { noteId: string; list: { id: string; anchor: CommentAnchor; resolved?: boolean }[] } }): void {
  if (patch.wikiTerms) data.wikiTerms = patch.wikiTerms;
  if (patch.shortcuts) data.shortcuts = patch.shortcuts.filter((s) => s.abbr.trim() && !/\s/.test(s.abbr));
  if (patch.mentionsOn !== undefined) data.mentionsOn = patch.mentionsOn;
  if (patch.activeComment !== undefined) data.activeComment = patch.activeComment;
  if (patch.comments) data.comments.set(patch.comments.noteId, patch.comments.list);
  for (const v of views) if (!v.isDestroyed) v.dispatch(v.state.tr.setMeta(key, "refresh"));
}

/** Belgenin düz metni ve her karakterin belge konumu (bloklar arasında "\n"). */
export function plainIndex(doc: PMNode): { text: string; pos: number[] } {
  let text = "";
  const pos: number[] = [];
  doc.descendants((node, p) => {
    if (node.isText) {
      const s = node.text ?? "";
      for (let i = 0; i < s.length; i++) pos.push(p + i);
      text += s;
    } else if (node.isBlock && text && !text.endsWith("\n")) {
      pos.push(p);
      text += "\n";
    }
    // Kod bloklarında anılış ve yorum aranmaz.
    return node.type.name !== "codeBlock";
  });
  return { text, pos };
}

/** Seçimden yorum bağlantı noktası (seçili metin, öncesi ve sonrası). */
export function anchorFromSelection(state: EditorState): CommentAnchor | null {
  const { from, to, empty } = state.selection;
  if (empty) return null;
  const { text, pos } = plainIndex(state.doc);
  let start = -1;
  let end = -1;
  for (let i = 0; i < pos.length; i++) {
    if (pos[i] >= from && pos[i] < to) {
      if (start < 0) start = i;
      end = i + 1;
    }
  }
  if (start < 0) return null;
  const quote = text.slice(start, end).trim();
  if (!quote) return null;
  const s = text.indexOf(quote, start);
  return { text: quote.slice(0, 2000), prefix: text.slice(Math.max(0, s - 30), s), suffix: text.slice(s + quote.length, s + quote.length + 30) };
}

/** Düz metindeki [start, end) aralığını belge aralığına çevirir (satır sonlarını aşmayan parçalar halinde). */
function ranges(pos: number[], text: string, start: number, end: number): [number, number][] {
  const out: [number, number][] = [];
  let a = start;
  for (let i = start; i <= end; i++) {
    if (i === end || text[i] === "\n") {
      if (i > a) out.push([pos[a], pos[i - 1] + 1]);
      a = i + 1;
    }
  }
  return out;
}

function decorations(view: EditorView | null, doc: PMNode, noteId: string | null): DecorationSet {
  const needWiki = data.mentionsOn && data.wikiTerms.length > 0;
  const anchors = noteId ? (data.comments.get(noteId) ?? []) : [];
  if (!needWiki && !anchors.length) return DecorationSet.empty;
  const { text, pos } = plainIndex(doc);
  const decos: Decoration[] = [];
  if (needWiki) {
    const owner = new Map<string, WikiTerm>();
    for (const term of data.wikiTerms) {
      if (term.id === noteId) continue;
      for (const n of term.names) if (!owner.has(n.toLocaleLowerCase("tr"))) owner.set(n.toLocaleLowerCase("tr"), term);
    }
    const hits = findAllMentions(text, [...owner.keys()]);
    for (const h of hits.slice(0, 2000)) {
      const term = owner.get(text.slice(h.index, h.index + h.length).toLocaleLowerCase("tr"));
      if (!term) continue;
      for (const [a, b] of ranges(pos, text, h.index, h.index + h.length)) {
        decos.push(Decoration.inline(a, b, { class: "nl-wiki-mention", "data-wiki-id": term.id, "data-path": term.path, title: term.title }));
      }
    }
  }
  for (const c of anchors) {
    if (c.resolved) continue;
    const at = locateAnchor(text, c.anchor);
    if (at < 0) continue;
    for (const [a, b] of ranges(pos, text, at, at + c.anchor.text.length)) {
      decos.push(Decoration.inline(a, b, { class: `nl-annot${data.activeComment === c.id ? " active" : ""}`, "data-comment-id": c.id }));
    }
  }
  void view;
  return DecorationSet.create(doc, decos);
}

const noteIdOf = (view: EditorView) => view.dom.getAttribute("data-note-id");

export const StudioMarks = Extension.create({
  name: "studioMarks",
  addProseMirrorPlugins() {
    const editor = this.editor;
    let current: EditorView | null = null;
    return [
      new Plugin<DecorationSet>({
        key,
        view(v) {
          current = v;
          views.add(v);
          // İlk çizimde öznitelik henüz okunabilir: süslemeleri bir kez yenile.
          queueMicrotask(() => !v.isDestroyed && v.dispatch(v.state.tr.setMeta(key, "refresh")));
          return { destroy: () => void views.delete(v) };
        },
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, old) => {
            if (!tr.docChanged && !tr.getMeta(key)) return old;
            return decorations(current, tr.doc, current ? noteIdOf(current) : null);
          },
        },
        props: {
          decorations: (state) => key.getState(state),
          handleClick: (view, _pos, event) => {
            const el = event.target as HTMLElement | null;
            const comment = el?.closest<HTMLElement>("[data-comment-id]");
            const wiki = el?.closest<HTMLElement>("[data-wiki-id]");
            if (wiki && (event.metaKey || event.ctrlKey) && handlers.openNode) {
              handlers.openNode(wiki.dataset.wikiId!);
              return true;
            }
            if (comment && handlers.openComment) {
              const noteId = noteIdOf(view);
              if (noteId) handlers.openComment(noteId, comment.dataset.commentId!);
            }
            return false;
          },
          handleTextInput: (view, from, to, text) => {
            if (!data.shortcuts.length || !/^[\s.,;:!?)\]]$/.test(text)) return false;
            const $from = view.state.doc.resolve(from);
            if ($from.parent.type.name === "codeBlock" || $from.marks().some((m) => m.type.name === "code")) return false;
            const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 64), $from.parentOffset, undefined, "￼");
            const word = /(\S+)$/.exec(before)?.[1];
            const hit = word ? data.shortcuts.find((s) => s.abbr === word) : undefined;
            if (!hit || !word) return false;
            const title = (document.querySelector<HTMLTextAreaElement>(".title-input")?.value ?? "").trim();
            const expansion = fillTemplate(hit.text, { title, now: new Date() });
            const start = from - word.length;
            if (!expansion.includes("\n")) {
              view.dispatch(view.state.tr.insertText(expansion + text, start, to));
              return true;
            }
            editor.chain().focus().deleteRange({ from: start, to }).insertContent(expansion, { contentType: "markdown" } as never).run();
            return true;
          },
        },
      }),
    ];
  },
});

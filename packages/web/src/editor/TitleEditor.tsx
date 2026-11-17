// Sayfa başlığı: tek satırlık, satır içi biçimli (kalın, italik, altı çizili, üstü çizili, vurgu, renk) editör.
// Düz başlık (dosya adı, kenar çubuğu, bağlantılar) `title` olarak kaydedilir; biçimli hâli yalnızca bir görünüm
// alanıdır (`titleRich`, satır içi HTML) ve başlığın metni değişmediği sürece kullanılır.

import { Node } from "@tiptap/core";
import { Highlight } from "@tiptap/extension-highlight";
import { TextStyle, Color } from "@tiptap/extension-text-style";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor, type Editor as TiptapEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { addContextItems } from "../contextMenu.ts";
import { t, type StringKey } from "../i18n/index.ts";
import { keys } from "../shortcuts.tsx";
import { Icon } from "../ui/Icon.tsx";
import { TEXT_COLORS } from "./text-colors.ts";

/** Başlık belgesi tek paragraftır: Enter ve yapıştırılan satır sonları yeni satır açmaz. */
const TitleDoc = Node.create({ name: "doc", topNode: true, content: "paragraph" });

export interface TitleEditorHandle {
  focus: () => void;
  selectAll: () => void;
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Biçim içermiyorsa null (yalnızca düz başlık kaydedilir). */
function richOf(editor: TiptapEditor): string | null {
  let marked = false;
  editor.state.doc.descendants((n) => {
    if (n.isText && n.marks.length) marked = true;
  });
  return marked ? editor.getHTML() : null;
}

/** Kayıtlı biçimli başlık, yalnızca metni düz başlıkla aynıysa geçerlidir (başlık başka yerden değiştiyse düşer). */
function initialContent(title: string, rich: string | undefined): string {
  if (rich) {
    const probe = new DOMParser().parseFromString(rich, "text/html").body.textContent ?? "";
    if (probe.replace(/\s+/g, " ").trim() === title.trim()) return rich;
  }
  return `<p>${escapeHtml(title)}</p>`;
}

export const TitleEditor = forwardRef<
  TitleEditorHandle,
  {
    docId: string;
    title: string;
    rich: string | undefined;
    readOnly?: boolean;
    onChange: (title: string, rich: string | null) => void;
    onEnter: () => void;
  }
>(function TitleEditor({ docId, title, rich, readOnly, onChange, onEnter }, ref) {
  const cb = useRef({ onChange, onEnter });
  cb.current = { onChange, onEnter };
  const ctxHidesBar = useRef(false);
  const editor = useEditor({
    extensions: [
      TitleDoc,
      StarterKit.configure({
        document: false,
        heading: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        listKeymap: false,
        codeBlock: false,
        code: false,
        horizontalRule: false,
        hardBreak: false,
        link: false,
        trailingNode: false,
        dropcursor: false,
        gapcursor: false,
      }),
      TextStyle,
      Color,
      Highlight,
      Placeholder.configure({ placeholder: t("common.untitled") }),
    ],
    content: initialContent(title, rich),
    editable: !readOnly,
    editorProps: {
      attributes: { class: "title-pm", spellcheck: "false" },
      handleKeyDown: (_view, e) => {
        if (e.key === "Enter" && !e.isComposing) {
          e.preventDefault();
          cb.current.onEnter();
          return true;
        }
        return false;
      },
      transformPastedText: (text) => text.replace(/\s*\n\s*/g, " "),
    },
    onUpdate: ({ editor: e }) => {
      const plain = e.getText().replace(/\s+/g, " ");
      cb.current.onChange(plain, richOf(e));
    },
  });

  // Başka bir Node açıldığında ya da başlık dışarıdan (kenar çubuğu, yeniden adlandırma) değiştiğinde içerik yenilenir;
  // yazarken gelen kendi kaydımızın yankısı imleci bozmasın diye odaktayken dokunulmaz.
  const shown = useRef({ docId, title });
  useEffect(() => {
    if (!editor) return;
    const sameDoc = shown.current.docId === docId;
    shown.current = { docId, title };
    const sameText = editor.getText().replace(/\s+/g, " ").trim() === title.trim();
    if (sameDoc && (sameText || editor.isFocused)) return;
    editor.commands.setContent(initialContent(title, rich), { emitUpdate: false });
  }, [editor, docId, title, rich]);

  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);

  useImperativeHandle(ref, () => ({
    focus: () => editor?.commands.focus("end"),
    selectAll: () => editor?.chain().focus().selectAll().run(),
  }));

  if (!editor) return null;
  return (
    <div
      className="title-input"
      onMouseDownCapture={() => (ctxHidesBar.current = false)}
      onKeyDownCapture={() => (ctxHidesBar.current = false)}
      onContextMenu={() => {
        const hasSel = !editor.state.selection.empty;
        if (!hasSel) return;
        ctxHidesBar.current = true;
        editor.view.dispatch(editor.state.tr.setMeta("title-format", "hide"));
        const fmt = (key: StringKey, mark: string, run: () => void) => ({ label: t(key), checked: editor.isActive(mark), run });
        addContextItems([
          fmt("keys.bold", "bold", () => editor.chain().focus().toggleBold().run()),
          fmt("keys.italic", "italic", () => editor.chain().focus().toggleItalic().run()),
          fmt("keys.underline", "underline", () => editor.chain().focus().toggleUnderline().run()),
          fmt("ed.strike", "strike", () => editor.chain().focus().toggleStrike().run()),
          fmt("ed.highlight", "highlight", () => editor.chain().focus().toggleHighlight().run()),
          {
            label: t("ed.textColor"),
            submenu: TEXT_COLORS.map(([name, value]) => ({
              label: t(name),
              run: () => (value ? editor.chain().focus().setColor(value).run() : editor.chain().focus().unsetColor().run()),
            })),
          },
        ]);
      }}
    >
      {!readOnly && (
        <BubbleMenu editor={editor} pluginKey="title-format" shouldShow={({ state }) => !ctxHidesBar.current && !state.selection.empty}>
          <TitleFormatBar editor={editor} />
        </BubbleMenu>
      )}
      <EditorContent editor={editor} />
    </div>
  );
});

function TitleFormatBar({ editor }: { editor: TiptapEditor }) {
  const [colors, setColors] = useState(false);
  const mark = (name: string, label: React.ReactNode, title: string, run: () => void) => (
    <button className={editor.isActive(name) ? "on" : ""} title={title} onMouseDown={(e) => e.preventDefault()} onClick={run}>
      {label}
    </button>
  );
  if (colors) {
    return (
      <div className="bubble">
        {TEXT_COLORS.map(([name, value]) => (
          <button
            key={name}
            className="swatch"
            title={t(name)}
            style={{ background: value || "var(--nlc-text-primary)" }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (value) editor.chain().focus().setColor(value).run();
              else editor.chain().focus().unsetColor().run();
              setColors(false);
            }}
          />
        ))}
        <button onMouseDown={(e) => e.preventDefault()} onClick={() => setColors(false)}>
          <Icon name="x" size={14} />
        </button>
      </div>
    );
  }
  return (
    <div className="bubble">
      {mark("bold", "B", t("ed.bold", { key: keys("Mod+B") }), () => editor.chain().focus().toggleBold().run())}
      {mark("italic", t("ed.italicMark"), t("ed.italic", { key: keys("Mod+I") }), () => editor.chain().focus().toggleItalic().run())}
      {mark("underline", "U", t("ed.underline", { key: keys("Mod+U") }), () => editor.chain().focus().toggleUnderline().run())}
      {mark("strike", "S", t("ed.strike"), () => editor.chain().focus().toggleStrike().run())}
      {mark("highlight", "▮", t("ed.highlight"), () => editor.chain().focus().toggleHighlight().run())}
      <button title={t("ed.textColor")} onMouseDown={(e) => e.preventDefault()} onClick={() => setColors(true)}>
        <span style={{ color: (editor.getAttributes("textStyle").color as string | undefined) ?? "inherit" }}>A</span>
      </button>
    </div>
  );
}

// Stream modu editörü: bir Node'un Shard'larını (blokları) Notion benzeri dikey akışta düzenler.
// Dosyadaki Markdown ↔ editör dönüşümü yalnızca burada, yükleme ve kaydetme sınırında yapılır.

import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor as TiptapEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import { api, type NodeMeta } from "../api.ts";
import { buildExtensions } from "./extensions.ts";
import { CALLOUT_KINDS, type CalloutKind } from "./markdown-extensions.ts";
import { fileUrl, fromEditorMarkdown, toEditorMarkdown, vaultPathFromUrl } from "./paths.ts";

interface Command {
  label: string;
  hint: string;
  icon: string;
  group: string;
  keywords: string;
  run: (e: TiptapEditor, ctx: CommandContext) => void | Promise<void>;
}

interface CommandContext {
  pickFile: (accept: string) => Promise<File | null>;
  insertFiles: (e: TiptapEditor, files: File[], pos?: number) => Promise<void>;
  createChild: (title: string) => Promise<NodeMeta | null>;
}

const CALLOUT_LABELS: Record<CalloutKind, [string, string]> = {
  note: ["Not", "ℹ️"],
  tip: ["İpucu", "💡"],
  important: ["Önemli", "❗"],
  warning: ["Uyarı", "⚠️"],
  caution: ["Dikkat", "⛔"],
};

const COMMANDS: Command[] = [
  {
    group: "Temel",
    label: "Metin",
    hint: "Düz paragraf",
    icon: "¶",
    keywords: "text paragraf metin",
    run: (e) => void e.chain().focus().setParagraph().run(),
  },
  {
    group: "Temel",
    label: "Başlık 1",
    hint: "Büyük başlık",
    icon: "H1",
    keywords: "h1 baslik heading",
    run: (e) => void e.chain().focus().setHeading({ level: 1 }).run(),
  },
  {
    group: "Temel",
    label: "Başlık 2",
    hint: "Orta başlık",
    icon: "H2",
    keywords: "h2 baslik heading",
    run: (e) => void e.chain().focus().setHeading({ level: 2 }).run(),
  },
  {
    group: "Temel",
    label: "Başlık 3",
    hint: "Küçük başlık",
    icon: "H3",
    keywords: "h3 baslik heading",
    run: (e) => void e.chain().focus().setHeading({ level: 3 }).run(),
  },
  {
    group: "Temel",
    label: "Madde listesi",
    hint: "• liste",
    icon: "•",
    keywords: "liste bullet ul madde",
    run: (e) => void e.chain().focus().toggleBulletList().run(),
  },
  {
    group: "Temel",
    label: "Numaralı liste",
    hint: "1. liste",
    icon: "1.",
    keywords: "liste numbered ol numara",
    run: (e) => void e.chain().focus().toggleOrderedList().run(),
  },
  {
    group: "Temel",
    label: "Yapılacaklar",
    hint: "Onay kutuları",
    icon: "☑",
    keywords: "todo yapilacak gorev task checkbox",
    run: (e) => void e.chain().focus().toggleTaskList().run(),
  },
  {
    group: "Temel",
    label: "Açılır blok",
    hint: "Gizlenebilir içerik",
    icon: "▸",
    keywords: "toggle acilir details gizle",
    run: (e) => void e.chain().focus().setDetails().run(),
  },
  {
    group: "Temel",
    label: "Alıntı",
    hint: "Alıntı bloğu",
    icon: "❝",
    keywords: "quote alinti",
    run: (e) => void e.chain().focus().toggleBlockquote().run(),
  },
  {
    group: "Temel",
    label: "Ayırıcı",
    hint: "Yatay çizgi",
    icon: "—",
    keywords: "divider hr ayirici cizgi",
    run: (e) => void e.chain().focus().setHorizontalRule().run(),
  },
  ...CALLOUT_KINDS.map((kind): Command => ({
    group: "Callout",
    label: `Callout: ${CALLOUT_LABELS[kind][0]}`,
    hint: "Vurgulu kutu",
    icon: CALLOUT_LABELS[kind][1],
    keywords: `callout kutu ${kind} ${CALLOUT_LABELS[kind][0]}`,
    run: (e) => void e.chain().focus().setCallout(kind).run(),
  })),
  {
    group: "Gelişmiş",
    label: "Tablo",
    hint: "3×3 tablo",
    icon: "▦",
    keywords: "table tablo",
    run: (e) => void e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    group: "Gelişmiş",
    label: "Kod bloğu",
    hint: "Sözdizimi renklendirmeli",
    icon: "</>",
    keywords: "code kod",
    run: (e) => void e.chain().focus().toggleCodeBlock().run(),
  },
  {
    group: "Bağlantı",
    label: "Node bağlantısı",
    hint: "Başka bir Node'a bağlan ([[)",
    icon: "↗",
    keywords: "link baglanti sayfa node mention",
    run: (e) => void e.chain().focus().insertContent("[[").run(),
  },
  {
    group: "Bağlantı",
    label: "Alt Node",
    hint: "Bu Node'un altında yeni Node",
    icon: "⤷",
    keywords: "alt sayfa subpage child node",
    run: async (e, ctx) => {
      const node = await ctx.createChild("Adsız");
      if (node) e.chain().focus().insertContent(linkContent(node)).run();
    },
  },
  {
    group: "Medya",
    label: "Resim",
    hint: "Bilgisayardan yükle",
    icon: "🖼",
    keywords: "image resim gorsel foto",
    run: async (e, ctx) => {
      const f = await ctx.pickFile("image/*");
      if (f) await ctx.insertFiles(e, [f]);
    },
  },
  {
    group: "Medya",
    label: "Dosya",
    hint: "Ek olarak yükle",
    icon: "📎",
    keywords: "file dosya ek pdf",
    run: async (e, ctx) => {
      const f = await ctx.pickFile("*/*");
      if (f) await ctx.insertFiles(e, [f]);
    },
  },
  {
    group: "Medya",
    label: "YouTube",
    hint: "Video göm",
    icon: "▶",
    keywords: "youtube video embed gom",
    run: (e) => {
      const src = prompt("YouTube bağlantısı:");
      if (src) e.chain().focus().setYoutubeVideo({ src }).run();
    },
  },
];

function linkContent(node: Pick<NodeMeta, "title" | "path">) {
  return [
    { type: "text", text: node.title, marks: [{ type: "link", attrs: { href: fileUrl(node.path) } }] },
    { type: "text", text: " " },
  ];
}

const fold = (s: string) => s.toLocaleLowerCase("tr").replace(/[çğıöşü]/g, (c) => ({ ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" })[c] ?? c);

interface Trigger {
  kind: "slash" | "link";
  query: string;
  from: number;
  top: number;
  left: number;
}

type Item = { key: string; label: string; hint: string; icon: string; group: string; run: (e: TiptapEditor) => void | Promise<void> };

const TEXT_COLORS = [
  ["Varsayılan", ""],
  ["Gri", "#8b949e"],
  ["Cyan", "#00a8b5"],
  ["Mavi", "#2f81f7"],
  ["Yeşil", "#3fb950"],
  ["Sarı", "#d29922"],
  ["Turuncu", "#f0883e"],
  ["Kırmızı", "#f85149"],
  ["Mor", "#a371f7"],
] as const;

export interface EditorProps {
  /** Node id'si + sunucu sürümü; değişince içerik baştan yüklenir. */
  docKey: string;
  markdown: string;
  /** Node'un Origin'e göre yolu: göreli bağlantılar buna göre çözülür. */
  nodePath: string;
  nodes: NodeMeta[];
  currentId: string;
  onChange: (markdown: string) => void;
  onOpenPath: (vaultPath: string) => void;
  onCreateChild: (title: string) => Promise<NodeMeta | null>;
  onError: (message: string) => void;
  /** Seçili metin değiştiğinde (Nularche AI bağlamı için). */
  onSelectionText?: (text: string) => void;
}

export function Editor(props: EditorProps) {
  const { docKey, markdown, nodePath, onChange } = props;
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [active, setActive] = useState(0);
  const propsRef = useRef(props);
  propsRef.current = props;
  const loading = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const ctx: CommandContext = {
    pickFile: (accept) =>
      new Promise((resolve) => {
        const input = fileInput.current!;
        input.accept = accept;
        input.value = "";
        input.onchange = () => resolve(input.files?.[0] ?? null);
        input.click();
      }),
    insertFiles: async (e, files, pos) => {
      for (const file of files) {
        try {
          const { path } = await api.upload(file);
          const content = file.type.startsWith("image/")
            ? { type: "image", attrs: { src: fileUrl(path), alt: file.name } }
            : { type: "paragraph", content: [{ type: "text", text: `📎 ${file.name}`, marks: [{ type: "link", attrs: { href: fileUrl(path) } }] }] };
          if (pos !== undefined) e.chain().focus().insertContentAt(pos, content).run();
          else e.chain().focus().insertContent(content).run();
        } catch (err) {
          propsRef.current.onError(`Yüklenemedi: ${file.name} (${(err as Error).message})`);
        }
      }
    },
    createChild: (title) => propsRef.current.onCreateChild(title),
  };
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const items: Item[] = useMemo(() => {
    if (!trigger) return [];
    const q = fold(trigger.query);
    if (trigger.kind === "slash") {
      return COMMANDS.filter((c) => fold(`${c.label} ${c.keywords}`).includes(q)).map((c) => ({
        key: c.label,
        label: c.label,
        hint: c.hint,
        icon: c.icon,
        group: c.group,
        run: (e: TiptapEditor) => c.run(e, ctxRef.current),
      }));
    }
    return propsRef.current.nodes
      .filter((n) => n.id !== propsRef.current.currentId && fold(n.title).includes(q))
      .slice(0, 30)
      .map((n) => ({
        key: n.id,
        label: n.title,
        hint: n.path.replace(/\.md$/, ""),
        icon: n.icon ?? "◇",
        group: "Node'lar",
        run: (e: TiptapEditor) => void e.chain().focus().insertContent(linkContent(n)).run(),
      }));
  }, [trigger]);

  const stateRef = useRef({ trigger, items, active });
  stateRef.current = { trigger, items, active };

  const choose = (e: TiptapEditor, item: Item) => {
    const t = stateRef.current.trigger;
    if (t) e.chain().focus().deleteRange({ from: t.from, to: e.state.selection.from }).run();
    setTrigger(null);
    void item.run(e);
  };

  function updateTrigger(e: TiptapEditor) {
    const { $from, empty } = e.state.selection;
    if (!empty || $from.parent.type.name === "codeBlock") return setTrigger(null);
    const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
    const link = /\[\[([^\]\n]{0,60})$/.exec(before);
    const slash = /(?:^|\s)\/([\p{L}\d:]*)$/u.exec(before);
    const m = link ?? slash;
    if (!m) return setTrigger(null);
    const kind = link ? "link" : "slash";
    const from = $from.pos - m[1].length - (link ? 2 : 1);
    const coords = e.view.coordsAtPos(from);
    setTrigger((prev) => {
      if (!prev || prev.query !== m[1] || prev.kind !== kind) setActive(0);
      return { kind, query: m[1], from, top: Math.min(coords.bottom + 4, window.innerHeight - 350), left: coords.left };
    });
  }

  const editor = useEditor({
    extensions: buildExtensions({ placeholder: "Yazmaya başlayın; komutlar için “/”, Node bağlantısı için “[[”" }),
    content: "",
    editorProps: {
      handleKeyDown: (_view, event) => {
        const { trigger: t, items: list, active: idx } = stateRef.current;
        if (!t || list.length === 0) return false;
        if (event.key === "ArrowDown") return (setActive((idx + 1) % list.length), true);
        if (event.key === "ArrowUp") return (setActive((idx - 1 + list.length) % list.length), true);
        if (event.key === "Enter" || event.key === "Tab") {
          if (editorRef.current) choose(editorRef.current, list[idx]);
          return true;
        }
        if (event.key === "Escape") return (setTrigger(null), true);
        return false;
      },
      handleClick: (_view, _pos, event) => {
        const a = (event.target as HTMLElement).closest("a");
        if (!a) return false;
        const href = a.getAttribute("href") ?? "";
        const target = vaultPathFromUrl(href);
        if (target?.toLowerCase().endsWith(".md")) {
          propsRef.current.onOpenPath(target);
          return true;
        }
        if (href) window.open(href, "_blank", "noopener");
        return true;
      },
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])];
        if (!files.length || !editorRef.current) return false;
        void ctxRef.current.insertFiles(editorRef.current, files);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        const files = [...(event.dataTransfer?.files ?? [])];
        if (moved || !files.length || !editorRef.current) return false;
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        void ctxRef.current.insertFiles(editorRef.current, files, pos);
        return true;
      },
    },
    onUpdate: ({ editor: e }) => {
      if (!loading.current) {
        const md = (e as unknown as { getMarkdown(): string }).getMarkdown();
        onChangeRef.current(fromEditorMarkdown(md, propsRef.current.nodePath));
      }
      updateTrigger(e);
    },
    onSelectionUpdate: ({ editor: e }) => {
      updateTrigger(e);
      const { from, to, empty } = e.state.selection;
      propsRef.current.onSelectionText?.(empty ? "" : e.state.doc.textBetween(from, to, "\n").slice(0, 20_000));
    },
  });
  const editorRef = useRef<TiptapEditor | null>(null);
  editorRef.current = editor;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Başka bir Node seçildiğinde ya da Node dışarıdan (ör. Claude) değiştiğinde içeriği yükle.
  useEffect(() => {
    if (!editor) return;
    loading.current = true;
    editor.commands.setContent(toEditorMarkdown(markdown, nodePath), { emitUpdate: false, contentType: "markdown" } as never);
    loading.current = false;
    setTrigger(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, docKey]);

  let lastGroup = "";
  return (
    <div className="editor">
      <input ref={fileInput} type="file" hidden />
      {editor && (
        <>
          <DragHandle editor={editor}>
            <div className="drag-handle" title="Sürükleyerek taşı">
              ⋮⋮
            </div>
          </DragHandle>
          <BubbleMenu
            editor={editor}
            pluginKey="format"
            shouldShow={({ editor: e, state }) =>
              !state.selection.empty && !e.isActive("image") && !e.isActive("codeBlock") && !e.isActive("youtube")
            }
          >
            <FormatBar editor={editor} />
          </BubbleMenu>
          <BubbleMenu
            editor={editor}
            pluginKey="table"
            shouldShow={({ editor: e, state }) => state.selection.empty && e.isActive("table")}
            options={{ placement: "top" }}
          >
            <div className="bubble">
              <button onClick={() => editor.chain().focus().addRowAfter().run()}>+ Satır</button>
              <button onClick={() => editor.chain().focus().addColumnAfter().run()}>+ Sütun</button>
              <button onClick={() => editor.chain().focus().deleteRow().run()}>− Satır</button>
              <button onClick={() => editor.chain().focus().deleteColumn().run()}>− Sütun</button>
              <button onClick={() => editor.chain().focus().toggleHeaderRow().run()}>Başlık satırı</button>
              <span className="sep" />
              <button onClick={() => editor.chain().focus().deleteTable().run()}>Tabloyu sil</button>
            </div>
          </BubbleMenu>
        </>
      )}
      <EditorContent editor={editor} />
      {trigger && items.length > 0 && (
        <div className="pop suggest" style={{ top: trigger.top, left: trigger.left }} role="listbox">
          {items.map((c, i) => {
            const header = c.group !== lastGroup ? <div className="group">{c.group}</div> : null;
            lastGroup = c.group;
            return (
              <div key={c.key}>
                {header}
                <button
                  className={i === active ? "active" : ""}
                  onMouseDown={(ev) => {
                    ev.preventDefault();
                    if (editor) choose(editor, c);
                  }}
                  onMouseEnter={() => setActive(i)}
                >
                  <span className="ico">{c.icon}</span>
                  <span>
                    {c.label}
                    <small>{c.hint}</small>
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FormatBar({ editor }: { editor: TiptapEditor }) {
  const [colors, setColors] = useState(false);
  const mark = (name: string, label: string, title: string, run: () => void) => (
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
            title={name}
            style={{ background: value || "var(--nlc-text-primary)" }}
            onClick={() => {
              if (value) editor.chain().focus().setColor(value).run();
              else editor.chain().focus().unsetColor().run();
              setColors(false);
            }}
          />
        ))}
        <button onClick={() => setColors(false)}>✕</button>
      </div>
    );
  }
  return (
    <div className="bubble">
      {mark("bold", "B", "Kalın (⌘B)", () => editor.chain().focus().toggleBold().run())}
      {mark("italic", "İ", "İtalik (⌘I)", () => editor.chain().focus().toggleItalic().run())}
      {mark("underline", "U", "Altı çizili (⌘U)", () => editor.chain().focus().toggleUnderline().run())}
      {mark("strike", "S", "Üstü çizili", () => editor.chain().focus().toggleStrike().run())}
      {mark("code", "</>", "Satır içi kod", () => editor.chain().focus().toggleCode().run())}
      {mark("highlight", "▮", "Vurgula", () => editor.chain().focus().toggleHighlight().run())}
      <button title="Metin rengi" onClick={() => setColors(true)}>
        A
      </button>
      <span className="sep" />
      {mark("link", "Bağlantı", "Bağlantı ekle/kaldır", () => {
        if (editor.isActive("link")) return void editor.chain().focus().unsetLink().run();
        const href = prompt("Bağlantı adresi (https://…):");
        if (href) editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
      })}
    </div>
  );
}

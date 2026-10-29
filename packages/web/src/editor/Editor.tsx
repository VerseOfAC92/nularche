// Stream modu editörü: bir Node'un Shard'larını (blokları) Notion benzeri dikey akışta düzenler.
// Dosyadaki Markdown ↔ editör dönüşümü yalnızca burada, yükleme ve kaydetme sınırında yapılır.

import { useEffect, useMemo, useRef, useState } from "react";
import { askText } from "../ask.tsx";
import { EditorContent, useEditor, type Editor as TiptapEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import { api, type NodeMeta } from "../api.ts";
import { t, type StringKey } from "../i18n/index.ts";
import { keys } from "../shortcuts.tsx";
import { buildExtensions } from "./extensions.ts";
import { CALLOUT_KINDS, type CalloutKind } from "./markdown-extensions.ts";
import { fileUrl, fromEditorMarkdown, toEditorMarkdown, vaultPathFromUrl } from "./paths.ts";
import { desktop } from "../desktop.ts";
import { getLang } from "../i18n/index.ts";
import { modPressed } from "../shortcuts.tsx";
import { registerEditorUi, setActiveEditor } from "../commands.ts";
import { countWords } from "../../../core/src/note-text.ts";
import { FindBar } from "./FindBar.tsx";
import { LinkDialog } from "./LinkDialog.tsx";
import { MediaHostContext, type MediaHost } from "./media-nodes.tsx";
import { VaultHostContext, type VaultHost } from "./obsidian-nodes.tsx";
import { makeResolver } from "../vault/resolve.ts";
import { foldKey, headings, setFind, findKey, setFolded, type MathMode } from "./notes-extensions.ts";
import { copyAsMarkdown, pasteAsMarkdown } from "./text-tools.ts";
import { RecordDialog } from "../media/RecordDialog.tsx";
import { DrawingDialog } from "../media/DrawingDialog.tsx";

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
  createDatabase: (title: string) => Promise<NodeMeta | null>;
  record: () => void;
  draw: () => void;
}

const CALLOUT_LABELS: Record<CalloutKind, [StringKey, string]> = {
  note: ["ed.callout.note", "ℹ️"],
  tip: ["ed.callout.tip", "💡"],
  important: ["ed.callout.important", "❗"],
  warning: ["ed.callout.warning", "⚠️"],
  caution: ["ed.callout.caution", "⛔"],
};

const commands = (): Command[] => [
  {
    group: t("ed.g.basic"),
    label: t("ed.c.text"),
    hint: t("ed.c.textHint"),
    icon: "¶",
    keywords: "text paragraf metin",
    run: (e) => void e.chain().focus().setParagraph().run(),
  },
  {
    group: t("ed.g.basic"),
    label: t("ed.c.h1"),
    hint: t("ed.c.h1Hint"),
    icon: "H1",
    keywords: "h1 baslik heading",
    run: (e) => void e.chain().focus().setHeading({ level: 1 }).run(),
  },
  {
    group: t("ed.g.basic"),
    label: t("ed.c.h2"),
    hint: t("ed.c.h2Hint"),
    icon: "H2",
    keywords: "h2 baslik heading",
    run: (e) => void e.chain().focus().setHeading({ level: 2 }).run(),
  },
  {
    group: t("ed.g.basic"),
    label: t("ed.c.h3"),
    hint: t("ed.c.h3Hint"),
    icon: "H3",
    keywords: "h3 baslik heading",
    run: (e) => void e.chain().focus().setHeading({ level: 3 }).run(),
  },
  {
    group: t("ed.g.basic"),
    label: t("ed.c.bullet"),
    hint: "• liste",
    icon: "•",
    keywords: "liste bullet ul madde",
    run: (e) => void e.chain().focus().toggleBulletList().run(),
  },
  {
    group: t("ed.g.basic"),
    label: t("ed.c.ordered"),
    hint: "1. liste",
    icon: "1.",
    keywords: "liste numbered ol numara",
    run: (e) => void e.chain().focus().toggleOrderedList().run(),
  },
  {
    group: t("ed.g.basic"),
    label: t("ed.c.todo"),
    hint: t("ed.c.todoHint"),
    icon: "☑",
    keywords: "todo yapilacak gorev task checkbox",
    run: (e) => void e.chain().focus().toggleTaskList().run(),
  },
  {
    group: t("ed.g.basic"),
    label: t("ed.c.toggle"),
    hint: t("ed.c.toggleHint"),
    icon: "▸",
    keywords: "toggle acilir details gizle",
    run: (e) => void e.chain().focus().setDetails().run(),
  },
  {
    group: t("ed.g.basic"),
    label: t("cmd.dashedList"),
    hint: "– liste",
    icon: "–",
    keywords: "tire dashed liste list",
    run: (e) => void e.chain().focus().toggleDashedList().run(),
  },
  {
    group: t("ed.g.basic"),
    label: t("ed.c.quote"),
    hint: t("ed.c.quoteHint"),
    icon: "❝",
    keywords: "quote alinti",
    run: (e) => void e.chain().focus().toggleBlockquote().run(),
  },
  {
    group: t("ed.g.basic"),
    label: t("ed.c.divider"),
    hint: t("ed.c.dividerHint"),
    icon: "—",
    keywords: "divider hr ayirici cizgi",
    run: (e) => void e.chain().focus().setHorizontalRule().run(),
  },
  ...CALLOUT_KINDS.map((kind): Command => ({
    group: "Callout",
    label: `Callout: ${t(CALLOUT_LABELS[kind][0])}`,
    hint: t("ed.c.calloutHint"),
    icon: CALLOUT_LABELS[kind][1],
    keywords: `callout kutu box ${kind} ${t(CALLOUT_LABELS[kind][0])}`,
    run: (e) => void e.chain().focus().setCallout(kind).run(),
  })),
  {
    group: t("ed.g.advanced"),
    label: t("ed.c.table"),
    hint: t("ed.c.tableHint"),
    icon: "▦",
    keywords: "table tablo",
    run: (e) => void e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    group: t("ed.g.advanced"),
    label: t("ed.c.code"),
    hint: t("ed.c.codeHint"),
    icon: "</>",
    keywords: "code kod",
    run: (e) => void e.chain().focus().toggleCodeBlock().run(),
  },
  {
    group: t("ed.g.link"),
    label: t("ed.c.nodeLink"),
    hint: t("ed.c.nodeLinkHint"),
    icon: "↗",
    keywords: "link baglanti sayfa node mention",
    run: (e) => void e.chain().focus().insertContent("[[").run(),
  },
  {
    group: t("ed.g.link"),
    label: t("ed.c.child"),
    hint: t("ed.c.childHint"),
    icon: "⤷",
    keywords: "alt sayfa subpage child node",
    run: async (e, ctx) => {
      const node = await ctx.createChild(t("common.untitled"));
      if (node) e.chain().focus().insertContent(linkContent(node)).run();
    },
  },
  {
    group: t("ed.g.advanced"),
    label: t("ed.c.database"),
    hint: t("ed.c.databaseHint"),
    icon: "▦",
    keywords: "database veritabani tablo pano board takvim calendar galeri gallery liste list timeline",
    run: async (e, ctx) => {
      const node = await ctx.createDatabase(t("db.untitledDb"));
      if (node) e.chain().focus().insertDatabase(fileUrl(node.path)).run();
    },
  },
  {
    group: t("ed.g.media"),
    label: t("ed.c.image"),
    hint: t("ed.c.imageHint"),
    icon: "🖼",
    keywords: "image resim gorsel foto",
    run: async (e, ctx) => {
      const f = await ctx.pickFile("image/*");
      if (f) await ctx.insertFiles(e, [f]);
    },
  },
  {
    group: t("ed.g.media"),
    label: t("ed.c.file"),
    hint: t("ed.c.fileHint"),
    icon: "📎",
    keywords: "file dosya ek pdf",
    run: async (e, ctx) => {
      const f = await ctx.pickFile("*/*");
      if (f) await ctx.insertFiles(e, [f]);
    },
  },
  {
    group: t("ed.g.media"),
    label: t("cmd.recordAudio"),
    hint: t("rec.title"),
    icon: "🎙",
    keywords: "ses kayit audio record mikrofon voice",
    run: (_e, ctx) => ctx.record(),
  },
  {
    group: t("ed.g.media"),
    label: t("cmd.drawing"),
    hint: t("draw.title"),
    icon: "✎",
    keywords: "cizim drawing sketch ciz kalem",
    run: (_e, ctx) => ctx.draw(),
  },
  {
    group: t("ed.g.media"),
    label: "YouTube",
    hint: t("ed.c.youtubeHint"),
    icon: "▶",
    keywords: "youtube video embed gom",
    run: async (e) => {
      const src = await askText(t("ed.youtubePrompt"));
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

const TEXT_COLORS: [StringKey, string][] = [
  ["ed.color.default", ""],
  ["ed.color.gray", "#8b949e"],
  ["ed.color.cyan", "#00a8b5"],
  ["ed.color.blue", "#2f81f7"],
  ["ed.color.green", "#3fb950"],
  ["ed.color.yellow", "#d29922"],
  ["ed.color.orange", "#f0883e"],
  ["ed.color.red", "#f85149"],
  ["ed.color.purple", "#a371f7"],
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
  onCreateDatabase: (title: string) => Promise<NodeMeta | null>;
  onError: (message: string) => void;
  /** Seçili metin değiştiğinde (Nularche AI bağlamı için). */
  onSelectionText?: (text: string) => void;
  /** İşaretlenen yapılacaklar listenin sonuna taşınsın (sayfa ayarı). */
  sortChecked?: boolean;
  mathMode?: MathMode;
  spellcheck?: boolean;
  /** Sözcük/karakter sayıları (sayfa ve seçim). */
  onStats?: (stats: EditorStats) => void;
  onTagClick?: (tag: string) => void;
  onToast?: (message: string) => void;
  /** Var olmayan bir [[wiki]] hedefine tıklanınca bu başlıkla not oluşturur ve açar. */
  onCreateNote?: (title: string) => void;
}

export interface EditorStats {
  words: number;
  chars: number;
  selWords: number;
  selChars: number;
}

function statsOf(e: TiptapEditor): EditorStats {
  const text = e.state.doc.textBetween(0, e.state.doc.content.size, "\n", " ");
  const { from, to, empty } = e.state.selection;
  const sel = empty ? "" : e.state.doc.textBetween(from, to, "\n", " ");
  return { words: countWords(text), chars: text.replace(/\n/g, "").length, selWords: countWords(sel), selChars: sel.replace(/\n/g, "").length };
}

const foldStoreKey = (id: string) => `nlc-fold:${id}`;

export function Editor(props: EditorProps) {
  const { docKey, markdown, nodePath, onChange } = props;
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [active, setActive] = useState(0);
  const propsRef = useRef(props);
  propsRef.current = props;
  const loading = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [find, setFindOpen] = useState<{ replace: boolean; tick: number } | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [drawing, setDrawing] = useState<{ src: string | null; resolve: (p: string | null) => void } | null>(null);

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
          propsRef.current.onError(t("ed.uploadFailed", { name: file.name, error: (err as Error).message }));
        }
      }
    },
    createChild: (title) => propsRef.current.onCreateChild(title),
    createDatabase: (title) => propsRef.current.onCreateDatabase(title),
    record: () => setRecording(true),
    draw: () => {
      void new Promise<string | null>((resolve) => setDrawing({ src: null, resolve })).then((path) => {
        if (path) editorRef.current?.chain().focus().insertDrawing(fileUrl(path)).run();
      });
    },
  };
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const items: Item[] = useMemo(() => {
    if (!trigger) return [];
    const q = fold(trigger.query);
    if (trigger.kind === "slash") {
      return commands().filter((c) => fold(`${c.label} ${c.keywords}`).includes(q)).map((c) => ({
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
        group: t("ed.g.nodes"),
        run: (e: TiptapEditor) => void e.chain().focus().insertContent(linkContent(n)).run(),
      }));
  }, [trigger]);

  const stateRef = useRef({ trigger, items, active });
  stateRef.current = { trigger, items, active };

  const choose = (e: TiptapEditor, item: Item) => {
    const trig = stateRef.current.trigger;
    if (trig) e.chain().focus().deleteRange({ from: trig.from, to: e.state.selection.from }).run();
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
    extensions: buildExtensions({ placeholder: t("ed.placeholder") }),
    content: "",
    onFocus: ({ editor: e }) => setActiveEditor(e as TiptapEditor),
    onCreate: ({ editor: e }) => setActiveEditor(e as TiptapEditor),
    editorProps: {
      attributes: { spellcheck: String(props.spellcheck ?? true) },
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
        const tag = (event.target as HTMLElement).closest<HTMLElement>(".nl-tag");
        if (tag && modPressed(event) && propsRef.current.onTagClick) {
          propsRef.current.onTagClick(tag.dataset.tag ?? "");
          return true;
        }
        const a = (event.target as HTMLElement).closest("a");
        if (!a) return false;
        const href = a.getAttribute("href") ?? "";
        const target = vaultPathFromUrl(href);
        // Sayfa bağlantıları tek tıkla açılır; dış bağlantılar ve ekler ⌘/Ctrl-tıkla (düz tık imleci yerleştirir).
        if (target?.toLowerCase().endsWith(".md")) {
          propsRef.current.onOpenPath(target);
          return true;
        }
        if (href && modPressed(event)) {
          window.open(href, "_blank", "noopener");
          return true;
        }
        return false;
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
      propsRef.current.onStats?.(statsOf(e as TiptapEditor));
    },
    onSelectionUpdate: ({ editor: e }) => {
      updateTrigger(e);
      propsRef.current.onStats?.(statsOf(e as TiptapEditor));
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
    // Daraltılmış bölümler (başlık metinleriyle) bu cihazda hatırlanır.
    try {
      const saved = JSON.parse(localStorage.getItem(foldStoreKey(propsRef.current.currentId)) ?? "[]") as string[];
      if (saved.length) setFolded(editor, headings(editor.state.doc).filter((h) => saved.includes(h.text)).map((h) => h.pos));
    } catch {
      // depolama kapalı
    }
    const q = findKey.getState(editor.state)?.query;
    if (q) setFind(editor, {}, false);
    propsRef.current.onStats?.(statsOf(editor));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, docKey]);

  // Sayfa ve uygulama ayarlarını eklentilere aktar.
  useEffect(() => {
    if (!editor) return;
    const st = editor.storage as unknown as { taskTools: { sortChecked: boolean }; mathResults: { mode: MathMode; comma: boolean } };
    st.taskTools.sortChecked = !!props.sortChecked;
    st.mathResults.mode = props.mathMode ?? "suggest";
    st.mathResults.comma = getLang() === "tr";
    editor.view.dispatch(editor.state.tr.setMeta("nlSettings", true));
  }, [editor, props.sortChecked, props.mathMode]);

  useEffect(() => {
    editor?.setOptions({ editorProps: { ...editor.options.editorProps, attributes: { spellcheck: String(props.spellcheck ?? true) } } });
  }, [editor, props.spellcheck]);

  // Daraltılan bölümleri kaydet.
  useEffect(() => {
    if (!editor) return;
    let last = "";
    const save = () => {
      const folded = foldKey.getState(editor.state)?.folded ?? [];
      const texts = headings(editor.state.doc)
        .filter((h) => folded.includes(h.pos))
        .map((h) => h.text);
      const json = JSON.stringify(texts);
      if (json === last) return;
      last = json;
      try {
        if (texts.length) localStorage.setItem(foldStoreKey(propsRef.current.currentId), json);
        else localStorage.removeItem(foldStoreKey(propsRef.current.currentId));
      } catch {
        // depolama kapalı
      }
    };
    editor.on("transaction", save);
    return () => void editor.off("transaction", save);
  }, [editor]);

  // Menü ve kısayol komutlarından arayüz gerektirenler.
  useEffect(() => {
    if (!editor) return;
    setActiveEditor(editor);
    const offs = [
      registerEditorUi("find.open", () => setFindOpen((f) => ({ replace: f?.replace ?? false, tick: (f?.tick ?? 0) + 1 }))),
      registerEditorUi("find.replace", () => setFindOpen((f) => ({ replace: true, tick: (f?.tick ?? 0) + 1 }))),
      registerEditorUi("find.next", (e) => {
        const s = findKey.getState(e.state);
        if (s?.matches.length) setFind(e, { index: (s.index + 1) % s.matches.length });
        else setFindOpen({ replace: false, tick: 1 });
      }),
      registerEditorUi("find.prev", (e) => {
        const s = findKey.getState(e.state);
        if (s?.matches.length) setFind(e, { index: (s.index - 1 + s.matches.length) % s.matches.length });
      }),
      registerEditorUi("link.edit", () => setLinkOpen(true)),
      registerEditorUi("insert.audio", () => setRecording(true)),
      registerEditorUi("insert.drawing", () => ctxRef.current.draw()),
      registerEditorUi("insert.image", async (e) => {
        const f = await ctxRef.current.pickFile("image/*");
        if (f) await ctxRef.current.insertFiles(e, [f]);
      }),
      registerEditorUi("insert.file", async (e) => {
        const f = await ctxRef.current.pickFile("*/*");
        if (f) await ctxRef.current.insertFiles(e, [f]);
      }),
      registerEditorUi("edit.copyMarkdown", (e) => void copyAsMarkdown(e, propsRef.current.nodePath).then(() => propsRef.current.onToast?.(t("node.copiedMd")))),
      registerEditorUi("edit.pasteMarkdown", (e) => void pasteAsMarkdown(e, propsRef.current.nodePath)),
    ];
    return () => {
      offs.forEach((off) => off());
      setActiveEditor(null);
    };
  }, [editor]);

  const resolver = useMemo(() => makeResolver(props.nodes), [props.nodes]);
  const vaultHost: VaultHost = {
    resolve: resolver,
    open: (id) => {
      const n = propsRef.current.nodes.find((x) => x.id === id);
      if (n) propsRef.current.onOpenPath(n.path);
    },
    create: (title) => propsRef.current.onCreateNote?.(title),
  };

  const mediaHost: MediaHost = {
    transcribe: async (src, mode) => {
      const path = vaultPathFromUrl(src);
      if (!desktop || !path) {
        propsRef.current.onToast?.(t("media.desktopOnly"));
        return null;
      }
      const res = await desktop.transcribe(path, mode, getLang());
      if (!res.ok) {
        propsRef.current.onError(res.needsAuto ? t("media.needAuto") : (res.error ?? "error"));
        return null;
      }
      return res.text ?? null;
    },
    editDrawing: (src) =>
      new Promise<string | null>((resolve) => setDrawing({ src, resolve })).then((path) => (path ? fileUrl(path) : null)),
  };

  let lastGroup = "";
  return (
    <div className="editor">
      <input ref={fileInput} type="file" hidden />
      {editor && find && <FindBar key={find.tick} editor={editor} replace={find.replace} onClose={() => setFindOpen(null)} onToast={props.onToast} />}
      {editor && linkOpen && <LinkDialog editor={editor} onClose={() => setLinkOpen(false)} />}
      {editor && recording && (
        <RecordDialog
          onDone={(path) => {
            setRecording(false);
            if (path) editor.chain().focus().insertAudio(fileUrl(path)).run();
          }}
        />
      )}
      {drawing && (
        <DrawingDialog
          src={drawing.src}
          onDone={(path) => {
            drawing.resolve(path);
            setDrawing(null);
          }}
        />
      )}
      {editor && (
        <>
          <DragHandle editor={editor}>
            <div className="drag-handle" title={t("ed.dragMove")}>
              ⋮⋮
            </div>
          </DragHandle>
          <BubbleMenu
            editor={editor}
            pluginKey="format"
            shouldShow={({ editor: e, state }) =>
              !state.selection.empty && !e.isActive("image") && !e.isActive("codeBlock") && !e.isActive("youtube") && !e.isActive("inlineDatabase")
            }
          >
            <FormatBar editor={editor} onLink={() => setLinkOpen(true)} />
          </BubbleMenu>
          <BubbleMenu
            editor={editor}
            pluginKey="link"
            shouldShow={({ editor: e, state }) => state.selection.empty && e.isActive("link") && !String(e.getAttributes("link").href ?? "").startsWith("/files/")}
            options={{ placement: "bottom" }}
          >
            <div className="bubble link-bubble">
              <span className="link-url">{String(editor.getAttributes("link").href ?? "")}</span>
              <button onClick={() => window.open(String(editor.getAttributes("link").href ?? ""), "_blank", "noopener")}>↗ {t("link.open")}</button>
              <button onClick={() => setLinkOpen(true)}>{t("link.edit")}</button>
              <button onClick={() => editor.chain().focus().extendMarkRange("link").unsetLink().run()}>{t("link.remove")}</button>
            </div>
          </BubbleMenu>
          <BubbleMenu
            editor={editor}
            pluginKey="table"
            shouldShow={({ editor: e, state }) => state.selection.empty && e.isActive("table")}
            options={{ placement: "top" }}
          >
            <div className="bubble">
              <button onClick={() => editor.chain().focus().addRowAfter().run()}>+ {t("ed.row")}</button>
              <button onClick={() => editor.chain().focus().addColumnAfter().run()}>+ {t("ed.col")}</button>
              <button onClick={() => editor.chain().focus().deleteRow().run()}>− {t("ed.row")}</button>
              <button onClick={() => editor.chain().focus().deleteColumn().run()}>− {t("ed.col")}</button>
              <button onClick={() => editor.chain().focus().toggleHeaderRow().run()}>{t("ed.headerRow")}</button>
              <span className="sep" />
              <button onClick={() => editor.chain().focus().deleteTable().run()}>{t("ed.deleteTable")}</button>
            </div>
          </BubbleMenu>
        </>
      )}
      <MediaHostContext.Provider value={mediaHost}>
        <VaultHostContext.Provider value={vaultHost}>
          <EditorContent editor={editor} />
        </VaultHostContext.Provider>
      </MediaHostContext.Provider>
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

const STYLES: [StringKey, string, (e: TiptapEditor) => void, (e: TiptapEditor) => boolean][] = [
  ["cmd.styleTitle", "H1", (e) => e.chain().focus().setHeading({ level: 1 }).run(), (e) => e.isActive("heading", { level: 1 })],
  ["cmd.styleHeading", "H2", (e) => e.chain().focus().setHeading({ level: 2 }).run(), (e) => e.isActive("heading", { level: 2 })],
  ["cmd.styleSubheading", "H3", (e) => e.chain().focus().setHeading({ level: 3 }).run(), (e) => e.isActive("heading", { level: 3 })],
  ["cmd.styleBody", "¶", (e) => e.chain().focus().setParagraph().run(), (e) => e.isActive("paragraph")],
  ["cmd.styleMono", "M", (e) => e.chain().focus().toggleCodeBlock().run(), (e) => e.isActive("codeBlock")],
];

const ALIGNS: ["left" | "center" | "right" | "justify", StringKey, string][] = [
  ["left", "cmd.alignLeft", "⇤"],
  ["center", "cmd.alignCenter", "↔"],
  ["right", "cmd.alignRight", "⇥"],
  ["justify", "cmd.alignJustify", "☰"],
];

function FormatBar({ editor, onLink }: { editor: TiptapEditor; onLink: () => void }) {
  const [panel, setPanel] = useState<"colors" | "styles" | "align" | null>(null);
  const mark = (name: string, label: string, title: string, run: () => void) => (
    <button className={editor.isActive(name) ? "on" : ""} title={title} onMouseDown={(e) => e.preventDefault()} onClick={run}>
      {label}
    </button>
  );
  if (panel === "colors") {
    return (
      <div className="bubble">
        {TEXT_COLORS.map(([name, value]) => (
          <button
            key={name}
            className="swatch"
            title={t(name)}
            style={{ background: value || "var(--nlc-text-primary)" }}
            onClick={() => {
              if (value) editor.chain().focus().setColor(value).run();
              else editor.chain().focus().unsetColor().run();
              setPanel(null);
            }}
          />
        ))}
        <button onClick={() => setPanel(null)}>✕</button>
      </div>
    );
  }
  if (panel === "styles") {
    return (
      <div className="bubble">
        {STYLES.map(([label, icon, run, active]) => (
          <button key={label} className={active(editor) ? "on" : ""} onMouseDown={(e) => e.preventDefault()} onClick={() => (run(editor), setPanel(null))}>
            <b>{icon}</b> {t(label)}
          </button>
        ))}
        <button onClick={() => setPanel(null)}>✕</button>
      </div>
    );
  }
  if (panel === "align") {
    const current = (editor.getAttributes("paragraph").textAlign ?? editor.getAttributes("heading").textAlign ?? "left") as string;
    return (
      <div className="bubble">
        {ALIGNS.map(([value, label, icon]) => (
          <button key={value} className={current === value ? "on" : ""} title={t(label)} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().setTextAlign(value).run()}>
            {icon}
          </button>
        ))}
        <span className="sep" />
        <button title={t("cmd.indentLess")} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().outdentBlock().run()}>
          ⇠
        </button>
        <button title={t("cmd.indentMore")} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().indentBlock().run()}>
          ⇢
        </button>
        <button title={t("cmd.dirRtl")} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().setTextDirection(editor.getAttributes("paragraph").dir === "rtl" ? "ltr" : "rtl").run()}>
          ⇄
        </button>
        <button onClick={() => setPanel(null)}>✕</button>
      </div>
    );
  }
  return (
    <div className="bubble">
      <button title={t("fmt.style")} onMouseDown={(e) => e.preventDefault()} onClick={() => setPanel("styles")}>
        Aa ▾
      </button>
      <span className="sep" />
      {mark("bold", "B", t("ed.bold", { key: keys("Mod+B") }), () => editor.chain().focus().toggleBold().run())}
      {mark("italic", t("ed.italicMark"), t("ed.italic", { key: keys("Mod+I") }), () => editor.chain().focus().toggleItalic().run())}
      {mark("underline", "U", t("ed.underline", { key: keys("Mod+U") }), () => editor.chain().focus().toggleUnderline().run())}
      {mark("strike", "S", t("ed.strike"), () => editor.chain().focus().toggleStrike().run())}
      {mark("code", "</>", t("ed.inlineCode"), () => editor.chain().focus().toggleCode().run())}
      {mark("highlight", "▮", t("ed.highlight"), () => editor.chain().focus().toggleHighlight().run())}
      {mark("superscript", "x²", `${t("cmd.superscript")} (${keys("Mod+Shift+.")})`, () => editor.chain().focus().toggleSuperscript().run())}
      {mark("subscript", "x₂", `${t("cmd.subscript")} (${keys("Mod+Shift+,")})`, () => editor.chain().focus().toggleSubscript().run())}
      <button title={t("ed.textColor")} onClick={() => setPanel("colors")}>
        A
      </button>
      <button title={t("fmt.align")} onMouseDown={(e) => e.preventDefault()} onClick={() => setPanel("align")}>
        ≡
      </button>
      <span className="sep" />
      {mark("link", t("ed.g.link"), `${t("cmd.link")} (${keys("Mod+L")})`, onLink)}
    </div>
  );
}

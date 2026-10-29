// Uygulama komutları: menüler (masaüstü), klavye kısayolları ve kısayol listesi için tek kaynak.
// Editör komutları etkin editörde çalışır; uygulama/sayfa komutlarını App ve NodeView kaydeder.
// Masaüstünde menü yapısı (etiketlerle birlikte) arayüzden ana sürece gönderilir; böylece metinler tek yerde kalır.

import type { Editor as TiptapEditor } from "@tiptap/react";
import { t, type StringKey } from "./i18n/index.ts";
import { isMac } from "./shortcuts.tsx";
import { changeCase, copyStyle, pasteStyle, copyAsMarkdown, pasteAsMarkdown, pastePlain } from "./editor/text-tools.ts";
import { deleteCheckedTasks, foldKey, headings, moveCheckedToBottom, setAllTasks, setFolded } from "./editor/notes-extensions.ts";

export interface CommandSpec {
  id: string;
  label: StringKey;
  /** "Mod+Shift+E" biçimi; Mod = macOS'ta ⌘, diğerlerinde Ctrl. */
  combo?: string;
  /** Kısayolu editörün kendi tuş eşlemesi (TipTap) işler; genel dinleyici yalnızca menü için kullanır. */
  editorKey?: boolean;
}

type Group = { id: string; label: StringKey; items: (CommandSpec | "-" | { submenu: StringKey; items: (CommandSpec | "-")[] })[] };

const c = (id: string, label: StringKey, combo?: string, editorKey = false): CommandSpec => ({ id, label, combo, editorKey });

/** Masaüstü menülerinde gösterilen komutlar (gruplar ana süreçte Dosya/Düzen/Biçim/Görüntü/Pencere menülerine eklenir). */
export const MENU: Group[] = [
  {
    id: "file",
    label: "menu.file",
    items: [
      c("note.new", "common.quickNote", "Mod+N"),
      c("note.unique", "ob.uniqueNote"),
      c("canvas.new", "ob.newCanvas"),
      c("note.window", "cmd.openWindow"),
      c("note.slides", "ob.slides"),
      "-",
      c("app.importMarkdown", "cmd.importMarkdown"),
      c("app.importNotes", "cmd.importNotes"),
      "-",
      {
        submenu: "cmd.exportAs",
        items: [c("note.export.pdf", "node.savePdf"), c("note.export.docx", "cmd.exportDocx"), c("note.export.rtf", "cmd.exportRtf"), c("note.export.txt", "cmd.exportTxt"), c("note.export.md", "export.md"), c("note.export.html", "export.html")],
      },
      c("note.print", "cmd.print", "Mod+P"),
      "-",
      c("note.copyPath", "ob.copyPath"),
      c("note.reveal", "ob.reveal"),
    ],
  },
  {
    id: "edit",
    label: "menu.edit",
    items: [
      c("edit.copyMarkdown", "cmd.copyMarkdown"),
      c("edit.pasteMarkdown", "cmd.pasteMarkdown"),
      c("edit.pastePlain", "cmd.pastePlain", "Mod+Alt+Shift+V"),
      "-",
      c("find.open", "cmd.find", "Mod+F"),
      c("find.replace", "cmd.findReplace", "Mod+Alt+F"),
      c("find.next", "cmd.findNext", "Mod+G"),
      c("find.prev", "cmd.findPrev", "Mod+Shift+G"),
      "-",
      c("edit.spellcheck", "cmd.spellcheck"),
      "-",
      c("note.addProperty", "ob.addProperty", "Mod+;"),
      c("note.reading", "ob.readingView", "Mod+Alt+E"),
      {
        submenu: "ob.composer",
        items: [c("note.merge", "ob.merge"), c("note.extract", "ob.extract"), c("note.extractHeading", "ob.extractHeading")],
      },
      "-",
      { submenu: "cmd.speech", items: [c("speech.start", "cmd.speechStart"), c("speech.stop", "cmd.speechStop")] },
    ],
  },
  {
    id: "format",
    label: "menu.format",
    items: [
      c("style.title", "cmd.styleTitle", "Mod+Alt+1", true),
      c("style.heading", "cmd.styleHeading", "Mod+Alt+2", true),
      c("style.subheading", "cmd.styleSubheading", "Mod+Alt+3", true),
      c("style.body", "cmd.styleBody", "Mod+Alt+0", true),
      c("style.mono", "cmd.styleMono", "Mod+Alt+C", true),
      "-",
      c("list.bullet", "ed.c.bullet", "Mod+Shift+8", true),
      c("list.dashed", "cmd.dashedList", "Mod+Shift+6", true),
      c("list.numbered", "ed.c.ordered", "Mod+Shift+7", true),
      c("list.checklist", "ed.c.todo", "Mod+Shift+9", true),
      c("fmt.quote", "ed.c.quote", "Mod+Shift+B", true),
      {
        submenu: "cmd.moreChecklist",
        items: [c("task.checkAll", "cmd.checkAll"), c("task.uncheckAll", "cmd.uncheckAll"), "-", c("task.moveChecked", "cmd.moveChecked"), c("task.deleteChecked", "cmd.deleteChecked"), "-", c("page.sortChecked", "cmd.autoSortChecked")],
      },
      "-",
      {
        submenu: "cmd.font",
        items: [
          c("fmt.bold", "keys.bold", "Mod+B", true),
          c("fmt.italic", "keys.italic", "Mod+I", true),
          c("fmt.underline", "keys.underline", "Mod+U", true),
          c("fmt.strike", "ed.strike", "Mod+Shift+S", true),
          c("fmt.highlight", "ed.highlight", "Mod+Shift+H", true),
          "-",
          c("fmt.superscript", "cmd.superscript", "Mod+Shift+.", true),
          c("fmt.subscript", "cmd.subscript", "Mod+Shift+,", true),
          "-",
          c("font.bigger", "cmd.bigger", "Mod+Alt+="),
          c("font.smaller", "cmd.smaller", "Mod+Alt+-"),
          c("font.panel", "cmd.fontPanel", "Mod+T"),
          "-",
          c("style.copy", "cmd.copyStyle"),
          c("style.paste", "cmd.pasteStyle"),
        ],
      },
      {
        submenu: "cmd.text",
        items: [
          c("align.left", "cmd.alignLeft", "Mod+Shift+L", true),
          c("align.center", "cmd.alignCenter", "Mod+Shift+E", true),
          c("align.right", "cmd.alignRight", "Mod+Shift+R", true),
          c("align.justify", "cmd.alignJustify", "Mod+Shift+J", true),
          "-",
          c("indent.more", "cmd.indentMore", "Mod+]", true),
          c("indent.less", "cmd.indentLess", "Mod+[", true),
          "-",
          c("dir.ltr", "cmd.dirLtr"),
          c("dir.rtl", "cmd.dirRtl"),
        ],
      },
      {
        submenu: "cmd.transform",
        items: [c("case.upper", "cmd.upper"), c("case.lower", "cmd.lower"), c("case.title", "cmd.capitalize")],
      },
      "-",
      c("link.edit", "cmd.link", "Mod+L"),
      c("insert.table", "ed.c.table"),
      c("insert.divider", "ed.c.divider"),
      c("insert.audio", "cmd.recordAudio"),
      c("insert.drawing", "cmd.drawing"),
      c("insert.file", "cmd.attachFile"),
      c("insert.template", "ob.insertTemplate"),
      c("insert.footnote", "ob.footnote"),
      c("insert.callout", "ob.callout"),
      c("insert.math", "ob.mathBlock"),
      c("insert.mermaid", "ob.mermaid"),
      c("fmt.comment", "ob.comment"),
      c("fmt.clear", "ob.clearFormat", "Mod+\\"),
      "-",
      c("line.up", "ob.moveUp", "Alt+ArrowUp", true),
      c("line.down", "ob.moveDown", "Alt+ArrowDown", true),
      "-",
      c("fold.toggle", "cmd.foldSection"),
      c("fold.all", "cmd.foldAll"),
      c("unfold.all", "cmd.unfoldAll"),
    ],
  },
  {
    id: "view",
    label: "menu.view",
    items: [
      c("view.focus", "cmd.focusMode", "Mod+Shift+F"),
      "-",
      c("view.allNotes", "list.allNotes"),
      c("view.recent", "list.recent"),
      c("view.attachments", "att.title"),
      "-",
      c("view.list", "list.asList"),
      c("view.gallery", "list.asGallery"),
      c("view.groupByDate", "list.groupByDate"),
      c("view.noteCount", "list.showCount"),
      "-",
      c("note.lightBg", "cmd.lightBg"),
      c("note.pin", "cmd.pin"),
      c("note.lock", "cmd.lock"),
      c("note.closeLocked", "cmd.closeLocked"),
    ],
  },
  {
    id: "go",
    label: "menu.go",
    items: [
      c("app.palette", "ob.palette", "Mod+Shift+P"),
      c("app.switcher", "ob.switcher", "Mod+O"),
      c("app.search", "ob.search", "Mod+K"),
      "-",
      c("tab.new", "ob.newTab", "Mod+Alt+T"),
      c("tab.duplicate", "ob.duplicateTab"),
      c("tab.close", "ob.closeTab", "Mod+Alt+W"),
      c("workspace.save", "ob.workspaceSave"),
      c("workspace.load", "ob.workspaceLoad"),
      "-",
      c("nav.back", "ob.back", "Mod+Alt+ArrowLeft"),
      c("nav.forward", "ob.forward", "Mod+Alt+ArrowRight"),
      "-",
      c("view.graph", "ob.graph"),
      c("view.sidePanel", "ob.sidePanel", "Mod+Shift+O"),
      c("view.outline", "ob.outline"),
      c("view.links", "ob.links"),
      c("view.localGraph", "ob.localGraph"),
      c("view.history", "ob.history"),
      "-",
      c("daily.today", "ob.dailyToday", "Mod+Shift+D"),
      c("daily.prev", "ob.dailyPrev"),
      c("daily.next", "ob.dailyNext"),
      c("note.random", "ob.random"),
      "-",
      c("app.settings", "ob.settings", "Mod+,"),
      c("app.shortcuts", "keys.title", "Mod+/"),
    ],
  },
];

/** Kısayolu olan tüm komutlar (kısayol listesi ve genel dinleyici). */
export const ALL_COMMANDS: CommandSpec[] = MENU.flatMap((g) => g.items.flatMap((i) => (i === "-" ? [] : "submenu" in i ? i.items.filter((x): x is CommandSpec => x !== "-") : [i])));

// ------------------------------------------------------------------ Kullanıcı kısayolları (Obsidian "Hotkeys")

/** Kullanıcının değiştirdiği kısayollar: komut id → kısayol ("" = kısayolsuz). Tercihlerden App yükler. */
let overrides: Record<string, string> = {};

export function setHotkeyOverrides(map: Record<string, string> | null | undefined): void {
  overrides = map && typeof map === "object" ? map : {};
}

/** Komutun geçerli kısayolu: kullanıcınınki varsa o, yoksa varsayılan. */
export function comboFor(cmd: CommandSpec): string | undefined {
  return cmd.id in overrides ? overrides[cmd.id] || undefined : cmd.combo;
}

// ------------------------------------------------------------------ Etkin editör ve kayıtlı işleyiciler

let activeEditor: TiptapEditor | null = null;
/** Komut başına işleyici yığını: en son kaydeden (ör. açık liste görünümü) önce gelir. */
const handlers = new Map<string, (() => void)[]>();
const editorUi = new Map<string, (e: TiptapEditor) => void>();

export function setActiveEditor(e: TiptapEditor | null): void {
  activeEditor = e;
}

export const getActiveEditor = () => (activeEditor && !activeEditor.isDestroyed ? activeEditor : null);

/** Uygulama ya da sayfa komutu kaydeder (bileşen kaldırılınca çağrılacak iptal işlevini döndürür). */
export function registerCommand(id: string, fn: () => void): () => void {
  handlers.set(id, [...(handlers.get(id) ?? []), fn]);
  return () => handlers.set(id, (handlers.get(id) ?? []).filter((f) => f !== fn));
}

/** Editör bileşeninin arayüz gerektiren komutları (bul çubuğu, bağlantı penceresi…). */
export function registerEditorUi(id: string, fn: (e: TiptapEditor) => void): () => void {
  editorUi.set(id, fn);
  return () => {
    if (editorUi.get(id) === fn) editorUi.delete(id);
  };
}

const EDITOR: Record<string, (e: TiptapEditor) => unknown> = {
  "style.title": (e) => e.chain().focus().setHeading({ level: 1 }).run(),
  "style.heading": (e) => e.chain().focus().setHeading({ level: 2 }).run(),
  "style.subheading": (e) => e.chain().focus().setHeading({ level: 3 }).run(),
  "style.body": (e) => e.chain().focus().setParagraph().run(),
  "style.mono": (e) => e.chain().focus().toggleCodeBlock().run(),
  "list.bullet": (e) => e.chain().focus().toggleBulletList().run(),
  "list.dashed": (e) => e.chain().focus().toggleDashedList().run(),
  "list.numbered": (e) => e.chain().focus().toggleOrderedList().run(),
  "list.checklist": (e) => e.chain().focus().toggleTaskList().run(),
  "fmt.quote": (e) => e.chain().focus().toggleBlockquote().run(),
  "task.checkAll": (e) => setAllTasks(e, true),
  "task.uncheckAll": (e) => setAllTasks(e, false),
  "task.moveChecked": (e) => moveCheckedToBottom(e),
  "task.deleteChecked": (e) => deleteCheckedTasks(e),
  "fmt.bold": (e) => e.chain().focus().toggleBold().run(),
  "fmt.italic": (e) => e.chain().focus().toggleItalic().run(),
  "fmt.underline": (e) => e.chain().focus().toggleUnderline().run(),
  "fmt.strike": (e) => e.chain().focus().toggleStrike().run(),
  "fmt.highlight": (e) => e.chain().focus().toggleHighlight().run(),
  "fmt.superscript": (e) => e.chain().focus().toggleSuperscript().run(),
  "fmt.subscript": (e) => e.chain().focus().toggleSubscript().run(),
  "style.copy": (e) => copyStyle(e),
  "style.paste": (e) => pasteStyle(e),
  "align.left": (e) => e.chain().focus().setTextAlign("left").run(),
  "align.center": (e) => e.chain().focus().setTextAlign("center").run(),
  "align.right": (e) => e.chain().focus().setTextAlign("right").run(),
  "align.justify": (e) => e.chain().focus().setTextAlign("justify").run(),
  "indent.more": (e) => e.chain().focus().indentBlock().run(),
  "indent.less": (e) => e.chain().focus().outdentBlock().run(),
  "dir.ltr": (e) => e.chain().focus().setTextDirection("ltr").run(),
  "dir.rtl": (e) => e.chain().focus().setTextDirection("rtl").run(),
  "case.upper": (e) => changeCase(e, "upper"),
  "case.lower": (e) => changeCase(e, "lower"),
  "case.title": (e) => changeCase(e, "title"),
  "insert.table": (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  "insert.divider": (e) => e.chain().focus().setHorizontalRule().run(),
  "insert.footnote": (e) => e.chain().focus().insertFootnote().run(),
  "insert.callout": (e) => e.chain().focus().setCallout("note").run(),
  "insert.math": (e) => e.chain().focus().insertMathBlock().run(),
  "insert.mermaid": (e) => e.chain().focus().insertContent({ type: "codeBlock", attrs: { language: "mermaid" }, content: [{ type: "text", text: "graph TD\n  A --> B" }] }).run(),
  "fmt.comment": (e) => e.chain().focus().toggleComment().run(),
  "fmt.clear": (e) => e.chain().focus().unsetAllMarks().clearNodes().run(),
  "line.up": (e) => e.chain().focus().moveBlock(-1).run(),
  "line.down": (e) => e.chain().focus().moveBlock(1).run(),
  "edit.copyMarkdown": (e) => copyAsMarkdown(e),
  "edit.pasteMarkdown": (e) => pasteAsMarkdown(e),
  "edit.pastePlain": (e) => pastePlain(e),
  "fold.all": (e) => setFolded(e, headings(e.state.doc).map((h) => h.pos)),
  "unfold.all": (e) => setFolded(e, []),
  "fold.toggle": (e) => {
    const top = e.state.selection.$from.depth > 0 ? e.state.selection.$from.before(1) : 0;
    const owner = headings(e.state.doc)
      .filter((h) => h.pos <= top)
      .pop();
    if (!owner) return;
    const folded = foldKey.getState(e.state)!.folded;
    setFolded(e, folded.includes(owner.pos) ? folded.filter((p) => p !== owner.pos) : [...folded, owner.pos]);
  },
};

/** Komut şu anda çalıştırılabilir mi (komut paleti yalnızca bunları gösterir). */
export function canRun(id: string): boolean {
  if (handlers.get(id)?.length) return true;
  return !!getActiveEditor() && (editorUi.has(id) || id in EDITOR);
}

/** Komutu çalıştırır; işleyen yoksa false. */
export function runCommand(id: string): boolean {
  const app = handlers.get(id)?.at(-1);
  if (app) {
    app();
    return true;
  }
  const e = getActiveEditor();
  if (!e) return false;
  const ui = editorUi.get(id);
  if (ui) {
    ui(e);
    return true;
  }
  const fn = EDITOR[id];
  if (!fn) return false;
  fn(e);
  return true;
}

// ------------------------------------------------------------------ Klavye

/** KeyboardEvent → "Mod+Shift+E" biçimi (karşılaştırma için). */
export function comboOf(e: KeyboardEvent): string {
  const parts: string[] = [];
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (mod) parts.push("Mod");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (isMac && e.ctrlKey) parts.push("Ctrl");
  // Shift/Alt basılıyken e.key değişir (ör. "+" ya da "≠"); fiziksel tuşu kullan.
  const code = e.code;
  const key = /^Key([A-Z])$/.exec(code)?.[1] ?? /^Digit(\d)$/.exec(code)?.[1] ?? ({ Equal: "=", Minus: "-", Period: ".", Comma: ",", BracketLeft: "[", BracketRight: "]", Slash: "/", Backslash: "\\", Semicolon: ";", Enter: "Enter" } as Record<string, string>)[code] ?? e.key;
  parts.push(key.length === 1 ? key.toUpperCase() : key);
  return parts.join("+");
}

const normalizeCombo = (combo: string) =>
  combo
    .split("+")
    .map((p) => (p.length === 1 ? p.toUpperCase() : p))
    .join("+");

/** Genel kısayol dinleyicisi: editör dışında da çalışan kısayollar. Editörün kendi işlediği kısayollar atlanır. */
export function handleShortcut(e: KeyboardEvent): boolean {
  const combo = comboOf(e);
  for (const cmd of ALL_COMMANDS) {
    const own = comboFor(cmd);
    // Editörün kendi tuş eşlemesi varsayılan kısayolu işler; kullanıcı kısayol atadıysa onu genel dinleyici çalıştırır.
    if (!own || (cmd.editorKey && !(cmd.id in overrides)) || e.defaultPrevented) continue;
    if (normalizeCombo(own) !== combo) continue;
    if (runCommand(cmd.id)) {
      e.preventDefault();
      return true;
    }
  }
  return false;
}

/** Ana sürece gönderilecek menü yapısı (çevrilmiş etiketler ve Electron kısayol biçimi). */
export function menuSpec(): unknown {
  const accel = (combo?: string) => combo?.replace(/^Mod\b/, "CmdOrCtrl").replace(/Arrow(Up|Down|Left|Right)/, "$1");
  const item = (i: CommandSpec | "-"): unknown => (i === "-" ? { type: "separator" } : { id: i.id, label: t(i.label), accelerator: accel(comboFor(i)) });
  return MENU.map((g) => ({
    id: g.id,
    label: t(g.label),
    items: g.items.map((i) => (i !== "-" && "submenu" in i ? { label: t(i.submenu), submenu: i.items.map(item) } : item(i))),
  }));
}

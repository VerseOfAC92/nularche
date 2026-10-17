// Klavye kısayolları: işletim sistemine göre gösterim (macOS: ⇧⌘D, Windows/Linux: Ctrl+Shift+D) ve kısayol listesi.
// Kısayolların kendisi her yerde "Mod" (macOS'ta ⌘, diğerlerinde Ctrl) ile tanımlanır.

import { t, type StringKey } from "./i18n/index.ts";

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);

const MAC: Record<string, string> = { Mod: "⌘", Shift: "⇧", Alt: "⌥", Ctrl: "⌃", Enter: "↩", Backspace: "⌫" };
const OTHER: Record<string, string> = { Mod: "Ctrl", Shift: "Shift", Alt: "Alt", Ctrl: "Ctrl", Enter: "Enter", Backspace: "Backspace" };

/** "Mod+Shift+D" → macOS'ta "⇧⌘D", Windows/Linux'ta "Ctrl+Shift+D". */
export function keys(combo: string): string {
  const parts = combo.split("+");
  if (isMac) {
    // macOS sırası: ⌃ ⌥ ⇧ ⌘ ve sonra tuş
    const order = ["Ctrl", "Alt", "Shift", "Mod"];
    const mods = order.filter((m) => parts.includes(m)).map((m) => MAC[m]);
    const rest = parts.filter((p) => !order.includes(p)).map((p) => MAC[p] ?? p.toUpperCase());
    return [...mods, ...rest].join("");
  }
  return parts.map((p) => OTHER[p] ?? (p.length === 1 ? p.toUpperCase() : p)).join("+");
}

/** Klavye olayında "Mod" tuşu (macOS'ta ⌘, diğerlerinde Ctrl) basılı mı. */
export const modPressed = (e: { metaKey: boolean; ctrlKey: boolean }) => (isMac ? e.metaKey : e.ctrlKey);

interface Shortcut {
  combo: string;
  label: StringKey;
}

const GROUPS: { title: StringKey; items: Shortcut[] }[] = [
  {
    title: "keys.general",
    items: [
      { combo: "Mod+K", label: "sidebar.search" },
      { combo: "Mod+N", label: "common.quickNote" },
      { combo: "Mod+Shift+D", label: "daily.today" },
      { combo: "Mod+S", label: "keys.save" },
      { combo: "Mod+,", label: "settings.title" },
      { combo: "Mod+/", label: "keys.title" },
      { combo: "Mod+Enter", label: "keys.capture" },
    ],
  },
  {
    title: "keys.editing",
    items: [
      { combo: "/", label: "keys.commands" },
      { combo: "[[", label: "ed.c.nodeLink" },
      { combo: "Mod+B", label: "keys.bold" },
      { combo: "Mod+I", label: "keys.italic" },
      { combo: "Mod+U", label: "keys.underline" },
      { combo: "Mod+Shift+S", label: "ed.strike" },
      { combo: "Mod+E", label: "ed.inlineCode" },
      { combo: "Mod+Shift+H", label: "ed.highlight" },
      { combo: "Mod+Z", label: "keys.undo" },
      { combo: isMac ? "Mod+Shift+Z" : "Mod+Y", label: "keys.redo" },
    ],
  },
  {
    title: "keys.blocks",
    items: [
      { combo: "Mod+Alt+1", label: "ed.c.h1" },
      { combo: "Mod+Alt+2", label: "ed.c.h2" },
      { combo: "Mod+Alt+3", label: "ed.c.h3" },
      { combo: "Mod+Shift+8", label: "ed.c.bullet" },
      { combo: "Mod+Shift+7", label: "ed.c.ordered" },
      { combo: "Mod+Shift+9", label: "ed.c.todo" },
      { combo: "Mod+Shift+B", label: "ed.c.quote" },
      { combo: "Mod+Alt+C", label: "ed.c.code" },
    ],
  },
];

const literal = (combo: string) => combo === "/" || combo === "[[";

export function ShortcutList() {
  return (
    <div className="shortcut-groups">
      {GROUPS.map((g) => (
        <div key={g.title} className="shortcut-group">
          <h4>{t(g.title)}</h4>
          {g.items.map((s) => (
            <div key={s.combo + s.label} className="shortcut-row">
              <span>{t(s.label).replace(/\s*\(.*\)$/, "")}</span>
              <kbd>{literal(s.combo) ? s.combo : keys(s.combo)}</kbd>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog shortcuts">
        <div className="dialog-head">
          <h2>⌨ {t("keys.title")}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t("common.close")}>
            ✕
          </button>
        </div>
        <p className="muted small">{isMac ? t("keys.hintMac") : t("keys.hintOther")}</p>
        <ShortcutList />
      </div>
    </div>
  );
}

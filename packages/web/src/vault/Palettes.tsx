// Komut paleti (⇧⌘P) ve hızlı geçiş (⌘O): Obsidian'daki gibi klavyeden komut çalıştırma ve not açma/oluşturma.

import type { NodeMeta } from "../api.ts";
import { ALL_COMMANDS, canRun, comboFor, runCommand } from "../commands.ts";
import { t } from "../i18n/index.ts";
import { getPref, setPref } from "../prefs.ts";
import { keys } from "../shortcuts.tsx";
import { isExcluded } from "./excluded.ts";
import { Picker, type PickItem } from "./Picker.tsx";

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const recent = getPref<string[]>("paletteRecent", []);
  const seen = new Set<string>();
  const cmds = ALL_COMMANDS.filter((c) => c.id !== "app.palette" && !seen.has(c.id) && seen.add(c.id) && canRun(c.id));
  // Son kullanılanlar önce.
  cmds.sort((a, b) => (recent.indexOf(a.id) + 1 || 999) - (recent.indexOf(b.id) + 1 || 999));
  const items: PickItem[] = cmds.map((c) => {
    const combo = comboFor(c);
    return { id: c.id, label: t(c.label), hint: combo ? keys(combo) : undefined };
  });
  return (
    <Picker
      items={items}
      placeholder={t("ob.palettePlaceholder")}
      empty={t("ob.noCommands")}
      limit={500}
      onClose={onClose}
      onPick={(it) => {
        onClose();
        setPref("paletteRecent", [it.id, ...recent.filter((x) => x !== it.id)].slice(0, 12));
        // Pencere kapandıktan sonra çalışsın (editör odağı geri gelir). requestAnimationFrame arka plandaki pencerede beklerdi.
        setTimeout(() => runCommand(it.id), 0);
      }}
    />
  );
}

export function QuickSwitcher({
  nodes,
  onOpen,
  onCreate,
  onClose,
}: {
  nodes: NodeMeta[];
  onOpen: (id: string, newWindow: boolean) => void;
  onCreate: (title: string) => void;
  onClose: () => void;
}) {
  const excluded = getPref<string[]>("excludedFiles", []);
  const recent = getPref<string[]>("recent", []);
  const visible = nodes.filter((n) => !isExcluded(n.path, excluded));
  visible.sort((a, b) => (recent.indexOf(a.id) + 1 || 999) - (recent.indexOf(b.id) + 1 || 999) || b.updatedAt - a.updatedAt);
  const items: PickItem[] = visible.map((n) => ({
    id: n.id,
    label: n.title,
    aliases: [...n.aliases, n.path],
    detail: n.aliases.length ? `${n.aliases.join(", ")} · ${n.path.replace(/\.md$/, "")}` : n.path.replace(/\.md$/, ""),
    icon: n.icon ?? (n.layoutMode === "canvas" ? "🧩" : "◇"),
  }));
  return (
    <Picker
      items={items}
      placeholder={t("ob.switcherPlaceholder")}
      onClose={onClose}
      extra={(q) => (nodes.some((n) => n.title.toLocaleLowerCase("tr") === q.toLocaleLowerCase("tr")) ? null : { id: "__create__", label: t("ob.createNote", { title: q }), icon: "＋", hint: keys("Shift+Enter") })}
      onPick={(it, q, e) => {
        onClose();
        if (it.id === "__create__" || (e.shift && q)) onCreate(q);
        else onOpen(it.id, e.mod);
      }}
    />
  );
}

/** Not seçici (birleştirme hedefi, tuvale not ekleme). */
export function NotePicker({ nodes, placeholder, onPick, onClose }: { nodes: NodeMeta[]; placeholder: string; onPick: (n: NodeMeta) => void; onClose: () => void }) {
  return (
    <Picker
      items={nodes.map((n) => ({ id: n.id, label: n.title, aliases: [...n.aliases, n.path], detail: n.path.replace(/\.md$/, ""), icon: n.icon ?? "◇" }))}
      placeholder={placeholder}
      onClose={onClose}
      onPick={(it) => {
        onClose();
        const n = nodes.find((x) => x.id === it.id);
        if (n) onPick(n);
      }}
    />
  );
}

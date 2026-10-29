// Sekmeler ve çalışma alanları (Obsidian "Tabs" ve "Workspaces"). Her sekme bir görünümün adresidir (#not-id, #graph…);
// gezinme etkin sekmenin adresini değiştirir. Sekmeler ve kaydedilen çalışma alanları Origin tercihlerinde tutulur.
// Ctrl+Tab / Ctrl+Shift+Tab sekmeler arasında dolaşır.

import { useEffect } from "react";
import type { NodeMeta } from "../api.ts";
import { t } from "../i18n/index.ts";

export interface TabState {
  hashes: string[];
  active: number;
}

export const EMPTY_TABS: TabState = { hashes: [""], active: 0 };

/** Sekme başlığı: notun adı ya da görünümün adı. */
function label(hash: string, nodes: NodeMeta[]): { icon: string; text: string } {
  const h = decodeURIComponent(hash.replace(/^#/, ""));
  if (!h) return { icon: "⌂", text: "Nularche" };
  const named: Record<string, [string, string]> = {
    graph: ["🕸", t("ob.graph")],
    notes: ["🗒", t("list.allNotes")],
    recent: ["🕘", t("list.recent")],
    attachments: ["📎", t("att.title")],
    shadow: ["◐", "Shadow"],
    trash: ["🗑", t("trash.title")],
  };
  if (named[h]) return { icon: named[h][0], text: named[h][1] };
  if (h.startsWith("tag:")) return { icon: "#", text: h.slice(4) };
  const n = nodes.find((x) => x.id === h);
  return n ? { icon: n.icon ?? (n.layoutMode === "canvas" ? "🧩" : "◇"), text: n.title } : { icon: "◇", text: "…" };
}

export function TabBar({ tabs, nodes, onSelect, onClose, onNew }: { tabs: TabState; nodes: NodeMeta[]; onSelect: (i: number) => void; onClose: (i: number) => void; onNew: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.key !== "Tab" || tabs.hashes.length < 2) return;
      e.preventDefault();
      const n = tabs.hashes.length;
      onSelect((tabs.active + (e.shiftKey ? n - 1 : 1)) % n);
    };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [tabs, onSelect]);
  if (tabs.hashes.length < 2) return null;
  return (
    <div className="tab-bar" role="tablist">
      {tabs.hashes.map((h, i) => {
        const l = label(h, nodes);
        return (
          <div key={`${i}:${h}`} role="tab" aria-selected={i === tabs.active} className={`tab ${i === tabs.active ? "on" : ""}`} onClick={() => onSelect(i)} onAuxClick={(e) => e.button === 1 && onClose(i)} title={l.text}>
            <span className="tab-icon">{l.icon}</span>
            <span className="tab-text">{l.text}</span>
            <button
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                onClose(i);
              }}
              aria-label={t("common.close")}
            >
              ×
            </button>
          </div>
        );
      })}
      <button className="tab-new" onClick={onNew} title={t("ob.newTab")}>
        ＋
      </button>
    </div>
  );
}

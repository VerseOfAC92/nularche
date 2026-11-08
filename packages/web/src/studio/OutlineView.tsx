// Taslak (2.0): planlama için hiyerarşik satırlar (I., A., 1., a. …). Enter yeni satır, Tab/⇧Tab girinti,
// ⌥↑/⌥↓ taşı, boş satırda ⌫ sil, ⌘↩ satır notu. Satırlar bir nota (sahne/bölüm) bağlanabilir; bir manuskript bu
// taslağı izleyince yazılmamış satırlar orada "planlanan" olarak görünür.

import { useEffect, useRef, useState } from "react";
import { api, type NodeMeta } from "../api.ts";
import { desktop } from "../desktop.ts";
import { t } from "../i18n/index.ts";
import { NotePicker } from "../vault/Palettes.tsx";
import { MAX_OUTLINE_DEPTH, newWritingId, type OutlineRow } from "../../../core/src/writing.ts";
import { colorOf, useWriting } from "./useWriting.ts";
import { ColorDots } from "./ui.tsx";

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX"];
const alpha = (n: number, upper: boolean) => {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(((x - 1) % 26) + (upper ? 65 : 97)) + s;
  return s;
};

/** Klasik taslak numaraları: I. → A. → 1. → a. → (1) → (a) */
export function outlineNumbers(rows: OutlineRow[]): string[] {
  const counters: number[] = [];
  return rows.map((r) => {
    counters.length = r.depth + 1;
    for (let i = 0; i <= r.depth; i++) counters[i] ??= 0;
    counters[r.depth]++;
    const n = counters[r.depth];
    switch (r.depth % 6) {
      case 0:
        return `${ROMAN[n - 1] ?? n}.`;
      case 1:
        return `${alpha(n, true)}.`;
      case 2:
        return `${n}.`;
      case 3:
        return `${alpha(n, false)}.`;
      case 4:
        return `(${n})`;
      default:
        return `(${alpha(n, false)})`;
    }
  });
}

/** Satırın (alt satırlarıyla birlikte) kapladığı aralık. */
function blockEnd(rows: OutlineRow[], i: number): number {
  let j = i + 1;
  while (j < rows.length && rows[j].depth > rows[i].depth) j++;
  return j;
}

export function OutlineView({
  id,
  body,
  nodes,
  onChange,
  onOpen,
  onChanged,
  onToast,
  onFlush,
}: {
  id: string;
  body: string;
  nodes: NodeMeta[];
  onChange: (body: string) => void;
  onOpen: (id: string) => void;
  onChanged: () => void;
  onToast: (msg: string) => void;
  onFlush: () => Promise<void>;
}) {
  const { data, update, broken } = useWriting("outline", body, onChange);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [linkFor, setLinkFor] = useState<string | null>(null);
  const [colorFor, setColorFor] = useState<string | null>(null);
  const [numbers, setNumbers] = useState(true);
  const refs = useRef(new Map<string, HTMLInputElement>());
  const byPath = new Map(nodes.map((n) => [n.path, n]));

  useEffect(() => {
    if (!focusId) return;
    const el = refs.current.get(focusId);
    if (el && document.activeElement !== el) el.focus();
  }, [focusId, data]);

  if (broken) return <p className="banner error">{t("ws.broken")}</p>;

  const rows = data.rows;
  const nums = outlineNumbers(rows);
  const hidden = new Set<string>();
  for (let i = 0; i < rows.length; i++) if (collapsed.has(rows[i].id)) for (let j = i + 1; j < blockEnd(rows, i); j++) hidden.add(rows[j].id);

  const patch = (rid: string, p: Partial<OutlineRow>) => update((d) => ((d.rows = d.rows.map((r) => (r.id === rid ? { ...r, ...p } : r))), d));
  const insertAfter = (i: number, depth: number) => {
    const row: OutlineRow = { id: newWritingId(), text: "", depth };
    update((d) => (d.rows.splice(i < 0 ? d.rows.length : blockEnd(d.rows, i), 0, row), d));
    setFocusId(row.id);
  };
  const shift = (i: number, delta: 1 | -1) =>
    update((d) => {
      const end = blockEnd(d.rows, i);
      const maxDepth = i === 0 ? 0 : Math.min(MAX_OUTLINE_DEPTH, d.rows[i - 1].depth + 1);
      const nextDepth = Math.max(0, Math.min(maxDepth, d.rows[i].depth + delta));
      const diff = nextDepth - d.rows[i].depth;
      if (!diff) return d;
      for (let j = i; j < end; j++) d.rows[j].depth = Math.max(0, Math.min(MAX_OUTLINE_DEPTH, d.rows[j].depth + diff));
      return d;
    });
  const move = (i: number, dir: -1 | 1) =>
    update((d) => {
      const end = blockEnd(d.rows, i);
      const block = d.rows.slice(i, end);
      if (dir < 0) {
        let p = i - 1;
        while (p > 0 && d.rows[p].depth > block[0].depth) p--;
        // Yalnızca aynı düzeydeki bir önceki kardeşin önüne geçer (üst satırın dışına çıkmaz).
        if (p < 0 || i === 0 || d.rows[p].depth !== block[0].depth) return d;
        d.rows.splice(i, block.length);
        d.rows.splice(p, 0, ...block);
      } else {
        if (end >= d.rows.length) return d;
        const nextEnd = blockEnd(d.rows, end);
        d.rows.splice(i, block.length);
        d.rows.splice(nextEnd - block.length, 0, ...block);
      }
      return d;
    });
  const remove = (i: number) => {
    const prev = rows[i - 1]?.id ?? rows[i + 1]?.id ?? null;
    update((d) => (d.rows.splice(i, 1), d));
    setFocusId(prev);
  };

  const createNote = async (r: OutlineRow) => {
    await onFlush();
    const n = await api.create(r.text.trim() || t("ws.untitledRow"), id);
    const fresh = await api.read(n.id);
    patch(r.id, { file: fresh.path });
    onChanged();
    onToast(t("ws.noteCreated", { title: n.title }));
  };

  const copyMarkdown = async () => {
    const md = rows.map((r) => `${"  ".repeat(r.depth)}- ${r.done ? "[x] " : ""}${r.text}${r.notes ? `\n${"  ".repeat(r.depth + 1)}${r.notes.replace(/\n/g, `\n${"  ".repeat(r.depth + 1)}`)}` : ""}`).join("\n");
    if (desktop) await desktop.copy(md);
    else await navigator.clipboard.writeText(md);
    onToast(t("ws.copiedOutline"));
  };

  return (
    <div className="ws-view ws-outline">
      <div className="ws-toolbar">
        <span className="muted small">{t("ws.rows", { n: rows.length })}</span>
        <span className="grow" />
        <label className="check small">
          <input type="checkbox" checked={numbers} onChange={(e) => setNumbers(e.target.checked)} /> {t("ws.numbering")}
        </label>
        <button className="secondary" onClick={() => setCollapsed(new Set(rows.filter((r, i) => blockEnd(rows, i) > i + 1).map((r) => r.id)))}>
          {t("cmd.foldAll")}
        </button>
        <button className="secondary" onClick={() => setCollapsed(new Set())}>
          {t("cmd.unfoldAll")}
        </button>
        <button className="secondary" onClick={() => void copyMarkdown()}>
          ⧉ {t("ws.copyMarkdown")}
        </button>
      </div>
      <p className="muted small ws-hint">{t("ws.outlineHint")}</p>
      <div className="outline-rows">
        {rows.map((r, i) => {
          if (hidden.has(r.id)) return null;
          const hasKids = blockEnd(rows, i) > i + 1;
          const linked = r.file ? byPath.get(r.file) : undefined;
          return (
            <div key={r.id} className={`outline-row depth-${Math.min(r.depth, 5)} ${r.done ? "done" : ""}`} style={{ paddingLeft: 8 + r.depth * 26, borderLeftColor: colorOf(r.color) ?? "transparent" }}>
              <button className="fold-btn" style={{ visibility: hasKids ? "visible" : "hidden" }} onClick={() => setCollapsed((s) => (s.has(r.id) ? (s.delete(r.id), new Set(s)) : new Set(s.add(r.id))))}>
                {collapsed.has(r.id) ? "▸" : "▾"}
              </button>
              {numbers && <span className="outline-num">{nums[i]}</span>}
              <input type="checkbox" className="outline-done" checked={!!r.done} onChange={(e) => patch(r.id, { done: e.target.checked || undefined })} title={t("ws.markDone")} />
              <div className="grow">
                <input
                  ref={(el) => void (el ? refs.current.set(r.id, el) : refs.current.delete(r.id))}
                  className="outline-text"
                  value={r.text}
                  placeholder={t("ws.rowPlaceholder")}
                  onFocus={() => setFocusId(r.id)}
                  onChange={(e) => patch(r.id, { text: e.target.value })}
                  onKeyDown={(e) => {
                    const mod = e.metaKey || e.ctrlKey;
                    if (e.key === "Enter" && mod) return (e.preventDefault(), setNotesOpen((s) => new Set(s.has(r.id) ? [...s].filter((x) => x !== r.id) : [...s, r.id])));
                    if (e.key === "Enter") return (e.preventDefault(), insertAfter(i, r.depth));
                    if (e.key === "Tab") return (e.preventDefault(), shift(i, e.shiftKey ? -1 : 1));
                    if (e.altKey && e.key === "ArrowUp") return (e.preventDefault(), move(i, -1));
                    if (e.altKey && e.key === "ArrowDown") return (e.preventDefault(), move(i, 1));
                    if (e.key === "ArrowUp" && !e.altKey) return (e.preventDefault(), setFocusId(rows.slice(0, i).reverse().find((x) => !hidden.has(x.id))?.id ?? r.id));
                    if (e.key === "ArrowDown" && !e.altKey) return (e.preventDefault(), setFocusId(rows.slice(i + 1).find((x) => !hidden.has(x.id))?.id ?? r.id));
                    if (e.key === "Backspace" && !r.text && !hasKids) return (e.preventDefault(), remove(i));
                  }}
                />
                {(notesOpen.has(r.id) || r.notes) && (
                  <textarea className="outline-notes" rows={Math.min(6, (r.notes ?? "").split("\n").length)} value={r.notes ?? ""} placeholder={t("ws.rowNotes")} onChange={(e) => patch(r.id, { notes: e.target.value || undefined })} />
                )}
              </div>
              {linked && (
                <a className="outline-link" onClick={() => onOpen(linked.id)} data-path={linked.path} title={t("ws.openLinked")}>
                  {linked.icon ?? "📄"} {linked.title}
                </a>
              )}
              <div className="outline-actions">
                <div className="rel">
                  <button className="icon-btn" title={t("ws.color")} onClick={() => setColorFor(colorFor === r.id ? null : r.id)}>
                    ●
                  </button>
                  {colorFor === r.id && (
                    <div className="pop anchored right" onMouseLeave={() => setColorFor(null)}>
                      <ColorDots value={r.color} onChange={(c) => (patch(r.id, { color: c }), setColorFor(null))} />
                    </div>
                  )}
                </div>
                {r.file ? (
                  <button className="icon-btn" title={t("ws.unlink")} onClick={() => patch(r.id, { file: undefined })}>
                    ⊘
                  </button>
                ) : (
                  <>
                    <button className="icon-btn" title={t("ws.linkNote")} onClick={() => setLinkFor(r.id)}>
                      🔗
                    </button>
                    <button className="icon-btn" title={t("ws.createNoteFromRow")} onClick={() => void createNote(r)}>
                      ✎
                    </button>
                  </>
                )}
                <button className="icon-btn" title={t("ws.rowNotes")} onClick={() => setNotesOpen((s) => new Set(s.has(r.id) ? [...s].filter((x) => x !== r.id) : [...s, r.id]))}>
                  ¶
                </button>
                <button className="icon-btn" title={t("common.remove")} onClick={() => remove(i)}>
                  ✕
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <button className="secondary" onClick={() => insertAfter(-1, 0)}>
        ＋ {rows.length ? t("ws.addRow") : t("ws.startOutline")}
      </button>
      {linkFor && (
        <NotePicker
          nodes={nodes.filter((n) => n.id !== id && !n.database && !n.template)}
          placeholder={t("ws.pickNote")}
          onClose={() => setLinkFor(null)}
          onPick={(n) => patch(linkFor, { file: n.path })}
        />
      )}
    </div>
  );
}

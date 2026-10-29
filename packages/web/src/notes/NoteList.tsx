// Not listesi görünümü (Apple Notlar'daki liste/galeri): tüm notlar, bir Arche, etiket, akıllı klasör ya da son notlar.
// İğnelenmiş notlar üstte; sıralama, tarihe göre gruplama ve not sayısı her liste için ayrı hatırlanır.

import { useEffect, useMemo, type ReactNode } from "react";
import type { NodeMeta } from "../api.ts";
import { registerCommand } from "../commands.ts";
import { fileUrl } from "../editor/paths.ts";
import { getLang, locale, t } from "../i18n/index.ts";
import { usePref } from "../prefs.ts";

export type SortKey = "edited" | "created" | "title";

export interface ListView {
  mode: "list" | "gallery";
  sort: SortKey;
  desc: boolean;
  group: boolean;
}

const DEFAULT_VIEW: ListView = { mode: "list", sort: "edited", desc: true, group: true };
const DAY = 86_400_000;

/** "az önce", "3 saat önce", "dün", "4 gün önce", sonra tarih. */
export function relTime(ms: number): string {
  const rtf = new Intl.RelativeTimeFormat(getLang(), { numeric: "auto" });
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  if (abs < 60_000) return rtf.format(0, "second");
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < DAY && new Date(ms).getDate() === new Date().getDate()) return rtf.format(Math.round(diff / 3_600_000), "hour");
  const days = Math.round((startOfDay(ms) - startOfDay(Date.now())) / DAY);
  if (days > -7) return rtf.format(days, "day");
  return new Date(ms).toLocaleDateString(locale(), { day: "numeric", month: "short", year: new Date(ms).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function groupLabel(ms: number): string {
  const days = Math.round((startOfDay(Date.now()) - startOfDay(ms)) / DAY);
  if (days <= 0) return t("list.today");
  if (days === 1) return t("list.yesterday");
  if (days <= 7) return t("list.prev7");
  if (days <= 30) return t("list.prev30");
  const d = new Date(ms);
  return d.getFullYear() === new Date().getFullYear() ? d.toLocaleDateString(locale(), { month: "long" }) : String(d.getFullYear());
}

export function sortNotes(notes: NodeMeta[], view: Pick<ListView, "sort" | "desc">): NodeMeta[] {
  const val = (n: NodeMeta) => (view.sort === "created" ? n.createdAt : n.updatedAt);
  const sorted = [...notes].sort((a, b) => (view.sort === "title" ? a.title.localeCompare(b.title, "tr") : val(a) - val(b)));
  return view.desc ? sorted.reverse() : sorted;
}

export interface NoteListProps {
  /** Görünüm ayarlarının saklandığı anahtar (ör. "all", "tag:iş"). */
  listKey: string;
  title: ReactNode;
  icon?: string;
  notes: NodeMeta[];
  nodes: NodeMeta[];
  actions?: ReactNode;
  empty?: string;
  /** Sıralama sabit (ör. son notlar: açılma sırası). */
  fixedOrder?: boolean;
  onOpen: (id: string) => void;
  onTag?: (tag: string) => void;
}

export function NoteList(props: NoteListProps) {
  const [views, setViews] = usePref<Record<string, ListView>>("listViews", {});
  const [showCount, setShowCount] = usePref<boolean>("listShowCount", true);
  const view = { ...DEFAULT_VIEW, ...views[props.listKey] };
  const setView = (patch: Partial<ListView>) => setViews({ ...views, [props.listKey]: { ...view, ...patch } });

  useEffect(() => {
    const offs = [
      registerCommand("view.list", () => setView({ mode: "list" })),
      registerCommand("view.gallery", () => setView({ mode: "gallery" })),
      registerCommand("view.groupByDate", () => setView({ group: !view.group })),
      registerCommand("view.noteCount", () => setShowCount(!showCount)),
    ];
    return () => offs.forEach((o) => o());
  });

  const byId = useMemo(() => new Map(props.nodes.map((n) => [n.id, n])), [props.nodes]);
  const ordered = props.fixedOrder ? props.notes : sortNotes(props.notes, view);
  const pinned = ordered.filter((n) => n.pinned);
  const rest = ordered.filter((n) => !n.pinned);
  const groups: { label: string; notes: NodeMeta[] }[] = [];
  if (view.group && view.sort !== "title" && !props.fixedOrder) {
    for (const n of rest) {
      const label = groupLabel(view.sort === "created" ? n.createdAt : n.updatedAt);
      const g = groups.at(-1);
      if (g?.label === label) g.notes.push(n);
      else groups.push({ label, notes: [n] });
    }
  } else if (rest.length) groups.push({ label: pinned.length ? t("list.notes") : "", notes: rest });

  const where = (n: NodeMeta) => {
    const parent = n.parentNodeId ? byId.get(n.parentNodeId) : undefined;
    if (parent) return `${parent.icon ? `${parent.icon} ` : ""}${parent.title}`;
    return n.archeId === null ? "Shadow" : "";
  };

  const card = (n: NodeMeta) => {
    const date = relTime(view.sort === "created" ? n.createdAt : n.updatedAt);
    const meta = (
      <span className="note-meta">
        <span>{date}</span>
        {where(n) && <span className="note-where">{where(n)}</span>}
        {n.todos > 0 && <span>☑ {t("list.todos", { done: n.done, n: n.todos })}</span>}
      </span>
    );
    const tags = n.tags.length > 0 && (
      <span className="note-tags">
        {n.tags.slice(0, 4).map((tg) => (
          <span
            key={tg}
            className="nl-tag"
            onClick={(e) => {
              e.stopPropagation();
              props.onTag?.(tg);
            }}
          >
            #{tg}
          </span>
        ))}
      </span>
    );
    const title = (
      <span className="note-title">
        {n.pinned && <span title={t("list.pinned")}>📌 </span>}
        {n.locked && <span title={t("list.locked")}>🔒 </span>}
        {n.icon ? `${n.icon} ` : ""}
        {n.title}
      </span>
    );
    if (view.mode === "gallery") {
      return (
        <button key={n.id} className="note-card" onClick={() => props.onOpen(n.id)}>
          <span className="note-thumb">
            {n.image ? <img src={fileUrl(n.image)} alt="" loading="lazy" /> : <span className="note-thumb-text">{n.locked ? "🔒" : n.excerpt.slice(0, 140)}</span>}
          </span>
          {title}
          {meta}
          {tags}
        </button>
      );
    }
    return (
      <button key={n.id} className="note-row" onClick={() => props.onOpen(n.id)}>
        <span className="note-row-main">
          {title}
          <span className="note-excerpt">{n.locked ? t("list.locked") : n.excerpt}</span>
          {meta}
          {tags}
        </span>
        {n.image && <img className="note-row-thumb" src={fileUrl(n.image)} alt="" loading="lazy" />}
      </button>
    );
  };

  const section = (label: string, notes: NodeMeta[]) =>
    notes.length > 0 && (
      <section key={label || "_"} className="note-group">
        {label && <h4>{label}</h4>}
        <div className={view.mode === "gallery" ? "note-grid" : "note-rows"}>{notes.map(card)}</div>
      </section>
    );

  return (
    <div className="note-list-page">
      <div className="note-list-head">
        <h1>
          {props.icon && <span className="note-list-icon">{props.icon}</span>}
          {props.title}
          {showCount && <span className="note-count">{t("list.count", { n: props.notes.length })}</span>}
        </h1>
        <div className="note-list-tools">
          {props.actions}
          <div className="segmented small">
            <button className={view.mode === "list" ? "on" : ""} onClick={() => setView({ mode: "list" })} title={t("list.asList")}>
              ☰
            </button>
            <button className={view.mode === "gallery" ? "on" : ""} onClick={() => setView({ mode: "gallery" })} title={t("list.asGallery")}>
              ▦
            </button>
          </div>
          {!props.fixedOrder && (
            <select
              value={`${view.sort}:${view.desc ? "desc" : "asc"}`}
              onChange={(e) => {
                const [sort, dir] = e.target.value.split(":");
                setView({ sort: sort as SortKey, desc: dir === "desc" });
              }}
              title={t("list.sort")}
            >
              <option value="edited:desc">{`${t("list.sortEdited")} · ${t("list.newest")}`}</option>
              <option value="edited:asc">{`${t("list.sortEdited")} · ${t("list.oldest")}`}</option>
              <option value="created:desc">{`${t("list.sortCreated")} · ${t("list.newest")}`}</option>
              <option value="created:asc">{`${t("list.sortCreated")} · ${t("list.oldest")}`}</option>
              <option value="title:asc">{`${t("list.sortTitle")} · ${t("list.az")}`}</option>
              <option value="title:desc">{`${t("list.sortTitle")} · ${t("list.za")}`}</option>
            </select>
          )}
          {!props.fixedOrder && view.sort !== "title" && (
            <button className={`secondary ${view.group ? "on" : ""}`} onClick={() => setView({ group: !view.group })} title={t("list.groupByDate")}>
              🗓
            </button>
          )}
          <button className={`secondary ${showCount ? "on" : ""}`} onClick={() => setShowCount(!showCount)} title={t("list.showCount")}>
            #
          </button>
        </div>
      </div>
      {props.notes.length === 0 && <p className="muted empty-list">{props.empty ?? t("list.empty")}</p>}
      {section(t("list.pinned"), pinned)}
      {groups.map((g) => section(g.label, g.notes))}
    </div>
  );
}

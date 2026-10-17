// Veritabanı: görünüm sekmeleri, arama, filtre, sıralama, özellik görünürlüğü ve seçili görünüm.
// Hem tam sayfa veritabanında hem de bir sayfaya gömülü (satır içi) veritabanında kullanılır.

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type NodeMeta } from "../api.ts";
import { desktop } from "../desktop.ts";
import { t, type StringKey } from "../i18n/index.ts";
import {
  cellValue,
  displayText,
  newView,
  queryRows,
  TITLE_PROP,
  toCsv,
  useDatabaseModel,
  VIEW_TYPES,
  writeRowValue,
  writeSchema,
  type Database,
  type DatabaseActions,
  type Filter,
  type FilterOp,
  type Property,
  type Row,
  type View,
  type ViewType,
} from "./model.ts";
import { Popover } from "./Popover.tsx";
import { TYPE_ICON } from "./PropertyMenu.tsx";
import { BoardView, CalendarView, GalleryView, ListView, TableView, TimelineView, type ViewProps } from "./Views.tsx";

export const VIEW_ICON: Record<ViewType, string> = { table: "▦", board: "▥", list: "☰", gallery: "▣", calendar: "▤", timeline: "▬" };
export const viewLabel = (type: ViewType) => t(`db.view.${type}` as StringKey);

const VIEW_KEY = (id: string) => `nlc-db-view:${id}`;

function opsFor(prop: Property | null): FilterOp[] {
  const type = prop?.type ?? "text";
  switch (type) {
    case "number":
    case "rollup":
      return ["is", "is_not", "gt", "lt", "gte", "lte", "is_empty", "is_not_empty"];
    case "select":
    case "status":
      return ["is", "is_not", "is_empty", "is_not_empty"];
    case "multi_select":
      return ["contains", "not_contains", "is_empty", "is_not_empty"];
    case "checkbox":
      return ["checked", "unchecked"];
    case "date":
    case "created_time":
    case "updated_time":
      return ["before", "after", "is_empty", "is_not_empty"];
    case "relation":
      return ["is_empty", "is_not_empty"];
    case "formula":
      return ["contains", "is", "gt", "lt", "is_empty", "is_not_empty"];
    default:
      return ["contains", "not_contains", "is", "is_not", "starts_with", "is_empty", "is_not_empty"];
  }
}

const NO_VALUE: FilterOp[] = ["is_empty", "is_not_empty", "checked", "unchecked"];

function FilterEditor({ db, view, saveView }: { db: Database; view: View; saveView: (p: Partial<View>) => void }) {
  const props: (Property | null)[] = [null, ...db.properties];
  const propOf = (id: string) => (id === TITLE_PROP ? null : (db.properties.find((p) => p.id === id) ?? null));
  const set = (i: number, patch: Partial<Filter>) => saveView({ filters: view.filters.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  return (
    <div className="prop-menu filter-editor">
      {view.filters.length > 1 && (
        <div className="segmented small">
          <button className={view.match === "all" ? "on" : ""} onClick={() => saveView({ match: "all" })}>
            {t("db.matchAll")}
          </button>
          <button className={view.match === "any" ? "on" : ""} onClick={() => saveView({ match: "any" })}>
            {t("db.matchAny")}
          </button>
        </div>
      )}
      {view.filters.map((f, i) => {
        const prop = propOf(f.prop);
        const ops = opsFor(prop);
        return (
          <div key={i} className="filter-row">
            <select value={f.prop} onChange={(e) => set(i, { prop: e.target.value, op: opsFor(propOf(e.target.value))[0], value: null })}>
              {props.map((p) => (
                <option key={p?.id ?? TITLE_PROP} value={p?.id ?? TITLE_PROP}>
                  {p ? p.name : t("db.title")}
                </option>
              ))}
            </select>
            <select value={f.op} onChange={(e) => set(i, { op: e.target.value as FilterOp })}>
              {ops.map((o) => (
                <option key={o} value={o}>
                  {t(`db.op.${o}` as StringKey)}
                </option>
              ))}
            </select>
            {!NO_VALUE.includes(f.op) &&
              (prop?.options ? (
                <select value={String(f.value ?? "")} onChange={(e) => set(i, { value: e.target.value })}>
                  <option value="">—</option>
                  {prop.options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              ) : prop && ["date", "created_time", "updated_time"].includes(prop.type) ? (
                <input type="date" className="db-input" value={f.value === "today" ? "" : String(f.value ?? "")} onChange={(e) => set(i, { value: e.target.value })} />
              ) : (
                <input className="db-input" value={String(f.value ?? "")} onChange={(e) => set(i, { value: e.target.value })} placeholder={t("db.value")} />
              ))}
            <button className="icon-btn" onClick={() => saveView({ filters: view.filters.filter((_, j) => j !== i) })} title={t("common.remove")}>
              ×
            </button>
          </div>
        );
      })}
      <button className="secondary" onClick={() => saveView({ filters: [...view.filters, { prop: TITLE_PROP, op: "contains", value: "" }] })}>
        ＋ {t("db.addFilter")}
      </button>
    </div>
  );
}

function SortEditor({ db, view, saveView }: { db: Database; view: View; saveView: (p: Partial<View>) => void }) {
  return (
    <div className="prop-menu">
      {view.sorts.map((s, i) => (
        <div key={i} className="filter-row">
          <select value={s.prop} onChange={(e) => saveView({ sorts: view.sorts.map((x, j) => (j === i ? { ...x, prop: e.target.value } : x)) })}>
            <option value={TITLE_PROP}>{t("db.title")}</option>
            {db.properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select value={s.dir} onChange={(e) => saveView({ sorts: view.sorts.map((x, j) => (j === i ? { ...x, dir: e.target.value as "asc" | "desc" } : x)) })}>
            <option value="asc">{t("db.sortAsc")}</option>
            <option value="desc">{t("db.sortDesc")}</option>
          </select>
          <button className="icon-btn" onClick={() => saveView({ sorts: view.sorts.filter((_, j) => j !== i) })} title={t("common.remove")}>
            ×
          </button>
        </div>
      ))}
      <button className="secondary" onClick={() => saveView({ sorts: [...view.sorts, { prop: TITLE_PROP, dir: "asc" }] })}>
        ＋ {t("db.addSort")}
      </button>
    </div>
  );
}

function ViewOptions({ db, view, saveView, onDelete, onDuplicate, canDelete }: { db: Database; view: View; saveView: (p: Partial<View>) => void; onDelete: () => void; onDuplicate: () => void; canDelete: boolean }) {
  const [name, setName] = useState(view.name);
  return (
    <div className="prop-menu">
      <input className="db-input" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== view.name && saveView({ name: name.trim() })} />
      <label className="field">
        <span>{t("db.layout")}</span>
        <div className="layout-grid">
          {VIEW_TYPES.map((ty) => (
            <button key={ty} className={view.type === ty ? "on" : ""} onClick={() => saveView({ type: ty, ...newViewDefaults(db, ty, view) })}>
              {VIEW_ICON[ty]} {viewLabel(ty)}
            </button>
          ))}
        </div>
      </label>
      {view.type === "board" && (
        <label className="field">
          <span>{t("db.groupBy")}</span>
          <select value={view.groupBy ?? ""} onChange={(e) => saveView({ groupBy: e.target.value || undefined })}>
            <option value="">—</option>
            {db.properties
              .filter((p) => ["select", "status", "multi_select", "checkbox"].includes(p.type))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
      )}
      {(view.type === "calendar" || view.type === "timeline") && (
        <label className="field">
          <span>{t("db.dateProp")}</span>
          <select value={view.dateProp ?? ""} onChange={(e) => saveView({ dateProp: e.target.value || undefined })}>
            <option value="">—</option>
            {db.properties
              .filter((p) => p.type === "date")
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
      )}
      <div className="field">
        <span>{t("db.properties")}</span>
        {db.properties.map((p) => (
          <label key={p.id} className="row-inline prop-toggle">
            <input
              type="checkbox"
              checked={!view.hidden.includes(p.id)}
              onChange={(e) => saveView({ hidden: e.target.checked ? view.hidden.filter((h) => h !== p.id) : [...view.hidden, p.id] })}
            />
            <span className="type-icon">{TYPE_ICON[p.type]}</span> {p.name}
          </label>
        ))}
      </div>
      <hr />
      <button onClick={onDuplicate}>⧉ {t("db.duplicateView")}</button>
      {canDelete && (
        <button className="danger" onClick={onDelete}>
          🗑 {t("db.deleteView")}
        </button>
      )}
    </div>
  );
}

function newViewDefaults(db: Database, type: ViewType, view: View): Partial<View> {
  const d = newView(type, view.name, db.properties);
  return { groupBy: view.groupBy ?? d.groupBy, dateProp: view.dateProp ?? d.dateProp };
}

export interface DatabaseViewProps {
  dbNode: NodeMeta;
  nodes: NodeMeta[];
  /** Görünümü sabitler (satır içi veritabanında gömülü görünüm). */
  viewId?: string;
  inline?: boolean;
  onChanged: () => void;
  onNavigate: (id: string) => void;
  onToast: (msg: string) => void;
  /** Tam sayfa veritabanında şema, açık sayfanın sürüm takibiyle kaydedilir. */
  saveSchema?: (db: Database) => Promise<void>;
  onSelectView?: (viewId: string) => void;
}

export function DatabaseView(props: DatabaseViewProps) {
  const { dbNode, nodes } = props;
  const model = useDatabaseModel(dbNode, nodes);
  const [active, setActive] = useState<string | null>(() => {
    if (props.viewId) return props.viewId;
    try {
      return localStorage.getItem(VIEW_KEY(dbNode.id));
    } catch {
      return null;
    }
  });
  const [query, setQuery] = useState("");
  const [pop, setPop] = useState<{ kind: "filter" | "sort" | "options" | "add" | "new"; anchor: HTMLElement } | null>(null);
  // Hızlı geri bildirim: kaydedilen şema, Node listesi yenilenene kadar yerelde kullanılır.
  const [pendingDb, setPendingDb] = useState<Database | null>(null);
  useEffect(() => setPendingDb(null), [dbNode.database]);

  const db = pendingDb ?? model?.db;
  const view = db?.views.find((v) => v.id === (props.viewId ?? active)) ?? db?.views[0];

  const saveDb = useCallback(
    async (next: Database) => {
      setPendingDb(next);
      try {
        if (props.saveSchema) await props.saveSchema(next);
        else await writeSchema(dbNode.id, next);
        props.onChanged();
      } catch (e) {
        setPendingDb(null);
        props.onToast((e as Error).message);
      }
    },
    [dbNode.id, props],
  );

  const actions: DatabaseActions = useMemo(
    () => ({
      saveDb,
      setValue: async (row, propId, value) => {
        try {
          await writeRowValue(row, propId, value);
          props.onChanged();
        } catch (e) {
          props.onToast((e as Error).message);
        }
      },
      setTitle: async (row, title) => {
        try {
          await api.update(row.id, { title });
          props.onChanged();
        } catch (e) {
          props.onToast((e as Error).message);
        }
      },
      createRow: async (title, values) => {
        try {
          const clean = Object.fromEntries(Object.entries(values ?? {}).filter(([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && !v.length)));
          const n = await api.create(title, dbNode.id, "", Object.keys(clean).length ? { props: clean } : undefined);
          props.onChanged();
          return n;
        } catch (e) {
          props.onToast((e as Error).message);
          return null;
        }
      },
      trashRow: async (row: Row) => {
        if (!confirm(t("app.trashConfirm", { title: row.title }))) return;
        await api.trash(row.id).catch((e: Error) => props.onToast(e.message));
        props.onChanged();
      },
      openRow: props.onNavigate,
    }),
    [saveDb, dbNode.id, props],
  );

  if (!model || !db || !view) return null;
  const liveModel = pendingDb ? { ...model, db: pendingDb } : model;

  const saveView = (patch: Partial<View>) => void saveDb({ ...db, views: db.views.map((v) => (v.id === view.id ? { ...v, ...patch } : v)) });
  const selectView = (id: string) => {
    setActive(id);
    props.onSelectView?.(id);
    try {
      localStorage.setItem(VIEW_KEY(dbNode.id), id);
    } catch {
      // yalnızca bu oturum
    }
  };
  const addView = (type: ViewType) => {
    const v = newView(type, viewLabel(type), db.properties, db.views.map((x) => x.id));
    void saveDb({ ...db, views: [...db.views, v] });
    selectView(v.id);
    setPop(null);
  };

  const q = query.trim().toLocaleLowerCase("tr");
  const searched = q
    ? model.rows.filter((r) =>
        [r.title, ...db.properties.map((p) => displayText(p, cellValue(db, r, p.id, model.ctx)))].some((x) => x.toLocaleLowerCase("tr").includes(q)),
      )
    : model.rows;
  const rows = queryRows(db, searched, view, model.ctx);
  const viewProps: ViewProps = { model: liveModel, actions, view, rows, saveView, saveDb: (d) => void saveDb(d) };

  async function exportCsv() {
    const csv = toCsv(db!, model!.rows, view!, t("db.title"), model!.ctx);
    const name = `${dbNode.title} - ${view!.name}.csv`;
    const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name.replace(/[\\/:*?"<>|]/g, "-");
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    if (!desktop) props.onToast(t("db.csvDone"));
  }

  return (
    <div className={`db ${props.inline ? "inline" : ""}`} onKeyDown={(e) => e.stopPropagation()}>
      {props.inline && (
        <div className="db-inline-title" onClick={() => props.onNavigate(dbNode.id)}>
          {dbNode.icon ?? "▦"} {dbNode.title}
        </div>
      )}
      <div className="db-toolbar">
        <div className="db-tabs">
          {db.views.map((v) => (
            <button key={v.id} className={`db-tab ${v.id === view.id ? "on" : ""}`} onClick={() => selectView(v.id)}>
              {VIEW_ICON[v.type]} {v.name}
            </button>
          ))}
          {!props.viewId && (
            <button className="db-tab add" onClick={(e) => setPop({ kind: "add", anchor: e.currentTarget })} title={t("db.addView")}>
              ＋
            </button>
          )}
        </div>
        <div className="db-tools">
          <input className="db-search" placeholder={t("db.search")} value={query} onChange={(e) => setQuery(e.target.value)} />
          <button className={`db-tool ${view.filters.length ? "on" : ""}`} onClick={(e) => setPop({ kind: "filter", anchor: e.currentTarget })}>
            ⏷ {t("db.filter")}
            {view.filters.length ? ` ${view.filters.length}` : ""}
          </button>
          <button className={`db-tool ${view.sorts.length ? "on" : ""}`} onClick={(e) => setPop({ kind: "sort", anchor: e.currentTarget })}>
            ⇅ {t("db.sort")}
            {view.sorts.length ? ` ${view.sorts.length}` : ""}
          </button>
          <button className="db-tool" onClick={(e) => setPop({ kind: "options", anchor: e.currentTarget })} title={t("db.viewOptions")}>
            ⋯
          </button>
          <button className="db-tool" onClick={exportCsv} title={t("db.exportCsv")}>
            ⇩ CSV
          </button>
          <span className="split-btn">
            <button className="primary small" onClick={() => actions.createRow(t("common.untitled")).then((n) => n && props.onNavigate(n.id))}>
              {t("db.new")}
            </button>
            <button className="primary small caret" onClick={(e) => setPop({ kind: "new", anchor: e.currentTarget })} title={t("tpl.rowTemplates")}>
              ▾
            </button>
          </span>
        </div>
      </div>

      {view.type === "table" && <TableView {...viewProps} />}
      {view.type === "board" && <BoardView {...viewProps} />}
      {view.type === "list" && <ListView {...viewProps} />}
      {view.type === "gallery" && <GalleryView {...viewProps} />}
      {view.type === "calendar" && <CalendarView {...viewProps} />}
      {view.type === "timeline" && <TimelineView {...viewProps} />}

      {pop && (
        <Popover anchor={pop.anchor} onClose={() => setPop(null)} width={pop.kind === "filter" ? 460 : pop.kind === "sort" ? 340 : 280}>
          {pop.kind === "filter" && <FilterEditor db={db} view={view} saveView={saveView} />}
          {pop.kind === "sort" && <SortEditor db={db} view={view} saveView={saveView} />}
          {pop.kind === "options" && (
            <ViewOptions
              db={db}
              view={view}
              saveView={saveView}
              canDelete={db.views.length > 1}
              onDuplicate={() => {
                const copy = { ...view, id: newView(view.type, "", [], db.views.map((x) => x.id)).id, name: `${view.name} 2` };
                void saveDb({ ...db, views: [...db.views, copy] });
                selectView(copy.id);
                setPop(null);
              }}
              onDelete={() => {
                if (!confirm(t("db.deleteViewConfirm", { name: view.name }))) return;
                void saveDb({ ...db, views: db.views.filter((v) => v.id !== view.id) });
                setPop(null);
              }}
            />
          )}
          {pop.kind === "new" && (
            <div className="prop-menu">
              <div className="muted small pad">{t("tpl.rowTemplates")}</div>
              {nodes
                .filter((n) => n.parentNodeId === dbNode.id && n.template)
                .map((n) => (
                  <button
                    key={n.id}
                    onClick={async () => {
                      setPop(null);
                      try {
                        const copy = await api.duplicate(n.id, { parentNodeId: dbNode.id, title: t("common.untitled") });
                        props.onChanged();
                        props.onNavigate(copy.id);
                      } catch (e) {
                        props.onToast((e as Error).message);
                      }
                    }}
                  >
                    {n.icon ?? "📄"} {n.title}
                  </button>
                ))}
              <hr />
              <button
                onClick={async () => {
                  setPop(null);
                  const n = await api.create(t("tpl.newRowTemplate"), dbNode.id, "", { template: true });
                  props.onChanged();
                  props.onNavigate(n.id);
                }}
              >
                ＋ {t("tpl.newRowTemplateAction")}
              </button>
            </div>
          )}
          {pop.kind === "add" && (
            <div className="prop-menu">
              {VIEW_TYPES.map((ty) => (
                <button key={ty} onClick={() => addView(ty)}>
                  {VIEW_ICON[ty]} {viewLabel(ty)}
                </button>
              ))}
            </div>
          )}
        </Popover>
      )}
    </div>
  );
}


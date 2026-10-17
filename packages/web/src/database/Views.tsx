// Veritabanı görünümleri: tablo, pano, liste, galeri, takvim ve zaman çizelgesi.

import { useMemo, useRef, useState, type DragEvent } from "react";
import { locale, t } from "../i18n/index.ts";
import { fileUrl, resolveRelative } from "../editor/paths.ts";
import { Cell, CellDisplay, OptionChip } from "./Cell.tsx";
import {
  addProperty,
  cellValue,
  dateMs,
  groupRows,
  isEmpty,
  parseDateValue,
  PROPERTY_TYPES,
  TITLE_PROP,
  valueForGroup,
  type Database,
  type DatabaseActions,
  type DatabaseModel,
  type Property,
  type PropertyType,
  type Row,
  type View,
} from "./model.ts";
import { Popover } from "./Popover.tsx";
import { PropertyMenu, TYPE_ICON, typeLabel } from "./PropertyMenu.tsx";

export interface ViewProps {
  model: DatabaseModel;
  actions: DatabaseActions;
  view: View;
  rows: Row[];
  saveView: (patch: Partial<View>) => void;
  saveDb: (db: Database) => void;
}

const GRADIENTS = ["gradient-1", "gradient-2", "gradient-3", "gradient-4", "gradient-5", "gradient-6"];
const visibleProps = (db: Database, view: View) => db.properties.filter((p) => !view.hidden.includes(p.id));

function TitleCell({ row, actions, autoFocus }: { row: Row; actions: DatabaseActions; autoFocus?: boolean }) {
  const [editing, setEditing] = useState(!!autoFocus);
  const [text, setText] = useState(row.title);
  if (editing) {
    const commit = () => {
      setEditing(false);
      if (text.trim() && text.trim() !== row.title) void actions.setTitle(row, text.trim());
      else setText(row.title);
    };
    return (
      <div className="db-cell title-cell">
        <input
          autoFocus
          className="db-input bare"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") (setText(row.title), setEditing(false));
          }}
        />
      </div>
    );
  }
  return (
    <div className="db-cell title-cell" onClick={() => setEditing(true)}>
      <span className="row-icon">{row.icon ?? "◇"}</span>
      <span className="row-title">{row.title}</span>
      <button className="open-btn" onClick={(e) => (e.stopPropagation(), actions.openRow(row.id))}>
        ↗ {t("db.open")}
      </button>
    </div>
  );
}

function AddPropertyButton({ model, saveDb, className = "" }: { model: DatabaseModel; saveDb: (db: Database) => void; className?: string }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [name, setName] = useState("");
  const add = (type: PropertyType) => {
    const label = name.trim() || typeLabel(type);
    saveDb(addProperty(model.db, { name: label, type }).db);
    setName("");
    setAnchor(null);
  };
  return (
    <>
      <button className={`add-prop ${className}`} onClick={(e) => setAnchor(e.currentTarget)} title={t("db.addProperty")}>
        ＋
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={240}>
          <div className="prop-menu">
            <input autoFocus className="db-input" placeholder={t("db.propName")} value={name} onChange={(e) => setName(e.target.value)} />
            <div className="type-list">
              {PROPERTY_TYPES.map((ty) => (
                <button key={ty} onClick={() => add(ty)}>
                  <span className="type-icon">{TYPE_ICON[ty]}</span> {typeLabel(ty)}
                </button>
              ))}
            </div>
          </div>
        </Popover>
      )}
    </>
  );
}

function HeaderCell({ prop, props, width, onResize }: { prop: Property; props: ViewProps; width: number; onResize: (w: number) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    let w = width;
    const th = (e.currentTarget as HTMLElement).parentElement!;
    const move = (ev: MouseEvent) => {
      w = Math.max(80, Math.min(800, width + ev.clientX - x0));
      th.style.width = `${w}px`;
    };
    const up = () => {
      removeEventListener("mousemove", move);
      removeEventListener("mouseup", up);
      onResize(w);
    };
    addEventListener("mousemove", move);
    addEventListener("mouseup", up);
  };
  return (
    <div className="th" style={{ width }}>
      <button className="th-btn" onClick={(e) => setAnchor(e.currentTarget)}>
        <span className="type-icon">{TYPE_ICON[prop.type]}</span> {prop.name}
      </button>
      <span className="resize" onMouseDown={startResize} />
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={280}>
          <PropertyMenu
            model={props.model}
            prop={prop}
            onSave={props.saveDb}
            onSort={(dir) => props.saveView({ sorts: [{ prop: prop.id, dir }] })}
            onHide={() => props.saveView({ hidden: [...props.view.hidden, prop.id] })}
            onClose={() => setAnchor(null)}
          />
        </Popover>
      )}
    </div>
  );
}

function RowMenu({ row, actions }: { row: Row; actions: DatabaseActions }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <button className="row-menu-btn" onClick={(e) => setAnchor(e.currentTarget)} title={t("node.more")}>
        ⋮
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={200}>
          <div className="prop-menu">
            <button onClick={() => (setAnchor(null), actions.openRow(row.id))}>↗ {t("db.open")}</button>
            <button className="danger" onClick={() => (setAnchor(null), void actions.trashRow(row))}>
              🗑 {t("common.moveToTrash")}
            </button>
          </div>
        </Popover>
      )}
    </>
  );
}

export function TableView(props: ViewProps) {
  const { model, actions, view, rows } = props;
  const cols = visibleProps(model.db, view);
  const [fresh, setFresh] = useState<string | null>(null);
  const width = (id: string) => view.widths?.[id] ?? (id === TITLE_PROP ? 280 : 180);
  const resize = (id: string, w: number) => props.saveView({ widths: { ...(view.widths ?? {}), [id]: Math.round(w) } });
  return (
    <div className="db-table-wrap">
      <div className="db-table" role="table">
        <div className="tr head" role="row">
          <div className="th" style={{ width: width(TITLE_PROP) }}>
            <span className="th-btn static">
              <span className="type-icon">Aa</span> {t("db.title")}
            </span>
            <span className="resize" onMouseDown={(e) => {
              e.preventDefault();
              const x0 = e.clientX;
              const th = (e.currentTarget as HTMLElement).parentElement!;
              let w = width(TITLE_PROP);
              const base = w;
              const move = (ev: MouseEvent) => ((w = Math.max(120, Math.min(900, base + ev.clientX - x0))), (th.style.width = `${w}px`));
              const up = () => (removeEventListener("mousemove", move), removeEventListener("mouseup", up), resize(TITLE_PROP, w));
              addEventListener("mousemove", move);
              addEventListener("mouseup", up);
            }} />
          </div>
          {cols.map((p) => (
            <HeaderCell key={p.id} prop={p} props={props} width={width(p.id)} onResize={(w) => resize(p.id, w)} />
          ))}
          <div className="th add">
            <AddPropertyButton model={model} saveDb={props.saveDb} />
          </div>
        </div>
        {rows.map((r) => (
          <div className="tr" role="row" key={r.id}>
            <div className="td" style={{ width: width(TITLE_PROP) }}>
              <RowMenu row={r} actions={actions} />
              <TitleCell row={r} actions={actions} autoFocus={fresh === r.id} />
            </div>
            {cols.map((p) => (
              <div className="td" key={p.id} style={{ width: width(p.id) }}>
                <Cell model={model} actions={actions} prop={p} row={r} />
              </div>
            ))}
            <div className="td add" />
          </div>
        ))}
      </div>
      <button
        className="db-new-row"
        onClick={async () => {
          const n = await actions.createRow(t("common.untitled"));
          if (n) setFresh(n.id);
        }}
      >
        ＋ {t("db.newRow")}
      </button>
      <div className="db-count muted small">{t("db.count", { count: rows.length })}</div>
    </div>
  );
}

function CardProps({ model, actions, view, row, skip }: { model: DatabaseModel; actions: DatabaseActions; view: View; row: Row; skip?: string }) {
  const props = visibleProps(model.db, view).filter((p) => p.id !== skip);
  return (
    <div className="card-props">
      {props.map((p) => {
        const v = cellValue(model.db, row, p.id, model.ctx);
        if (isEmpty(v) || (p.type === "checkbox" && v !== true)) return null;
        return (
          <div key={p.id} className="card-prop" title={p.name}>
            <CellDisplay model={model} prop={p} value={v} onOpenRow={actions.openRow} />
          </div>
        );
      })}
    </div>
  );
}

function coverStyle(model: DatabaseModel, row: Row): { className: string; style?: React.CSSProperties } | null {
  const cover = row.cover;
  if (!cover) return null;
  if (GRADIENTS.includes(cover)) return { className: cover };
  const path = model.byId.get(row.id)?.path ?? "";
  const url = /^https?:/.test(cover) ? cover : fileUrl(resolveRelative(path, cover) ?? cover);
  return { className: "", style: { backgroundImage: `url("${url}")` } };
}

export function BoardView(props: ViewProps) {
  const { model, actions, view, rows } = props;
  const groupProp = model.db.properties.find((p) => p.id === view.groupBy);
  const [over, setOver] = useState<string | null>(null);
  const groupable = model.db.properties.filter((p) => ["select", "status", "multi_select", "checkbox"].includes(p.type));
  if (!groupProp) {
    return (
      <div className="db-empty">
        <p>{t("db.boardNeedsGroup")}</p>
        {groupable.length ? (
          <select onChange={(e) => props.saveView({ groupBy: e.target.value })} defaultValue="">
            <option value="" disabled>
              {t("db.groupBy")}
            </option>
            {groupable.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        ) : (
          <button
            className="secondary"
            onClick={() => {
              const r = addProperty(model.db, { name: t("db.statusName"), type: "status", options: [] });
              props.saveDb(r.db);
              props.saveView({ groupBy: r.property.id });
            }}
          >
            ＋ {t("db.addStatus")}
          </button>
        )}
      </div>
    );
  }
  const groups = groupRows(model.db, rows, groupProp.id, t("db.noValue"));
  const onDrop = (e: DragEvent, toKey: string) => {
    e.preventDefault();
    setOver(null);
    const [rowId, fromKey] = e.dataTransfer.getData("application/x-nularche-row").split("|");
    const row = rows.find((r) => r.id === rowId);
    if (!row || fromKey === toKey) return;
    void actions.setValue(row, groupProp.id, valueForGroup(groupProp, row.props?.[groupProp.id], fromKey, toKey));
  };
  return (
    <div className="db-board">
      {groups.map((g) => (
        <div
          key={g.key || "_none"}
          className={`board-col ${over === g.key ? "over" : ""}`}
          onDragOver={(e) => (e.preventDefault(), setOver(g.key))}
          onDragLeave={() => setOver(null)}
          onDrop={(e) => onDrop(e, g.key)}
        >
          <div className="board-head">
            {g.color ? <OptionChip option={{ id: g.key, name: g.label, color: g.color }} /> : <span className="muted">{g.label}</span>}
            <span className="muted small">{g.rows.length}</span>
          </div>
          {g.rows.map((r) => {
            const cover = coverStyle(model, r);
            return (
              <div
                key={r.id}
                className="board-card"
                draggable
                onDragStart={(e) => e.dataTransfer.setData("application/x-nularche-row", `${r.id}|${g.key}`)}
                onClick={() => actions.openRow(r.id)}
              >
                {cover && <div className={`card-cover ${cover.className}`} style={cover.style} />}
                <div className="card-title">
                  {r.icon ? `${r.icon} ` : ""}
                  {r.title}
                </div>
                <CardProps model={model} actions={actions} view={view} row={r} skip={groupProp.id} />
              </div>
            );
          })}
          <button
            className="db-new-row"
            onClick={() => actions.createRow(t("common.untitled"), g.key ? { [groupProp.id]: valueForGroup(groupProp, undefined, "", g.key) } : {})}
          >
            ＋ {t("db.newRow")}
          </button>
        </div>
      ))}
    </div>
  );
}

export function ListView(props: ViewProps) {
  const { model, actions, view, rows } = props;
  return (
    <div className="db-list">
      {rows.map((r) => (
        <div key={r.id} className="list-row" onClick={() => actions.openRow(r.id)}>
          <span className="row-icon">{r.icon ?? "◇"}</span>
          <span className="row-title">{r.title}</span>
          <CardProps model={model} actions={actions} view={view} row={r} />
        </div>
      ))}
      <button className="db-new-row" onClick={() => actions.createRow(t("common.untitled"))}>
        ＋ {t("db.newRow")}
      </button>
    </div>
  );
}

export function GalleryView(props: ViewProps) {
  const { model, actions, view, rows } = props;
  return (
    <div className="db-gallery">
      {rows.map((r) => {
        const cover = coverStyle(model, r);
        return (
          <div key={r.id} className="gallery-card" onClick={() => actions.openRow(r.id)}>
            <div className={`gallery-cover ${cover?.className ?? "empty"}`} style={cover?.style}>
              {!cover && <span>{r.icon ?? "◇"}</span>}
            </div>
            <div className="card-title">
              {cover && r.icon ? `${r.icon} ` : ""}
              {r.title}
            </div>
            <CardProps model={model} actions={actions} view={view} row={r} />
          </div>
        );
      })}
      <button className="gallery-card new" onClick={() => actions.createRow(t("common.untitled"))}>
        ＋ {t("db.newRow")}
      </button>
    </div>
  );
}

const DAY = 86_400_000;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const startOfDay = (ms: number) => new Date(new Date(ms).toDateString()).getTime();

function DateSetup({ props }: { props: ViewProps }) {
  const dates = props.model.db.properties.filter((p) => p.type === "date");
  return (
    <div className="db-empty">
      <p>{t("db.needsDate")}</p>
      {dates.length ? (
        <select onChange={(e) => props.saveView({ dateProp: e.target.value })} defaultValue="">
          <option value="" disabled>
            {t("db.dateProp")}
          </option>
          {dates.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      ) : (
        <button
          className="secondary"
          onClick={() => {
            const r = addProperty(props.model.db, { name: t("db.dateName"), type: "date" });
            props.saveDb(r.db);
            props.saveView({ dateProp: r.property.id });
          }}
        >
          ＋ {t("db.addDate")}
        </button>
      )}
    </div>
  );
}

function rowSpan(row: Row, prop: Property): { start: number; end: number } | null {
  const d = parseDateValue(row.props?.[prop.id]);
  if (!d) return null;
  const start = startOfDay(dateMs(d.start));
  const end = d.end ? startOfDay(dateMs(d.end)) : start;
  return Number.isFinite(start) ? { start, end: Math.max(start, end) } : null;
}

/** Bir satırın tarihini (aralık uzunluğunu koruyarak) yeni güne taşır. */
function shiftDate(row: Row, prop: Property, toDay: number): unknown {
  const d = parseDateValue(row.props?.[prop.id]);
  if (!d) return iso(new Date(toDay));
  const delta = toDay - startOfDay(dateMs(d.start));
  const time = d.start.length > 10 ? d.start.slice(10) : "";
  const start = iso(new Date(toDay)) + time;
  if (!d.end) return start;
  return { start, end: iso(new Date(startOfDay(dateMs(d.end)) + delta)) };
}

export function CalendarView(props: ViewProps) {
  const { model, actions, view, rows } = props;
  const prop = model.db.properties.find((p) => p.id === view.dateProp && p.type === "date");
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  });
  const [over, setOver] = useState<number | null>(null);
  if (!prop) return <DateSetup props={props} />;
  const first = new Date(month);
  const offset = (first.getDay() + 6) % 7; // Pazartesi başlangıç
  const gridStart = month - offset * DAY;
  const days = Array.from({ length: 42 }, (_, i) => startOfDay(gridStart + i * DAY + 3_600_000 * 2));
  const spans = rows.map((r) => ({ r, s: rowSpan(r, prop) })).filter((x) => x.s);
  const today = startOfDay(Date.now());
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(locale(), { weekday: "short" }));
  return (
    <div className="db-calendar">
      <div className="cal-head">
        <strong>{first.toLocaleDateString(locale(), { month: "long", year: "numeric" })}</strong>
        <div className="row-inline">
          <button className="secondary" onClick={() => setMonth(new Date(first.getFullYear(), first.getMonth() - 1, 1).getTime())}>
            ‹
          </button>
          <button className="secondary" onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime())}>
            {t("db.today")}
          </button>
          <button className="secondary" onClick={() => setMonth(new Date(first.getFullYear(), first.getMonth() + 1, 1).getTime())}>
            ›
          </button>
        </div>
      </div>
      <div className="cal-grid">
        {weekdays.map((w) => (
          <div key={w} className="cal-wd muted small">
            {w}
          </div>
        ))}
        {days.map((day) => {
          const items = spans.filter((x) => x.s!.start <= day && day <= x.s!.end);
          const inMonth = new Date(day).getMonth() === first.getMonth();
          return (
            <div
              key={day}
              className={`cal-day ${inMonth ? "" : "out"} ${day === today ? "today" : ""} ${over === day ? "over" : ""}`}
              onDragOver={(e) => (e.preventDefault(), setOver(day))}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const row = rows.find((r) => r.id === e.dataTransfer.getData("application/x-nularche-row"));
                if (row) void actions.setValue(row, prop.id, shiftDate(row, prop, day));
              }}
            >
              <div className="cal-num">
                <span>{new Date(day).getDate()}</span>
                <button className="cal-add" title={t("db.newRow")} onClick={() => actions.createRow(t("common.untitled"), { [prop.id]: iso(new Date(day)) })}>
                  ＋
                </button>
              </div>
              {items.map(({ r }) => (
                <div
                  key={r.id}
                  className="cal-item"
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("application/x-nularche-row", r.id)}
                  onClick={() => actions.openRow(r.id)}
                  title={r.title}
                >
                  {r.icon ? `${r.icon} ` : ""}
                  {r.title}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TimelineView(props: ViewProps) {
  const { model, actions, view, rows } = props;
  const prop = model.db.properties.find((p) => p.id === view.dateProp && p.type === "date");
  const [start, setStart] = useState(() => startOfDay(Date.now()) - 7 * DAY);
  const scroller = useRef<HTMLDivElement>(null);
  const DAYS = 42;
  const COL = 34;
  const days = useMemo(() => Array.from({ length: DAYS }, (_, i) => startOfDay(start + i * DAY + 3_600_000 * 2)), [start]);
  if (!prop) return <DateSetup props={props} />;
  const scheduled = rows.map((r) => ({ r, s: rowSpan(r, prop) })).filter((x) => x.s) as { r: Row; s: { start: number; end: number } }[];
  const unscheduled = rows.filter((r) => !rowSpan(r, prop));
  const today = startOfDay(Date.now());
  const idx = (ms: number) => Math.round((ms - days[0]) / DAY);
  return (
    <div className="db-timeline">
      <div className="cal-head">
        <strong>
          {new Date(days[0]).toLocaleDateString(locale(), { day: "numeric", month: "short" })} – {new Date(days[DAYS - 1]).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" })}
        </strong>
        <div className="row-inline">
          <button className="secondary" onClick={() => setStart(start - 14 * DAY)}>
            ‹
          </button>
          <button className="secondary" onClick={() => setStart(startOfDay(Date.now()) - 7 * DAY)}>
            {t("db.today")}
          </button>
          <button className="secondary" onClick={() => setStart(start + 14 * DAY)}>
            ›
          </button>
        </div>
      </div>
      <div className="tl-scroll" ref={scroller}>
        <div className="tl-inner" style={{ width: 220 + DAYS * COL }}>
          <div className="tl-row head">
            <div className="tl-label" />
            {days.map((d) => (
              <div key={d} className={`tl-day ${d === today ? "today" : ""} ${[0, 6].includes(new Date(d).getDay()) ? "weekend" : ""}`} style={{ width: COL }}>
                <span className="muted small">{new Date(d).getDate()}</span>
              </div>
            ))}
          </div>
          {scheduled.map(({ r, s }) => {
            const a = Math.max(0, idx(s.start));
            const b = Math.min(DAYS - 1, idx(s.end));
            const visible = b >= 0 && a <= DAYS - 1 && idx(s.end) >= 0 && idx(s.start) <= DAYS - 1;
            return (
              <div key={r.id} className="tl-row">
                <div className="tl-label" onClick={() => actions.openRow(r.id)} title={r.title}>
                  {r.icon ?? "◇"} {r.title}
                </div>
                <div className="tl-track" style={{ width: DAYS * COL }}>
                  {visible && (
                    <button className="tl-bar" style={{ left: a * COL + 2, width: (b - a + 1) * COL - 4 }} onClick={() => actions.openRow(r.id)} title={r.title}>
                      {r.title}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {unscheduled.length > 0 && (
        <div className="tl-unscheduled">
          <span className="muted small">{t("db.unscheduled", { count: unscheduled.length })}</span>
          {unscheduled.map((r) => (
            <button key={r.id} className="rel-chip" onClick={() => void actions.setValue(r, prop.id, iso(new Date()))} title={t("db.scheduleToday")}>
              {r.title} ＋
            </button>
          ))}
        </div>
      )}
      <button className="db-new-row" onClick={() => actions.createRow(t("common.untitled"), { [prop.id]: iso(new Date()) })}>
        ＋ {t("db.newRow")}
      </button>
    </div>
  );
}


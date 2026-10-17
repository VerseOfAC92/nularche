// Veritabanı hücreleri: değerin tipine göre gösterimi ve düzenleyicisi.

import { useMemo, useState } from "react";
import { locale, t } from "../i18n/index.ts";
import {
  cellValue,
  ensureOption,
  parseDateValue,
  storedValue,
  todayIso,
  type CellValue,
  type DatabaseActions,
  type DatabaseModel,
  type Property,
  type Row,
  type SelectOption,
} from "./model.ts";
import { Popover } from "./Popover.tsx";

const READ_ONLY = new Set(["formula", "rollup", "created_time", "updated_time"]);

export const isReadOnly = (p: Property) => READ_ONLY.has(p.type);

function fmtDate(s: string): string {
  const withTime = s.length > 10;
  const d = withTime ? new Date(s) : new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return s;
  return withTime
    ? d.toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" })
    : d.toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" });
}

export function OptionChip({ option, onRemove }: { option: SelectOption | undefined; onRemove?: () => void }) {
  if (!option) return null;
  return (
    <span className={`opt opt-${option.color}`}>
      {option.name}
      {onRemove && (
        <button className="opt-x" onClick={(e) => (e.stopPropagation(), onRemove())} aria-label={t("common.remove")}>
          ×
        </button>
      )}
    </span>
  );
}

/** Hücre değerinin salt-okunur gösterimi. */
export function CellDisplay({ model, prop, value, onOpenRow }: { model: DatabaseModel; prop: Property; value: CellValue; onOpenRow?: (id: string) => void }) {
  if (value === null || value === "" || (Array.isArray(value) && value.length === 0)) return null;
  if (typeof value === "object" && !Array.isArray(value) && "error" in value) {
    return (
      <span className="db-error" title={value.error}>
        #{t("db.error")}
      </span>
    );
  }
  switch (prop.type) {
    case "select":
    case "status":
      return <OptionChip option={prop.options?.find((o) => o.id === value)} />;
    case "multi_select":
      return (
        <span className="opt-list">
          {(value as string[]).map((id) => (
            <OptionChip key={id} option={prop.options?.find((o) => o.id === id) ?? { id, name: id, color: "gray" }} />
          ))}
        </span>
      );
    case "checkbox":
      return <span className="db-check">{value ? "☑" : "☐"}</span>;
    case "date": {
      const d = value as { start: string; end?: string };
      return <span>{d.end ? `${fmtDate(d.start)} → ${fmtDate(d.end)}` : fmtDate(d.start)}</span>;
    }
    case "created_time":
    case "updated_time":
      return <span className="muted">{fmtDate(String(value).slice(0, 16))}</span>;
    case "url":
      return (
        <a href={String(value)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
          {String(value).replace(/^https?:\/\//, "")}
        </a>
      );
    case "email":
      return (
        <a href={`mailto:${value}`} onClick={(e) => e.stopPropagation()}>
          {String(value)}
        </a>
      );
    case "phone":
      return (
        <a href={`tel:${value}`} onClick={(e) => e.stopPropagation()}>
          {String(value)}
        </a>
      );
    case "relation":
      return (
        <span className="opt-list">
          {(value as string[]).map((id) => {
            const n = model.byId.get(id);
            return (
              <button key={id} className="rel-chip" onClick={(e) => (e.stopPropagation(), n && onOpenRow?.(id))}>
                {n ? `${n.icon ?? "↗"} ${n.title}` : t("db.missingRow")}
              </button>
            );
          })}
        </span>
      );
    case "number":
      return <span className="db-num">{typeof value === "number" ? value.toLocaleString(locale()) : String(value)}</span>;
    default:
      if (typeof value === "boolean") return <span className="db-check">{value ? "☑" : "☐"}</span>;
      if (typeof value === "number") return <span className="db-num">{value.toLocaleString(locale())}</span>;
      return <span className="db-text">{String(value)}</span>;
  }
}

/** Düzenlenebilir hücre: tıklayınca tipe uygun düzenleyici açılır. */
export function Cell({
  model,
  actions,
  prop,
  row,
  className = "",
}: {
  model: DatabaseModel;
  actions: DatabaseActions;
  prop: Property;
  row: Row;
  className?: string;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const value = cellValue(model.db, row, prop.id, model.ctx);
  if (prop.type === "checkbox") {
    return (
      <div className={`db-cell ${className}`}>
        <input type="checkbox" checked={value === true} onChange={(e) => void actions.setValue(row, prop.id, e.target.checked)} />
      </div>
    );
  }
  return (
    <>
      <div
        className={`db-cell ${isReadOnly(prop) ? "ro" : ""} ${className}`}
        onClick={(e) => !isReadOnly(prop) && setAnchor(e.currentTarget)}
        title={isReadOnly(prop) ? t("db.computed") : undefined}
      >
        <CellDisplay model={model} prop={prop} value={value} onOpenRow={actions.openRow} />
      </div>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={prop.type === "text" ? 320 : 260}>
          <CellEditor model={model} actions={actions} prop={prop} row={row} onClose={() => setAnchor(null)} />
        </Popover>
      )}
    </>
  );
}

export function CellEditor({
  model,
  actions,
  prop,
  row,
  onClose,
}: {
  model: DatabaseModel;
  actions: DatabaseActions;
  prop: Property;
  row: Row;
  onClose: () => void;
}) {
  const raw = row.props?.[prop.id];
  const stored = storedValue(prop, raw);
  switch (prop.type) {
    case "select":
    case "status":
    case "multi_select":
      return <OptionEditor model={model} actions={actions} prop={prop} row={row} stored={stored} onClose={onClose} />;
    case "date":
      return <DateEditor actions={actions} prop={prop} row={row} />;
    case "relation":
      return <RelationEditor model={model} actions={actions} prop={prop} row={row} stored={(stored as string[]) ?? []} />;
    default:
      return <TextEditor actions={actions} prop={prop} row={row} initial={stored === null ? "" : String(stored)} onClose={onClose} />;
  }
}

function TextEditor({ actions, prop, row, initial, onClose }: { actions: DatabaseActions; prop: Property; row: Row; initial: string; onClose: () => void }) {
  const [text, setText] = useState(initial);
  const commit = () => {
    if (text === initial) return;
    if (prop.type === "number") {
      const n = text.trim() === "" ? null : Number(text.replace(",", "."));
      if (n !== null && !Number.isFinite(n)) return;
      void actions.setValue(row, prop.id, n);
    } else void actions.setValue(row, prop.id, text.trim() === "" ? null : text);
  };
  const multiline = prop.type === "text";
  const props = {
    autoFocus: true,
    value: text,
    className: "db-input",
    onChange: (e: { target: { value: string } }) => setText(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !(multiline && e.shiftKey)) {
        e.preventDefault();
        commit();
        onClose();
      }
    },
  };
  return multiline ? (
    <textarea {...props} rows={3} />
  ) : (
    <input {...props} type={prop.type === "number" ? "text" : prop.type === "email" ? "email" : prop.type === "url" ? "url" : "text"} inputMode={prop.type === "number" ? "decimal" : undefined} />
  );
}

function OptionEditor({
  model,
  actions,
  prop,
  row,
  stored,
  onClose,
}: {
  model: DatabaseModel;
  actions: DatabaseActions;
  prop: Property;
  row: Row;
  stored: CellValue;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const multi = prop.type === "multi_select";
  const selected = multi ? ((stored as string[]) ?? []) : typeof stored === "string" ? [stored] : [];
  const options = prop.options ?? [];
  const filtered = options.filter((o) => o.name.toLocaleLowerCase("tr").includes(q.trim().toLocaleLowerCase("tr")));
  const exact = options.some((o) => o.name.toLocaleLowerCase("tr") === q.trim().toLocaleLowerCase("tr"));

  async function pick(id: string) {
    if (multi) {
      const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
      await actions.setValue(row, prop.id, next);
    } else {
      await actions.setValue(row, prop.id, selected[0] === id ? null : id);
      onClose();
    }
  }

  async function create() {
    const name = q.trim();
    if (!name) return;
    const { db, option } = ensureOption(model.db, prop.id, name);
    await actions.saveDb(db);
    setQ("");
    await pick(option.id);
  }

  return (
    <div className="opt-editor">
      <div className="opt-selected">
        {selected.map((id) => (
          <OptionChip key={id} option={options.find((o) => o.id === id) ?? { id, name: id, color: "gray" }} onRemove={() => pick(id)} />
        ))}
        <input
          autoFocus
          className="db-input bare"
          placeholder={selected.length ? "" : t("db.searchOrCreate")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (filtered[0] && (exact || !q.trim())) void pick(filtered[0].id);
              else void create();
            }
            if (e.key === "Backspace" && !q && selected.length) void pick(selected[selected.length - 1]);
          }}
        />
      </div>
      <div className="opt-choices">
        {filtered.map((o) => (
          <button key={o.id} className={selected.includes(o.id) ? "on" : ""} onClick={() => pick(o.id)}>
            <OptionChip option={o} />
            {selected.includes(o.id) && <span className="check">✓</span>}
          </button>
        ))}
        {q.trim() && !exact && (
          <button onClick={create}>
            {t("db.createOption")} <OptionChip option={{ id: "_", name: q.trim(), color: "gray" }} />
          </button>
        )}
        {options.length === 0 && !q && <p className="muted small pad">{t("db.noOptions")}</p>}
      </div>
    </div>
  );
}

function DateEditor({ actions, prop, row }: { actions: DatabaseActions; prop: Property; row: Row }) {
  const current = parseDateValue(row.props?.[prop.id]);
  const [start, setStart] = useState(current?.start.slice(0, 10) ?? "");
  const [end, setEnd] = useState(current?.end?.slice(0, 10) ?? "");
  const [range, setRange] = useState(!!current?.end);
  const save = (s: string, e: string, r: boolean) => {
    if (!s) return void actions.setValue(row, prop.id, null);
    void actions.setValue(row, prop.id, r && e && e >= s ? { start: s, end: e } : s);
  };
  return (
    <div className="date-editor">
      <label>
        {range ? t("db.start") : t("db.date")}
        <input type="date" className="db-input" value={start} onChange={(e) => (setStart(e.target.value), save(e.target.value, end, range))} autoFocus />
      </label>
      {range && (
        <label>
          {t("db.end")}
          <input type="date" className="db-input" value={end} min={start} onChange={(e) => (setEnd(e.target.value), save(start, e.target.value, range))} />
        </label>
      )}
      <label className="row-inline">
        <input type="checkbox" checked={range} onChange={(e) => (setRange(e.target.checked), save(start, end, e.target.checked))} /> {t("db.endDate")}
      </label>
      <div className="row-inline">
        <button className="secondary" onClick={() => (setStart(todayIso()), save(todayIso(), end, range))}>
          {t("db.today")}
        </button>
        <button className="secondary" onClick={() => (setStart(""), setEnd(""), save("", "", false))}>
          {t("db.clear")}
        </button>
      </div>
    </div>
  );
}

function RelationEditor({ model, actions, prop, row, stored }: { model: DatabaseModel; actions: DatabaseActions; prop: Property; row: Row; stored: string[] }) {
  const [q, setQ] = useState("");
  const target = prop.target ? model.byId.get(prop.target) : undefined;
  const candidates = useMemo(
    () => [...model.byId.values()].filter((n) => n.parentNodeId === prop.target && n.id !== row.id),
    [model.byId, prop.target, row.id],
  );
  if (!target) return <p className="muted small pad">{t("db.relationNoTarget")}</p>;
  const list = candidates.filter((n) => n.title.toLocaleLowerCase("tr").includes(q.toLocaleLowerCase("tr"))).slice(0, 50);
  const toggle = (id: string) => void actions.setValue(row, prop.id, stored.includes(id) ? stored.filter((x) => x !== id) : [...stored, id]);
  return (
    <div className="opt-editor">
      <input autoFocus className="db-input" placeholder={t("db.searchIn", { name: target.title })} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="opt-choices">
        {list.map((n) => (
          <button key={n.id} className={stored.includes(n.id) ? "on" : ""} onClick={() => toggle(n.id)}>
            <span>
              {n.icon ?? "◇"} {n.title}
            </span>
            {stored.includes(n.id) && <span className="check">✓</span>}
          </button>
        ))}
        {list.length === 0 && <p className="muted small pad">{t("db.noRows")}</p>}
      </div>
    </div>
  );
}

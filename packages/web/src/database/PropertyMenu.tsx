// Sütun başlığı menüsü: özelliği yeniden adlandırma, tip değiştirme, seçenekleri, formülü, ilişkiyi ve toplamayı düzenleme.

import { useState } from "react";
import { t, type StringKey } from "../i18n/index.ts";
import {
  evaluateFormula,
  OPTION_COLORS,
  PROPERTY_TYPES,
  removeProperty,
  ROLLUP_FUNCTIONS,
  TITLE_PROP,
  updateProperty,
  type Database,
  type DatabaseModel,
  type Property,
  type PropertyType,
} from "./model.ts";

export const TYPE_ICON: Record<PropertyType, string> = {
  text: "≡",
  number: "#",
  select: "◉",
  multi_select: "☰",
  status: "◐",
  date: "▦",
  checkbox: "☑",
  url: "🔗",
  email: "@",
  phone: "☎",
  relation: "↗",
  rollup: "Σ",
  formula: "ƒ",
  created_time: "⏱",
  updated_time: "⟳",
};

export const typeLabel = (type: PropertyType) => t(`db.type.${type}` as StringKey);

export function PropertyMenu({
  model,
  prop,
  onSave,
  onSort,
  onHide,
  onClose,
}: {
  model: DatabaseModel;
  prop: Property;
  onSave: (db: Database) => void;
  onSort: (dir: "asc" | "desc") => void;
  onHide: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(prop.name);
  const [expr, setExpr] = useState(prop.expression ?? "");
  const update = (patch: Partial<Property>) => onSave(updateProperty(model.db, prop.id, patch));
  const databases = [...model.byId.values()].filter((n) => n.database);
  const relations = model.db.properties.filter((p) => p.type === "relation");
  const relTarget = relations.find((r) => r.id === prop.relation)?.target;
  const targetProps = relTarget ? (model.ctx.databases?.get(relTarget)?.db.properties ?? []) : [];
  const sampleRow = model.rows[0];
  const preview = prop.type === "formula" && sampleRow ? evaluateFormula(expr, model.db, sampleRow, model.ctx) : null;

  return (
    <div className="prop-menu">
      <input
        autoFocus
        className="db-input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name !== prop.name && update({ name: name.trim() })}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
      />
      <label className="field">
        <span>{t("db.propType")}</span>
        <select value={prop.type} onChange={(e) => update({ type: e.target.value as PropertyType, ...(["select", "multi_select", "status"].includes(e.target.value) && !prop.options ? { options: [] } : {}) })}>
          {PROPERTY_TYPES.map((ty) => (
            <option key={ty} value={ty}>
              {TYPE_ICON[ty]} {typeLabel(ty)}
            </option>
          ))}
        </select>
      </label>

      {(prop.type === "select" || prop.type === "multi_select" || prop.type === "status") && (
        <div className="field">
          <span>{t("db.options")}</span>
          {(prop.options ?? []).map((o) => (
            <div key={o.id} className="opt-row">
              <select
                className={`color-dot opt-${o.color}`}
                value={o.color}
                onChange={(e) => update({ options: prop.options!.map((x) => (x.id === o.id ? { ...x, color: e.target.value as typeof o.color } : x)) })}
                title={t("db.color")}
              >
                {OPTION_COLORS.map((c) => (
                  <option key={c} value={c}>
                    {t(`db.color.${c}` as StringKey)}
                  </option>
                ))}
              </select>
              <input
                className="db-input"
                defaultValue={o.name}
                onBlur={(e) => e.target.value.trim() && e.target.value !== o.name && update({ options: prop.options!.map((x) => (x.id === o.id ? { ...x, name: e.target.value.trim() } : x)) })}
              />
              <button className="icon-btn" title={t("common.remove")} onClick={() => update({ options: prop.options!.filter((x) => x.id !== o.id) })}>
                ×
              </button>
            </div>
          ))}
          <button
            className="secondary"
            onClick={() => {
              const base = t("db.newOption");
              const taken = new Set((prop.options ?? []).map((o) => o.id));
              let i = (prop.options ?? []).length + 1;
              while (taken.has(`opt_${i}`)) i++;
              update({ options: [...(prop.options ?? []), { id: `opt_${i}`, name: `${base} ${i}`, color: OPTION_COLORS[i % OPTION_COLORS.length] }] });
            }}
          >
            ＋ {t("db.addOption")}
          </button>
        </div>
      )}

      {prop.type === "formula" && (
        <div className="field">
          <span>{t("db.formula")}</span>
          <textarea className="db-input mono" rows={3} value={expr} onChange={(e) => setExpr(e.target.value)} onBlur={() => expr !== prop.expression && update({ expression: expr })} />
          <span className="muted small">
            {t("db.formulaHelp")}{" "}
            {preview !== null && (
              <>
                · {t("db.preview")}: <b>{typeof preview === "object" && preview && "error" in preview ? `#${preview.error}` : JSON.stringify(preview)}</b>
              </>
            )}
          </span>
          <div className="formula-props">
            {[TITLE_PROP, ...model.db.properties.filter((p) => p.id !== prop.id).map((p) => p.name)].map((n) => (
              <button key={n} className="pill" onClick={() => setExpr((x) => `${x}prop("${n}")`)}>
                {n === TITLE_PROP ? t("db.title") : n}
              </button>
            ))}
          </div>
        </div>
      )}

      {prop.type === "relation" && (
        <label className="field">
          <span>{t("db.relationTarget")}</span>
          <select value={prop.target ?? ""} onChange={(e) => update({ target: e.target.value || undefined })}>
            <option value="">—</option>
            {databases.map((d) => (
              <option key={d.id} value={d.id}>
                {d.icon ?? "▦"} {d.title}
              </option>
            ))}
          </select>
        </label>
      )}

      {prop.type === "rollup" && (
        <>
          <label className="field">
            <span>{t("db.rollupRelation")}</span>
            <select value={prop.relation ?? ""} onChange={(e) => update({ relation: e.target.value || undefined, targetProp: undefined })}>
              <option value="">—</option>
              {relations.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t("db.rollupProperty")}</span>
            <select value={prop.targetProp ?? TITLE_PROP} onChange={(e) => update({ targetProp: e.target.value })}>
              <option value={TITLE_PROP}>{t("db.title")}</option>
              {targetProps.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t("db.rollupFn")}</span>
            <select value={prop.fn ?? "count"} onChange={(e) => update({ fn: e.target.value as Property["fn"] })}>
              {ROLLUP_FUNCTIONS.map((f) => (
                <option key={f} value={f}>
                  {t(`db.fn.${f}` as StringKey)}
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      <hr />
      <button onClick={() => (onSort("asc"), onClose())}>↑ {t("db.sortAsc")}</button>
      <button onClick={() => (onSort("desc"), onClose())}>↓ {t("db.sortDesc")}</button>
      <button onClick={() => (onHide(), onClose())}>◌ {t("db.hide")}</button>
      <button
        className="danger"
        onClick={() => {
          if (!confirm(t("db.deletePropConfirm", { name: prop.name }))) return;
          onSave(removeProperty(model.db, prop.id));
          onClose();
        }}
      >
        🗑 {t("db.deleteProp")}
      </button>
    </div>
  );
}

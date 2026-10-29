// Not özellikleri (Obsidian "Properties"): frontmatter'daki kullanıcı alanları başlığın altında düzenlenir.
// Tür değerden anlaşılır: liste, onay kutusu, sayı, tarih (YYYY-AA-GG) ya da metin. `aliases` ve `tags` listedir.

import { useEffect, useRef, useState } from "react";
import { t } from "../i18n/index.ts";

type Kind = "text" | "list" | "number" | "checkbox" | "date";

const kindOf = (v: unknown): Kind =>
  Array.isArray(v) ? "list" : typeof v === "boolean" ? "checkbox" : typeof v === "number" ? "number" : typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? "date" : "text";

const KIND_LABEL = { text: "ob.kind.text", list: "ob.kind.list", number: "ob.kind.number", checkbox: "ob.kind.checkbox", date: "ob.kind.date" } as const;

const LIST_KEYS = new Set(["aliases", "tags", "cssclasses"]);

function emptyOf(kind: Kind): unknown {
  return kind === "list" ? [] : kind === "checkbox" ? false : kind === "number" ? 0 : kind === "date" ? new Date().toISOString().slice(0, 10) : "";
}

export function PropertiesBlock({
  properties,
  onChange,
  addTick,
  readOnly,
}: {
  properties: Record<string, unknown>;
  /** Değişen anahtarlar; `null` özelliği kaldırır. */
  onChange: (patch: Record<string, unknown>) => void;
  /** Her artışta "özellik ekle" satırı açılır (⌘; komutu). */
  addTick: number;
  readOnly?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Kind>("text");
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (addTick > 0) (setAdding(true), setTimeout(() => nameRef.current?.focus(), 0));
  }, [addTick]);

  const entries = Object.entries(properties);
  if (!entries.length && !adding) return null;

  const add = () => {
    const key = name.trim();
    if (!key) return setAdding(false);
    onChange({ [key]: emptyOf(LIST_KEYS.has(key) ? "list" : kind) });
    setName("");
    setAdding(false);
  };

  return (
    <div className="properties">
      {entries.map(([key, value]) => (
        <div key={key} className="prop-row">
          <span className="prop-key" title={key}>
            {key}
          </span>
          <PropValue value={value} readOnly={readOnly} onChange={(v) => onChange({ [key]: v })} />
          {!readOnly && (
            <button className="icon-btn prop-remove" title={t("common.remove")} onClick={() => onChange({ [key]: null })}>
              ✕
            </button>
          )}
        </div>
      ))}
      {adding ? (
        <div className="prop-row">
          <input
            ref={nameRef}
            className="prop-key-input"
            placeholder={t("ob.propName")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => (e.key === "Enter" ? add() : e.key === "Escape" ? setAdding(false) : undefined)}
          />
          <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            {(["text", "list", "number", "checkbox", "date"] as Kind[]).map((k) => (
              <option key={k} value={k}>
                {t(KIND_LABEL[k])}
              </option>
            ))}
          </select>
          <button className="secondary" onClick={add}>
            {t("ob.add")}
          </button>
        </div>
      ) : (
        !readOnly && (
          <button className="prop-add" onClick={() => (setAdding(true), setTimeout(() => nameRef.current?.focus(), 0))}>
            ＋ {t("ob.addProperty")}
          </button>
        )
      )}
    </div>
  );
}

function PropValue({ value, onChange, readOnly }: { value: unknown; onChange: (v: unknown) => void; readOnly?: boolean }) {
  const kind = kindOf(value);
  const [draft, setDraft] = useState(() => (kind === "list" ? "" : String(value ?? "")));
  useEffect(() => {
    if (kind !== "list") setDraft(String(value ?? ""));
  }, [value, kind]);
  if (kind === "checkbox") return <input type="checkbox" checked={value === true} disabled={readOnly} onChange={(e) => onChange(e.target.checked)} />;
  if (kind === "list") {
    const items = (value as unknown[]).map(String);
    return (
      <span className="prop-list">
        {items.map((it, i) => (
          <span key={`${it}-${i}`} className="prop-chip">
            {it}
            {!readOnly && <button onClick={() => onChange(items.filter((_, j) => j !== i))}>×</button>}
          </span>
        ))}
        {!readOnly && (
          <input
            className="prop-list-input"
            value={draft}
            placeholder="＋"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === ",") && draft.trim()) {
                e.preventDefault();
                onChange([...items, draft.trim()]);
                setDraft("");
              } else if (e.key === "Backspace" && !draft && items.length) onChange(items.slice(0, -1));
            }}
            onBlur={() => draft.trim() && (onChange([...items, draft.trim()]), setDraft(""))}
          />
        )}
      </span>
    );
  }
  const commit = () => {
    const next = kind === "number" ? Number(draft) : draft;
    if (kind === "number" && !Number.isFinite(next)) return setDraft(String(value));
    if (next !== value) onChange(next);
  };
  return (
    <input
      className="prop-value"
      type={kind === "number" ? "number" : kind === "date" ? "date" : "text"}
      value={draft}
      readOnly={readOnly}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

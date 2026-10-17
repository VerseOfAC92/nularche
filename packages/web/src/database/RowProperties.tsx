// Veritabanı satırı sayfasının üstündeki özellik paneli. Değerler, açık sayfanın sürüm takibiyle (NodeView) kaydedilir.

import { useMemo, useState } from "react";
import { api, type NodeMeta } from "../api.ts";
import { t } from "../i18n/index.ts";
import { Cell } from "./Cell.tsx";
import { addProperty, PROPERTY_TYPES, toRow, useDatabaseModel, writeSchema, type Database, type DatabaseActions } from "./model.ts";
import { Popover } from "./Popover.tsx";
import { PropertyMenu, TYPE_ICON, typeLabel } from "./PropertyMenu.tsx";

export function RowProperties({
  row,
  dbNode,
  nodes,
  setRowProps,
  onChanged,
  onNavigate,
  onToast,
}: {
  row: NodeMeta;
  dbNode: NodeMeta;
  nodes: NodeMeta[];
  setRowProps: (props: Record<string, unknown> | null) => Promise<void>;
  onChanged: () => void;
  onNavigate: (id: string) => void;
  onToast: (msg: string) => void;
}) {
  const model = useDatabaseModel(dbNode, nodes);
  const [menu, setMenu] = useState<{ id: string | null; anchor: HTMLElement } | null>(null);
  const [name, setName] = useState("");
  const r = useMemo(() => toRow(row), [row]);

  const saveDb = async (db: Database) => {
    try {
      await writeSchema(dbNode.id, db);
      onChanged();
    } catch (e) {
      onToast((e as Error).message);
    }
  };
  const actions: DatabaseActions = {
    saveDb,
    setValue: async (_row, propId, value) => {
      const props = { ...(row.props ?? {}) };
      if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) delete props[propId];
      else props[propId] = value;
      await setRowProps(Object.keys(props).length ? props : null);
    },
    setTitle: async (_row, title) => void (await api.update(row.id, { title }), onChanged()),
    createRow: async () => null,
    trashRow: async () => undefined,
    openRow: onNavigate,
  };
  if (!model) return null;
  const propOf = (id: string | null) => model.db.properties.find((p) => p.id === id);

  return (
    <section className="row-props">
      <button className="row-db-link muted small" onClick={() => onNavigate(dbNode.id)}>
        {dbNode.icon ?? "▦"} {dbNode.title}
      </button>
      {model.db.properties.map((p) => (
        <div key={p.id} className="row-prop">
          <button className="row-prop-name" onClick={(e) => setMenu({ id: p.id, anchor: e.currentTarget })}>
            <span className="type-icon">{TYPE_ICON[p.type]}</span> {p.name}
          </button>
          <Cell model={model} actions={actions} prop={p} row={r} className="row-prop-value" />
        </div>
      ))}
      <button className="row-prop-add muted" onClick={(e) => setMenu({ id: null, anchor: e.currentTarget })}>
        ＋ {t("db.addProperty")}
      </button>
      {menu && (
        <Popover anchor={menu.anchor} onClose={() => setMenu(null)} width={280}>
          {menu.id && propOf(menu.id) ? (
            <PropertyMenu model={model} prop={propOf(menu.id)!} onSave={(db) => void saveDb(db)} onSort={() => undefined} onHide={() => undefined} onClose={() => setMenu(null)} />
          ) : (
            <div className="prop-menu">
              <input autoFocus className="db-input" placeholder={t("db.propName")} value={name} onChange={(e) => setName(e.target.value)} />
              <div className="type-list">
                {PROPERTY_TYPES.map((ty) => (
                  <button
                    key={ty}
                    onClick={() => {
                      void saveDb(addProperty(model.db, { name: name.trim() || typeLabel(ty), type: ty }).db);
                      setName("");
                      setMenu(null);
                    }}
                  >
                    <span className="type-icon">{TYPE_ICON[ty]}</span> {typeLabel(ty)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </Popover>
      )}
    </section>
  );
}

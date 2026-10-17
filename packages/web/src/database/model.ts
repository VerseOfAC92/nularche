// Veritabanı arayüzünün veri katmanı: şema ve satırlar Node listesinden okunur (yorum core/src/database.ts'te),
// yazmalar yerel sunucunun Node API'si üzerinden yapılır.

import { useMemo } from "react";
import {
  computeContext,
  defaultDatabase,
  parseDatabase,
  serializeDatabase,
  toRow,
  type ComputeContext,
  type Database,
  type Row,
} from "../../../core/src/database.ts";
import { api, type NodeMeta } from "../api.ts";
import { t } from "../i18n/index.ts";

export * from "../../../core/src/database.ts";

export interface DatabaseModel {
  db: Database;
  rows: Row[];
  ctx: ComputeContext;
  byId: Map<string, NodeMeta>;
}

export function useDatabaseModel(dbNode: NodeMeta | undefined, nodes: NodeMeta[]): DatabaseModel | null {
  return useMemo(() => {
    if (!dbNode?.database) return null;
    return {
      db: parseDatabase(dbNode.database),
      rows: nodes.filter((n) => n.parentNodeId === dbNode.id && !n.template).map(toRow),
      ctx: computeContext(nodes),
      byId: new Map(nodes.map((n) => [n.id, n])),
    };
  }, [dbNode, nodes]);
}

export interface DatabaseActions {
  saveDb: (db: Database) => Promise<void>;
  setValue: (row: Row, propId: string, value: unknown) => Promise<void>;
  setTitle: (row: Row, title: string) => Promise<void>;
  createRow: (title: string, props?: Record<string, unknown>) => Promise<NodeMeta | null>;
  trashRow: (row: Row) => Promise<void>;
  openRow: (id: string) => void;
}

/** Satır özellik değerini yazar (null değeri siler). */
export async function writeRowValue(row: Row, propId: string, value: unknown): Promise<void> {
  const props = { ...(row.props ?? {}) };
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) delete props[propId];
  else props[propId] = value;
  await api.update(row.id, { fields: { props: Object.keys(props).length ? props : null } });
}

export async function writeSchema(dbId: string, db: Database): Promise<void> {
  await api.update(dbId, { fields: { database: serializeDatabase(db) } });
}

/** Yeni veritabanı şeması (arayüz dilindeki adlarla): Durum ve Etiketler, tablo ve pano görünümleri. */
export const freshDatabase = () =>
  serializeDatabase(
    defaultDatabase({
      tags: t("db.tags"),
      status: t("db.statusName"),
      todo: t("db.todo"),
      doing: t("db.doing"),
      done: t("db.done"),
      table: t("db.view.table"),
      board: t("db.view.board"),
    }),
  );

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

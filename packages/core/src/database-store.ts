// Veritabanlarını Node deposuna bağlar: veritabanı = `database` alanlı Node, satırlar = onun alt Node'ları.
// MCP ve sunucu veritabanı okuma/yazmayı buradan yapar; değer yorumlama database.ts'tedir.

import {
  cellValue,
  computeContext,
  displayText,
  inputToStored,
  parseDatabase,
  queryRows,
  resolveProperty,
  serializeDatabase,
  TITLE_PROP,
  type ComputeContext,
  type Database,
  type Filter,
  type Sort,
  toRow,
} from "./database.ts";
import { NodeError, type NodeMeta, type NodeStore } from "./node-store.ts";

export interface LoadedDatabase {
  node: NodeMeta;
  db: Database;
  rows: NodeMeta[];
  ctx: ComputeContext;
}

export async function loadDatabase(store: NodeStore, ref: string): Promise<LoadedDatabase> {
  const node = await store.read(ref);
  if (!node.database) throw new NodeError("invalid", `Bu Node bir veritabanı değil: ${node.title}`);
  const all = await store.list();
  // Satır şablonları (template: true) veri satırı sayılmaz.
  return { node, db: parseDatabase(node.database), rows: all.filter((n) => n.parentNodeId === node.id && !n.template), ctx: computeContext(all) };
}

export async function createDatabase(store: NodeStore, input: { title: string; parentNodeId?: string | null; db: Database; body?: string }) {
  return store.create({ title: input.title, parentNodeId: input.parentNodeId, body: input.body, fields: { database: serializeDatabase(input.db) } });
}

export async function saveSchema(store: NodeStore, dbId: string, db: Database, baseRevision?: string) {
  return store.update(dbId, { fields: { database: serializeDatabase(db) }, baseRevision });
}

/** İnsan okunur değerleri (özellik adı → değer) satır değerlerine çevirir; gerekirse şemaya seçenek ekler. */
function resolveValues(db: Database, values: Record<string, unknown>): { db: Database; props: Record<string, unknown>; title?: string; changedSchema: boolean } {
  let cur = db;
  const props: Record<string, unknown> = {};
  let title: string | undefined;
  for (const [ref, input] of Object.entries(values)) {
    const prop = resolveProperty(cur, ref);
    if (!prop) throw new NodeError("invalid", `Bilinmeyen özellik: ${ref}`, { properties: [TITLE_PROP, ...cur.properties.map((p) => p.name)] });
    if (prop === TITLE_PROP) {
      title = String(input ?? "");
      continue;
    }
    try {
      const r = inputToStored(cur, prop, input);
      cur = r.db;
      props[prop.id] = r.value;
    } catch (e) {
      throw new NodeError("invalid", (e as Error).message);
    }
  }
  return { db: cur, props, title, changedSchema: cur !== db };
}

export async function addRow(store: NodeStore, dbRef: string, input: { title: string; values?: Record<string, unknown>; body?: string; icon?: string }) {
  const { node, db } = await loadDatabase(store, dbRef);
  const r = resolveValues(db, input.values ?? {});
  if (r.changedSchema) await saveSchema(store, node.id, r.db);
  const props = Object.fromEntries(Object.entries(r.props).filter(([, v]) => v !== null));
  return store.create({
    title: r.title || input.title,
    parentNodeId: node.id,
    body: input.body,
    fields: { ...(Object.keys(props).length ? { props } : {}), ...(input.icon ? { icon: input.icon } : {}) },
  });
}

export async function setRowValues(store: NodeStore, rowRef: string, values: Record<string, unknown>, baseRevision?: string) {
  const row = await store.read(rowRef);
  if (!row.parentNodeId) throw new NodeError("invalid", "Bu Node bir veritabanı satırı değil");
  const { node, db } = await loadDatabase(store, row.parentNodeId);
  const r = resolveValues(db, values);
  if (r.changedSchema) await saveSchema(store, node.id, r.db);
  const props = { ...(row.props ?? {}) };
  for (const [k, v] of Object.entries(r.props)) {
    if (v === null) delete props[k];
    else props[k] = v;
  }
  return store.update(row.id, { title: r.title, baseRevision, fields: { props: Object.keys(props).length ? props : null } });
}

/** Satırları görünüm, filtre ve sıralamayla sorgular; değerleri okunur metin olarak verir (MCP ve dışa aktarma). */
export function describeRows(loaded: LoadedDatabase, options: { view?: string; filters?: Filter[]; sorts?: Sort[]; match?: "all" | "any" } = {}) {
  const { db, rows, ctx } = loaded;
  const view = db.views.find((v) => v.id === options.view || v.name === options.view) ?? db.views[0];
  const query = { filters: options.filters ?? view.filters, sorts: options.sorts ?? view.sorts, match: options.match ?? view.match };
  const byId = new Map(rows.map((r) => [r.id, r]));
  return {
    view,
    rows: queryRows(db, rows.map(toRow), query, ctx).map((r) => ({
      id: r.id,
      title: r.title,
      path: byId.get(r.id)?.path,
      values: Object.fromEntries(db.properties.map((p) => [p.name, displayText(p, cellValue(db, r, p.id, ctx))])),
    })),
  };
}

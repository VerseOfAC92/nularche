// Speculum: notlara canlı sorgu. Bir notun içindeki ```query bloğu her açılışta ve Origin değiştikçe yeniden
// çalışır; sonuç liste, tablo, sayı ya da yapılacaklar olarak gösterilir. Sözdizimi satır satır `anahtar: değer`:
//
//   tag: #proje #açık          etiketlerin hepsi (alt etiketler dahil)
//   arche: Tez                 Arche'nin adı (ya da `shadow`)
//   text: bellek arşiv         gövdede geçen kelimelerin hepsi
//   where: durum = Açık        özellik koşulu; işleçler = != > < >= <= ~ (içerir), `has alan`, `!has alan`
//   where: updated >= -7d      tarihlerde göreli değer: -7d, -2w, -1m, today
//   sort: updated desc         title, created, updated, words, todos ya da bir özellik
//   limit: 20                  en çok 500
//   show: table                list | table | count | tasks
//   fields: durum, son tarih   tabloda gösterilecek sütunlar
//
// Kilitli notların içeriği sorgulanmaz (yalnızca başlık, etiket ve tarihler); şablonlar ve sorgunun bulunduğu not
// sonuçlara girmez.

import type { NodeMeta, NodeStore } from "./node-store.ts";
import { isLockedBody, maskCode, tagKey } from "./note-text.ts";

export type QueryShow = "list" | "table" | "count" | "tasks";
type Op = "=" | "!=" | ">" | "<" | ">=" | "<=" | "~" | "has" | "!has";

export interface QueryCondition {
  field: string;
  op: Op;
  value: string;
}

export interface ParsedQuery {
  tags: string[];
  arche: string | null;
  text: string[];
  where: QueryCondition[];
  sort: { field: string; desc: boolean } | null;
  limit: number;
  show: QueryShow;
  fields: string[];
  errors: string[];
}

export interface QueryRow {
  id: string;
  title: string;
  path: string;
  icon?: string;
  values: Record<string, string>;
}

export interface QueryTask {
  id: string;
  title: string;
  text: string;
  done: boolean;
  /** Görevin gövdedeki satır numarası (0'dan). */
  line: number;
}

export interface QueryResult {
  show: QueryShow;
  columns: string[];
  rows: QueryRow[];
  tasks: QueryTask[];
  total: number;
  errors: string[];
}

const BUILTIN = new Set(["title", "created", "updated", "words", "todos", "done", "tags", "path", "arche"]);
const MAX_LIMIT = 500;

export function parseQuery(src: string): ParsedQuery {
  const q: ParsedQuery = { tags: [], arche: null, text: [], where: [], sort: null, limit: 50, show: "list", fields: [], errors: [] };
  for (const raw of src.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;
    const m = /^([\p{L}]+)\s*:\s*(.*)$/u.exec(line);
    if (!m) {
      q.errors.push(`Anlaşılmadı: ${line}`);
      continue;
    }
    const key = m[1].toLocaleLowerCase("tr");
    const value = m[2].trim();
    switch (key) {
      case "tag":
      case "etiket":
        q.tags.push(...value.split(/[\s,]+/).filter(Boolean).map((t) => tagKey(t.replace(/^#/, ""))));
        break;
      case "arche":
        q.arche = value || null;
        break;
      case "text":
      case "metin":
        q.text.push(...value.toLocaleLowerCase("tr").split(/\s+/).filter(Boolean));
        break;
      case "where":
      case "koşul": {
        const c = parseCondition(value);
        if (c) q.where.push(c);
        else q.errors.push(`Koşul anlaşılmadı: ${value}`);
        break;
      }
      case "sort":
      case "sırala": {
        const [field, dir] = value.split(/\s+(?=(?:asc|desc|artan|azalan)$)/i);
        q.sort = { field: field.trim().toLocaleLowerCase("tr"), desc: /^(desc|azalan)$/i.test(dir ?? "") };
        break;
      }
      case "limit":
      case "sınır": {
        const n = Number(value);
        if (Number.isInteger(n) && n > 0) q.limit = Math.min(n, MAX_LIMIT);
        else q.errors.push(`Geçersiz sınır: ${value}`);
        break;
      }
      case "show":
      case "göster": {
        const v = value.toLocaleLowerCase("tr");
        const map: Record<string, QueryShow> = { list: "list", liste: "list", table: "table", tablo: "table", count: "count", sayı: "count", tasks: "tasks", görevler: "tasks" };
        if (map[v]) q.show = map[v];
        else q.errors.push(`Bilinmeyen görünüm: ${value}`);
        break;
      }
      case "fields":
      case "alanlar":
        q.fields = value.split(",").map((f) => f.trim()).filter(Boolean);
        break;
      default:
        q.errors.push(`Bilinmeyen anahtar: ${m[1]}`);
    }
  }
  return q;
}

function parseCondition(s: string): QueryCondition | null {
  const has = /^(!?)has\s+(.+)$/i.exec(s);
  if (has) return { field: has[2].trim().toLocaleLowerCase("tr"), op: has[1] ? "!has" : "has", value: "" };
  const m = /^(.+?)\s*(>=|<=|!=|=|>|<|~)\s*(.*)$/.exec(s);
  if (!m || !m[1].trim()) return null;
  return { field: m[1].trim().toLocaleLowerCase("tr"), op: m[2] as Op, value: m[3].trim().replace(/^["']|["']$/g, "") };
}

/** Göreli tarih (`-7d`, `-2w`, `-1m`, `today`) ya da ISO tarih → zaman damgası; tarih değilse null. */
export function dateValue(v: string, now = Date.now()): number | null {
  const s = v.trim().toLocaleLowerCase("tr");
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  if (s === "today" || s === "bugün") return day.getTime();
  const rel = /^([+-]?\d+)\s*([dwmyhgsa])$/.exec(s);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2];
    const d = new Date(day);
    if (unit === "d" || unit === "g") d.setDate(d.getDate() + n);
    else if (unit === "w" || unit === "h") d.setDate(d.getDate() + n * 7);
    else if (unit === "m" || unit === "a") d.setMonth(d.getMonth() + n);
    else if (unit === "y") d.setFullYear(d.getFullYear() + n);
    return d.getTime();
  }
  if (/^\d{4}-\d{2}(-\d{2})?([T ][\d:.]+Z?)?$/.test(s)) {
    const t = Date.parse(s.length === 7 ? `${s}-01` : s);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

const display = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(display).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

function compare(actual: unknown, op: Op, expected: string): boolean {
  if (op === "has") return actual !== undefined && actual !== null && actual !== "" && !(Array.isArray(actual) && !actual.length);
  if (op === "!has") return !compare(actual, "has", "");
  if (actual === undefined || actual === null) return op === "!=";
  if (Array.isArray(actual)) {
    const items = actual.map((x) => display(x).toLocaleLowerCase("tr"));
    const e = expected.toLocaleLowerCase("tr");
    if (op === "=" || op === "~") return items.some((x) => (op === "=" ? x === e : x.includes(e)));
    if (op === "!=") return !items.includes(e);
  }
  const a = display(actual);
  if (op === "~") return a.toLocaleLowerCase("tr").includes(expected.toLocaleLowerCase("tr"));
  // Sayı, tarih ve metin sırasıyla denenir.
  const an = Number(a);
  const en = Number(expected);
  let cmp: number;
  if (a.trim() !== "" && expected.trim() !== "" && Number.isFinite(an) && Number.isFinite(en)) cmp = an - en;
  else {
    const ad = dateValue(a);
    const ed = dateValue(expected);
    if (ad !== null && ed !== null) cmp = ad - ed;
    else cmp = a.toLocaleLowerCase("tr").localeCompare(expected.toLocaleLowerCase("tr"), "tr");
  }
  switch (op) {
    case "=":
      return cmp === 0;
    case "!=":
      return cmp !== 0;
    case ">":
      return cmp > 0;
    case "<":
      return cmp < 0;
    case ">=":
      return cmp >= 0;
    case "<=":
      return cmp <= 0;
  }
  return false;
}

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export async function runQuery(store: NodeStore, src: string, options: { selfId?: string } = {}): Promise<QueryResult> {
  const q = parseQuery(src);
  const all = await store.list();
  const byId = new Map(all.map((n) => [n.id, n]));
  let archeId: string | null | undefined;
  if (q.arche) {
    const want = q.arche.toLocaleLowerCase("tr");
    if (want === "shadow") archeId = null;
    else {
      const a = all.find((n) => n.parentNodeId === null && n.archeId === n.id && n.title.toLocaleLowerCase("tr") === want);
      if (!a) q.errors.push(`Arche bulunamadı: ${q.arche}`);
      archeId = a?.id ?? "__none__";
    }
  }
  const builtin = (n: NodeMeta, f: string): unknown => {
    switch (f) {
      case "title":
        return n.title;
      case "created":
        return iso(n.createdAt);
      case "updated":
        return iso(n.updatedAt);
      case "words":
        return n.words;
      case "todos":
        return n.todos - n.done;
      case "done":
        return n.done;
      case "tags":
        return n.tags;
      case "path":
        return n.path;
      case "arche":
        return n.archeId ? (byId.get(n.archeId)?.title ?? "") : "Shadow";
    }
    return undefined;
  };
  const needsDoc = q.text.length > 0 || q.show === "tasks" || q.where.some((c) => !BUILTIN.has(c.field)) || q.fields.some((f) => !BUILTIN.has(f.toLocaleLowerCase("tr"))) || (q.sort && !BUILTIN.has(q.sort.field));

  const matches: { meta: NodeMeta; props: Record<string, unknown>; body: string }[] = [];
  for (const n of all) {
    if (n.id === options.selfId || n.template || n.database) continue;
    if (archeId !== undefined && n.archeId !== archeId) continue;
    if (q.tags.length && !q.tags.every((t) => n.tags.some((g) => tagKey(g) === t || tagKey(g).startsWith(`${t}/`)))) continue;
    let props: Record<string, unknown> = { ...(n.props ?? {}) };
    let body = "";
    if (needsDoc) {
      const doc = await store.read(n.id);
      const locked = !!doc.locked || isLockedBody(doc.body);
      body = locked ? "" : doc.body;
      props = locked ? {} : { ...props, ...doc.properties };
    }
    const lowerProps = Object.fromEntries(Object.entries(props).map(([k, v]) => [k.toLocaleLowerCase("tr"), v]));
    const value = (f: string) => (BUILTIN.has(f) ? builtin(n, f) : lowerProps[f]);
    if (q.text.length) {
      const hay = `${n.title}\n${body}`.toLocaleLowerCase("tr");
      if (!q.text.every((w) => hay.includes(w))) continue;
    }
    if (!q.where.every((c) => compare(value(c.field), c.op, c.value))) continue;
    matches.push({ meta: n, props: lowerProps, body });
  }

  const sortField = q.sort?.field ?? (q.show === "tasks" ? "title" : "updated");
  const desc = q.sort ? q.sort.desc : sortField === "updated";
  const keyOf = (x: (typeof matches)[number]) => {
    if (sortField === "updated") return x.meta.updatedAt;
    if (sortField === "created") return x.meta.createdAt;
    const v = BUILTIN.has(sortField) ? builtin(x.meta, sortField) : x.props[sortField];
    return typeof v === "number" ? v : display(v).toLocaleLowerCase("tr");
  };
  matches.sort((a, b) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    const c = typeof ka === "number" && typeof kb === "number" ? ka - kb : String(ka).localeCompare(String(kb), "tr", { numeric: true });
    return desc ? -c : c;
  });

  const columns = q.fields.length ? q.fields : q.show === "table" ? ["updated"] : [];
  const rows: QueryRow[] = matches.slice(0, q.limit).map(({ meta, props }) => ({
    id: meta.id,
    title: meta.title,
    path: meta.path,
    ...(meta.icon ? { icon: meta.icon } : {}),
    values: Object.fromEntries(columns.map((c) => {
      const f = c.toLocaleLowerCase("tr");
      return [c, display(BUILTIN.has(f) ? builtin(meta, f) : props[f])];
    })),
  }));

  const tasks: QueryTask[] = [];
  if (q.show === "tasks") {
    for (const { meta, body } of matches) {
      const lines = maskCode(body).split("\n");
      lines.forEach((l, i) => {
        const m = /^[ \t]*[-*+] \[( |x|X)\][ \t]+(.*)$/.exec(l);
        if (m && m[1] === " " && tasks.length < q.limit) tasks.push({ id: meta.id, title: meta.title, text: body.split("\n")[i].replace(/^[ \t]*[-*+] \[.\][ \t]+/, ""), done: false, line: i });
      });
    }
  }
  return { show: q.show, columns, rows, tasks, total: q.show === "tasks" ? tasks.length : matches.length, errors: q.errors };
}

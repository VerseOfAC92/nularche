// Veritabanları: bir Node'un frontmatter'ındaki `database` alanı (şema + görünümler) ve alt Node'larının
// `props` alanı (satır değerleri). Bu modül bu iki alanın tek yorumlayıcısıdır; arayüz, sunucu ve MCP
// aynı ayrıştırma, hesaplama (formül, toplama), filtre, sıralama ve gruplama kurallarını buradan kullanır.
// Node/Electron bağımlılığı yoktur; tarayıcıda da çalışır.

export const PROPERTY_TYPES = [
  "text",
  "number",
  "select",
  "multi_select",
  "status",
  "date",
  "checkbox",
  "url",
  "email",
  "phone",
  "relation",
  "rollup",
  "formula",
  "created_time",
  "updated_time",
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export const VIEW_TYPES = ["table", "board", "list", "gallery", "calendar", "timeline"] as const;
export type ViewType = (typeof VIEW_TYPES)[number];

export const OPTION_COLORS = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"] as const;
export type OptionColor = (typeof OPTION_COLORS)[number];

export const ROLLUP_FUNCTIONS = ["count", "count_values", "sum", "average", "min", "max", "show"] as const;
export type RollupFunction = (typeof ROLLUP_FUNCTIONS)[number];

/** Satır başlığı her veritabanında vardır; değeri satır Node'unun başlığıdır. */
export const TITLE_PROP = "title";

export interface SelectOption {
  id: string;
  name: string;
  color: OptionColor;
}

export interface Property {
  /** Kararlı kimlik: satırlarda değer bu anahtarla saklanır; ad değişse de değişmez. */
  id: string;
  name: string;
  type: PropertyType;
  /** select, multi_select, status */
  options?: SelectOption[];
  /** relation: hedef veritabanı Node id'si */
  target?: string;
  /** rollup: kullanılan relation özelliği, hedefteki özellik ve işlev */
  relation?: string;
  targetProp?: string;
  fn?: RollupFunction;
  /** formula */
  expression?: string;
}

export const FILTER_OPS = [
  "is",
  "is_not",
  "contains",
  "not_contains",
  "starts_with",
  "gt",
  "lt",
  "gte",
  "lte",
  "is_empty",
  "is_not_empty",
  "checked",
  "unchecked",
  "before",
  "after",
] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export interface Filter {
  prop: string;
  op: FilterOp;
  value?: string | number | boolean | null;
}

export interface Sort {
  prop: string;
  dir: "asc" | "desc";
}

export interface View {
  id: string;
  name: string;
  type: ViewType;
  filters: Filter[];
  /** Filtrelerin birleşimi: hepsi (ve) ya da herhangi biri (veya). */
  match: "all" | "any";
  sorts: Sort[];
  /** board: gruplama özelliği (select / status / multi_select / checkbox) */
  groupBy?: string;
  /** calendar / timeline: tarih özelliği */
  dateProp?: string;
  /** Gizlenen özellik id'leri */
  hidden: string[];
  /** table: sütun genişlikleri (px) */
  widths?: Record<string, number>;
}

export interface Database {
  properties: Property[];
  views: View[];
}

/** Hesaplamaya giren satır: Node meta verisinin veritabanının ihtiyaç duyduğu kısmı. */
export interface Row {
  id: string;
  title: string;
  props?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  icon?: string;
  cover?: string;
  order?: number;
}

/** Tarih değeri: `2026-10-17`, `2026-10-17T14:30` ya da başlangıç–bitiş. */
export interface DateValue {
  start: string;
  end?: string;
}

export type CellValue = string | number | boolean | null | string[] | DateValue | { error: string };

/** Satır ve veritabanı olarak kullanılabilen Node bilgisi (NodeMeta ile uyumlu, Node modülüne bağımlı değil). */
export interface NodeLike {
  id: string;
  title: string;
  parentNodeId: string | null;
  props?: Record<string, unknown>;
  database?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  icon?: string;
  cover?: string;
  order?: number;
  template?: boolean;
}

export const toRow = (m: NodeLike): Row => ({
  id: m.id,
  title: m.title,
  props: m.props,
  createdAt: m.createdAt,
  updatedAt: m.updatedAt,
  icon: m.icon,
  cover: m.cover,
  order: m.order,
});

/** Tüm Node listesinden hesaplama bağlamı (ilişki ve toplama hedefleri) kurar. */
export function computeContext(all: NodeLike[]): ComputeContext {
  const databases = new Map<string, { db: Database; rows: Row[] }>();
  for (const n of all) {
    if (!n.database) continue;
    databases.set(n.id, { db: parseDatabase(n.database), rows: all.filter((r) => r.parentNodeId === n.id && !r.template).map(toRow) });
  }
  return { databases };
}

// --- Ayrıştırma -----------------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | undefined => (list.includes(v as T) ? (v as T) : undefined);

function parseOption(raw: unknown, i: number): SelectOption | null {
  if (typeof raw === "string" && raw.trim()) return { id: slugId(raw), name: raw, color: OPTION_COLORS[i % OPTION_COLORS.length] };
  if (!isObj(raw)) return null;
  const name = str(raw.name) ?? str(raw.id);
  if (!name) return null;
  return { id: str(raw.id) ?? slugId(name), name, color: oneOf(OPTION_COLORS, raw.color) ?? "gray" };
}

function parseProperty(raw: unknown): Property | null {
  if (!isObj(raw)) return null;
  const name = str(raw.name);
  const type = oneOf(PROPERTY_TYPES, raw.type);
  if (!name || !type) return null;
  const p: Property = { id: str(raw.id) ?? slugId(name), name, type };
  if (type === "select" || type === "multi_select" || type === "status") {
    const opts = Array.isArray(raw.options) ? raw.options.map(parseOption).filter((o): o is SelectOption => !!o) : [];
    p.options = uniqueBy(opts, (o) => o.id);
  }
  if (type === "relation" && str(raw.target)) p.target = str(raw.target);
  if (type === "rollup") {
    p.relation = str(raw.relation);
    p.targetProp = str(raw.targetProp) ?? str(raw.target_prop);
    p.fn = oneOf(ROLLUP_FUNCTIONS, raw.fn) ?? "count";
  }
  if (type === "formula") p.expression = typeof raw.expression === "string" ? raw.expression : "";
  return p;
}

function parseFilter(raw: unknown): Filter | null {
  if (!isObj(raw) || !str(raw.prop)) return null;
  const op = oneOf(FILTER_OPS, raw.op);
  if (!op) return null;
  const v = raw.value;
  return { prop: raw.prop as string, op, value: typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : null };
}

function parseView(raw: unknown, i: number): View | null {
  if (!isObj(raw)) return null;
  const type = oneOf(VIEW_TYPES, raw.type) ?? "table";
  const widths = isObj(raw.widths)
    ? Object.fromEntries(Object.entries(raw.widths).filter(([, w]) => typeof w === "number" && w > 40 && w < 2000)) as Record<string, number>
    : undefined;
  return {
    id: str(raw.id) ?? `v${i + 1}`,
    name: str(raw.name) ?? type,
    type,
    filters: Array.isArray(raw.filters) ? raw.filters.map(parseFilter).filter((f): f is Filter => !!f) : [],
    match: raw.match === "any" ? "any" : "all",
    sorts: Array.isArray(raw.sorts)
      ? raw.sorts.filter((s): s is Record<string, unknown> => isObj(s) && !!str(s.prop)).map((s) => ({ prop: s.prop as string, dir: s.dir === "desc" ? "desc" : "asc" }))
      : [],
    groupBy: str(raw.groupBy) ?? str(raw.group_by),
    dateProp: str(raw.dateProp) ?? str(raw.date_prop),
    hidden: Array.isArray(raw.hidden) ? raw.hidden.filter((h): h is string => typeof h === "string") : [],
    ...(widths && Object.keys(widths).length ? { widths } : {}),
  };
}

/** Frontmatter'daki `database` alanını ayrıştırır. Geçersiz girdiler atlanır; en az bir görünüm bulunur. */
export function parseDatabase(raw: unknown): Database {
  const r = isObj(raw) ? raw : {};
  const properties = uniqueBy(
    (Array.isArray(r.properties) ? r.properties : []).map(parseProperty).filter((p): p is Property => !!p && p.id !== TITLE_PROP),
    (p) => p.id,
  );
  let views = uniqueBy(
    (Array.isArray(r.views) ? r.views : []).map(parseView).filter((v): v is View => !!v),
    (v) => v.id,
  );
  if (views.length === 0) views = [newView("table", "Table", [])];
  return { properties, views };
}

/** Veritabanını frontmatter'a yazılacak düz nesneye çevirir (boş alanlar yazılmaz). */
export function serializeDatabase(db: Database): Record<string, unknown> {
  const clean = (o: object) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  return { properties: db.properties.map(clean), views: db.views.map(clean) };
}

// --- Oluşturma ve düzenleme -----------------------------------------------------------------------

const TR: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" };

/** Addan okunabilir, kararlı bir kimlik üretir (ör. "Son tarih" → "son_tarih"). */
export function slugId(name: string): string {
  const s = name
    .toLocaleLowerCase("tr")
    .replace(/[çğıöşü]/g, (c) => TR[c] ?? c)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return s || "prop";
}

function uniqueBy<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((t) => (seen.has(key(t)) ? false : (seen.add(key(t)), true)));
}

/** Var olan kimliklerle çakışmayan kimlik. */
export function uniqueId(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  set.add(TITLE_PROP);
  if (!set.has(base)) return base;
  for (let i = 2; ; i++) if (!set.has(`${base}_${i}`)) return `${base}_${i}`;
}

export function newView(type: ViewType, name: string, properties: Property[], taken: string[] = []): View {
  const view: View = { id: uniqueId(`v_${type}`, taken), name, type, filters: [], match: "all", sorts: [], hidden: [] };
  if (type === "board") view.groupBy = properties.find((p) => p.type === "status" || p.type === "select")?.id;
  if (type === "calendar" || type === "timeline") view.dateProp = properties.find((p) => p.type === "date")?.id;
  return view;
}

export function addProperty(db: Database, input: { name: string; type: PropertyType } & Partial<Property>): { db: Database; property: Property } {
  const property: Property = { ...input, id: uniqueId(input.id ?? slugId(input.name), db.properties.map((p) => p.id)) };
  if ((property.type === "select" || property.type === "multi_select" || property.type === "status") && !property.options) property.options = [];
  if (property.type === "rollup" && !property.fn) property.fn = "count";
  if (property.type === "formula" && property.expression === undefined) property.expression = "";
  return { db: { ...db, properties: [...db.properties, property] }, property };
}

export function updateProperty(db: Database, id: string, patch: Partial<Omit<Property, "id">>): Database {
  return { ...db, properties: db.properties.map((p) => (p.id === id ? { ...p, ...patch } : p)) };
}

/** Özelliği şemadan kaldırır. Satırlardaki değerler silinmez (geri eklenirse yeniden görünür). */
export function removeProperty(db: Database, id: string): Database {
  return {
    properties: db.properties.filter((p) => p.id !== id),
    views: db.views.map((v) => ({
      ...v,
      filters: v.filters.filter((f) => f.prop !== id),
      sorts: v.sorts.filter((s) => s.prop !== id),
      hidden: v.hidden.filter((h) => h !== id),
      groupBy: v.groupBy === id ? undefined : v.groupBy,
      dateProp: v.dateProp === id ? undefined : v.dateProp,
    })),
  };
}

/** Seçim özelliğine yeni seçenek ekler ya da adı eşleşen var olanı döndürür. */
export function ensureOption(db: Database, propId: string, name: string): { db: Database; option: SelectOption } {
  const prop = db.properties.find((p) => p.id === propId);
  if (!prop) throw new Error(`Unknown property: ${propId}`);
  const options = prop.options ?? [];
  const found = options.find((o) => o.name.toLocaleLowerCase("tr") === name.trim().toLocaleLowerCase("tr"));
  if (found) return { db, option: found };
  const option: SelectOption = {
    id: uniqueId(slugId(name), options.map((o) => o.id)),
    name: name.trim(),
    color: OPTION_COLORS[(options.length + 1) % OPTION_COLORS.length],
  };
  return { db: updateProperty(db, propId, { options: [...options, option] }), option };
}

/** Yeni veritabanı: verilen adlarla (arayüz dilinde) Etiketler ve Durum özellikleri, tablo ve pano görünümleri. */
export function defaultDatabase(names: {
  tags: string;
  status: string;
  todo: string;
  doing: string;
  done: string;
  table: string;
  board: string;
}): Database {
  const properties: Property[] = [
    {
      id: "status",
      name: names.status,
      type: "status",
      options: [
        { id: "todo", name: names.todo, color: "gray" },
        { id: "doing", name: names.doing, color: "blue" },
        { id: "done", name: names.done, color: "green" },
      ],
    },
    { id: "tags", name: names.tags, type: "multi_select", options: [] },
  ];
  return { properties, views: [newView("table", names.table, properties), newView("board", names.board, properties, ["v_table"])] };
}

// --- Değerler ---------------------------------------------------------------------------------------

export function parseDateValue(v: unknown): DateValue | null {
  const ok = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?/.test(s);
  if (v instanceof Date && !Number.isNaN(v.getTime())) return { start: v.toISOString().slice(0, 10) };
  if (ok(v)) return { start: v };
  if (isObj(v) && ok(v.start)) return ok(v.end) ? { start: v.start, end: v.end } : { start: v.start };
  return null;
}

/** Tarih değerinin zamanı (ms, yerel saat). */
export function dateMs(s: string): number {
  return s.length <= 10 ? new Date(`${s}T00:00:00`).getTime() : new Date(s).getTime();
}

/** Saklanan ham değeri özelliğin tipine göre normalleştirir (hesaplanan tipler hariç). */
export function storedValue(prop: Property, raw: unknown): CellValue {
  switch (prop.type) {
    case "text":
    case "url":
    case "email":
    case "phone":
      return typeof raw === "string" ? raw : typeof raw === "number" ? String(raw) : null;
    case "number": {
      const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
      return Number.isFinite(n) ? n : null;
    }
    case "checkbox":
      return raw === true || raw === "true";
    case "select":
    case "status":
      return typeof raw === "string" && raw ? raw : null;
    case "multi_select":
    case "relation":
      return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : typeof raw === "string" && raw ? [raw] : [];
    case "date":
      return parseDateValue(raw);
    default:
      return null;
  }
}

export interface ComputeContext {
  /** relation hedefleri için: veritabanı id'sine göre şema ve satırlar */
  databases?: Map<string, { db: Database; rows: Row[] }>;
  /** formül döngülerini kesmek için */
  depth?: number;
  now?: number;
}

/** Satırın bir özellikteki değeri (hesaplanan özellikler dahil). */
export function cellValue(db: Database, row: Row, propId: string, ctx: ComputeContext = {}): CellValue {
  if (propId === TITLE_PROP) return row.title;
  const prop = db.properties.find((p) => p.id === propId);
  if (!prop) return null;
  switch (prop.type) {
    case "created_time":
      return new Date(row.createdAt).toISOString();
    case "updated_time":
      return new Date(row.updatedAt).toISOString();
    case "formula":
      return evaluateFormula(prop.expression ?? "", db, row, ctx);
    case "rollup":
      return rollup(db, row, prop, ctx);
    default:
      return storedValue(prop, row.props?.[prop.id]);
  }
}

function rollup(db: Database, row: Row, prop: Property, ctx: ComputeContext): CellValue {
  const rel = db.properties.find((p) => p.id === prop.relation && p.type === "relation");
  if (!rel?.target) return null;
  const target = ctx.databases?.get(rel.target);
  const ids = storedValue(rel, row.props?.[rel.id]) as string[];
  if (!target) return prop.fn === "count" ? ids.length : null;
  const linked = target.rows.filter((r) => ids.includes(r.id));
  const values = linked.map((r) => cellValue(target.db, r, prop.targetProp ?? TITLE_PROP, { ...ctx, depth: (ctx.depth ?? 0) + 1 }));
  const nums = values.map(toNumber).filter((n): n is number => n !== null);
  switch (prop.fn) {
    case "count":
      return linked.length;
    case "count_values":
      return values.filter((v) => !isEmpty(v)).length;
    case "sum":
      return nums.reduce((a, b) => a + b, 0);
    case "average":
      return nums.length ? round(nums.reduce((a, b) => a + b, 0) / nums.length, 4) : null;
    case "min":
      return nums.length ? Math.min(...nums) : null;
    case "max":
      return nums.length ? Math.max(...nums) : null;
    default:
      return values.map((v) => displayText(target.db.properties.find((p) => p.id === prop.targetProp), v)).filter(Boolean).join(", ");
  }
}

const round = (n: number, d = 0) => Math.round(n * 10 ** d) / 10 ** d;

export function isEmpty(v: CellValue): boolean {
  return v === null || v === "" || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && v !== null && "error" in v);
}

function toNumber(v: CellValue): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** Değerin düz metin gösterimi (arama, sıralama, CSV ve formül birleştirmeleri için). */
export function displayText(prop: Property | undefined, v: CellValue): string {
  if (v === null) return "";
  if (typeof v === "object" && !Array.isArray(v)) return "error" in v ? `#${v.error}` : v.end ? `${v.start} → ${v.end}` : v.start;
  if (Array.isArray(v)) {
    if (prop?.options) return v.map((id) => prop.options!.find((o) => o.id === id)?.name ?? id).join(", ");
    return v.join(", ");
  }
  if (typeof v === "string" && prop?.options) return prop.options.find((o) => o.id === v)?.name ?? v;
  if (typeof v === "boolean") return v ? "✓" : "";
  return String(v);
}

// --- Filtre, sıralama, gruplama -------------------------------------------------------------------

function matchFilter(db: Database, row: Row, f: Filter, ctx: ComputeContext): boolean {
  const prop = f.prop === TITLE_PROP ? undefined : db.properties.find((p) => p.id === f.prop);
  if (f.prop !== TITLE_PROP && !prop) return true; // silinmiş özellik: filtre etkisiz
  const v = cellValue(db, row, f.prop, ctx);
  const text = displayText(prop, v).toLocaleLowerCase("tr");
  const want = f.value === null || f.value === undefined ? "" : String(f.value);
  const wantLower = want.toLocaleLowerCase("tr");
  switch (f.op) {
    case "is_empty":
      return isEmpty(v);
    case "is_not_empty":
      return !isEmpty(v);
    case "checked":
      return v === true;
    case "unchecked":
      return v !== true;
    case "is":
      if (Array.isArray(v)) return v.includes(want);
      if (typeof v === "number") return v === Number(want);
      if (typeof v === "boolean") return v === (want === "true");
      if (prop?.options && typeof v === "string") return v === want;
      return text === wantLower;
    case "is_not":
      return !matchFilter(db, row, { ...f, op: "is" }, ctx);
    case "contains":
      return Array.isArray(v) && prop?.options ? v.includes(want) : text.includes(wantLower);
    case "not_contains":
      return !matchFilter(db, row, { ...f, op: "contains" }, ctx);
    case "starts_with":
      return text.startsWith(wantLower);
    case "gt":
    case "lt":
    case "gte":
    case "lte": {
      const n = toNumber(v);
      const w = Number(want);
      if (n === null || !Number.isFinite(w)) return false;
      return f.op === "gt" ? n > w : f.op === "lt" ? n < w : f.op === "gte" ? n >= w : n <= w;
    }
    case "before":
    case "after": {
      const d = typeof v === "object" && v && !Array.isArray(v) && "start" in v ? dateMs(v.start) : typeof v === "string" ? dateMs(v) : NaN;
      const w = want === "today" ? new Date(new Date(ctx.now ?? Date.now()).toDateString()).getTime() : dateMs(want);
      if (!Number.isFinite(d) || !Number.isFinite(w)) return false;
      return f.op === "before" ? d < w : d > w;
    }
  }
}

function sortKey(db: Database, row: Row, propId: string, ctx: ComputeContext): number | string | null {
  const prop = db.properties.find((p) => p.id === propId);
  const v = cellValue(db, row, propId, ctx);
  if (isEmpty(v)) return null;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "object" && !Array.isArray(v) && v && "start" in v) return dateMs(v.start);
  if (prop && (prop.type === "created_time" || prop.type === "updated_time") && typeof v === "string") return Date.parse(v);
  if (prop?.options && typeof v === "string") {
    const i = prop.options.findIndex((o) => o.id === v);
    return i >= 0 ? i : displayText(prop, v);
  }
  return displayText(prop, v).toLocaleLowerCase("tr");
}

/** Görünümün filtre ve sıralamasını uygular. Sıralama yoksa elle sıra (order), sonra oluşturulma zamanı. */
export function queryRows(db: Database, rows: Row[], view: Pick<View, "filters" | "sorts" | "match">, ctx: ComputeContext = {}): Row[] {
  const passes = (r: Row) =>
    view.filters.length === 0 ||
    (view.match === "any" ? view.filters.some((f) => matchFilter(db, r, f, ctx)) : view.filters.every((f) => matchFilter(db, r, f, ctx)));
  const out = rows.filter(passes);
  const base = (a: Row, b: Row) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.createdAt - b.createdAt;
  out.sort((a, b) => {
    for (const s of view.sorts) {
      const ka = sortKey(db, a, s.prop, ctx);
      const kb = sortKey(db, b, s.prop, ctx);
      if (ka === kb) continue;
      if (ka === null) return 1; // boşlar her zaman sonda
      if (kb === null) return -1;
      const c = typeof ka === "number" && typeof kb === "number" ? ka - kb : String(ka).localeCompare(String(kb), "tr");
      if (c !== 0) return s.dir === "desc" ? -c : c;
    }
    return base(a, b);
  });
  return out;
}

export interface Group {
  /** Seçenek id'si, "true"/"false" (onay kutusu) ya da boş grup için "" */
  key: string;
  label: string;
  color?: OptionColor;
  rows: Row[];
}

/** Pano görünümü için satırları gruplar. Boş grup ("Yok") her zaman en sondadır. */
export function groupRows(db: Database, rows: Row[], propId: string | undefined, noneLabel: string): Group[] {
  const prop = db.properties.find((p) => p.id === propId);
  if (!prop) return [{ key: "", label: noneLabel, rows }];
  if (prop.type === "checkbox") {
    return [
      { key: "true", label: "✓", rows: rows.filter((r) => storedValue(prop, r.props?.[prop.id]) === true) },
      { key: "false", label: "—", rows: rows.filter((r) => storedValue(prop, r.props?.[prop.id]) !== true) },
    ];
  }
  const options = prop.options ?? [];
  const groups: Group[] = options.map((o) => ({ key: o.id, label: o.name, color: o.color, rows: [] }));
  const none: Group = { key: "", label: noneLabel, rows: [] };
  for (const r of rows) {
    const v = storedValue(prop, r.props?.[prop.id]);
    const keys = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
    const hits = groups.filter((g) => keys.includes(g.key));
    if (hits.length === 0) none.rows.push(r);
    for (const g of hits) g.rows.push(r);
  }
  return [...groups, none];
}

/** Pano kartını bir gruptan diğerine taşırken yazılacak yeni ham değer. */
export function valueForGroup(prop: Property, current: unknown, fromKey: string, toKey: string): unknown {
  if (prop.type === "checkbox") return toKey === "true";
  if (prop.type === "multi_select") {
    const list = (storedValue(prop, current) as string[]).filter((k) => k !== fromKey);
    return toKey ? [...new Set([...list, toKey])] : list;
  }
  return toKey || null;
}

/** Satır değerlerini hedef özellik adlarına ya da kimliklerine göre yazmak için çözümler (MCP ve CSV). */
export function resolveProperty(db: Database, ref: string): Property | typeof TITLE_PROP | null {
  if (ref === TITLE_PROP) return TITLE_PROP;
  const lower = ref.toLocaleLowerCase("tr");
  return db.properties.find((p) => p.id === ref) ?? db.properties.find((p) => p.name.toLocaleLowerCase("tr") === lower) ?? null;
}

/**
 * Kullanıcı ya da yapay zekâ tarafından verilen (insan okunur) değeri saklanacak ham değere çevirir.
 * Seçim adları seçenek kimliğine çevrilir; yeni adlar şemaya seçenek olarak eklenir.
 */
export function inputToStored(db: Database, prop: Property, input: unknown): { db: Database; value: unknown } {
  if (input === null || input === undefined || input === "") return { db, value: null };
  switch (prop.type) {
    case "select":
    case "status": {
      const name = String(Array.isArray(input) ? input[0] : input);
      const byId = prop.options?.find((o) => o.id === name);
      if (byId) return { db, value: byId.id };
      const r = ensureOption(db, prop.id, name);
      return { db: r.db, value: r.option.id };
    }
    case "multi_select": {
      let cur = db;
      const ids: string[] = [];
      for (const raw of Array.isArray(input) ? input : String(input).split(",")) {
        const name = String(raw).trim();
        if (!name) continue;
        const p = cur.properties.find((x) => x.id === prop.id)!;
        const byId = p.options?.find((o) => o.id === name);
        if (byId) ids.push(byId.id);
        else {
          const r = ensureOption(cur, prop.id, name);
          cur = r.db;
          ids.push(r.option.id);
        }
      }
      return { db: cur, value: [...new Set(ids)] };
    }
    case "number": {
      const n = Number(input);
      if (!Number.isFinite(n)) throw new Error(`"${prop.name}" expects a number`);
      return { db, value: n };
    }
    case "checkbox":
      return { db, value: input === true || input === "true" || input === 1 || input === "1" };
    case "date": {
      const d = parseDateValue(input);
      if (!d) throw new Error(`"${prop.name}" expects a date like 2026-10-17`);
      return { db, value: d.end ? d : d.start };
    }
    case "relation":
      return { db, value: (Array.isArray(input) ? input : [input]).map(String) };
    case "formula":
    case "rollup":
    case "created_time":
    case "updated_time":
      throw new Error(`"${prop.name}" is computed and cannot be set`);
    default:
      return { db, value: String(input) };
  }
}

// --- Formüller --------------------------------------------------------------------------------------
// Küçük, güvenli bir ifade dili (kod çalıştırmaz):
//   prop("Fiyat") * prop("Adet")      if(prop("Bitti"), "✓", "…")      concat(prop("Ad"), " ", "x")
//   Operatörler: + - * / % == != > < >= <= and or not   (&& || ! de olur)
//   İşlevler: if, concat, length, lower, upper, contains, replace, round, floor, ceil, abs, min, max,
//             sqrt, pow, empty, toNumber, format, now, today, dateBetween, dateAdd, formatDate, year, month, day

type FValue = number | string | boolean | null | string[] | DateValue;

type Token = { t: "num"; v: number } | { t: "str"; v: string } | { t: "id"; v: string } | { t: "op"; v: string };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/\d/.test(c) || (c === "." && /\d/.test(src[i + 1] ?? ""))) {
      const m = /^\d*\.?\d+(e[+-]?\d+)?/i.exec(src.slice(i))!;
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (c === '"' || c === "'" || c === "“" || c === "”") {
      const close = c === "“" ? "”" : c;
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== close && !(close === "”" && src[j] === '"')) {
        if (src[j] === "\\" && j + 1 < src.length) j++;
        s += src[j++];
      }
      if (j >= src.length) throw new Error("unterminated string");
      out.push({ t: "str", v: s });
      i = j + 1;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (["==", "!=", ">=", "<=", "&&", "||"].includes(two)) {
      out.push({ t: "op", v: two });
      i += 2;
      continue;
    }
    if ("+-*/%()<>,!".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
      continue;
    }
    const m = /^[\p{L}_][\p{L}\p{N}_]*/u.exec(src.slice(i));
    if (m) {
      out.push({ t: "id", v: m[0] });
      i += m[0].length;
      continue;
    }
    throw new Error(`unexpected "${c}"`);
  }
  return out;
}

type Ast =
  | { k: "lit"; v: FValue }
  | { k: "call"; name: string; args: Ast[] }
  | { k: "un"; op: string; a: Ast }
  | { k: "bin"; op: string; a: Ast; b: Ast };

const PREC: Record<string, number> = { or: 1, "||": 1, and: 2, "&&": 2, "==": 3, "!=": 3, ">": 4, "<": 4, ">=": 4, "<=": 4, "+": 5, "-": 5, "*": 6, "/": 6, "%": 6 };

function parseFormula(src: string): Ast {
  const toks = tokenize(src);
  let pos = 0;
  const peek = () => toks[pos];
  const opOf = (tk: Token | undefined) => (tk && (tk.t === "op" || (tk.t === "id" && (tk.v === "and" || tk.v === "or"))) ? tk.v : null);
  const expect = (v: string) => {
    const tk = toks[pos++];
    if (!tk || tk.t !== "op" || tk.v !== v) throw new Error(`expected "${v}"`);
  };
  function primary(): Ast {
    const tk = toks[pos++];
    if (!tk) throw new Error("unexpected end");
    if (tk.t === "num") return { k: "lit", v: tk.v };
    if (tk.t === "str") return { k: "lit", v: tk.v };
    if (tk.t === "op" && tk.v === "(") {
      const e = expr(0);
      expect(")");
      return e;
    }
    if (tk.t === "op" && (tk.v === "-" || tk.v === "!")) return { k: "un", op: tk.v, a: unary() };
    if (tk.t === "id") {
      if (tk.v === "true" || tk.v === "false") return { k: "lit", v: tk.v === "true" };
      if (tk.v === "not") return { k: "un", op: "!", a: unary() };
      const next = peek();
      if (next?.t === "op" && next.v === "(") {
        pos++;
        const args: Ast[] = [];
        if (!(peek()?.t === "op" && (peek() as { v: string }).v === ")")) {
          for (;;) {
            args.push(expr(0));
            const sep = toks[pos];
            if (sep?.t === "op" && sep.v === ",") {
              pos++;
              continue;
            }
            break;
          }
        }
        expect(")");
        return { k: "call", name: tk.v, args };
      }
      throw new Error(`unknown name "${tk.v}"`);
    }
    throw new Error(`unexpected "${tk.v}"`);
  }
  function unary(): Ast {
    return primary();
  }
  function expr(min: number): Ast {
    let left = unary();
    for (;;) {
      const op = opOf(peek());
      const p = op ? PREC[op] : undefined;
      if (!op || p === undefined || p < min) break;
      pos++;
      const right = expr(p + 1);
      left = { k: "bin", op, a: left, b: right };
    }
    return left;
  }
  const ast = expr(0);
  if (pos < toks.length) throw new Error(`unexpected "${(toks[pos] as { v: unknown }).v}"`);
  return ast;
}

const truthy = (v: FValue): boolean =>
  v === null ? false : typeof v === "string" ? v !== "" : Array.isArray(v) ? v.length > 0 : typeof v === "object" ? true : Boolean(v);

const asText = (v: FValue): string =>
  v === null ? "" : Array.isArray(v) ? v.join(", ") : typeof v === "object" ? (v.end ? `${v.start} → ${v.end}` : v.start) : typeof v === "boolean" ? String(v) : String(v);

const asNum = (v: FValue): number => {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v && typeof v === "object" && !Array.isArray(v)) return dateMs(v.start);
  const t = asText(v);
  const n = t.trim() === "" ? NaN : Number(t);
  if (!Number.isFinite(n)) throw new Error(`"${asText(v)}" is not a number`);
  return n;
};

const asDate = (v: FValue): number => {
  if (v && typeof v === "object" && !Array.isArray(v)) return dateMs(v.start);
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const ms = dateMs(v);
    if (Number.isFinite(ms)) return ms;
  }
  throw new Error("expected a date");
};

const DAY = 86_400_000;
const isoDay = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const UNITS: Record<string, number> = { minutes: 60_000, hours: 3_600_000, days: DAY, weeks: 7 * DAY };

/** Formülü hesaplar; hata durumunda `{ error }` döner (hesaplanamayan hücre "#hata" olarak gösterilir). */
export function evaluateFormula(expression: string, db: Database, row: Row, ctx: ComputeContext = {}): CellValue {
  if (!expression.trim()) return null;
  if ((ctx.depth ?? 0) > 6) return { error: "cycle" };
  let ast: Ast;
  try {
    ast = parseFormula(expression);
  } catch (e) {
    return { error: (e as Error).message };
  }
  const now = ctx.now ?? Date.now();
  const ev = (n: Ast): FValue => {
    switch (n.k) {
      case "lit":
        return n.v;
      case "un": {
        const a = ev(n.a);
        return n.op === "-" ? -asNum(a) : !truthy(a);
      }
      case "bin": {
        if (n.op === "and" || n.op === "&&") return truthy(ev(n.a)) && truthy(ev(n.b));
        if (n.op === "or" || n.op === "||") return truthy(ev(n.a)) || truthy(ev(n.b));
        const a = ev(n.a);
        const b = ev(n.b);
        // Boş değerle aritmetik boş sonuç verir (doldurulmamış hücre "0" gibi görünmesin).
        if ((a === null || b === null) && "-*/%".includes(n.op)) return null;
        if (a === null && b === null && n.op === "+") return null;
        switch (n.op) {
          case "+":
            return typeof a === "string" || typeof b === "string" ? asText(a) + asText(b) : asNum(a) + asNum(b);
          case "-":
            return asNum(a) - asNum(b);
          case "*":
            return asNum(a) * asNum(b);
          case "/": {
            const d = asNum(b);
            if (d === 0) throw new Error("division by zero");
            return asNum(a) / d;
          }
          case "%":
            return asNum(a) % asNum(b);
          case "==":
            return asText(a) === asText(b);
          case "!=":
            return asText(a) !== asText(b);
          default: {
            const both = typeof a === "number" || typeof b === "number";
            const x = both ? asNum(a) : asText(a);
            const y = both ? asNum(b) : asText(b);
            return n.op === ">" ? x > y : n.op === "<" ? x < y : n.op === ">=" ? x >= y : x <= y;
          }
        }
      }
      case "call": {
        const name = n.name;
        if (name === "if") {
          if (n.args.length < 2) throw new Error("if(condition, then, else)");
          return truthy(ev(n.args[0])) ? ev(n.args[1]) : n.args[2] ? ev(n.args[2]) : null;
        }
        if (name === "prop") {
          const key = n.args[0] ? asText(ev(n.args[0])) : "";
          const ref = key.toLocaleLowerCase("tr") === "title" || key === "Name" ? TITLE_PROP : resolveProperty(db, key);
          if (!ref) throw new Error(`no property "${key}"`);
          const id = ref === TITLE_PROP ? TITLE_PROP : ref.id;
          const prop = ref === TITLE_PROP ? undefined : ref;
          const v = cellValue(db, row, id, { ...ctx, depth: (ctx.depth ?? 0) + 1 });
          if (v && typeof v === "object" && !Array.isArray(v) && "error" in v) throw new Error(v.error);
          if (prop?.options) return Array.isArray(v) ? v.map((x) => displayText(prop, x)) : typeof v === "string" ? displayText(prop, v) : (v as FValue);
          return v as FValue;
        }
        const args = n.args.map(ev);
        const a0 = args[0] ?? null;
        switch (name) {
          case "concat":
            return args.map(asText).join("");
          case "length":
            return Array.isArray(a0) ? a0.length : asText(a0).length;
          case "lower":
            return asText(a0).toLocaleLowerCase("tr");
          case "upper":
            return asText(a0).toLocaleUpperCase("tr");
          case "contains":
            return Array.isArray(a0) ? a0.includes(asText(args[1] ?? null)) : asText(a0).includes(asText(args[1] ?? null));
          case "replace":
            return asText(a0).split(asText(args[1] ?? null)).join(asText(args[2] ?? null));
          case "round":
            return round(asNum(a0), args[1] === undefined ? 0 : asNum(args[1]));
          case "floor":
            return Math.floor(asNum(a0));
          case "ceil":
            return Math.ceil(asNum(a0));
          case "abs":
            return Math.abs(asNum(a0));
          case "sqrt":
            return Math.sqrt(asNum(a0));
          case "pow":
            return asNum(a0) ** asNum(args[1] ?? null);
          case "min":
            return Math.min(...args.map(asNum));
          case "max":
            return Math.max(...args.map(asNum));
          case "empty":
            return !truthy(a0);
          case "toNumber":
            return asNum(a0);
          case "format":
            return asText(a0);
          case "now":
            return new Date(now).toISOString().slice(0, 16);
          case "today":
            return isoDay(now);
          case "year":
            return new Date(asDate(a0)).getFullYear();
          case "month":
            return new Date(asDate(a0)).getMonth() + 1;
          case "day":
            return new Date(asDate(a0)).getDate();
          case "formatDate":
            return isoDay(asDate(a0));
          case "dateBetween": {
            const unit = UNITS[asText(args[2] ?? "days")] ?? DAY;
            return Math.trunc((asDate(a0) - asDate(args[1] ?? null)) / unit);
          }
          case "dateAdd": {
            const unit = UNITS[asText(args[2] ?? "days")] ?? DAY;
            return isoDay(asDate(a0) + asNum(args[1] ?? null) * unit);
          }
          default:
            throw new Error(`unknown function "${name}"`);
        }
      }
    }
  };
  try {
    const v = ev(ast);
    if (typeof v === "number" && !Number.isFinite(v)) return { error: "not a number" };
    if (typeof v === "number") return round(v, 10);
    return v;
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// --- Dışa aktarma ------------------------------------------------------------------------------------

/** Görünümdeki satırları CSV olarak verir (görünür sütunlar, gösterim değerleriyle). */
export function toCsv(db: Database, rows: Row[], view: View, titleLabel: string, ctx: ComputeContext = {}): string {
  const cols = [TITLE_PROP, ...db.properties.filter((p) => !view.hidden.includes(p.id)).map((p) => p.id)];
  const esc = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const head = cols.map((c) => esc(c === TITLE_PROP ? titleLabel : db.properties.find((p) => p.id === c)!.name));
  const lines = queryRows(db, rows, view, ctx).map((r) =>
    cols.map((c) => esc(displayText(db.properties.find((p) => p.id === c), cellValue(db, r, c, ctx)))).join(","),
  );
  return [head.join(","), ...lines].join("\n");
}

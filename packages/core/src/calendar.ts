// Takvim eşitleme: bir veritabanının tarih özelliğini bir Google ya da Apple (iCloud) takvimiyle iki yönlü eşitler.
// Bu modül sağlayıcıdan bağımsızdır: Nularche tarih değeri ↔ etkinlik zamanı dönüşümünün, eşleme durumunun
// (`.nularche/calendar.json`) ve eşitleme kurallarının tek sahibidir. Sağlayıcı bağdaştırıcıları
// calendar-providers.ts'tedir; kimlik bilgileri masaüstü uygulamasında şifreli saklanır, burada tutulmaz.
//
// Eşitlenen alanlar: başlık ve tarih (iki yönlü). Uzak etkinliğin açıklaması yalnızca etkinlikten yeni satır
// oluşturulurken satırın gövdesine yazılır. Yinelenen etkinlikler ve kilitli notlar eşitlenmez.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { dateMs, parseDateValue, type DateValue } from "./database.ts";
import { loadDatabase } from "./database-store.ts";
import { NodeError, type NodeMeta, type NodeStore } from "./node-store.ts";

export const CALENDAR_PROVIDERS = ["google", "apple"] as const;
export type CalendarProviderId = (typeof CALENDAR_PROVIDERS)[number];
export const isCalendarProvider = (v: unknown): v is CalendarProviderId => CALENDAR_PROVIDERS.includes(v as CalendarProviderId);

/** Etkinlik zamanı: tüm gün (bitiş hariç, iCalendar/Google kuralı) ya da başlangıç–bitiş anı (ms). */
export type EventTime = { allDay: true; start: string; end: string } | { allDay: false; start: number; end: number };

export interface CalendarEvent {
  /** Sağlayıcıdaki kimlik: Google etkinlik id'si ya da CalDAV kaynağının mutlak adresi. */
  id: string;
  etag?: string;
  title: string;
  when: EventTime;
  description?: string;
  /** Son değişiklik zamanı (ms), sağlayıcı bildiriyorsa. */
  updatedAt?: number;
  /** Etkinliği Nularche oluşturduysa satırın id'si (eşleme durumu kaybolursa yinelenmeyi önler). */
  rowId?: string;
  /** Yinelenen etkinlik ya da onun bir örneği: okunur, eşitlenmez. */
  recurring?: boolean;
  /** CalDAV: güncellemede diğer alanları korumak için kaynağın ham iCalendar metni. */
  raw?: string;
}

export interface EventInput {
  title: string;
  when: EventTime;
  rowId: string;
}

export interface CalendarInfo {
  id: string;
  name: string;
  color?: string;
}

export type CalendarErrorCode = "auth" | "conflict" | "not_found" | "network" | "invalid";

export class CalendarError extends Error {
  readonly code: CalendarErrorCode;
  readonly status?: number;
  constructor(code: CalendarErrorCode, message: string, status?: number) {
    super(message);
    this.name = "CalendarError";
    this.code = code;
    this.status = status;
  }
}

/** Sağlayıcı bağdaştırıcısının eşitleme motoruna sunduğu işlemler. */
export interface CalendarProvider {
  /** Hesabın görünen adı (e-posta / Apple Kimliği). */
  account(): Promise<string>;
  listCalendars(): Promise<CalendarInfo[]>;
  /** Aralıkla kesişen etkinlikler (ms). */
  listEvents(calendarId: string, range: { from: number; to: number }): Promise<CalendarEvent[]>;
  /** Etkinlik yoksa ya da silinmişse null. */
  getEvent(calendarId: string, eventId: string): Promise<CalendarEvent | null>;
  createEvent(calendarId: string, input: EventInput): Promise<CalendarEvent>;
  updateEvent(calendarId: string, current: CalendarEvent, input: EventInput): Promise<CalendarEvent>;
  deleteEvent(calendarId: string, current: CalendarEvent): Promise<void>;
}

// --- Zaman dönüşümü --------------------------------------------------------------------------------

const DAY = 86_400_000;
/** Bitişi olmayan saatli Nularche tarihi bir saatlik etkinlik olur (ve bir saatlik etkinlik bitişsiz geri gelir). */
export const DEFAULT_DURATION_MS = 3_600_000;

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** `YYYY-MM-DD` gününe gün ekler (yaz saatinden etkilenmez). */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + days * DAY);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Anı (ms) yerel saatle Nularche biçimine çevirir: `2026-10-17T14:30`. */
export function localDateTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Nularche tarih değeri → etkinlik zamanı. Başlangıcın biçimi (gün / gün+saat) etkinliğin tüm gün olup olmadığını belirler. */
export function toEventTime(v: DateValue): EventTime {
  if (v.start.length <= 10) {
    const start = v.start.slice(0, 10);
    const last = v.end && v.end.slice(0, 10) > start ? v.end.slice(0, 10) : start;
    return { allDay: true, start, end: addDays(last, 1) };
  }
  const start = dateMs(v.start);
  const end = v.end ? dateMs(v.end) : NaN;
  return { allDay: false, start, end: Number.isFinite(end) && end > start ? end : start + DEFAULT_DURATION_MS };
}

/** Etkinlik zamanı → Nularche tarih değeri (toEventTime'ın tersi; varsayılan süreler bitişsiz döner). */
export function fromEventTime(t: EventTime): DateValue {
  if (t.allDay) {
    const last = addDays(t.end, -1);
    return last > t.start ? { start: t.start, end: last } : { start: t.start };
  }
  const start = localDateTime(t.start);
  return t.end - t.start === DEFAULT_DURATION_MS || t.end <= t.start ? { start } : { start, end: localDateTime(t.end) };
}

/** Karşılaştırma anahtarı: iki taraf aynı başlık ve zamanı gösteriyorsa eşittir. */
export function syncKey(title: string, when: EventTime): string {
  return JSON.stringify([title.trim(), fromEventTime(when)]);
}

/** Satır değeri olarak saklanan biçim (database.ts inputToStored ile aynı: bitişsiz ise düz metin). */
const storedDate = (v: DateValue): string | DateValue => (v.end ? v : v.start);

// --- Eşleme durumu ---------------------------------------------------------------------------------

export const CALENDAR_STATE_FILE = path.join(".nularche", "calendar.json");

export interface SyncedItem {
  eventId: string;
  etag?: string;
  /** Son eşitlemede iki tarafın ortak anahtarı (syncKey). */
  key: string;
}

export interface CalendarLink {
  id: string;
  /** Veritabanı Node id'si. */
  dbId: string;
  provider: CalendarProviderId;
  calendarId: string;
  calendarName: string;
  /** Eşitlenen tarih özelliğinin id'si. */
  dateProp: string;
  lastSync?: number;
  lastError?: { code: CalendarErrorCode | "unknown"; message: string } | null;
  lastResult?: SyncCounts;
  /** Satır id'si → etkinlik. */
  items: Record<string, SyncedItem>;
}

export interface CalendarState {
  version: 1;
  links: CalendarLink[];
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

function parseItem(raw: unknown): SyncedItem | null {
  if (!isObj(raw) || !str(raw.eventId) || typeof raw.key !== "string") return null;
  return { eventId: raw.eventId as string, key: raw.key, ...(str(raw.etag) ? { etag: raw.etag as string } : {}) };
}

function parseLink(raw: unknown): CalendarLink | null {
  if (!isObj(raw)) return null;
  const { id, dbId, provider, calendarId, dateProp } = raw;
  if (!str(id) || !str(dbId) || !isCalendarProvider(provider) || !str(calendarId) || !str(dateProp)) return null;
  const items: Record<string, SyncedItem> = {};
  if (isObj(raw.items)) {
    for (const [rowId, v] of Object.entries(raw.items)) {
      const item = parseItem(v);
      if (item) items[rowId] = item;
    }
  }
  return {
    id: id as string,
    dbId: dbId as string,
    provider,
    calendarId: calendarId as string,
    calendarName: str(raw.calendarName) ?? (calendarId as string),
    dateProp: dateProp as string,
    lastSync: typeof raw.lastSync === "number" ? raw.lastSync : undefined,
    lastError: isObj(raw.lastError) && typeof raw.lastError.message === "string" ? (raw.lastError as CalendarLink["lastError"]) : null,
    lastResult: isObj(raw.lastResult) ? (raw.lastResult as unknown as SyncCounts) : undefined,
    items,
  };
}

export async function readCalendarState(root: string): Promise<CalendarState> {
  try {
    const raw = JSON.parse(await readFile(path.join(root, CALENDAR_STATE_FILE), "utf8"));
    const links = Array.isArray(raw?.links) ? raw.links.map(parseLink).filter((l: CalendarLink | null): l is CalendarLink => !!l) : [];
    return { version: 1, links };
  } catch {
    return { version: 1, links: [] };
  }
}

export async function writeCalendarState(root: string, state: CalendarState): Promise<void> {
  const file = path.join(root, CALENDAR_STATE_FILE);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2));
  await rename(tmp, file);
}

/** Bir veritabanını bir takvime bağlar (aynı veritabanı + takvim zaten bağlıysa tarih özelliğini günceller). */
export function addLink(state: CalendarState, input: Omit<CalendarLink, "id" | "items">): { state: CalendarState; link: CalendarLink } {
  const existing = state.links.find((l) => l.dbId === input.dbId && l.provider === input.provider && l.calendarId === input.calendarId);
  if (existing) {
    const link = { ...existing, ...input, items: existing.dateProp === input.dateProp ? existing.items : {} };
    return { state: { ...state, links: state.links.map((l) => (l.id === existing.id ? link : l)) }, link };
  }
  const link: CalendarLink = { ...input, id: randomUUID(), items: {} };
  return { state: { ...state, links: [...state.links, link] }, link };
}

export function removeLink(state: CalendarState, linkId: string): CalendarState {
  return { ...state, links: state.links.filter((l) => l.id !== linkId) };
}

// --- Eşitleme --------------------------------------------------------------------------------------

/** Uzak etkinliklerin listelendiği aralık: geçmiş bir yıl, gelecek iki yıl. Bunun dışındaki eşlenmiş etkinlikler tek tek denetlenir. */
export const SYNC_WINDOW = { pastDays: 365, futureDays: 730 };

export interface SyncCounts {
  createdLocal: number;
  createdRemote: number;
  updatedLocal: number;
  updatedRemote: number;
  trashedLocal: number;
  deletedRemote: number;
  /** Bu çalıştırmada atlanan (ör. eşzamanlı değişiklik) öğeler; bir sonraki eşitlemede yeniden denenir. */
  skipped: number;
}

export interface SyncReport {
  link: CalendarLink;
  counts: SyncCounts;
  /** Öğe düzeyindeki hatalar; eşitleme diğer öğelerle sürer. */
  errors: string[];
}

export interface SyncOptions {
  /** Başlıksız uzak etkinlikten oluşturulan satırın başlığı. */
  untitled: string;
  now?: number;
}

const emptyCounts = (): SyncCounts => ({
  createdLocal: 0,
  createdRemote: 0,
  updatedLocal: 0,
  updatedRemote: 0,
  trashedLocal: 0,
  deletedRemote: 0,
  skipped: 0,
});

interface LocalRow {
  node: NodeMeta;
  /** Satırın tarihi yoksa ya da satır kilitliyse null: takvimde yer almaz. */
  when: EventTime | null;
  key: string | null;
}

function localRow(node: NodeMeta, dateProp: string): LocalRow {
  const v = node.locked ? null : parseDateValue(node.props?.[dateProp]);
  const when = v ? toEventTime(v) : null;
  return { node, when, key: when ? syncKey(node.title, when) : null };
}

const overlaps = (t: EventTime, from: number, to: number) => {
  const s = t.allDay ? dateMs(t.start) : t.start;
  const e = t.allDay ? dateMs(t.end) : t.end;
  return e > from && s < to;
};

/**
 * Bir bağlantıyı eşitler ve güncellenmiş bağlantıyı döndürür (durumu çağıran kaydeder).
 * Kurallar (son eşitlemedeki ortak anahtara göre):
 *  - yalnızca bir taraf değiştiyse o taraf diğerine yazılır; ikisi de değiştiyse son değiştirilen kazanır;
 *  - satır silindi / tarihi kaldırıldı ve etkinlik değişmediyse etkinlik silinir;
 *  - etkinlik silindi ve satır değişmediyse satır çöpe taşınır (geri getirilebilir);
 *  - eşlenmemiş satırlar etkinlik, eşlenmemiş etkinlikler satır olur. Önce Nularche işaretine, sonra aynı
 *    başlık ve zamana göre eşleştirilir; böylece eşleme durumu kaybolsa da yinelenen kayıt oluşmaz.
 * Listeleme ve kimlik doğrulama hataları eşitlemeyi durdurur; öğe hataları toplanır ve diğer öğeler sürer.
 */
export async function syncLink(store: NodeStore, provider: CalendarProvider, link: CalendarLink, options: SyncOptions): Promise<SyncReport> {
  const counts = emptyCounts();
  const errors: string[] = [];
  const items: Record<string, SyncedItem> = { ...link.items };
  const now = options.now ?? Date.now();
  const from = now - SYNC_WINDOW.pastDays * DAY;
  const to = now + SYNC_WINDOW.futureDays * DAY;

  const loaded = await loadDatabase(store, link.dbId);
  const prop = loaded.db.properties.find((p) => p.id === link.dateProp);
  if (!prop || prop.type !== "date") throw new NodeError("invalid", `Tarih özelliği bulunamadı: ${link.dateProp}`);
  const rows = new Map(loaded.rows.map((n) => [n.id, localRow(n, link.dateProp)]));
  const listed = await provider.listEvents(link.calendarId, { from, to });
  const remote = new Map(listed.map((e) => [e.id, e]));

  const attempt = async (what: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      // Kimlik doğrulama hatası tüm bağlantıyı etkiler; diğerleri yalnızca bu öğeyi.
      if (e instanceof CalendarError && e.code === "auth") throw e;
      if ((e instanceof CalendarError && e.code === "conflict") || (e instanceof NodeError && e.code === "conflict")) counts.skipped++;
      else errors.push(`${what}: ${(e as Error).message}`);
    }
  };

  /** Tek etkinliği okur: silinmişse null, okunamadıysa (hata kaydedilir) undefined. */
  const fetchEvent = async (what: string, eventId: string): Promise<CalendarEvent | null | undefined> => {
    let out: CalendarEvent | null | undefined;
    await attempt(what, async () => {
      out = await provider.getEvent(link.calendarId, eventId);
    });
    return out;
  };

  const remoteKey = (e: CalendarEvent) => syncKey(e.title || options.untitled, e.when);
  const pushRemote = async (row: LocalRow, current: CalendarEvent) => {
    const ev = await provider.updateEvent(link.calendarId, current, { title: row.node.title, when: row.when!, rowId: row.node.id });
    items[row.node.id] = { eventId: ev.id, etag: ev.etag, key: row.key! };
    counts.updatedRemote++;
  };
  const pullLocal = async (row: LocalRow, ev: CalendarEvent) => {
    const props = { ...(row.node.props ?? {}), [link.dateProp]: storedDate(fromEventTime(ev.when)) };
    await store.update(row.node.id, { title: ev.title || options.untitled, baseRevision: row.node.revision, fields: { props } });
    items[row.node.id] = { eventId: ev.id, etag: ev.etag, key: remoteKey(ev) };
    counts.updatedLocal++;
  };
  const createRemote = async (row: LocalRow) => {
    const ev = await provider.createEvent(link.calendarId, { title: row.node.title, when: row.when!, rowId: row.node.id });
    items[row.node.id] = { eventId: ev.id, etag: ev.etag, key: row.key! };
    counts.createdRemote++;
  };
  const createLocal = async (ev: CalendarEvent) => {
    const node = await store.create({
      title: ev.title || options.untitled,
      parentNodeId: link.dbId,
      body: ev.description?.trim() ? `${ev.description.trim()}\n` : undefined,
      fields: { props: { [link.dateProp]: storedDate(fromEventTime(ev.when)) } },
    });
    items[node.id] = { eventId: ev.id, etag: ev.etag, key: remoteKey(ev) };
    counts.createdLocal++;
  };

  // 1) Eşlenmiş öğeler.
  const mappedEvents = new Set<string>();
  for (const [rowId, item] of Object.entries(link.items)) {
    mappedEvents.add(item.eventId);
    const row = rows.get(rowId) ?? null;
    let found: CalendarEvent | null | undefined = remote.get(item.eventId);
    if (!found) {
      // Listede yok: aralık dışında, taşınmış ya da silinmiş olabilir. Satır da aralık dışında ve değişmemişse dokunma.
      if (row?.key === item.key && row.when && !overlaps(row.when, from, to)) continue;
      found = await fetchEvent(row?.node.title ?? rowId, item.eventId);
      if (found === undefined) continue; // denetlenemedi; durum korunur
    }
    await attempt(row?.node.title ?? found?.title ?? rowId, async () => {
      const ev = found;
      if (!ev) {
        // Etkinlik silinmiş.
        delete items[rowId];
        if (!row?.key) return;
        if (row.key === item.key) {
          await store.trash(row.node.id);
          counts.trashedLocal++;
        } else await createRemote(row);
        return;
      }
      if (ev.recurring) return;
      const rk = remoteKey(ev);
      if (!row?.key) {
        // Satır silinmiş ya da takvimden çıkarılmış.
        if (rk === item.key) {
          await provider.deleteEvent(link.calendarId, ev);
          delete items[rowId];
          counts.deletedRemote++;
        } else if (row) await pullLocal(row, ev);
        else {
          delete items[rowId];
          await createLocal(ev);
        }
        return;
      }
      const localChanged = row.key !== item.key;
      const remoteChanged = rk !== item.key;
      if (row.key === rk) items[rowId] = { eventId: ev.id, etag: ev.etag, key: rk };
      else if (localChanged && !remoteChanged) await pushRemote(row, ev);
      else if (remoteChanged && !localChanged) await pullLocal(row, ev);
      else if (row.node.updatedAt >= (ev.updatedAt ?? 0)) await pushRemote(row, ev);
      else await pullLocal(row, ev);
    });
  }

  // 2) Eşlenmemiş satırlar ve etkinlikler: önce eşleştir, kalanları karşı tarafta oluştur.
  const freeRows = [...rows.values()].filter((r) => r.key && !items[r.node.id] && !link.items[r.node.id]);
  const freeEvents = listed.filter((e) => !e.recurring && !mappedEvents.has(e.id) && !Object.values(items).some((i) => i.eventId === e.id));
  const taken = new Set<string>();
  for (const row of freeRows) {
    const match =
      freeEvents.find((e) => !taken.has(e.id) && e.rowId === row.node.id) ?? freeEvents.find((e) => !taken.has(e.id) && remoteKey(e) === row.key);
    if (match) {
      taken.add(match.id);
      if (remoteKey(match) === row.key) items[row.node.id] = { eventId: match.id, etag: match.etag, key: row.key! };
      // Nularche işaretli ama farklı: satır daha yeniyse etkinliğe, değilse satıra yaz.
      else await attempt(row.node.title, () => (row.node.updatedAt >= (match.updatedAt ?? 0) ? pushRemote(row, match) : pullLocal(row, match)));
      continue;
    }
    await attempt(row.node.title, () => createRemote(row));
  }
  for (const ev of freeEvents) {
    if (taken.has(ev.id)) continue;
    await attempt(ev.title, () => createLocal(ev));
  }

  return { link: { ...link, items, lastSync: now, lastError: null, lastResult: counts }, counts, errors };
}

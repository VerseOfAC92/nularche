// Takvim ekranının veri modeli: hangi kaynaktan (bağlı Google/Apple takvimi ya da tarih özelliği olan bir Nularche
// veritabanı) hangi etkinliklerin geldiği. Etkinlikler veritabanı satırlarıdır; eşitlemenin sahibi masaüstü
// sürecidir (desktop/src/calendar.ts), bu modül yalnızca okur ve takvim görünümleri için düzenler.

import { dateMs, parseDatabase, parseDateValue } from "../../../core/src/database.ts";

export interface CalNode {
  id: string;
  title: string;
  icon?: string;
  parentNodeId: string | null;
  template?: boolean;
  database?: Record<string, unknown>;
  props?: Record<string, unknown>;
}

export interface CalLink {
  id: string;
  dbId: string;
  provider: "google" | "apple";
  calendarName: string;
  dateProp: string;
}

export interface CalSource {
  key: string;
  name: string;
  kind: "google" | "apple" | "local";
  dbId: string;
  dateProp: string;
  color: string;
}

export interface CalEvent {
  id: string;
  title: string;
  icon?: string;
  allDay: boolean;
  /** Başlangıç ve bitiş (ms, yerel saat; tüm gün etkinliklerde bitiş günün sonudur). */
  start: number;
  end: number;
  /** Tarih değerinin kaynak dizesi (gösterim için). */
  startText: string;
  source: CalSource;
}

export const SOURCE_COLORS = ["#2f81f7", "#3fb950", "#a371f7", "#d29922", "#f47067", "#00a8b5", "#db61a2", "#8b949e"];
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Kaynaklar: önce bağlı takvimler, sonra tarih özelliği olan diğer veritabanları. Her veritabanı bir kez görünür. */
export function calendarSources(nodes: CalNode[], links: CalLink[]): CalSource[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: CalSource[] = [];
  const seen = new Set<string>();
  for (const l of links) {
    if (seen.has(l.dbId) || !byId.get(l.dbId)?.database) continue;
    seen.add(l.dbId);
    out.push({ key: `link:${l.id}`, name: l.calendarName, kind: l.provider, dbId: l.dbId, dateProp: l.dateProp, color: "" });
  }
  for (const n of nodes) {
    if (!n.database || seen.has(n.id) || n.template) continue;
    const date = parseDatabase(n.database).properties.find((p) => p.type === "date");
    if (!date) continue;
    seen.add(n.id);
    out.push({ key: `db:${n.id}`, name: n.title, kind: "local", dbId: n.id, dateProp: date.id, color: "" });
  }
  return out.map((s, i) => ({ ...s, color: SOURCE_COLORS[i % SOURCE_COLORS.length] }));
}

/** Görünen kaynakların tarihli satırları; başlangıca göre sıralı. */
export function calendarEvents(nodes: CalNode[], sources: CalSource[]): CalEvent[] {
  const bySource = new Map(sources.map((s) => [s.dbId, s]));
  const out: CalEvent[] = [];
  for (const n of nodes) {
    if (n.template || !n.parentNodeId) continue;
    const source = bySource.get(n.parentNodeId);
    if (!source) continue;
    const v = parseDateValue(n.props?.[source.dateProp]);
    if (!v) continue;
    const allDay = v.start.length <= 10;
    const start = dateMs(v.start);
    if (Number.isNaN(start)) continue;
    let end = v.end ? dateMs(v.end) : NaN;
    if (allDay) end = (Number.isNaN(end) ? start : end) + DAY - 1;
    else if (Number.isNaN(end) || end <= start) end = start + HOUR;
    out.push({ id: n.id, title: n.title, icon: n.icon, allDay, start, end, startText: v.start, source });
  }
  return out.sort((a, b) => a.start - b.start || Number(b.allDay) - Number(a.allDay) || a.title.localeCompare(b.title));
}

/** Günün başı (yerel saat). */
export const dayStart = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Pazartesi ile başlayan haftanın ilk günü. */
export function weekStart(ms: number): number {
  const d = new Date(dayStart(ms));
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

export function addDays(ms: number, n: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

/** O günle kesişen etkinlikler. */
export const eventsOn = (events: CalEvent[], day: number) => events.filter((e) => e.start < addDays(day, 1) && e.end >= day);

/** Aynı gündeki saatli etkinlikleri çakışmayan sütunlara yerleştirir (hafta görünümü). */
export function layoutDay(events: CalEvent[]): { event: CalEvent; lane: number; lanes: number }[] {
  const timed = events.filter((e) => !e.allDay).sort((a, b) => a.start - b.start || b.end - a.end);
  const out: { event: CalEvent; lane: number; lanes: number }[] = [];
  let cluster: { event: CalEvent; lane: number; lanes: number }[] = [];
  let clusterEnd = -Infinity;
  const lanesEnd: number[] = [];
  const close = () => {
    const n = Math.max(1, ...cluster.map((c) => c.lane + 1));
    for (const c of cluster) c.lanes = n;
    out.push(...cluster);
    cluster = [];
    lanesEnd.length = 0;
  };
  for (const e of timed) {
    if (e.start >= clusterEnd && cluster.length) {
      close();
      clusterEnd = -Infinity;
    }
    let lane = lanesEnd.findIndex((end) => end <= e.start);
    if (lane < 0) lane = lanesEnd.length;
    lanesEnd[lane] = e.end;
    cluster.push({ event: e, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, e.end);
  }
  if (cluster.length) close();
  return out;
}

/** Yeni etkinliğin tarih değeri (veritabanı tarih özelliği biçiminde). */
export function eventValue(input: { date: string; allDay: boolean; start?: string; end?: string }): { start: string; end?: string } {
  if (input.allDay || !input.start) return { start: input.date };
  return { start: `${input.date}T${input.start}`, ...(input.end && input.end > input.start ? { end: `${input.date}T${input.end}` } : {}) };
}

/** Yerel tarih → "YYYY-MM-DD". */
export function isoDay(ms: number): string {
  const d = new Date(ms);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

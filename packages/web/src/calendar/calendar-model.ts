// Takvim ekranının veri modeli: hangi kaynaktan hangi etkinliklerin geldiği. İki tür kaynak vardır:
//  - takvimler (not dışı): yerel Nularche takvimi ve Ayarlar'da açılan Google/Apple takvimleri; etkinlikleri masaüstü
//    sürecinin önbelleğindedir (desktop/src/calendar.ts) ve ekrandan düzenlenir;
//  - tarih özelliği olan Nularche veritabanları: etkinlikler satırlardır (isteğe bağlı olarak bir takvimle eşitlenir).
// Bu modül yalnızca okur ve takvim görünümleri için düzenler.

import { dateMs, parseDatabase, parseDateValue } from "../../../core/src/database.ts";
import type { CachedEvent } from "../desktop.ts";

export interface CalNode {
  id: string;
  title: string;
  icon?: string;
  parentNodeId: string | null;
  template?: boolean;
  database?: Record<string, unknown>;
  props?: Record<string, unknown>;
}

/** Veritabanı ↔ takvim bağlantısı (görüntüleme bağlantılarında dbId yoktur; onlar `ViewCal` olarak gelir). */
export interface CalLink {
  id: string;
  dbId?: string;
  provider: "google" | "apple";
  calendarName: string;
  dateProp?: string;
}

export type { EventTime } from "../desktop.ts";
import type { EventTime } from "../desktop.ts";
/** Not dışı takvimin etkinliği ve ayrıntıları (masaüstü önbelleğindeki biçim). */
export type ViewEvent = CachedEvent;
/** Not dışı takvim: yerel Nularche takvimi (`id: "local"`) ya da görüntülenen hesap takvimi. */
export interface ViewCal {
  id: string;
  provider: "google" | "apple" | "local";
  name: string;
  events: ViewEvent[];
}

export type CalSource =
  | { key: string; name: string; kind: "google" | "apple" | "local"; type: "view"; viewId: string; color: string }
  | { key: string; name: string; kind: "google" | "apple" | "local"; type: "db"; dbId: string; dateProp: string; color: string };

export interface CalEvent {
  id: string;
  title: string;
  icon?: string;
  allDay: boolean;
  /** Başlangıç ve bitiş (ms, yerel saat; tüm gün etkinliklerde bitiş günün sonudur). */
  start: number;
  end: number;
  source: CalSource;
  /** Not dışı takvimin etkinliği (ekranda düzenlenir); yoksa etkinlik bir veritabanı satırıdır (`id` Node id'si). */
  view?: ViewEvent;
}

export const SOURCE_COLORS = ["#2f81f7", "#3fb950", "#a371f7", "#d29922", "#f47067", "#00a8b5", "#db61a2", "#8b949e"];
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Kaynaklar: önce not dışı takvimler (yerel Nularche takvimi ilk), sonra tarih özelliği olan veritabanları (bir
 *  takvimle eşitlenen veritabanı o takvimin adıyla). Her veritabanı bir kez görünür. */
export function calendarSources(nodes: CalNode[], links: CalLink[], views: ViewCal[] = []): CalSource[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: CalSource[] = [];
  for (const v of views) out.push({ key: `view:${v.id}`, name: v.name, kind: v.provider, type: "view", viewId: v.id, color: "" });
  const seen = new Set<string>();
  for (const l of links) {
    if (!l.dbId || !l.dateProp || seen.has(l.dbId) || !byId.get(l.dbId)?.database) continue;
    seen.add(l.dbId);
    out.push({ key: `link:${l.id}`, name: l.calendarName, kind: l.provider, type: "db", dbId: l.dbId, dateProp: l.dateProp, color: "" });
  }
  for (const n of nodes) {
    if (!n.database || seen.has(n.id) || n.template) continue;
    const date = parseDatabase(n.database).properties.find((p) => p.type === "date");
    if (!date) continue;
    seen.add(n.id);
    out.push({ key: `db:${n.id}`, name: n.title, kind: "local", type: "db", dbId: n.id, dateProp: date.id, color: "" });
  }
  return out.map((s, i) => ({ ...s, color: SOURCE_COLORS[i % SOURCE_COLORS.length] }));
}

/** Görünen kaynakların etkinlikleri (veritabanı satırları ve not dışı takvimler); başlangıca göre sıralı. */
export function calendarEvents(nodes: CalNode[], sources: CalSource[], views: ViewCal[] = []): CalEvent[] {
  const bySource = new Map<string, CalSource>();
  for (const s of sources) if (s.type === "db") bySource.set(s.dbId, s);
  const out: CalEvent[] = [];
  for (const n of nodes) {
    if (n.template || !n.parentNodeId) continue;
    const source = bySource.get(n.parentNodeId);
    if (!source || source.type !== "db") continue;
    const v = parseDateValue(n.props?.[source.dateProp]);
    if (!v) continue;
    const allDay = v.start.length <= 10;
    const start = dateMs(v.start);
    if (Number.isNaN(start)) continue;
    let end = v.end ? dateMs(v.end) : NaN;
    if (allDay) end = (Number.isNaN(end) ? start : end) + DAY - 1;
    else if (Number.isNaN(end) || end <= start) end = start + HOUR;
    out.push({ id: n.id, title: n.title, icon: n.icon, allDay, start, end, source });
  }
  for (const s of sources) {
    if (s.type !== "view") continue;
    for (const ev of views.find((v) => v.id === s.viewId)?.events ?? []) {
      const w = ev.when;
      const start = w.allDay ? dateMs(w.start) : w.start;
      // Tüm gün bitişi hariç tutulan gündür (iCalendar/Google kuralı): görünümde bir önceki günün sonu.
      const end = w.allDay ? Math.max(start + DAY - 1, dateMs(w.end) - 1) : Math.max(w.end, w.start + 1);
      if (Number.isNaN(start) || Number.isNaN(end)) continue;
      out.push({ id: `${s.viewId}:${ev.id}`, title: ev.title, allDay: w.allDay, start, end, source: s, view: ev });
    }
  }
  return out.sort((a, b) => a.start - b.start || Number(b.allDay) - Number(a.allDay) || a.title.localeCompare(b.title));
}

/** Formdaki değerden takvim etkinliği zamanı: tüm günde bitiş ertesi gündür; saatli etkinlikte geçersiz bitiş bir saat. */
export function eventTime(input: { date: string; allDay: boolean; start?: string; end?: string }): EventTime {
  if (input.allDay || !input.start) return { allDay: true, start: input.date, end: isoDay(addDays(dateMs(input.date), 1)) };
  const start = new Date(`${input.date}T${input.start}`).getTime();
  const endMs = input.end ? new Date(`${input.date}T${input.end}`).getTime() : NaN;
  return { allDay: false, start, end: endMs > start ? endMs : start + HOUR };
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


/** Açıklamayı düz metne çevirir: Google açıklamaları HTML olabilir (<br>, <a>, <p>); iCloud açıklamaları düz metindir. */
export function plainDescription(text: string): string {
  if (!/<[a-z][\s\S]*>/i.test(text)) return text;
  const html = text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => (label.replace(/<[^>]+>/g, "").trim() === href ? href : `${label} <${href}>`));
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

/** Metni düz parçalara ve bağlantılara ayırır (gösterimde bağlantılar tıklanabilir olur). */
export function linkify(text: string): { text: string; href?: string }[] {
  const out: { text: string; href?: string }[] = [];
  const re = /(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]]|mailto:[^\s<>"]+|tel:[+\d][\d,#*+-]*)/gi;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[0].replace(/^(mailto|tel):/i, ""), href: m[0] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

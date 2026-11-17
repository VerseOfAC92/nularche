// Takvim ekranı modeli: kaynaklar (bağlı takvim / tarihli veritabanı), etkinlikler, hafta yerleşimi, yeni etkinlik değeri.
import { describe, expect, test } from "vitest";
import { addDays, calendarEvents, calendarSources, dayStart, eventTime, eventValue, eventsOn, layoutDay, weekStart, type CalNode } from "../src/calendar/calendar-model.ts";

const db = (id: string, title: string, date = true): CalNode => ({
  id,
  title,
  parentNodeId: null,
  database: { properties: date ? [{ id: "when", name: "When", type: "date" }] : [{ id: "s", name: "S", type: "text" }], views: [] },
});
const row = (id: string, parent: string, when: unknown, extra: Partial<CalNode> = {}): CalNode => ({ id, title: id, parentNodeId: parent, props: { when }, ...extra });

describe("calendarSources", () => {
  test("bağlı takvimler önce, tarih özelliği olan diğer veritabanları sonra; tarihsiz veritabanı ve silinmiş bağlantı yok", () => {
    const nodes = [db("a", "Work"), db("b", "Tasks"), db("c", "Notes", false)];
    const s = calendarSources(nodes, [
      { id: "l1", dbId: "a", provider: "google", calendarName: "Google Work", dateProp: "when" },
      { id: "l2", dbId: "gone", provider: "apple", calendarName: "Old", dateProp: "when" },
    ]);
    expect(s.map((x) => [x.key, x.name, x.kind])).toEqual([
      ["link:l1", "Google Work", "google"],
      ["db:b", "Tasks", "local"],
    ]);
    expect(new Set(s.map((x) => x.color)).size).toBe(2);
  });
});

describe("calendarEvents", () => {
  const nodes = [db("a", "Work"), row("allday", "a", "2026-11-20"), row("timed", "a", { start: "2026-11-20T09:30" }), row("range", "a", { start: "2026-11-20T14:00", end: "2026-11-20T16:00" }), row("tpl", "a", "2026-11-20", { template: true }), row("nodate", "a", undefined)];
  const ev = calendarEvents(nodes, calendarSources(nodes, []));
  test("şablonlar ve tarihsiz satırlar atlanır; saatsiz değer tüm gün, bitişsiz saatli değer bir saattir", () => {
    expect(ev.map((e) => e.id)).toEqual(["allday", "timed", "range"]);
    const timed = ev.find((e) => e.id === "timed")!;
    expect(timed.end - timed.start).toBe(3_600_000);
    expect(ev.find((e) => e.id === "allday")!.allDay).toBe(true);
  });
  test("eventsOn gün sınırlarını doğru keser", () => {
    const day = new Date(2026, 10, 20).getTime();
    expect(eventsOn(ev, day).length).toBe(3);
    expect(eventsOn(ev, addDays(day, 1)).length).toBe(0);
  });
  test("çakışan saatli etkinlikler yan yana sütunlara yerleşir", () => {
    const more = [...nodes, row("overlap", "a", { start: "2026-11-20T15:00", end: "2026-11-20T15:30" })];
    const lay = layoutDay(calendarEvents(more, calendarSources(more, [])));
    const r = lay.find((x) => x.event.id === "range")!;
    const o = lay.find((x) => x.event.id === "overlap")!;
    expect(r.lanes).toBe(2);
    expect(o.lanes).toBe(2);
    expect(r.lane).not.toBe(o.lane);
    expect(lay.find((x) => x.event.id === "timed")!.lanes).toBe(1);
  });
});

describe("tarih yardımcıları", () => {
  test("hafta pazartesi başlar", () => {
    expect(new Date(weekStart(new Date(2026, 10, 22, 15).getTime())).getDay()).toBe(1);
    expect(dayStart(new Date(2026, 10, 22, 15).getTime())).toBe(new Date(2026, 10, 22).getTime());
  });
  test("yeni etkinlik değeri: tüm gün, saatli ve geçersiz bitiş", () => {
    expect(eventValue({ date: "2026-11-20", allDay: true, start: "09:00" })).toEqual({ start: "2026-11-20" });
    expect(eventValue({ date: "2026-11-20", allDay: false, start: "09:00", end: "10:30" })).toEqual({ start: "2026-11-20T09:00", end: "2026-11-20T10:30" });
    expect(eventValue({ date: "2026-11-20", allDay: false, start: "09:00", end: "08:00" })).toEqual({ start: "2026-11-20T09:00" });
  });
});

describe("not dışı takvimler", () => {
  const views = [
    { id: "local", provider: "local" as const, name: "Nularche", events: [{ id: "e1", title: "Yerel", when: { allDay: true as const, start: "2026-11-20", end: "2026-11-21" } }] },
    { id: "g1", provider: "google" as const, name: "Work", events: [{ id: "e2", title: "Toplantı", when: { allDay: false as const, start: new Date(2026, 10, 20, 9).getTime(), end: new Date(2026, 10, 20, 10).getTime() } }] },
  ];
  test("takvimler veritabanı gerektirmeden kaynak olur ve etkinlikleri gösterilir", () => {
    const sources = calendarSources([], [], views);
    expect(sources.map((s) => [s.key, s.type, s.kind])).toEqual([
      ["view:local", "view", "local"],
      ["view:g1", "view", "google"],
    ]);
    const ev = calendarEvents([], sources, views);
    expect(ev.map((e) => e.title)).toEqual(["Yerel", "Toplantı"]);
    const day = new Date(2026, 10, 20).getTime();
    expect(eventsOn(ev, day).length).toBe(2);
    expect(eventsOn(ev, addDays(day, 1)).length).toBe(0);
    expect(ev[1].view?.id).toBe("e2");
  });
  test("görüntüleme bağlantısı (dbId yok) veritabanı kaynağı oluşturmaz", () => {
    expect(calendarSources([db("a", "Work")], [{ id: "v", provider: "google", calendarName: "G" }]).map((s) => s.key)).toEqual(["db:a"]);
  });
  test("eventTime: tüm günde bitiş ertesi gün; geçersiz bitiş bir saat", () => {
    expect(eventTime({ date: "2026-11-30", allDay: true })).toEqual({ allDay: true, start: "2026-11-30", end: "2026-12-01" });
    const w = eventTime({ date: "2026-11-20", allDay: false, start: "09:00", end: "08:00" });
    expect(w.allDay === false && w.end - w.start).toBe(3_600_000);
  });
});

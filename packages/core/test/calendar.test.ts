import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  addLink,
  addProperty,
  buildIcs,
  CalDavCalendar,
  CalendarError,
  createDatabase,
  defaultDatabase,
  fromEventTime,
  GoogleCalendar,
  localDateTime,
  NodeStore,
  parseIcsEvent,
  parseMultistatus,
  patchIcs,
  readCalendarState,
  syncLink,
  toEventTime,
  writeCalendarState,
  zonedTimeToMs,
  type CalendarEvent,
  type CalendarLink,
  type CalendarProvider,
  type EventInput,
} from "../src/index.ts";

const names = { tags: "Etiketler", status: "Durum", todo: "Yapılacak", doing: "Sürüyor", done: "Bitti", table: "Tablo", board: "Pano" };
const opts = { untitled: "Adsız etkinlik" };

async function setup() {
  const store = new NodeStore(await mkdtemp(path.join(tmpdir(), "nularche-cal-")));
  await store.ensureRoot();
  const { db, property } = addProperty(defaultDatabase(names), { name: "Tarih", type: "date" });
  const dbNode = await createDatabase(store, { title: "Etkinlikler", db });
  const link: CalendarLink = { id: "l1", dbId: dbNode.id, provider: "apple", calendarId: "cal", calendarName: "Ev", dateProp: property.id, items: {} };
  const row = async (title: string, date: unknown, fields: Record<string, unknown> = {}) =>
    store.create({ title, parentNodeId: dbNode.id, fields: { props: { [property.id]: date }, ...fields } });
  const rows = async () => (await store.list()).filter((n) => n.parentNodeId === dbNode.id);
  return { store, link, row, rows, dateProp: property.id };
}

/** Bellekte takvim: etag her yazımda değişir, isteğe bağlı olarak işlemleri sayar. */
class MemoryCalendar implements CalendarProvider {
  events = new Map<string, CalendarEvent>();
  calls: string[] = [];
  private n = 0;
  async account() {
    return "test@example.com";
  }
  async listCalendars() {
    return [{ id: "cal", name: "Ev" }];
  }
  async listEvents(_c: string, range: { from: number; to: number }) {
    this.calls.push("list");
    return [...this.events.values()].filter((e) => {
      const s = e.when.allDay ? new Date(`${e.when.start}T00:00`).getTime() : e.when.start;
      return s < range.to && s >= range.from - 86_400_000;
    });
  }
  async getEvent(_c: string, id: string) {
    this.calls.push(`get ${id}`);
    return this.events.get(id) ?? null;
  }
  put(e: Omit<CalendarEvent, "etag" | "id"> & { id?: string }): CalendarEvent {
    const ev = { ...e, id: e.id ?? `e${++this.n}`, etag: `"${++this.n}"`, updatedAt: e.updatedAt ?? Date.now() };
    this.events.set(ev.id, ev);
    return ev;
  }
  async createEvent(_c: string, input: EventInput) {
    this.calls.push("create");
    return this.put({ title: input.title, when: input.when, rowId: input.rowId });
  }
  async updateEvent(_c: string, cur: CalendarEvent, input: EventInput) {
    this.calls.push(`update ${cur.id}`);
    if (this.events.get(cur.id)?.etag !== cur.etag) throw new CalendarError("conflict", "etag");
    return this.put({ ...cur, title: input.title, when: input.when, rowId: input.rowId, updatedAt: undefined });
  }
  async deleteEvent(_c: string, cur: CalendarEvent) {
    this.calls.push(`delete ${cur.id}`);
    this.events.delete(cur.id);
  }
}

test("tarih değerleri etkinlik zamanına ve geri çevrilir; varsayılan süreler bitişsiz döner", () => {
  assert.deepEqual(toEventTime({ start: "2026-10-17" }), { allDay: true, start: "2026-10-17", end: "2026-10-18" });
  assert.deepEqual(toEventTime({ start: "2026-10-30", end: "2026-11-02" }), { allDay: true, start: "2026-10-30", end: "2026-11-03" });
  // Yaz saati değişimi (Ekim sonu) gün sayısını bozmaz.
  assert.deepEqual(fromEventTime({ allDay: true, start: "2026-10-24", end: "2026-10-26" }), { start: "2026-10-24", end: "2026-10-25" });
  const timed = toEventTime({ start: "2026-10-17T14:30" });
  assert.equal(timed.allDay, false);
  assert.equal(!timed.allDay && timed.end - timed.start, 3_600_000);
  assert.deepEqual(fromEventTime(timed), { start: "2026-10-17T14:30" });
  const ranged = toEventTime({ start: "2026-10-17T09:00", end: "2026-10-17T11:15" });
  assert.deepEqual(fromEventTime(ranged), { start: "2026-10-17T09:00", end: "2026-10-17T11:15" });
  // Bitiş başlangıçtan önceyse bir saatlik etkinlik olur.
  assert.deepEqual(fromEventTime(toEventTime({ start: "2026-10-17T09:00", end: "2026-10-17T08:00" })), { start: "2026-10-17T09:00" });
});

test("iCalendar: katlanmış satırlar, kaçışlar, saat dilimi, süre ve yinelenme okunur", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "BEGIN:VTIMEZONE",
    "TZID:Europe/Istanbul",
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "END:STANDARD",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    "UID:1",
    "SUMMARY:Toplantı\\, ekip\\; plan ",
    " uzun başlık",
    "DESCRIPTION:Satır 1\\nSatır 2",
    "DTSTART;TZID=Europe/Istanbul:20261017T143000",
    "DURATION:PT1H30M",
    "LAST-MODIFIED:20261001T120000Z",
    "X-NULARCHE-ROW:row-1",
    "BEGIN:VALARM",
    "TRIGGER:-PT15M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const ev = parseIcsEvent(ics, "https://x/1.ics", '"e1"')!;
  assert.equal(ev.title, "Toplantı, ekip; plan uzun başlık");
  assert.equal(ev.description, "Satır 1\nSatır 2");
  // İstanbul UTC+3: 14:30 → 11:30Z
  assert.deepEqual(ev.when, { allDay: false, start: Date.UTC(2026, 9, 17, 11, 30), end: Date.UTC(2026, 9, 17, 13, 0) });
  assert.equal(ev.updatedAt, Date.UTC(2026, 9, 1, 12));
  assert.equal(ev.rowId, "row-1");
  assert.equal(ev.recurring, false);

  const allDay = parseIcsEvent("BEGIN:VEVENT\nDTSTART;VALUE=DATE:20261017\nSUMMARY:Gün\nEND:VEVENT", "x")!;
  assert.deepEqual(allDay.when, { allDay: true, start: "2026-10-17", end: "2026-10-18" });
  assert.equal(parseIcsEvent("BEGIN:VEVENT\nDTSTART:20261017T100000Z\nRRULE:FREQ=WEEKLY\nEND:VEVENT", "x")!.recurring, true);
  assert.equal(parseIcsEvent("BEGIN:VCALENDAR\nEND:VCALENDAR", "x"), null);
  // Yaz saati: New York'ta Temmuz UTC-4, Ocak UTC-5.
  assert.equal(zonedTimeToMs(2026, 7, 1, 9, 0, 0, "America/New_York"), Date.UTC(2026, 6, 1, 13));
  assert.equal(zonedTimeToMs(2026, 1, 1, 9, 0, 0, "America/New_York"), Date.UTC(2026, 0, 1, 14));
  // Bilinmeyen dilim yerel saat kabul edilir.
  assert.equal(zonedTimeToMs(2026, 1, 1, 9, 0, 0, "Bilinmeyen/Dilim"), new Date(2026, 0, 1, 9).getTime());
});

test("iCalendar: yeni etkinlik gidiş-dönüş korunur; güncelleme yalnızca başlık ve zamanı değiştirir", () => {
  const input: EventInput = { title: "Uzun, çok uzun bir başlık; ".repeat(5).trim(), when: { allDay: true, start: "2026-12-31", end: "2027-01-01" }, rowId: "r1" };
  const ics = buildIcs("u1", input, Date.UTC(2026, 9, 1));
  assert.ok(ics.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75));
  const back = parseIcsEvent(ics, "x")!;
  assert.equal(back.title, input.title);
  assert.deepEqual(back.when, input.when);
  assert.equal(back.rowId, "r1");

  const raw = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:u1\r\nSUMMARY:Eski\r\nDESCRIPTION:Notlar\r\nDTSTART:20261017T100000Z\r\nDURATION:PT2H\r\nSEQUENCE:4\r\nATTENDEE:mailto:a@b.c\r\nBEGIN:VALARM\r\nTRIGGER:-PT5M\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
  const patched = patchIcs(raw, { title: "Yeni", when: { allDay: false, start: Date.UTC(2026, 9, 18, 8), end: Date.UTC(2026, 9, 18, 9) }, rowId: "r1" });
  const ev = parseIcsEvent(patched, "x")!;
  assert.equal(ev.title, "Yeni");
  assert.equal(ev.description, "Notlar");
  assert.deepEqual(ev.when, { allDay: false, start: Date.UTC(2026, 9, 18, 8), end: Date.UTC(2026, 9, 18, 9) });
  assert.match(patched, /SEQUENCE:5/);
  assert.match(patched, /ATTENDEE:mailto:a@b.c/);
  assert.match(patched, /TRIGGER:-PT5M/);
  assert.doesNotMatch(patched, /DURATION|Eski/);
});

test("WebDAV çok durumlu yanıt: önekler, varlıklar ve 404 propstat", () => {
  const xml = `<?xml version="1.0"?>
<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <response><href>/cal/1.ics</href>
    <propstat><prop><getetag>"a&amp;b"</getetag><C:calendar-data><![CDATA[BEGIN:VCALENDAR]]></C:calendar-data></prop><status>HTTP/1.1 200 OK</status></propstat>
    <propstat><prop><displayname/></prop><status>HTTP/1.1 404 Not Found</status></propstat>
  </response>
  <D:response xmlns:D="DAV:"><D:href>/cal/2.ics</D:href><D:propstat><D:prop><D:getetag>"x"</D:getetag><C:calendar-data>A &lt; B&#13;</C:calendar-data></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>
</multistatus>`;
  const res = parseMultistatus(xml);
  assert.equal(res.length, 2);
  assert.equal(res[0].href, "/cal/1.ics");
  assert.deepEqual(
    res[0].props.map((p) => [p.name, p.text]),
    [
      ["getetag", '"a&b"'],
      ["calendar-data", "BEGIN:VCALENDAR"],
    ],
  );
  assert.equal(res[1].props.find((p) => p.name === "calendar-data")?.text, "A < B\r");
});

test("eşitleme: ilk çalıştırmada iki yön de aktarılır, ikinci çalıştırma hiçbir şey değiştirmez", async () => {
  const { store, link, row, rows, dateProp } = await setup();
  const cal = new MemoryCalendar();
  await row("Diş hekimi", "2026-11-03T10:00");
  await row("Tatil", { start: "2026-12-24", end: "2026-12-26" });
  await row("Tarihsiz not", null);
  cal.put({ title: "Doğum günü", when: { allDay: true, start: "2026-11-20", end: "2026-11-21" }, description: "Pasta al" });
  cal.put({ title: "", when: { allDay: false, start: new Date(2026, 10, 5, 9).getTime(), end: new Date(2026, 10, 5, 9, 45).getTime() } });

  const now = new Date(2026, 9, 1).getTime();
  const r1 = await syncLink(store, cal, link, { ...opts, now });
  assert.deepEqual(r1.errors, []);
  assert.equal(r1.counts.createdRemote, 2);
  assert.equal(r1.counts.createdLocal, 2);
  const titles = [...cal.events.values()].map((e) => e.title).sort();
  assert.deepEqual(titles, ["", "Diş hekimi", "Doğum günü", "Tatil"]);
  const tatil = [...cal.events.values()].find((e) => e.title === "Tatil")!;
  assert.deepEqual(tatil.when, { allDay: true, start: "2026-12-24", end: "2026-12-27" });

  const all = await rows();
  const bday = all.find((n) => n.title === "Doğum günü")!;
  assert.equal(bday.props?.[dateProp], "2026-11-20");
  assert.equal((await store.read(bday.id)).body.trim(), "Pasta al");
  const untitled = all.find((n) => n.title === "Adsız etkinlik")!;
  assert.deepEqual(untitled.props?.[dateProp], { start: "2026-11-05T09:00", end: "2026-11-05T09:45" });
  assert.equal(Object.keys(r1.link.items).length, 4);

  cal.calls = [];
  const r2 = await syncLink(store, cal, r1.link, { ...opts, now });
  assert.deepEqual(r2.counts, { createdLocal: 0, createdRemote: 0, updatedLocal: 0, updatedRemote: 0, trashedLocal: 0, deletedRemote: 0, skipped: 0 });
  assert.deepEqual(cal.calls, ["list"]);
  assert.equal((await rows()).length, 5);
});

test("eşitleme: değişiklikler taşınır, çakışmada son değişen kazanır, silmeler karşı tarafa yansır", async () => {
  const { store, link, row, rows, dateProp } = await setup();
  const cal = new MemoryCalendar();
  const a = await row("A", "2026-11-01");
  const b = await row("B", "2026-11-02");
  const c = await row("C", "2026-11-03");
  const d = await row("D", "2026-11-04");
  const e = await row("E", "2026-11-05");
  const now = new Date(2026, 9, 1).getTime();
  let { link: l } = await syncLink(store, cal, link, { ...opts, now });
  const ev = (rowId: string) => cal.events.get(l.items[rowId].eventId)!;

  // A yerelde, B uzakta değişir; C iki tarafta da (uzak daha yeni); D uzakta silinir; E yerelde silinir.
  await store.update(a.id, { title: "A2", fields: { props: { [dateProp]: "2026-11-10T08:00" } } });
  cal.put({ ...ev(b.id), title: "B2" });
  await store.update(c.id, { title: "C-yerel" });
  cal.put({ ...ev(c.id), title: "C-uzak", updatedAt: Date.now() + 60_000 });
  cal.events.delete(l.items[d.id].eventId);
  const eEvent = l.items[e.id].eventId;
  await store.trash(e.id);

  const r = await syncLink(store, cal, l, { ...opts, now });
  l = r.link;
  assert.deepEqual(r.errors, []);
  assert.equal(ev(a.id).title, "A2");
  assert.deepEqual(ev(a.id).when, { allDay: false, start: new Date(2026, 10, 10, 8).getTime(), end: new Date(2026, 10, 10, 9).getTime() });
  const byId = new Map((await rows()).map((n) => [n.id, n]));
  assert.equal(byId.get(b.id)?.title, "B2");
  assert.equal(byId.get(c.id)?.title, "C-uzak");
  assert.equal(byId.has(d.id), false, "uzakta silinen satır çöpe taşınır");
  assert.ok((await store.listTrash()).some((t) => t.nodeId === d.id));
  assert.equal(cal.events.has(eEvent), false, "yerelde silinen satırın etkinliği silinir");
  assert.equal(r.counts.trashedLocal, 1);
  assert.equal(r.counts.deletedRemote, 1);
  assert.equal(l.items[d.id], undefined);
  assert.equal(l.items[e.id], undefined);

  // Tarihi kaldırılan satır takvimden çıkar ama satır kalır.
  await store.update(a.id, { fields: { props: {} } });
  const aEvent = l.items[a.id].eventId;
  l = (await syncLink(store, cal, l, { ...opts, now })).link;
  assert.equal(cal.events.has(aEvent), false);
  assert.ok((await rows()).some((n) => n.id === a.id));
});

test("eşitleme: durum kaybolursa Nularche işaretiyle eşleşir; yinelenen etkinlik ve kilitli not eşitlenmez", async () => {
  const { store, link, row, rows } = await setup();
  const cal = new MemoryCalendar();
  await row("Plan", "2026-11-01");
  await row("Gizli", "2026-11-02", { locked: true });
  const weekly = cal.put({ title: "Haftalık", when: { allDay: false, start: new Date(2026, 10, 2, 9).getTime(), end: new Date(2026, 10, 2, 10).getTime() }, recurring: true });
  const now = new Date(2026, 9, 1).getTime();
  const r1 = await syncLink(store, cal, link, { ...opts, now });
  assert.equal(cal.events.size, 2);
  assert.ok(![...cal.events.values()].some((e) => e.title === "Gizli"));
  assert.ok(!(await rows()).some((n) => n.title === "Haftalık"));

  // Eşleme durumu silinir (ör. .nularche klasörü kopyalanmadı) ve satır yeniden adlandırılır.
  const plan = (await rows()).find((n) => n.title === "Plan")!;
  await store.update(plan.id, { title: "Plan 2" });
  const r2 = await syncLink(store, cal, { ...r1.link, items: {} }, { ...opts, now });
  assert.equal(cal.events.size, 2, "yinelenen kayıt oluşmaz");
  assert.ok([...cal.events.values()].some((e) => e.title === "Plan 2"));
  assert.equal((await rows()).length, 2);
  assert.ok(cal.events.has(weekly.id));
  assert.equal(r2.counts.createdRemote + r2.counts.createdLocal, 0);
});

test("eşitleme: eşzamanlı değişiklik atlanır, kimlik hatası eşitlemeyi durdurur, aralık dışı satırlar okunmaz", async () => {
  const { store, link, row } = await setup();
  const cal = new MemoryCalendar();
  const old = await row("Eski", "2020-01-01");
  const now = new Date(2026, 9, 1).getTime();
  let { link: l } = await syncLink(store, cal, link, { ...opts, now });
  assert.equal(cal.events.size, 1, "aralık dışındaki satır da gönderilir");

  cal.calls = [];
  l = (await syncLink(store, cal, l, { ...opts, now })).link;
  assert.deepEqual(cal.calls, ["list"], "değişmemiş aralık dışı öğe tek tek sorgulanmaz");

  // Etkinliğin etag'i başka bir istemci tarafından değişir; yerel değişiklik bu turda atlanır, sonra uzak değişiklik çekilir.
  await store.update(old.id, { title: "Eski 2" });
  const evId = l.items[old.id].eventId;
  const stale = { ...cal.events.get(evId)! };
  cal.put({ ...stale, title: "Başka" });
  cal.listEvents = async () => [{ ...stale, title: "Eski" }];
  const r = await syncLink(store, cal, l, { ...opts, now });
  assert.equal(r.counts.skipped, 1);
  assert.deepEqual(r.errors, []);

  const failing = new MemoryCalendar();
  failing.listEvents = async () => {
    throw new CalendarError("auth", "HTTP 401");
  };
  await assert.rejects(syncLink(store, failing, l, { ...opts, now }), (e: unknown) => e instanceof CalendarError && e.code === "auth");
});

test("eşleme durumu Origin'de saklanır; aynı veritabanı + takvim tekrar bağlanınca güncellenir", async () => {
  const { store, link } = await setup();
  let state = await readCalendarState(store.root);
  assert.deepEqual(state.links, []);
  state = addLink(state, { ...link }).state;
  const again = addLink(state, { ...link, dateProp: "baska" });
  assert.equal(again.state.links.length, 1);
  assert.equal(again.link.dateProp, "baska");
  assert.equal(addLink(state, { ...link, provider: "google" }).state.links.length, 2, "aynı veritabanı Google ve Apple'a birlikte bağlanabilir");
  await writeCalendarState(store.root, { ...state, links: [{ ...state.links[0], items: { r: { eventId: "e", key: "k" }, bad: { key: 1 } as never } }] });
  const back = await readCalendarState(store.root);
  assert.deepEqual(back.links[0].items, { r: { eventId: "e", key: "k" } });
});

// --- Sağlayıcılar: gerçek HTTP üzerinden sahte sunucular -------------------------------------------

async function serve(handler: (req: IncomingMessage, body: string, res: ServerResponse) => void) {
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    handler(req, body, res);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, close: () => new Promise<void>((r) => server.close(() => r())) };
}

test("Apple (CalDAV): keşif, takvim listesi, etkinlik oluşturma/güncelleme/silme ve tam eşitleme", async () => {
  const files = new Map<string, { ics: string; etag: string }>();
  let n = 0;
  const auth = `Basic ${Buffer.from("me@icloud.com:app-pass").toString("base64")}`;
  const ms = (inner: string) => `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">${inner}</d:multistatus>`;
  const ok = (href: string, props: string) => `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
  const srv = await serve((req, body, res) => {
    if (req.headers.authorization !== auth) return res.writeHead(401).end();
    const url = req.url ?? "/";
    if (req.method === "PROPFIND" && url === "/") return res.writeHead(207).end(ms(ok("/", "<d:current-user-principal><d:href>/123/principal/</d:href></d:current-user-principal>")));
    if (req.method === "PROPFIND" && url === "/123/principal/") return res.writeHead(207).end(ms(ok(url, "<cal:calendar-home-set><d:href>/123/calendars/</d:href></cal:calendar-home-set>")));
    if (req.method === "PROPFIND" && url === "/123/calendars/") {
      return res.writeHead(207).end(
        ms(
          ok("/123/calendars/", "<d:resourcetype><d:collection/></d:resourcetype>") +
            ok("/123/calendars/home/", '<d:displayname>Ev</d:displayname><d:resourcetype><d:collection/><cal:calendar/></d:resourcetype><cal:supported-calendar-component-set><cal:comp name="VEVENT"/></cal:supported-calendar-component-set>') +
            ok("/123/calendars/tasks/", '<d:displayname>Anımsatıcılar</d:displayname><d:resourcetype><cal:calendar/></d:resourcetype><cal:supported-calendar-component-set><cal:comp name="VTODO"/></cal:supported-calendar-component-set>'),
        ),
      );
    }
    if (req.method === "REPORT" && url === "/123/calendars/home/") {
      assert.match(body, /time-range start="\d{8}T\d{6}Z"/);
      return res.writeHead(207).end(ms([...files].map(([href, f]) => ok(href, `<d:getetag>${f.etag}</d:getetag><cal:calendar-data>${f.ics.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</cal:calendar-data>`)).join("")));
    }
    const file = files.get(url);
    if (req.method === "GET") return file ? res.writeHead(200, { etag: file.etag, "content-type": "text/calendar" }).end(file.ics) : res.writeHead(404).end();
    if (req.method === "PUT") {
      if (req.headers["if-none-match"] === "*" && file) return res.writeHead(412).end();
      if (req.headers["if-match"] && req.headers["if-match"] !== file?.etag) return res.writeHead(412).end();
      const etag = `"${++n}"`;
      files.set(url, { ics: body, etag });
      // iCloud gibi: yeni kaynakta ETag döndürülmeyebilir.
      return res.writeHead(file ? 204 : 201, file ? { etag } : {}).end();
    }
    if (req.method === "DELETE") {
      if (!file) return res.writeHead(404).end();
      files.delete(url);
      return res.writeHead(204).end();
    }
    res.writeHead(405).end();
  });
  try {
    const bad = new CalDavCalendar({ username: "me@icloud.com", password: "wrong", server: `${srv.base}/` });
    await assert.rejects(bad.account(), (e: unknown) => e instanceof CalendarError && e.code === "auth");

    const apple = new CalDavCalendar({ username: "me@icloud.com", password: "app-pass", server: `${srv.base}/` });
    assert.equal(await apple.account(), "me@icloud.com");
    const cals = await apple.listCalendars();
    assert.deepEqual(cals, [{ id: `${srv.base}/123/calendars/home/`, name: "Ev", color: undefined }]);
    const calId = cals[0].id;

    files.set("/123/calendars/home/remote.ics", {
      etag: '"r"',
      ics: "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:remote\r\nSUMMARY:Konser & yemek\r\nDESCRIPTION:Bilet <A12>\r\nDTSTART;VALUE=DATE:20261121\r\nDTEND;VALUE=DATE:20261122\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
    });
    const { store, link, row, rows } = await setup();
    const yerel = await row("Yerel toplantı", "2026-11-03T10:00");
    const now = new Date(2026, 9, 1).getTime();
    const r1 = await syncLink(store, apple, { ...link, calendarId: calId }, { ...opts, now });
    assert.deepEqual(r1.errors, []);
    assert.equal(r1.counts.createdRemote, 1);
    assert.equal(r1.counts.createdLocal, 1);
    const konser = (await rows()).find((n) => n.title === "Konser & yemek")!;
    assert.equal((await store.read(konser.id)).body.trim(), "Bilet <A12>");
    const created = [...files].find(([, f]) => f.ics.includes("Yerel toplantı"))!;
    assert.match(created[1].ics, new RegExp(`X-NULARCHE-ROW:${yerel.id}`));
    assert.equal(r1.link.items[yerel.id].etag, created[1].etag, "ETag dönmeyince kaynak yeniden okunur");

    await store.update(yerel.id, { title: "Yerel toplantı (taşındı)" });
    await store.trash(konser.id);
    const r2 = await syncLink(store, apple, r1.link, { ...opts, now });
    assert.deepEqual(r2.errors, []);
    assert.equal(r2.counts.updatedRemote, 1);
    assert.equal(r2.counts.deletedRemote, 1);
    assert.ok(!files.has("/123/calendars/home/remote.ics"));
    assert.match(files.get(new URL(created[0], srv.base).pathname)!.ics, /SUMMARY:Yerel toplantı \(taşındı\)/);

    const r3 = await syncLink(store, apple, r2.link, { ...opts, now });
    assert.equal(r3.counts.updatedLocal + r3.counts.updatedRemote + r3.counts.createdLocal + r3.counts.createdRemote, 0);
  } finally {
    await srv.close();
  }
});

test("Google: belirteç yenileme, sayfalama, işaretli oluşturma, if-match ile güncelleme ve silme", async () => {
  const events = new Map<string, Record<string, unknown>>();
  let n = 0;
  const seen: string[] = [];
  const srv = await serve((req, body, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    seen.push(`${req.method} ${url.pathname}`);
    res.setHeader("content-type", "application/json");
    if (url.pathname === "/token") {
      const p = new URLSearchParams(body);
      if (p.get("refresh_token") !== "rt") return res.writeHead(400).end('{"error":"invalid_grant"}');
      return res.end(JSON.stringify({ access_token: "at", expires_in: 3600 }));
    }
    if (req.headers.authorization !== "Bearer at") return res.writeHead(401).end("{}");
    if (url.pathname === "/users/me/calendarList/primary") return res.end('{"id":"me@gmail.com"}');
    if (url.pathname === "/users/me/calendarList") {
      assert.equal(url.searchParams.get("minAccessRole"), "writer");
      return res.end(JSON.stringify({ items: [{ id: "primary@x", summary: "Kişisel", backgroundColor: "#f00" }] }));
    }
    const m = /^\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(url.pathname);
    if (!m) return res.writeHead(404).end("{}");
    const id = m[2] && decodeURIComponent(m[2]);
    if (req.method === "GET" && !id) {
      assert.ok(url.searchParams.get("timeMin") && url.searchParams.get("timeMax"));
      const all = [...events.values()];
      const page = url.searchParams.get("pageToken") === "2" ? all.slice(1) : all.slice(0, 1);
      return res.end(JSON.stringify({ items: page, ...(url.searchParams.get("pageToken") ? {} : all.length > 1 ? { nextPageToken: "2" } : {}) }));
    }
    if (req.method === "POST") {
      const ev = { ...JSON.parse(body), id: `g${++n}`, etag: `"${n}"`, updated: new Date().toISOString() };
      events.set(ev.id, ev);
      return res.end(JSON.stringify(ev));
    }
    const cur = id ? events.get(id) : undefined;
    if (!cur) return res.writeHead(404).end("{}");
    if (req.method === "GET") return res.end(JSON.stringify(cur));
    if (req.headers["if-match"] && req.headers["if-match"] !== cur.etag) return res.writeHead(412).end("{}");
    if (req.method === "PATCH") {
      const ev = { ...cur, ...JSON.parse(body), etag: `"${++n}"`, updated: new Date().toISOString() };
      events.set(ev.id as string, ev);
      return res.end(JSON.stringify(ev));
    }
    if (req.method === "DELETE") {
      events.delete(id!);
      return res.writeHead(204).end();
    }
  });
  try {
    const endpoints = { api: srv.base, token: `${srv.base}/token` };
    const revoked = new GoogleCalendar({ clientId: "c", clientSecret: "s", refreshToken: "eski" }, endpoints);
    await assert.rejects(revoked.listCalendars(), (e: unknown) => e instanceof CalendarError && e.code === "auth");

    const google = new GoogleCalendar({ clientId: "c", clientSecret: "s", refreshToken: "rt" }, endpoints);
    assert.equal(await google.account(), "me@gmail.com");
    assert.deepEqual(await google.listCalendars(), [{ id: "primary@x", name: "Kişisel", color: "#f00" }]);

    events.set("rem", {
      id: "rem",
      etag: '"r"',
      summary: "Uçuş",
      description: "PNR ABC",
      start: { dateTime: "2026-11-07T06:00:00+03:00" },
      end: { dateTime: "2026-11-07T08:30:00+03:00" },
      updated: "2026-10-01T00:00:00Z",
    });
    events.set("weekly", { id: "weekly", summary: "Spor", start: { dateTime: "2026-11-02T18:00:00Z" }, end: { dateTime: "2026-11-02T19:00:00Z" }, recurrence: ["RRULE:FREQ=WEEKLY"] });
    events.set("gone", { id: "gone", status: "cancelled" });

    const { store, link, row, rows, dateProp } = await setup();
    const yerel = await row("Sunum", { start: "2026-11-10", end: "2026-11-11" });
    const now = new Date(2026, 9, 1).getTime();
    const r1 = await syncLink(store, google, { ...link, provider: "google", calendarId: "primary@x" }, { ...opts, now });
    assert.deepEqual(r1.errors, []);
    assert.equal(r1.counts.createdLocal, 1, "iptal ve yinelenen etkinlik atlanır");
    assert.equal(r1.counts.createdRemote, 1);
    const ucus = (await rows()).find((n) => n.title === "Uçuş")!;
    assert.deepEqual(ucus.props?.[dateProp], { start: localDateTime(Date.UTC(2026, 10, 7, 3)), end: localDateTime(Date.UTC(2026, 10, 7, 5, 30)) });
    const sunum = [...events.values()].find((e) => e.summary === "Sunum")!;
    assert.deepEqual(sunum.start, { date: "2026-11-10" });
    assert.deepEqual(sunum.end, { date: "2026-11-12" });
    assert.deepEqual(sunum.extendedProperties, { private: { nularcheRow: yerel.id } });

    await store.update(yerel.id, { title: "Sunum (son)" });
    await store.trash(ucus.id);
    const before = seen.length;
    const r2 = await syncLink(store, google, r1.link, { ...opts, now });
    assert.deepEqual(r2.errors, []);
    assert.equal(r2.counts.updatedRemote, 1);
    assert.equal(r2.counts.deletedRemote, 1);
    assert.equal(events.get(sunum.id as string)?.summary, "Sunum (son)");
    assert.ok(!events.has("rem"));
    assert.ok(seen.slice(before).includes(`PATCH /calendars/primary%40x/events/${sunum.id}`));
    assert.equal(seen.filter((s) => s === "POST /token").length, 2, "erişim belirteci süresi dolana kadar yeniden kullanılır");
  } finally {
    await srv.close();
  }
});

// Ortak takvim işlemleri (server/src/calendar-service.ts): masaüstü IPC'si ve web sürümü bu kodu kullanır. Hesaplar
// bellekte, Google Takvim sahte bir sunucudur; web sürümündeki gibi erişim belirteci dışarıdan verilir.

import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { CalendarProviderId } from "../src/calendar.ts";
import { GoogleCalendar } from "../src/calendar-providers.ts";
import { calendarFailure, createCalendarService, LOCAL_CALENDAR, type StoredAccount } from "../../server/src/calendar-service.ts";
import { startFakeGoogleCalendar, type FakeGoogleCalendar } from "./fake-google-calendar.ts";

let fake: FakeGoogleCalendar;
before(async () => void (fake = await startFakeGoogleCalendar("me@example.com")));
after(() => fake.close());

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "nularche-calsvc-"));
  const accounts = new Map<CalendarProviderId, StoredAccount>();
  let announced = 0;
  let forced = 0;
  const service = createCalendarService({
    originRoot: () => root,
    text: (k) => k,
    announce: () => void announced++,
    provider: (p, acc) => (p === "google" && acc.google ? new GoogleCalendar(acc.google, { api: fake.url }) : null),
    accounts: {
      read: async (p) => accounts.get(p) ?? null,
      save: async (p, a) => void accounts.set(p, a),
      remove: async (p) => void accounts.delete(p),
    },
  });
  const token = { accessToken: async (force?: boolean) => (force && forced++, "web-token") };
  return { service, accounts, token, announced: () => announced, forced: () => forced };
}

test("takvim servisi: Google hesabı belirteçle bağlanır, birincil takvim görüntülenir, etkinlik eklenir ve silinir", async () => {
  const { service, token, announced } = await setup();
  assert.deepEqual((await service.status()).accounts, {}, "başta hesap yok");
  const linkedBefore = await service.link({ provider: "google", calendarId: "me@example.com", calendarName: "Ben" });
  assert.equal(linkedBefore.ok, true);
  assert.match((await service.status()).links[0].lastError?.message ?? "", /cal.notConnected/, "hesapsız bağlantı hata gösterir");
  await service.unlink((linkedBefore as { linkId: string }).linkId);

  const connected = await service.connect("google", { google: token });
  assert.deepEqual(connected, { ok: true, account: "me@example.com" });
  const cals = await service.calendars("google");
  assert.ok(cals.ok && cals.calendars.some((c) => c.id === "me@example.com"));

  fake.events.set("e1", { id: "e1", etag: '"e1"', summary: "Toplantı", start: { dateTime: new Date(Date.now() + 3600_000).toISOString() }, end: { dateTime: new Date(Date.now() + 7200_000).toISOString() } });
  const link = await service.link({ provider: "google", calendarId: "me@example.com", calendarName: "Ben" });
  assert.ok(link.ok);
  const view = (await service.events()).calendars.find((c) => c.id === link.linkId)!;
  assert.deepEqual(view.events.map((e) => e.title), ["Toplantı"]);
  assert.equal((await service.events()).calendars[0].id, LOCAL_CALENDAR);

  const start = Date.now() + 86_400_000;
  const saved = await service.eventSave(link.linkId, null, { title: "Webden", when: { allDay: false, start, end: start + 3600_000 } });
  assert.ok(saved.ok);
  assert.ok([...fake.events.values()].some((e) => e.summary === "Webden"), "etkinlik Google'a yazıldı");
  assert.ok((await service.eventDelete(link.linkId, saved.event.id)).ok);
  assert.ok(![...fake.events.values()].some((e) => e.summary === "Webden"), "etkinlik Google'dan silindi");
  assert.ok(announced() > 0, "arayüz bilgilendirildi");

  await service.disconnect("google");
  assert.deepEqual((await service.status()).accounts, {});
});

test("takvim servisi: yerel takvim hesap gerektirmez; geçersiz girdi ve hatalar anlaşılır döner", async () => {
  const { service } = await setup();
  const start = Date.now();
  const ev = await service.eventSave(LOCAL_CALENDAR, null, { title: "  ", when: { allDay: false, start, end: start + 60_000 }, alarm: 10 });
  assert.ok(ev.ok);
  assert.equal(ev.event.title, "cal.untitled");
  assert.deepEqual(ev.event.alarms, [10]);
  assert.equal((await service.eventSave(LOCAL_CALENDAR, null, { title: "x", when: { allDay: false, start, end: start } })).ok, false, "bitiş başlangıçtan önce olamaz");
  assert.equal((await service.calendars("yok")).ok, false);
  assert.deepEqual(calendarFailure(new Error("x")), { ok: false, code: "unknown", error: "x" });
});

test("takvim servisi: süresi dolan web belirteci 401'de bir kez yenilenir", async () => {
  const { service, forced } = await setup();
  let calls = 0;
  const expiring = { accessToken: async (force?: boolean) => (calls++ === 0 && !force ? "" : "yeni") };
  const res = await service.connect("google", { google: expiring });
  assert.deepEqual(res, { ok: true, account: "me@example.com" });
  assert.ok(calls >= 2, "401 sonrası yeni belirteç istendi");
  void forced;
});

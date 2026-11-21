// Web sürümünde takvim: masaüstüyle aynı takvim işlemleri (server/src/calendar-service.ts), Google oturumunun
// erişim belirteciyle. Hesap yalnızca bellekte tutulur. Google ile girişte Takvim izni verildiyse hesap kendiliğinden
// bağlanır ve birincil takvim Takvim ekranında görüntülenir. Apple Takvim (CalDAV) tarayıcıdan erişilemediği için
// masaüstü uygulamasında kalır.

import type { CalendarProvider, CalendarProviderId } from "../../../core/src/calendar.ts";
import { GoogleCalendar, type GoogleEndpoints } from "../../../core/src/calendar-providers.ts";
import { createCalendarService, type StoredAccount } from "../../../server/src/calendar-service.ts";
import type { CalendarBridge } from "../desktop.ts";
import { t } from "../i18n/index.ts";

export interface WebCalendarOptions {
  originRoot(): string | null;
  /** Google oturumunun belirteci; `granted` Takvim izni verildi mi. */
  google: { accessToken(force?: boolean): Promise<string>; granted(): boolean; request(): Promise<boolean> } | null;
  endpoints?: GoogleEndpoints;
  /** Arka plan eşitleme aralığı (ms); 0 kapatır. */
  every?: number;
}

export interface WebCalendar {
  bridge: CalendarBridge;
  /** Takvim izni varsa hesabı bağlar ve birincil takvimi (bağlı değilse) görüntülemeye ekler. */
  autoConnect(): Promise<{ connected: boolean; account?: string }>;
  close(): void;
}

export function createWebCalendar(options: WebCalendarOptions): WebCalendar {
  const accounts = new Map<CalendarProviderId, StoredAccount>();
  const listeners = new Set<() => void>();
  const google = options.google;
  const service = createCalendarService({
    originRoot: options.originRoot,
    text: (key) => t(key),
    announce: () => listeners.forEach((cb) => cb()),
    provider: (p, acc): CalendarProvider | null => (p === "google" && acc.google ? new GoogleCalendar(acc.google, options.endpoints) : null),
    accounts: {
      read: async (p) => accounts.get(p) ?? null,
      save: async (p, a) => void accounts.set(p, a),
      remove: async (p) => void accounts.delete(p),
    },
  });
  const connectGoogle = () => (google ? service.connect("google", { google: { accessToken: (force) => google.accessToken(force) } }) : Promise.resolve({ ok: false as const, code: "auth" as const, error: t("cal.notConnected") }));
  const every = options.every ?? 5 * 60_000;
  const timer = every > 0 ? setInterval(() => void service.sync().catch(() => undefined), every) : null;

  const bridge: CalendarBridge = {
    calendarStatus: async () => ({ encryption: true, googleOneClick: !!google, ...(await service.status()) }),
    async calendarConnectGoogle() {
      // Girişte Takvim izni verilmediyse Google'ın izin penceresi yeniden açılır.
      if (google && !google.granted() && !(await google.request().catch(() => false))) return { ok: false, code: "auth", error: t("cal.notConnected") };
      return connectGoogle();
    },
    calendarConnectApple: async () => ({ ok: false, code: "invalid", error: t("cal.webAppleOnly") }),
    calendarDisconnect: (p) => service.disconnect(p),
    calendarCalendars: (p) => service.calendars(p),
    calendarLink: (input) => service.link(input),
    calendarEvents: () => service.events(),
    calendarEventSave: (linkId, eventId, input) => service.eventSave(linkId, eventId, input),
    calendarEventDelete: (linkId, eventId) => service.eventDelete(linkId, eventId),
    calendarUnlink: (linkId) => service.unlink(linkId),
    calendarSync: async () => {
      try {
        return await service.sync();
      } catch (e) {
        return { ok: false, errors: [(e as Error).message] };
      }
    },
    calendarHelp: async () => undefined,
    onCalendarSynced(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };

  return {
    bridge,
    async autoConnect() {
      if (!google?.granted()) return { connected: false };
      const res = await connectGoogle();
      if (!res.ok) return { connected: false };
      const status = await service.status();
      if (!status.links.some((l) => l.provider === "google" && !l.dbId)) {
        // Birincil takvimin kimliği hesabın e-postasıdır; adı takvim listesinden alınır.
        const list = await service.calendars("google");
        const primary = list.ok ? list.calendars.find((c) => c.id === res.account) : undefined;
        await service.link({ provider: "google", calendarId: res.account, calendarName: primary?.name ?? res.account });
      }
      return { connected: true, account: res.account };
    },
    close() {
      if (timer) clearInterval(timer);
      listeners.clear();
      accounts.clear();
    },
  };
}

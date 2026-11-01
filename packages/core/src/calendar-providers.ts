// Takvim sağlayıcı bağdaştırıcıları: Google Takvim (REST API, OAuth yenileme belirteci) ve Apple iCloud
// (CalDAV, uygulamaya özel parola). İkisi de calendar.ts'teki CalendarProvider sözleşmesini uygular;
// eşitleme kuralları ve zaman yorumu calendar.ts'tedir. `fetch` dışarıdan verilebilir (testler).

import { randomUUID } from "node:crypto";
import { addDays, CalendarError, type CalendarEvent, type CalendarInfo, type CalendarProvider, type EventInput, type EventTime } from "./calendar.ts";

type Fetch = typeof fetch;

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

async function request(f: Fetch, url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await f(url, init);
  } catch (e) {
    throw new CalendarError("network", (e as Error).message);
  }
  if (res.ok) return res;
  const text = (await res.text().catch(() => "")).slice(0, 300);
  const code =
    res.status === 401 || res.status === 403
      ? "auth"
      : res.status === 404 || res.status === 410
        ? "not_found"
        : res.status === 412
          ? "conflict"
          : res.status >= 500
            ? "network"
            : "invalid";
  throw new CalendarError(code, `HTTP ${res.status}${text ? `: ${text}` : ""}`, res.status);
}

// --- Google Takvim ---------------------------------------------------------------------------------

export const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.calendarlist.readonly"];
export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_API = "https://www.googleapis.com/calendar/v3";

export interface GoogleCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface GoogleEndpoints {
  token?: string;
  api?: string;
  fetch?: Fetch;
}

/** Yetkilendirme kodunu (PKCE) yenileme belirtecine çevirir. */
export async function exchangeGoogleCode(
  input: { clientId: string; clientSecret: string; code: string; redirectUri: string; verifier: string },
  endpoints: GoogleEndpoints = {},
): Promise<string> {
  const res = await request(endpoints.fetch ?? fetch, endpoints.token ?? GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      code_verifier: input.verifier,
    }),
  });
  const body = (await res.json()) as { refresh_token?: string };
  if (!body.refresh_token) throw new CalendarError("auth", "Google did not return a refresh token");
  return body.refresh_token;
}

export function googleAuthUrl(input: { clientId: string; redirectUri: string; challenge: string; state: string }, base = GOOGLE_AUTH_URL): string {
  const q = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    code_challenge: input.challenge,
    code_challenge_method: "S256",
    state: input.state,
    access_type: "offline",
    prompt: "consent",
  });
  return `${base}?${q}`;
}

interface GoogleTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

interface GoogleEvent {
  id: string;
  etag?: string;
  status?: string;
  summary?: string;
  description?: string;
  updated?: string;
  start?: GoogleTime;
  end?: GoogleTime;
  recurrence?: string[];
  recurringEventId?: string;
  extendedProperties?: { private?: Record<string, string> };
}

const ROW_PROP = "nularcheRow";

function googleTime(t: EventTime, which: "start" | "end"): GoogleTime {
  if (t.allDay) return { date: t[which] };
  return { dateTime: new Date(t[which]).toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
}

/** Google etkinliği → ortak etkinlik; zamanı okunamayan ya da iptal edilmiş etkinlik için null. */
export function fromGoogleEvent(g: GoogleEvent): CalendarEvent | null {
  if (g.status === "cancelled" || !g.start) return null;
  let when: EventTime;
  if (g.start.date) {
    when = { allDay: true, start: g.start.date, end: g.end?.date ?? g.start.date };
    if (when.end <= when.start) when = { ...when, end: addDays(when.start, 1) };
  } else if (g.start.dateTime) {
    const start = Date.parse(g.start.dateTime);
    const end = g.end?.dateTime ? Date.parse(g.end.dateTime) : start;
    if (!Number.isFinite(start)) return null;
    when = { allDay: false, start, end: Number.isFinite(end) ? end : start };
  } else return null;
  const updated = g.updated ? Date.parse(g.updated) : NaN;
  return {
    id: g.id,
    etag: g.etag,
    title: g.summary ?? "",
    description: g.description,
    when,
    updatedAt: Number.isFinite(updated) ? updated : undefined,
    rowId: g.extendedProperties?.private?.[ROW_PROP],
    recurring: !!(g.recurrence?.length || g.recurringEventId),
  };
}

export class GoogleCalendar implements CalendarProvider {
  private access: { token: string; until: number } | null = null;
  private readonly f: Fetch;
  private readonly api: string;
  private readonly tokenUrl: string;
  private readonly creds: GoogleCredentials;

  constructor(creds: GoogleCredentials, endpoints: GoogleEndpoints = {}) {
    this.creds = creds;
    this.f = endpoints.fetch ?? fetch;
    this.api = endpoints.api ?? GOOGLE_API;
    this.tokenUrl = endpoints.token ?? GOOGLE_TOKEN_URL;
  }

  private async token(): Promise<string> {
    if (this.access && this.access.until > Date.now()) return this.access.token;
    let res: Response;
    try {
      res = await request(this.f, this.tokenUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: this.creds.refreshToken,
          client_id: this.creds.clientId,
          client_secret: this.creds.clientSecret,
        }),
      });
    } catch (e) {
      // Geri alınmış ya da süresi dolmuş yenileme belirteci: yeniden bağlanmak gerekir.
      if (e instanceof CalendarError && (e.status === 400 || e.status === 401)) throw new CalendarError("auth", e.message, e.status);
      throw e;
    }
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new CalendarError("auth", "Google did not return an access token");
    this.access = { token: body.access_token, until: Date.now() + Math.max(60, (body.expires_in ?? 3600) - 60) * 1000 };
    return body.access_token;
  }

  private async call(pathAndQuery: string, init: RequestInit = {}): Promise<Response> {
    const headers = {
      authorization: `Bearer ${await this.token()}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers as Record<string, string>),
    };
    return request(this.f, `${this.api}${pathAndQuery}`, { ...init, headers });
  }

  private cal = (id: string) => `/calendars/${encodeURIComponent(id)}/events`;

  async account(): Promise<string> {
    const res = await this.call("/users/me/calendarList/primary");
    return ((await res.json()) as { id?: string }).id ?? "Google";
  }

  async listCalendars(): Promise<CalendarInfo[]> {
    const out: CalendarInfo[] = [];
    let page: string | undefined;
    do {
      const q = new URLSearchParams({ minAccessRole: "writer", maxResults: "250", ...(page ? { pageToken: page } : {}) });
      const body = (await (await this.call(`/users/me/calendarList?${q}`)).json()) as {
        items?: { id: string; summary?: string; summaryOverride?: string; backgroundColor?: string; primary?: boolean }[];
        nextPageToken?: string;
      };
      for (const c of body.items ?? []) out.push({ id: c.id, name: c.summaryOverride || c.summary || c.id, color: c.backgroundColor });
      page = body.nextPageToken;
    } while (page);
    return out;
  }

  async listEvents(calendarId: string, range: { from: number; to: number }): Promise<CalendarEvent[]> {
    const out: CalendarEvent[] = [];
    let page: string | undefined;
    do {
      const q = new URLSearchParams({
        timeMin: new Date(range.from).toISOString(),
        timeMax: new Date(range.to).toISOString(),
        maxResults: "2500",
        singleEvents: "false",
        ...(page ? { pageToken: page } : {}),
      });
      const body = (await (await this.call(`${this.cal(calendarId)}?${q}`)).json()) as { items?: GoogleEvent[]; nextPageToken?: string };
      for (const g of body.items ?? []) {
        const ev = fromGoogleEvent(g);
        if (ev) out.push(ev);
      }
      page = body.nextPageToken;
    } while (page);
    return out;
  }

  async getEvent(calendarId: string, eventId: string): Promise<CalendarEvent | null> {
    try {
      const res = await this.call(`${this.cal(calendarId)}/${encodeURIComponent(eventId)}`);
      return fromGoogleEvent((await res.json()) as GoogleEvent);
    } catch (e) {
      if (e instanceof CalendarError && e.code === "not_found") return null;
      throw e;
    }
  }

  private body(input: EventInput) {
    return { summary: input.title, start: googleTime(input.when, "start"), end: googleTime(input.when, "end") };
  }

  async createEvent(calendarId: string, input: EventInput): Promise<CalendarEvent> {
    const res = await this.call(this.cal(calendarId), {
      method: "POST",
      body: JSON.stringify({ ...this.body(input), extendedProperties: { private: { [ROW_PROP]: input.rowId } } }),
    });
    return fromGoogleEvent((await res.json()) as GoogleEvent)!;
  }

  async updateEvent(calendarId: string, current: CalendarEvent, input: EventInput): Promise<CalendarEvent> {
    // PATCH yalnızca başlık ve zamanı değiştirir; açıklama, katılımcılar, hatırlatmalar korunur.
    const res = await this.call(`${this.cal(calendarId)}/${encodeURIComponent(current.id)}`, {
      method: "PATCH",
      headers: current.etag ? { "if-match": current.etag } : {},
      body: JSON.stringify(this.body(input)),
    });
    return fromGoogleEvent((await res.json()) as GoogleEvent)!;
  }

  async deleteEvent(calendarId: string, current: CalendarEvent): Promise<void> {
    try {
      await this.call(`${this.cal(calendarId)}/${encodeURIComponent(current.id)}`, {
        method: "DELETE",
        headers: current.etag ? { "if-match": current.etag } : {},
      });
    } catch (e) {
      if (!(e instanceof CalendarError && e.code === "not_found")) throw e;
    }
  }
}

// --- iCalendar (RFC 5545) --------------------------------------------------------------------------

interface IcsLine {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** Katlanmış satırları açar ve `AD;PARAM=x:değer` satırlarına ayırır. */
export function parseIcsLines(text: string): IcsLine[] {
  const out: IcsLine[] = [];
  for (const line of text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/)) {
    if (!line) continue;
    // Değer, tırnak dışındaki ilk ":" sonrasıdır.
    let i = 0;
    let quoted = false;
    for (; i < line.length; i++) {
      if (line[i] === '"') quoted = !quoted;
      else if (line[i] === ":" && !quoted) break;
    }
    const head = line.slice(0, i).split(";");
    const params: Record<string, string> = {};
    for (const p of head.slice(1)) {
      const eq = p.indexOf("=");
      if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
    }
    out.push({ name: head[0].toUpperCase(), params, value: line.slice(i + 1) });
  }
  return out;
}

export const unescapeIcs = (s: string) => s.replace(/\\([\\;,nN])/g, (_m, c: string) => (c === "n" || c === "N" ? "\n" : c));
export const escapeIcs = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Satırları 75 bayttan katlar (UTF-8 karakterlerini bölmeden). */
function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let cur = "";
  let size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (size + n > (parts.length ? 74 : 75)) {
      parts.push(cur);
      cur = "";
      size = 0;
    }
    cur += ch;
    size += n;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

/** Bir saat diliminde duvar saatinin anı (ms); bilinmeyen dilimde yerel saat kabul edilir. */
export function zonedTimeToMs(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string | undefined): number {
  if (!tz) return new Date(y, mo - 1, d, h, mi, s).getTime();
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return new Date(y, mo - 1, d, h, mi, s).getTime();
  }
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  const offsetAt = (ms: number) => {
    const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms;
  };
  let ms = wall - offsetAt(wall);
  ms = wall - offsetAt(ms); // yaz saati geçişinde ikinci tahmin
  return ms;
}

function parseIcsTime(line: IcsLine): { allDay: true; day: string } | { allDay: false; ms: number } | null {
  const v = line.value.trim();
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (date || line.params.VALUE === "DATE") {
    if (!date) return null;
    return { allDay: true, day: `${date[1]}-${date[2]}-${date[3]}` };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number);
  if (m[7] === "Z") return { allDay: false, ms: Date.UTC(y, mo - 1, d, h, mi, s) };
  return { allDay: false, ms: zonedTimeToMs(y, mo, d, h, mi, s, line.params.TZID) };
}

/** RFC 5545 süresi (ör. `PT1H30M`, `P1D`, `P2W`) → ms. */
export function parseIcsDuration(v: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return null;
  const [w, d, h, mi, s] = m.slice(2).map((x) => Number(x ?? 0));
  const ms = ((((w * 7 + d) * 24 + h) * 60 + mi) * 60 + s) * 1000;
  return m[1] === "-" ? -ms : ms;
}

const icsDay = (day: string) => day.replace(/-/g, "");
const icsUtc = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
};

function timeLines(t: EventTime): string[] {
  return t.allDay
    ? [`DTSTART;VALUE=DATE:${icsDay(t.start)}`, `DTEND;VALUE=DATE:${icsDay(t.end)}`]
    : [`DTSTART:${icsUtc(t.start)}`, `DTEND:${icsUtc(t.end)}`];
}

const ROW_ICS = "X-NULARCHE-ROW";

/** CalDAV kaynağındaki ilk etkinliği okur; etkinlik yoksa null. */
export function parseIcsEvent(text: string, id: string, etag?: string): CalendarEvent | null {
  const lines = parseIcsLines(text);
  let depth = 0;
  let events = 0;
  let ev: Record<string, IcsLine> | null = null;
  let recurring = false;
  for (const l of lines) {
    if (l.name === "BEGIN" && l.value.toUpperCase() === "VEVENT") {
      events++;
      depth++;
      if (events === 1) ev = {};
      continue;
    }
    if (l.name === "END" && l.value.toUpperCase() === "VEVENT") {
      depth--;
      continue;
    }
    if (depth !== 1) continue;
    if (l.name === "RRULE" || l.name === "RDATE" || l.name === "RECURRENCE-ID") recurring = true;
    if (events === 1 && ev && !(l.name in ev)) ev[l.name] = l;
  }
  if (!ev || !ev.DTSTART) return null;
  const start = parseIcsTime(ev.DTSTART);
  if (!start) return null;
  const end = ev.DTEND ? parseIcsTime(ev.DTEND) : null;
  const dur = ev.DURATION ? parseIcsDuration(ev.DURATION.value) : null;
  let when: EventTime;
  if (start.allDay) {
    let endDay = end?.allDay ? end.day : dur !== null ? addDays(start.day, Math.max(1, Math.round(dur / 86_400_000))) : addDays(start.day, 1);
    if (endDay <= start.day) endDay = addDays(start.day, 1);
    when = { allDay: true, start: start.day, end: endDay };
  } else {
    const endMs = end && !end.allDay ? end.ms : dur !== null ? start.ms + dur : start.ms;
    when = { allDay: false, start: start.ms, end: Math.max(endMs, start.ms) };
  }
  const modified = ev["LAST-MODIFIED"] ? parseIcsTime(ev["LAST-MODIFIED"]) : null;
  return {
    id,
    etag,
    title: ev.SUMMARY ? unescapeIcs(ev.SUMMARY.value) : "",
    description: ev.DESCRIPTION ? unescapeIcs(ev.DESCRIPTION.value) : undefined,
    when,
    updatedAt: modified && !modified.allDay ? modified.ms : undefined,
    rowId: ev[ROW_ICS]?.value || undefined,
    recurring: recurring || events > 1,
    raw: text,
  };
}

/** Yeni etkinlik için iCalendar metni. */
export function buildIcs(uid: string, input: EventInput, now = Date.now()): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Nularche//Calendar Sync//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${icsUtc(now)}`,
    `LAST-MODIFIED:${icsUtc(now)}`,
    ...timeLines(input.when),
    `SUMMARY:${escapeIcs(input.title)}`,
    `${ROW_ICS}:${input.rowId}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

/** Var olan iCalendar metninde yalnızca başlık ve zamanı değiştirir; diğer her şey (açıklama, alarmlar, katılımcılar) korunur. */
export function patchIcs(raw: string, input: EventInput, now = Date.now()): string {
  const replaced = new Set(["SUMMARY", "DTSTART", "DTEND", "DURATION", "DTSTAMP", "LAST-MODIFIED", "SEQUENCE", ROW_ICS]);
  const physical = raw
    .replace(/\r?\n[ \t]/g, "")
    .split(/\r?\n/)
    .filter(Boolean);
  const out: string[] = [];
  let depth = 0;
  let seen = 0;
  let sequence = 0;
  for (const line of physical) {
    const [l] = parseIcsLines(line);
    if (l.name === "BEGIN" && l.value.toUpperCase() === "VEVENT") {
      depth++;
      seen++;
      out.push(line);
      continue;
    }
    const inMaster = depth === 1 && seen === 1;
    if (l.name === "END" && l.value.toUpperCase() === "VEVENT") {
      if (inMaster) {
        out.push(
          ...timeLines(input.when),
          `SUMMARY:${escapeIcs(input.title)}`,
          `DTSTAMP:${icsUtc(now)}`,
          `LAST-MODIFIED:${icsUtc(now)}`,
          `SEQUENCE:${sequence + 1}`,
          `${ROW_ICS}:${input.rowId}`,
        );
      }
      depth--;
      out.push(line);
      continue;
    }
    if (inMaster && replaced.has(l.name)) {
      if (l.name === "SEQUENCE") sequence = Number(l.value) || 0;
      continue;
    }
    out.push(line);
  }
  return `${out.map(foldLine).join("\r\n")}\r\n`;
}

// --- CalDAV XML ------------------------------------------------------------------------------------

export interface XmlNode {
  /** Ad alanı öneki atılmış yerel ad (ör. `d:href` → `href`). */
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const decodeXml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_m, e: string) => {
    const k = e.toLowerCase();
    if (k[0] === "#") return String.fromCodePoint(k[1] === "x" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
    return { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" }[k] ?? _m;
  });

/** WebDAV çok durumlu yanıtlar için küçük, hoşgörülü XML okuyucu (DTD/işlem talimatı/yorumlar atlanır). */
export function parseXml(text: string): XmlNode {
  const root: XmlNode = { name: "#root", attrs: {}, children: [], text: "" };
  const stack = [root];
  const re =
    /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<[?!][\s\S]*?>|<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[6] !== undefined) top.text += decodeXml(m[6]);
    else if (m[3]) {
      const local = m[3].includes(":") ? m[3].slice(m[3].indexOf(":") + 1) : m[3];
      if (m[2]) {
        if (stack.length > 1) stack.pop();
        continue;
      }
      const attrs: Record<string, string> = {};
      for (const a of m[4].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        const an = a[1].includes(":") ? a[1].slice(a[1].indexOf(":") + 1) : a[1];
        attrs[an] = decodeXml(a[2] ?? a[3] ?? "");
      }
      const node: XmlNode = { name: local, attrs, children: [], text: "" };
      top.children.push(node);
      if (!m[5]) stack.push(node);
    }
  }
  return root;
}

const kids = (n: XmlNode, name: string) => n.children.filter((c) => c.name === name);
const kid = (n: XmlNode | undefined, name: string) => n?.children.find((c) => c.name === name);
function descendants(n: XmlNode, name: string): XmlNode[] {
  const out: XmlNode[] = [];
  const walk = (x: XmlNode) => {
    for (const c of x.children) {
      if (c.name === name) out.push(c);
      walk(c);
    }
  };
  walk(n);
  return out;
}

export interface DavResponse {
  href: string;
  /** Yalnızca 200 durumlu propstat'lerdeki özellikler. */
  props: XmlNode[];
}

/** `multistatus` yanıtını kaynaklara ayırır. */
export function parseMultistatus(text: string): DavResponse[] {
  return descendants(parseXml(text), "response").map((r) => {
    const props: XmlNode[] = [];
    for (const ps of kids(r, "propstat")) {
      const status = kid(ps, "status")?.text ?? "";
      if (/\s2\d\d\s/.test(` ${status} `)) for (const p of kids(ps, "prop")) props.push(...p.children);
    }
    return { href: (kid(r, "href")?.text ?? "").trim(), props };
  });
}

const prop = (r: DavResponse, name: string) => r.props.find((p) => p.name === name);

// --- Apple iCloud (CalDAV) -------------------------------------------------------------------------

export const ICLOUD_CALDAV = "https://caldav.icloud.com/";

export interface CalDavCredentials {
  username: string;
  /** Apple'da uygulamaya özel parola (appleid.apple.com → Oturum Açma ve Güvenlik). */
  password: string;
  server?: string;
}

const DAV_NS = 'xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/"';

export class CalDavCalendar implements CalendarProvider {
  private readonly f: Fetch;
  private readonly server: string;
  private home: string | null = null;
  private readonly creds: CalDavCredentials;

  constructor(creds: CalDavCredentials, endpoints: { fetch?: Fetch } = {}) {
    this.creds = creds;
    this.f = endpoints.fetch ?? fetch;
    this.server = creds.server ?? ICLOUD_CALDAV;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { authorization: `Basic ${Buffer.from(`${this.creds.username}:${this.creds.password}`).toString("base64")}`, ...extra };
  }

  private async dav(method: string, url: string, depth: "0" | "1", body: string): Promise<DavResponse[]> {
    const res = await request(this.f, url, {
      method,
      headers: this.headers({ depth, "content-type": "application/xml; charset=utf-8" }),
      body,
      redirect: "follow",
    });
    return parseMultistatus(await res.text());
  }

  private abs = (href: string, base: string) => new URL(href, base).toString();

  /** current-user-principal → calendar-home-set. */
  private async calendarHome(): Promise<string> {
    if (this.home) return this.home;
    const [p] = await this.dav("PROPFIND", this.server, "0", `<d:propfind ${DAV_NS}><d:prop><d:current-user-principal/></d:prop></d:propfind>`);
    const principalHref = kid(p ? prop(p, "current-user-principal") : undefined, "href")?.text.trim();
    if (!principalHref) throw new CalendarError("auth", "CalDAV principal not found");
    const principal = this.abs(principalHref, this.server);
    const [h] = await this.dav("PROPFIND", principal, "0", `<d:propfind ${DAV_NS}><d:prop><c:calendar-home-set/></d:prop></d:propfind>`);
    const homeHref = kid(h ? prop(h, "calendar-home-set") : undefined, "href")?.text.trim();
    if (!homeHref) throw new CalendarError("invalid", "CalDAV calendar home not found");
    this.home = this.abs(homeHref, principal);
    return this.home;
  }

  async account(): Promise<string> {
    await this.calendarHome();
    return this.creds.username;
  }

  async listCalendars(): Promise<CalendarInfo[]> {
    const home = await this.calendarHome();
    const res = await this.dav(
      "PROPFIND",
      home,
      "1",
      `<d:propfind ${DAV_NS}><d:prop><d:displayname/><d:resourcetype/><c:supported-calendar-component-set/><a:calendar-color/></d:prop></d:propfind>`,
    );
    const out: CalendarInfo[] = [];
    for (const r of res) {
      if (!kid(prop(r, "resourcetype"), "calendar")) continue;
      const comps = prop(r, "supported-calendar-component-set");
      if (comps && !kids(comps, "comp").some((c) => c.attrs.name?.toUpperCase() === "VEVENT")) continue;
      const id = this.abs(r.href, home);
      out.push({
        id,
        name: prop(r, "displayname")?.text.trim() || decodeURIComponent(id.replace(/\/$/, "").split("/").pop() ?? id),
        color: prop(r, "calendar-color")?.text.trim() || undefined,
      });
    }
    return out;
  }

  async listEvents(calendarId: string, range: { from: number; to: number }): Promise<CalendarEvent[]> {
    const body =
      `<c:calendar-query ${DAV_NS}><d:prop><d:getetag/><c:calendar-data/></d:prop>` +
      `<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">` +
      `<c:time-range start="${icsUtc(range.from)}" end="${icsUtc(range.to)}"/>` +
      `</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
    const out: CalendarEvent[] = [];
    for (const r of await this.dav("REPORT", calendarId, "1", body)) {
      const data = prop(r, "calendar-data")?.text;
      if (!data) continue;
      const ev = parseIcsEvent(data, this.abs(r.href, calendarId), prop(r, "getetag")?.text.trim());
      if (ev) out.push(ev);
    }
    return out;
  }

  async getEvent(_calendarId: string, eventId: string): Promise<CalendarEvent | null> {
    try {
      const res = await request(this.f, eventId, { headers: this.headers() });
      return parseIcsEvent(await res.text(), eventId, res.headers.get("etag") ?? undefined);
    } catch (e) {
      if (e instanceof CalendarError && e.code === "not_found") return null;
      throw e;
    }
  }

  /** PUT yanıtı ETag döndürmediyse kaynağı yeniden okur. */
  private async stored(url: string, res: Response, fallback: () => CalendarEvent | null): Promise<CalendarEvent> {
    const etag = res.headers.get("etag");
    const ev = etag ? fallback() : await this.getEvent("", url);
    if (!ev) throw new CalendarError("invalid", "CalDAV server did not store the event");
    return etag ? { ...ev, etag } : ev;
  }

  async createEvent(calendarId: string, input: EventInput): Promise<CalendarEvent> {
    const uid = randomUUID();
    const url = this.abs(`${uid}.ics`, calendarId.endsWith("/") ? calendarId : `${calendarId}/`);
    const ics = buildIcs(uid, input);
    const res = await request(this.f, url, {
      method: "PUT",
      headers: this.headers({ "content-type": "text/calendar; charset=utf-8", "if-none-match": "*" }),
      body: ics,
    });
    return this.stored(url, res, () => parseIcsEvent(ics, url));
  }

  async updateEvent(_calendarId: string, current: CalendarEvent, input: EventInput): Promise<CalendarEvent> {
    const raw = current.raw ?? (await this.getEvent("", current.id))?.raw;
    if (!raw) throw new CalendarError("not_found", "Event not found");
    const ics = patchIcs(raw, input);
    const res = await request(this.f, current.id, {
      method: "PUT",
      headers: this.headers({ "content-type": "text/calendar; charset=utf-8", ...(current.etag ? { "if-match": current.etag } : {}) }),
      body: ics,
    });
    return this.stored(current.id, res, () => parseIcsEvent(ics, current.id));
  }

  async deleteEvent(_calendarId: string, current: CalendarEvent): Promise<void> {
    try {
      await request(this.f, current.id, { method: "DELETE", headers: this.headers(current.etag ? { "if-match": current.etag } : {}) });
    } catch (e) {
      if (!(e instanceof CalendarError && e.code === "not_found")) throw e;
    }
  }
}

// Testler ve uçtan uca senaryolar için Google Calendar v3'ün küçük bir taklidi: birincil takvim, takvim listesi ve
// etkinlik listeleme / oluşturma / okuma / güncelleme / silme. Erişim belirteci yalnızca varlığına bakılarak kabul edilir.

import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

export interface FakeGoogleEvent {
  id: string;
  etag: string;
  summary?: string;
  description?: string;
  start: { date?: string; dateTime?: string };
  end: { date?: string; dateTime?: string };
  status?: string;
}

export interface FakeGoogleCalendar {
  /** API kökü (GoogleCalendar'ın `api` uç noktası). */
  url: string;
  account: string;
  events: Map<string, FakeGoogleEvent>;
  /** Yetkisiz (belirteçsiz) istek sayısı. */
  unauthorized: number;
  close(): Promise<void>;
}

export async function startFakeGoogleCalendar(account = "alex@gmail.com"): Promise<FakeGoogleCalendar> {
  const events = new Map<string, FakeGoogleEvent>();
  let n = 0;
  const state = { unauthorized: 0 };
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const json = (v: unknown, status = 200) => res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" }).end(JSON.stringify(v));
    if (!/^Bearer \S+/.test(String(req.headers.authorization ?? ""))) {
      state.unauthorized++;
      return json({ error: "unauthenticated" }, 401);
    }
    const url = new URL(req.url ?? "/", "http://x");
    const p = decodeURIComponent(url.pathname);
    if (p === "/users/me/calendarList/primary") return json({ id: account, summary: account, primary: true });
    if (p === "/users/me/calendarList") return json({ items: [{ id: account, summary: account, primary: true, backgroundColor: "#2c5a84" }, { id: "work@group.calendar.google.com", summary: "İş" }] });
    const m = /^\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(p);
    if (m && m[1] === account) {
      const id = m[2];
      if (!id && req.method === "GET") return json({ items: [...events.values()] });
      if (!id && req.method === "POST") {
        const ev = { ...JSON.parse(body), id: randomUUID().replace(/-/g, ""), etag: `"${++n}"` } as FakeGoogleEvent;
        events.set(ev.id, ev);
        return json(ev);
      }
      const ev = id ? events.get(id) : undefined;
      if (!ev) return json({ error: "notFound" }, 404);
      if (req.method === "GET") return json(ev);
      if (req.method === "PATCH") {
        const next = { ...ev, ...JSON.parse(body), etag: `"${++n}"` };
        events.set(ev.id, next);
        return json(next);
      }
      if (req.method === "DELETE") {
        events.delete(ev.id);
        return res.writeHead(204).end();
      }
    }
    json({ error: "unsupported", path: p, method: req.method }, 400);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    url,
    account,
    events,
    get unauthorized() {
      return state.unauthorized;
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

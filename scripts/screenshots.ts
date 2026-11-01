// README ekran görüntülerini üretir: uygulama kaynaktan, sahte bir kullanıcı klasörü ve örnek (İngilizce) içerikle açılır.
// Kullanım: node scripts/screenshots.ts [--out docs/screenshots]

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron, type Page } from "playwright-core";
import { projectRoot } from "../packages/core/src/config.ts";
import { addProperty, defaultDatabase, newView, serializeDatabase } from "../packages/core/src/database.ts";

const arg = (n: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : undefined);
const root = projectRoot();
const out = path.resolve(arg("--out") ?? path.join(root, "docs", "screenshots"));
const work = await mkdtemp(path.join(tmpdir(), "nularche-shots-"));
const userData = path.join(work, "ud");
const origin = path.join(work, "Nularche");
await mkdir(path.join(userData, "config"), { recursive: true });
await mkdir(origin, { recursive: true });
await mkdir(out, { recursive: true });
await writeFile(path.join(userData, "config", "settings.json"), JSON.stringify({ originDir: origin, onboarded: true, language: "en" }));

// Takvim eşitleme görselleri: Google ve iCloud yerine sahte sunucular; hesaplar kayıtlı başlar (E2E modunda şifresiz).
const calEvents = new Map<string, Record<string, unknown>>();
const calFiles = new Map<string, { ics: string; etag: string }>();
let calN = 0;
const calendarServer = createServer(async (req, res) => {
  let body = "";
  for await (const c of req) body += c;
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname.startsWith("/google/")) {
    res.setHeader("content-type", "application/json");
    const p = url.pathname.slice("/google".length);
    if (p === "/token") return res.end(JSON.stringify({ access_token: "at", expires_in: 3600 }));
    if (p === "/users/me/calendarList/primary") return res.end('{"id":"alex@gmail.com"}');
    if (p === "/users/me/calendarList") {
      return res.end(JSON.stringify({ items: [{ id: "work", summary: "Work" }, { id: "alex@gmail.com", summary: "Alex" }] }));
    }
    const id = /\/events\/([^/]+)$/.exec(p)?.[1];
    if (req.method === "GET" && !id) return res.end(JSON.stringify({ items: [...calEvents.values()] }));
    if (req.method === "POST" || req.method === "PATCH") {
      const ev = { ...(id ? calEvents.get(id) : {}), ...JSON.parse(body), id: id ?? `g${++calN}`, etag: `"${++calN}"`, updated: new Date().toISOString() };
      calEvents.set(ev.id, ev);
      return res.end(JSON.stringify(ev));
    }
    const ev = id && calEvents.get(id);
    return ev ? res.end(JSON.stringify(ev)) : res.writeHead(404).end("{}");
  }
  const ok = (href: string, props: string) => `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
  const ms = (inner: string) => res.writeHead(207).end(`<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${inner}</d:multistatus>`);
  const p = url.pathname.slice("/caldav".length) || "/";
  if (req.method === "PROPFIND" && p === "/") return ms(ok("/caldav/", "<d:current-user-principal><d:href>/caldav/1/principal/</d:href></d:current-user-principal>"));
  if (req.method === "PROPFIND" && p === "/1/principal/") return ms(ok(url.pathname, "<c:calendar-home-set><d:href>/caldav/1/calendars/</d:href></c:calendar-home-set>"));
  if (req.method === "PROPFIND") {
    return ms(["Home", "Family"].map((n) => ok(`/caldav/1/calendars/${n.toLowerCase()}/`, `<d:displayname>${n}</d:displayname><d:resourcetype><d:collection/><c:calendar/></d:resourcetype>`)).join(""));
  }
  if (req.method === "REPORT") {
    const files = [...calFiles].filter(([h]) => h.startsWith(url.pathname));
    return ms(files.map(([h, f]) => ok(h, `<d:getetag>${f.etag}</d:getetag><c:calendar-data>${f.ics.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</c:calendar-data>`)).join(""));
  }
  if (req.method === "PUT") {
    const etag = `"${++calN}"`;
    calFiles.set(url.pathname, { ics: body, etag });
    return res.writeHead(201, { etag }).end();
  }
  const f = calFiles.get(url.pathname);
  return f ? res.writeHead(200, { etag: f.etag }).end(f.ics) : res.writeHead(404).end();
});
await new Promise<void>((r) => calendarServer.listen(0, "127.0.0.1", () => r()));
const calBase = `http://127.0.0.1:${(calendarServer.address() as { port: number }).port}`;
await writeFile(
  path.join(userData, "config", "calendar-google.bin"),
  JSON.stringify({ account: "alex@gmail.com", google: { clientId: "id", clientSecret: "secret", refreshToken: "rt" } }),
);
await writeFile(path.join(userData, "config", "calendar-apple.bin"), JSON.stringify({ account: "alex@icloud.com", apple: { username: "alex@icloud.com", password: "x" } }));

const app = await electron.launch({
  executablePath: path.join(root, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"),
  args: [root, "--lang=en"],
  env: { ...process.env, HOME: path.join(work, "home"), NULARCHE_USER_DATA: userData, NULARCHE_E2E: "1",
    NULARCHE_GOOGLE_API: `${calBase}/google`,
    NULARCHE_GOOGLE_TOKEN: `${calBase}/google/token`,
    NULARCHE_CALDAV: `${calBase}/caldav/`,
  },
});
const page: Page = await app.firstWindow();
await page.setViewportSize({ width: 1440, height: 900 });
const shot = (name: string) => page.screenshot({ path: path.join(out, `${name}.png`) });
const fromTemplate = async (name: string) => {
  await page.locator(".side-btn", { hasText: "Templates" }).click();
  await page.locator(".segmented button", { hasText: "New Arche" }).click();
  await page.locator(".tpl-card", { hasText: name }).first().click();
  await page.waitForTimeout(1500);
};

try {
  await page.locator(".sidebar").waitFor({ timeout: 20_000 });
  await page.emulateMedia({ colorScheme: "dark" });
  await fromTemplate("Reading list");
  await fromTemplate("Task board");
  await fromTemplate("Project");
  // Proje sayfası: özet + gömülü görev panosu (koyu tema)
  await page.mouse.move(10, 10);
  await shot("project-dark");
  // Tam sayfa görev panosu: takvim ve tablo
  await page.locator(".tree-row", { hasText: "Task board" }).click();
  await page.waitForTimeout(800);
  await page.locator(".db-tab", { hasText: "Board" }).click();
  await page.waitForTimeout(400);
  await shot("board-dark");
  await page.locator(".db-tab", { hasText: "Calendar" }).click();
  await page.waitForTimeout(400);
  await shot("calendar-dark");
  // Okuma listesi galerisi (açık tema)
  await page.emulateMedia({ colorScheme: "light" });
  await page.locator(".tree-row", { hasText: "Reading list" }).click();
  await page.waitForTimeout(800);
  await shot("gallery-light");
  await page.locator(".db-tab", { hasText: "Table" }).click();
  await page.waitForTimeout(400);
  await shot("table-light");
  // Şablon galerisi
  await page.locator(".side-btn", { hasText: "Templates" }).click();
  await page.waitForTimeout(400);
  await shot("templates-light");
  await page.keyboard.press("Escape");
  await page.locator(".dialog .icon-btn").first().click();
  // Nularche AI penceresi ve kısayollar (koyu)
  await page.emulateMedia({ colorScheme: "dark" });
  await page.locator(".tree-row", { hasText: "Project" }).click();
  await page.waitForTimeout(600);
  await page.locator(".claude-btn").click();
  await page.waitForTimeout(600);
  await shot("ai-dark");
  await page.locator(".nai-panel .icon-btn").last().click();
  await page.keyboard.press("Meta+/");
  await page.waitForTimeout(400);
  await shot("shortcuts-dark");
  await page.keyboard.press("Meta+/");
  // v1.5: etiketler, matematik sonuçları, yapılacaklar, biçimler; not listesi (galeri) ve odak modu
  const noteId = await page.evaluate(async () => {
    const body = [
      "Planning the spring trip with the team. #travel #plans/2026",
      "",
      "## Budget",
      "",
      "flights = 4 * 189",
      "hotel = 3 * 120",
      "flights + hotel =",
      "",
      "## Checklist",
      "",
      "- [ ] Book the flights",
      "- [ ] Reserve the hotel",
      "- [x] Ask everyone for dates",
      "",
      '<div align="center">',
      "",
      "*“Travel far enough, you meet yourself.”*",
      "",
      "</div>",
      "",
      "+ Passports",
      "+ Chargers",
      "",
      "Water is H<sub>2</sub>O and area grows with r<sup>2</sup>.",
    ].join("\n");
    const n = await (await fetch("/api/nodes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Spring trip", parentNodeId: null, body, fields: { icon: "🧳", pinned: true } }) })).json();
    await fetch("/api/nodes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Packing ideas", parentNodeId: n.id, body: "Light layers and a rain jacket. #travel" }) });
    await fetch("/api/prefs", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ writingBg: { kind: "scene", id: "sunset" } }) });
    return n.id as string;
  });
  await page.evaluate(() => location.reload());
  await page.locator(".sidebar").waitFor();
  await page.emulateMedia({ colorScheme: "dark" });
  await page.evaluate((id) => (location.hash = id), noteId);
  await page.waitForTimeout(900);
  // İmleç hesap satırının sonunda: sonuç önerisi görünür.
  const box = (await page.locator(".ProseMirror p", { hasText: "flights + hotel =" }).boundingBox())!;
  await page.mouse.click(box.x + 4, box.y + box.height - 6);
  await page.keyboard.press("Meta+ArrowRight");
  await page.waitForTimeout(300);
  await page.mouse.move(10, 10);
  await shot("notes-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.evaluate(() => (location.hash = "notes"));
  await page.waitForTimeout(500);
  await page.locator(".note-list-tools .segmented button").nth(1).click();
  await page.waitForTimeout(400);
  await shot("list-light");
  await page.evaluate((id) => (location.hash = id), noteId);
  await page.waitForTimeout(700);
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("Meta+Shift+F");
  await page.waitForTimeout(800);
  await page.mouse.move(400, 300);
  await page.waitForTimeout(200);
  await shot("focus-scene");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // Obsidian'dan gelen özellikler: özellikler, wiki bağlantıları, matematik, kutu, kenar paneli, grafik, tuval.
  const ids = await page.evaluate(async () => {
    const make = async (title: string, body: string, parentNodeId: string | null, fields?: Record<string, unknown>) =>
      (await (await fetch("/api/nodes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, parentNodeId, body, fields }) })).json()) as { id: string; path: string };
    const home = await make("Home", "", null, { icon: "🏡" });
    const solar = await make(
      "Solar panels",
      [
        "# Overview",
        "Comparing panels for the roof, see [[Roof measurements]] and the [[Energy log|monthly log]].",
        "Yearly yield $E = A \\cdot r \\cdot H \\cdot PR$ with a performance ratio of $0.75$.",
        "",
        "> [!tip] Rule of thumb",
        "> South-facing roofs at 30–35° get the most sun[^1].",
        "",
        "```mermaid",
        "graph LR; Panels-->Inverter-->Battery; Inverter-->Grid",
        "```",
        "",
        "[^1]: In the northern hemisphere.",
      ].join("\n"),
      home.id,
    );
    await fetch(`/api/nodes/${solar.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ properties: { aliases: ["PV", "Solar"], status: "researching", budget: 4200, tags: ["home"] } }) });
    await make("Roof measurements", "South side: 8.2 m × 4.5 m. Related: [[Solar panels]] and [[Battery options]].", home.id);
    await make("Battery options", "Compare 10 kWh units for [[PV]]. #home", home.id);
    await make("Energy log", "October: 412 kWh. The Solar panels research should cut this in half.", home.id);
    const heat = await make("Heat pump", "Maybe after the [[Solar panels]] are in.", home.id);
    const fresh = async (id: string) => ((await (await fetch(`/api/nodes/${id}`)).json()) as { path: string }).path;
    const canvas = {
      nodes: [
        { id: "a", type: "text", text: "# Home energy\nGoals for next year", x: 0, y: 0, width: 260, height: 120, color: "5" },
        { id: "b", type: "file", file: await fresh(solar.id), x: 360, y: -80, width: 280, height: 150, color: "4" },
        { id: "c", type: "file", file: await fresh(heat.id), x: 360, y: 120, width: 280, height: 120 },
        { id: "d", type: "text", text: "Budget: **€12k**", x: 0, y: 200, width: 220, height: 70, color: "3" },
      ],
      edges: [
        { id: "e1", fromNode: "a", toNode: "b", toEnd: "arrow" },
        { id: "e2", fromNode: "a", toNode: "c", toEnd: "arrow" },
        { id: "e3", fromNode: "a", toNode: "d", toEnd: "arrow", label: "limit" },
      ],
    };
    const board = await make("Home plan", "```json canvas\n" + JSON.stringify(canvas, null, 2) + "\n```\n", home.id, { layout: "canvas", icon: "🧩" });
    await fetch("/api/prefs", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ writingBg: { kind: "none" }, sidePanel: "links" }) });
    return { solar: solar.id, canvas: board.id };
  });
  await page.evaluate(() => location.reload());
  await page.locator(".sidebar").waitFor();
  await page.emulateMedia({ colorScheme: "dark" });
  await page.evaluate((id) => (location.hash = id), ids.solar);
  await page.locator(".mermaid-render svg").waitFor({ timeout: 10_000 });
  await page.waitForTimeout(800);
  await page.mouse.move(10, 10);
  await shot("obsidian-dark");
  await page.evaluate(() => (location.hash = "graph"));
  await page.waitForTimeout(3500);
  await shot("graph-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.keyboard.press("Meta+Shift+O"); // kenar panelini kapat
  await page.evaluate((id) => (location.hash = id), ids.canvas);
  await page.locator(".canvas-card").first().waitFor();
  await page.waitForTimeout(800);
  await shot("canvas-light");

  // Takvim eşitleme: bir etkinlik veritabanı Google "Work" ve iCloud "Home" takvimleriyle eşitlenir (koyu),
  // sonra Ayarlar'daki hesaplar (açık).
  const now = new Date();
  const day = (d: number, time?: string) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}${time ? `T${time}` : ""}`;
  const icsDay = (d: number) => day(d).replace(/-/g, "");
  calEvents.set("standup", { id: "standup", etag: '"s"', summary: "Quarterly planning", start: { dateTime: new Date(day(12, "10:00")).toISOString() }, end: { dateTime: new Date(day(12, "12:00")).toISOString() } });
  calEvents.set("review", { id: "review", etag: '"r"', summary: "Design review", start: { dateTime: new Date(day(18, "14:00")).toISOString() }, end: { dateTime: new Date(day(18, "15:00")).toISOString() } });
  calFiles.set("/caldav/1/calendars/home/dentist.ics", {
    etag: '"d"',
    ics: `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:dentist\r\nSUMMARY:Dentist\r\nDTSTART;VALUE=DATE:${icsDay(24)}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`,
  });
  const agendaId = await page.evaluate(
    async ({ db, rows }) => {
      const post = async (b: unknown) => (await (await fetch("/api/nodes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) })).json()).id as string;
      const id = await post({ title: "Agenda", parentNodeId: null, fields: { database: db, icon: "🗓" } });
      for (const [title, props] of rows) await post({ title, parentNodeId: id, fields: { props } });
      return id;
    },
    (() => {
      const base = addProperty(defaultDatabase({ tags: "Tags", status: "Status", todo: "To do", doing: "Doing", done: "Done", table: "Table", board: "Board" }), { name: "Date", type: "date" });
      const calView = { ...newView("calendar", "Calendar", base.db.properties), dateProp: base.property.id };
      const db = serializeDatabase({ ...base.db, views: [calView, ...base.db.views] });
      const d = base.property.id;
      const rows: [string, Record<string, unknown>][] = [
        ["Team offsite", { [d]: { start: day(5), end: day(6) }, status: "todo" }],
        ["Launch blog post", { [d]: day(9, "09:30"), status: "doing" }],
        ["Book flights", { [d]: day(10), status: "todo" }],
        ["Mum's birthday", { [d]: day(27) }],
      ];
      return { db, rows };
    })(),
  );
  await page.emulateMedia({ colorScheme: "dark" });
  await page.evaluate((id) => (location.hash = id), agendaId);
  await page.locator(".cal-grid").waitFor();
  for (const calendar of ["Work", "Home"]) {
    await page.locator(".db-tool", { hasText: "Calendar" }).click();
    const panel = page.locator(".cal-panel");
    if (calendar === "Home") await panel.locator(".segmented button", { hasText: "Apple" }).click();
    await panel.locator("select option", { hasText: calendar }).waitFor({ state: "attached", timeout: 10_000 });
    await panel.locator("select").first().selectOption({ label: calendar });
    await panel.locator("button.primary").click();
    await panel.locator(".cal-link", { hasText: calendar }).waitFor({ timeout: 15_000 });
    await page.keyboard.press("Escape");
    await page.locator(".toast").waitFor({ state: "detached", timeout: 15_000 });
  }
  await page.locator(".cal-item", { hasText: "Dentist" }).waitFor({ timeout: 5_000 });
  // Ayarlar'dan "Sync now": iki takvim de aynı satırları taşır (açık tema).
  await page.emulateMedia({ colorScheme: "light" });
  await page.locator(".side-btn", { hasText: "Settings" }).click();
  await page.getByRole("heading", { name: "Calendar sync" }).waitFor();
  await page.getByRole("button", { name: /Sync now/ }).click();
  await page.locator(".toast", { hasText: "Calendars synced" }).waitFor({ timeout: 10_000 });
  await page.locator(".toast").waitFor({ state: "detached", timeout: 15_000 });
  await page.locator(".cal-settings").evaluate((el) => {
    el.previousElementSibling?.scrollIntoView({ block: "start" });
    el.closest(".dialog")?.scrollBy(0, -24);
  });
  await page.waitForTimeout(400);
  await shot("calendar-settings-light");
  await page.keyboard.press("Escape");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.locator(".db-tool", { hasText: "Calendar" }).click();
  await page.locator(".cal-panel .cal-link").nth(1).waitFor();
  await page.mouse.move(10, 10);
  await page.waitForTimeout(400);
  await shot("calendar-sync-dark");
  await page.keyboard.press("Escape");
  console.log(`Ekran görüntüleri: ${out}`);
} finally {
  await app.close();
  calendarServer.close();
}

// README görselleri (Nularche Web): üretimdeki web sürümünün aynısı, Google yerine sahte Drive ve Takvim ile, İngilizce
// arayüzde ve 2x çözünürlükte çekilir. Giriş penceresi, parola adımı, uygulama, Google Drive ayarı, güvenlik ayarları
// (bu tarayıcıya güven, otomatik kilit) ve kilit ekranı. Kullanım: node scripts/web-platform/web-screenshots.ts [--out klasör]

import { createServer, request as httpRequest } from "node:http";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { GoogleDrive } from "../../packages/core/src/drive-google.ts";
import { deriveKeys, keyCheck, newSalt, syncOrigin } from "../../packages/core/src/drive-sync.ts";
import { NodeStore } from "../../packages/core/src/node-store.ts";
import { startFakeDrive } from "../../packages/core/test/fake-drive.ts";
import { startFakeGoogleCalendar } from "../../packages/core/test/fake-google-calendar.ts";
import { buildWeb } from "../build-web.ts";
import { APP_HEADERS } from "../site-headers.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const outArg = process.argv.indexOf("--out");
const shots = path.resolve(outArg > 0 ? process.argv[outArg + 1] : path.join(here, "..", "..", "docs", "screenshots", "raw"));
const ACCOUNT = "verseofac@gmail.com";
const PASS = "a long walk in the violet hills";

await mkdir(shots, { recursive: true });
const fake = await startFakeDrive(ACCOUNT);
const cal = await startFakeGoogleCalendar(ACCOUNT);
const soon = new Date();
soon.setHours(10, 0, 0, 0);
for (const [i, title] of ["Design review", "Writing hour", "Call with the editor"].entries()) {
  const start = soon.getTime() + (i * 2 + 1) * 86_400_000;
  cal.events.set(`e${i}`, { id: `e${i}`, etag: `"e${i}"`, summary: title, start: { dateTime: new Date(start).toISOString() }, end: { dateTime: new Date(start + 3600_000).toISOString() } });
}
const desk = await mkdtemp(path.join(tmpdir(), "nularche-webshots-desk-"));
const out = await mkdtemp(path.join(tmpdir(), "nularche-webshots-"));
try {
  // Masaüstünde yazılmış gibi örnek notlar, uçtan uca şifreli olarak sahte Drive'a.
  const d = new GoogleDrive({ clientId: "id", clientSecret: "s", refreshToken: "rt" }, { token: `${fake.url}/token`, api: `${fake.url}/drive/v3`, upload: `${fake.url}/upload/drive/v3` });
  const salt = newSalt();
  const keys = await deriveKeys(PASS, salt);
  const rootId = await d.createRoot("Nularche", { salt, check: keyCheck(keys) });
  const store = new NodeStore(desk);
  await store.ensureRoot();
  const novel = await store.create({ title: "The Lighthouse Keeper", parentNodeId: null, body: "", fields: { icon: "🌊" } });
  for (const [t, b] of [
    ["Chapter 1 — Arrival", "The ferry left her at the end of the pier with a single suitcase and a letter she had not yet opened."],
    ["Chapter 2 — The Lamp Room", "Every evening at dusk she climbed the hundred and twelve steps to wind the clockwork."],
    ["Characters", "**Mira** — the new keeper. **Tomas** — the harbour master who knows more than he says."],
  ]) await store.create({ title: t, parentNodeId: novel.id, body: b });
  const plans = await store.create({ title: "Plans and work", parentNodeId: null, body: "", fields: { icon: "🗂️" } });
  await store.create({ title: "Weekly review", parentNodeId: plans.id, body: "- [x] Inbox to zero\n- [x] Plan the week\n- [ ] Draft the newsletter\n\n#review" });
  await store.create({ title: "Reading list", parentNodeId: plans.id, body: "1. *The Waves* — Virginia Woolf\n2. *Invisible Cities* — Italo Calvino" });
  await store.create({
    title: "Welcome to Nularche Web",
    parentNodeId: null,
    body: "Your notes, from any computer. Nothing to install, no Nularche server: your browser talks to your own Google Drive and decrypts your notes in this tab.\n\n> Lock the tab when you step away. Your passphrase opens it again.",
    fields: { icon: "✨" },
  });
  await syncOrigin(desk, d, rootId, { host: "Desktop", keys });

  await buildWeb(out, path.join(here, "web-e2e-entry.ts"));
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const target = url.pathname.startsWith("/fake/") ? { prefix: "/fake", base: fake.url } : url.pathname.startsWith("/fakecal/") ? { prefix: "/fakecal", base: cal.url } : null;
    if (target) {
      const to = new URL(target.base);
      const proxied = httpRequest({ host: to.hostname, port: to.port, method: req.method, path: url.pathname.slice(target.prefix.length) + url.search, headers: req.headers }, (r) => {
        res.writeHead(r.statusCode ?? 500, r.headers);
        r.pipe(res);
      });
      req.pipe(proxied);
      return;
    }
    const rel = url.pathname.startsWith("/app/") ? url.pathname.slice(5) || "index.html" : "";
    const file = path.join(out, rel);
    const body = await readFile(file.startsWith(out) && rel ? file : path.join(out, "index.html")).catch(() => readFile(path.join(out, "index.html")));
    const type = rel.endsWith(".js") ? "text/javascript" : rel.endsWith(".css") ? "text/css" : rel.endsWith(".png") ? "image/png" : rel.endsWith(".woff2") ? "font/woff2" : "text/html";
    res.writeHead(200, { "content-type": type, "cache-control": "no-store", ...Object.fromEntries(APP_HEADERS) });
    res.end(body);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://localhost:${(server.address() as { port: number }).port}`;
  const browser = await chromium.launch({ headless: true, ...(process.env.NULARCHE_CHROME ? { executablePath: process.env.NULARCHE_CHROME } : { channel: "chrome" }) });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: "en-US", colorScheme: "light" });
    const page = await ctx.newPage();
    const shot = (name: string) => page.screenshot({ path: path.join(shots, `${name}.png`) });
    await page.goto(`${base}/app/`);
    await page.waitForSelector(".nw-google");
    await page.waitForTimeout(600);
    await shot("web-signin");
    await page.click(".nw-google");
    await page.waitForSelector(".nw-input", { timeout: 30_000 });
    await page.fill(".nw-input", PASS);
    await page.waitForTimeout(300);
    await shot("web-passphrase");
    await page.click(".nw-primary");
    await page.waitForSelector(".nw-shade", { state: "detached", timeout: 60_000 });
    // Masaüstü görselleriyle aynı görünüm: Lavender Hills manzarası her sayfada.
    await page.evaluate(async () => {
      await fetch("/api/prefs", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ writingBg: { kind: "scene", id: "lavender" }, writingBgEverywhere: true }) });
    });
    await page.waitForTimeout(800);
    await page.getByText("Welcome to Nularche Web").first().click();
    await page.waitForTimeout(1500);
    await shot("web-app");

    await page.getByText("Settings", { exact: true }).first().click();
    await page.getByText("Notes and Origin", { exact: true }).first().click();
    await page.getByTestId("web-drive").waitFor({ timeout: 15_000 });
    await page.waitForTimeout(800);
    await shot("web-drive");
    await page.getByRole("tab", { name: "Security" }).click();
    await page.getByTestId("web-trust").waitFor({ timeout: 15_000 });
    await page.getByTestId("web-trust").scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    await shot("web-security");
    await page.keyboard.press("Escape");

    await page.getByTestId("web-session").getByText("Lock").click();
    await page.waitForSelector(".nw-lockscreen .nw-input", { timeout: 20_000 });
    await page.waitForTimeout(600);
    await shot("web-lock");
  } finally {
    await browser.close();
    server.close();
  }
} finally {
  await fake.close();
  await cal.close();
  await rm(desk, { recursive: true, force: true });
  await rm(out, { recursive: true, force: true });
}
console.log(`Web screenshots: ${shots}`);

// Web sürümünü uçtan uca, görünmez (headless) Chrome'da denetler: giriş penceresi, şifreli Origin için parola
// (yanlış ve doğru), notların Drive'dan belleğe inmesi, uygulama arayüzünün açılması, web'de yapılan değişikliğin
// şifreli olarak Drive'a gitmesi ve hiçbir notun ağa ya da tarayıcı depolamasına yazılmaması. Google yerine sahte Drive
// kullanılır; derleme, service worker ve uygulama üretimdekiyle aynıdır. `--shots <klasör>` ekran görüntülerini kaydeder.

import { createServer, request as httpRequest } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { GoogleDrive } from "../../packages/core/src/drive-google.ts";
import { decryptFile, deriveKeys, keyCheck, newSalt, syncOrigin } from "../../packages/core/src/drive-sync.ts";
import { NodeStore } from "../../packages/core/src/node-store.ts";
import { startFakeDrive } from "../../packages/core/test/fake-drive.ts";
import { buildWeb } from "../build-web.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const shotsArg = process.argv.indexOf("--shots");
const shots = shotsArg > 0 ? path.resolve(process.argv[shotsArg + 1]) : null;
const PASS = "mor dağlarda uzun bir yürüyüş";

// 1. Masaüstü uygulaması gibi: şifreli kök ve bir not.
const fake = await startFakeDrive("deneme@example.com");
const desk = await mkdtemp(path.join(tmpdir(), "nularche-desk-"));
const out = await mkdtemp(path.join(tmpdir(), "nularche-web-"));
const failures: string[] = [];
const check = (ok: unknown, what: string) => {
  console.log(`${ok ? "✔" : "✘"} ${what}`);
  if (!ok) failures.push(what);
};
try {
  const d = new GoogleDrive({ clientId: "id", clientSecret: "s", refreshToken: "rt" }, { token: `${fake.url}/token`, api: `${fake.url}/drive/v3`, upload: `${fake.url}/upload/drive/v3` });
  const salt = newSalt();
  const keys = await deriveKeys(PASS, salt);
  const rootId = await d.createRoot("Nularche", { salt, check: keyCheck(keys) });
  const store = new NodeStore(desk);
  await store.ensureRoot();
  await store.create({ title: "Masaüstü planı", parentNodeId: null, body: "Bu not masaüstünde yazıldı. #plan" });
  await syncOrigin(desk, d, rootId, { host: "Masaüstü", keys });

  // 2. Web sürümünü sahte Drive girişiyle derle.
  await buildWeb(out, path.join(here, "web-e2e-entry.ts"));

  // 3. Sunucu: /app (tek sayfa), /fake → sahte Drive. /api ve /files ağa gelirse kaydedilir (gelmemeli).
  const network: string[] = [];
  const fakeUrl = new URL(fake.url);
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname.startsWith("/fake/")) {
      const proxied = httpRequest({ host: fakeUrl.hostname, port: fakeUrl.port, method: req.method, path: url.pathname.slice(5) + url.search, headers: req.headers }, (r) => {
        const headers = { ...r.headers };
        if (headers.location) headers.location = headers.location.replace(fake.url, `http://${req.headers.host}/fake`);
        res.writeHead(r.statusCode ?? 500, headers);
        r.pipe(res);
      });
      req.pipe(proxied);
      return;
    }
    if (url.pathname.startsWith("/app/")) {
      const rel = url.pathname.slice(5) || "index.html";
      const file = path.join(out, rel);
      try {
        if (!file.startsWith(out)) throw new Error("dışarı");
        const body = await readFile(file);
        const type = rel.endsWith(".js") ? "text/javascript" : rel.endsWith(".css") ? "text/css" : rel.endsWith(".png") ? "image/png" : rel.endsWith(".woff2") ? "font/woff2" : rel.endsWith(".html") ? "text/html" : "application/octet-stream";
        res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
        return res.end(body);
      } catch {
        if (!path.extname(rel)) {
          res.writeHead(200, { "content-type": "text/html" });
          return res.end(await readFile(path.join(out, "index.html")));
        }
      }
    }
    network.push(url.pathname);
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://localhost:${(server.address() as { port: number }).port}`;

  const browser = await chromium.launch({ headless: true, ...(process.env.NULARCHE_CHROME ? { executablePath: process.env.NULARCHE_CHROME } : { channel: "chrome" }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: "tr-TR" });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${base}/app/`);
    await page.waitForSelector(".nw-google");
    if (shots) await page.screenshot({ path: path.join(shots, "1-giris.png") });
    check(await page.locator(".nw-card h1").textContent() === "Nularche", "Nularche giriş penceresi görünüyor");
    await page.click(".nw-google");
    if (process.env.NULARCHE_DEBUG) page.on("console", (m) => console.log("console:", m.text()));
    page.on("crash", () => console.log("sayfa çöktü"));
    await page.waitForSelector(".nw-input, .nw-error", { timeout: 30_000 });
    const early = await page.$eval(".nw-error", (e) => e.textContent).catch(() => null);
    if (early) throw new Error(`giriş hatası: ${early}`);
    check((await page.locator(".nw-account").textContent()) === "deneme@example.com", "hesap adı gösteriliyor");
    if (shots) await page.screenshot({ path: path.join(shots, "2-parola.png") });
    await page.fill(".nw-input", "yanlış parola");
    await page.click(".nw-primary");
    await page.waitForSelector(".nw-error", { timeout: 30_000 });
    check(/yanlış/i.test((await page.locator(".nw-error").textContent()) ?? ""), "yanlış parola reddediliyor");
    await page.fill(".nw-input", PASS);
    await page.click(".nw-primary");
    await page.waitForSelector(".nw-shade", { state: "detached", timeout: 60_000 });
    await page.getByText("Masaüstü planı").first().waitFor({ timeout: 30_000 });
    check(true, "notlar çözülüp uygulama açıldı; masaüstündeki not görünüyor");
    const brand = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll("img")].filter((i) => i.src.endsWith("logo.png"));
      return { logos: imgs.length, broken: imgs.filter((i) => !i.complete || i.naturalWidth === 0).length, text: document.body.innerText };
    });
    check(brand.logos > 0 && brand.broken === 0, "logo yükleniyor");
    check(brand.text.includes("Origin · Nularche"), "Origin adı Drive'daki klasörün adı (Nularche)");
    if (shots) await page.screenshot({ path: path.join(shots, "3-uygulama.png") });

    // Web'de yeni not: arayüzün kullandığı API ile.
    const created = await page.evaluate(async () => {
      const r = await fetch("/api/nodes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Web notu", parentNodeId: null, body: "tarayıcıda yazıldı" }) });
      return r.status;
    });
    check(created === 201, "web'de not oluşturuldu");
    const end = Date.now() + 15_000;
    let uploaded = false;
    while (!uploaded && Date.now() < end) {
      uploaded = [...fake.files.values()].some((f) => !f.trashed && f.name.endsWith(".nlce") && decryptFile(keys, new Uint8Array(f.data)).rel.endsWith(".md") && decryptFile(keys, new Uint8Array(f.data)).rel.includes("Web"));
      if (!uploaded) await new Promise((r) => setTimeout(r, 200));
    }
    check(uploaded, "yeni not şifreli olarak Drive'a gönderildi");
    check(![...fake.files.values()].some((f) => f.name.includes("Web notu") || f.data.toString("latin1").includes("tarayıcıda yazıldı")), "Drive'da not adı ve içeriği açık metin değil");
    const stored = await page.evaluate(async () => {
      const ls = Object.keys(localStorage).join(",");
      const dbs = (await indexedDB.databases?.())?.length ?? 0;
      const caches = (await globalThis.caches?.keys())?.length ?? 0;
      return { ls, dbs, caches };
    });
    check(stored.dbs === 0 && stored.caches === 0 && !/node|note|origin|key/i.test(stored.ls), `tarayıcı depolamasında not ya da anahtar yok (localStorage: ${stored.ls || "boş"})`);
    check(!network.some((p) => p.startsWith("/api/") || p.startsWith("/files/")), "hiçbir /api ya da /files isteği ağa gitmedi");
    check(errors.length === 0, `sayfada hata yok${errors.length ? `: ${errors.join("; ")}` : ""}`);
  } finally {
    await browser.close();
    server.close();
  }
} finally {
  await fake.close();
  await rm(desk, { recursive: true, force: true });
  await rm(out, { recursive: true, force: true });
}
if (failures.length) process.exit(1);
console.log("Web sürümü uçtan uca çalışıyor.");

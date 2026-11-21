// Web sürümünün taşıyıcısını gerçek bir tarayıcıda denetler: service worker sayfanın /api ve /files isteklerini
// sayfadaki API işleyicisine iletir, işleyici bellek içi dosya sisteminde çalışır. fetch, yükleme, canlı olaylar
// (EventSource), <img src="/files/…"> ve sayfa geçişinin ağa bırakılması ayrı ayrı sınanır.
// Görünmez (headless) Chrome kullanır; ekranda pencere açılmaz. Chrome yolu NULARCHE_CHROME ile verilebilir.

import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { build } from "vite";
import { WEB_PLATFORM_ALIASES } from "../../packages/web-platform/src/aliases.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = await mkdtemp(path.join(tmpdir(), "nularche-bridge-"));
const app = path.join(out, "app");
await mkdir(app);

const bundle = (entry: string, fileName: string, format: "es" | "iife") =>
  build({
    configFile: false,
    logLevel: "silent",
    resolve: { alias: WEB_PLATFORM_ALIASES },
    build: { lib: { entry, formats: [format], fileName: () => fileName, name: "nularche" }, outDir: app, emptyOutDir: false, minify: false },
  });
await bundle(path.join(here, "../../packages/web-platform/src/service-worker.ts"), "sw.js", "iife");
await bundle(path.join(here, "bridge-harness.ts"), "harness.js", "es");
await writeFile(path.join(app, "index.html"), '<!doctype html><meta charset="utf-8"><title>bridge</title><script type="module" src="/app/harness.js"></script>');

// Statik sunucu: yalnızca /app altını sunar; /api ve /files ağa gelirse bunu kaydeder (gelmemeli, geçişler hariç).
const network: string[] = [];
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const file = url.pathname === "/app/" ? "index.html" : url.pathname.replace(/^\/app\//, "");
  if (url.pathname.startsWith("/app/") && !file.includes("..")) {
    try {
      const body = await readFile(path.join(app, file));
      res.writeHead(200, { "content-type": file.endsWith(".js") ? "text/javascript" : "text/html", "cache-control": "no-store" });
      return res.end(body);
    } catch {
      // aşağıda 404
    }
  }
  network.push(url.pathname);
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("network");
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = (server.address() as { port: number }).port;
const base = `http://localhost:${port}`;

const browser = await chromium.launch({ headless: true, ...(process.env.NULARCHE_CHROME ? { executablePath: process.env.NULARCHE_CHROME } : { channel: "chrome" }) });
const failures: string[] = [];
const check = (ok: unknown, what: string) => {
  console.log(`${ok ? "✔" : "✘"} ${what}`);
  if (!ok) failures.push(what);
};
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/app/`);
  check((await page.evaluate(() => window.harness)) === "ready", "service worker kuruldu ve sayfa onun denetiminde");

  const result = await page.evaluate(async () => {
    const json = { "content-type": "application/json" };
    const created = await fetch("/api/nodes", { method: "POST", headers: json, body: JSON.stringify({ title: "Web", parentNodeId: null, body: "tarayıcıdan #web" }) });
    const node = await created.json();
    const list = await (await fetch("/api/nodes")).json();
    // Canlı olaylar: bir değişiklikten sonra "change" gelmeli.
    const es = new EventSource("/api/events");
    const changed = new Promise<boolean>((resolve) => {
      es.addEventListener("change", () => resolve(true));
      es.onmessage = (e) => e.data.includes("change") && resolve(true);
      setTimeout(() => resolve(false), 5000);
    });
    await new Promise((r) => (es.onopen = r));
    await fetch(`/api/nodes/${encodeURIComponent(node.id)}`, { method: "PUT", headers: json, body: JSON.stringify({ body: "ikinci", baseRevision: node.revision }) });
    const live = await changed;
    es.close();
    // 1×1 PNG yükle ve <img> ile göster.
    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
    const up = await (await fetch("/api/attachments?name=nokta.png", { method: "POST", body: png })).json();
    const src = `/files/${up.path.split("/").map(encodeURIComponent).join("/")}`;
    const img = new Image();
    const loaded = await new Promise<boolean>((resolve) => {
      img.onload = () => resolve(img.naturalWidth === 1);
      img.onerror = () => resolve(false);
      img.src = src;
    });
    const big = new Uint8Array(4 * 1024 * 1024).fill(5);
    const bigUp = await (await fetch("/api/attachments?name=buyuk.bin", { method: "POST", body: big })).json();
    const back = new Uint8Array(await (await fetch(`/files/${bigUp.path.split("/").map(encodeURIComponent).join("/")}`)).arrayBuffer());
    return { status: created.status, listed: list.nodes.some((n: { title: string }) => n.title === "Web"), live, loaded, bigOk: back.length === big.length && back[back.length - 1] === 5, src };
  });
  check(result.status === 201, "POST /api/nodes işleyiciye ulaştı (201)");
  check(result.listed, "GET /api/nodes yeni notu listeliyor");
  check(result.live, "EventSource /api/events değişikliği canlı bildirdi");
  check(result.loaded, "<img src=/files/…> eki yükledi");
  check(result.bigOk, "4 MB yükleme ve indirme bozulmadan geçti");
  check(!network.some((p) => p.startsWith("/api/") || p.startsWith("/files/")), "hiçbir /api ya da /files isteği ağa gitmedi");

  // Sayfa geçişi (adres çubuğundan açılan /files) işleyiciye değil ağa gider.
  const nav = await page.goto(`${base}${result.src}`);
  check(nav?.status() === 404 && network.some((p) => p.startsWith("/files/")), "sayfa geçişi ağa bırakıldı");
  check(errors.length === 0, `sayfada hata yok${errors.length ? `: ${errors.join("; ")}` : ""}`);
} finally {
  await browser.close();
  server.close();
  await rm(out, { recursive: true, force: true });
}
if (failures.length) process.exit(1);
console.log("Web taşıyıcısı tarayıcıda çalışıyor.");

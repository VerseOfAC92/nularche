// Web sürümünü uçtan uca, görünmez (headless) Chrome'da denetler: giriş penceresi, şifreli Origin için parola
// (yanlış ve doğru), notların Drive'dan belleğe inmesi, uygulama arayüzünün açılması, aynı Google oturumuyla Google
// Takvim'in kendiliğinden bağlanıp etkinliklerin Takvim ekranında görünmesi, web'de yapılan değişikliğin şifreli olarak
// Drive'a gitmesi ve hiçbir notun ağa ya da tarayıcı depolamasına yazılmaması. Google yerine sahte Drive ve Takvim
// kullanılır; derleme, service worker ve uygulama üretimdekiyle aynıdır. `--shots <klasör>` ekran görüntülerini kaydeder.

import { createServer, request as httpRequest, type Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { GoogleDrive } from "../../packages/core/src/drive-google.ts";
import { decryptFile, deriveKeys, keyCheck, newSalt, syncOrigin } from "../../packages/core/src/drive-sync.ts";
import { NodeStore } from "../../packages/core/src/node-store.ts";
import { startFakeDrive } from "../../packages/core/test/fake-drive.ts";
import { startFakeGoogleCalendar } from "../../packages/core/test/fake-google-calendar.ts";
import { buildWeb } from "../build-web.ts";
import { APP_HEADERS } from "../site-headers.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const shotsArg = process.argv.indexOf("--shots");
const shots = shotsArg > 0 ? path.resolve(process.argv[shotsArg + 1]) : null;
const PASS = "mor dağlarda uzun bir yürüyüş";
const PASS_JS = PASS;

// 1. Masaüstü uygulaması gibi: şifreli kök ve bir not.
const fake = await startFakeDrive("deneme@example.com");
const cal = await startFakeGoogleCalendar("deneme@example.com");
// Sahte Gemini: model listesi ve her isteğe kısa bir metin cevap; gelen anahtar kaydedilir.
const geminiKeys: string[] = [];
const gemini: Server = createServer(async (req, res) => {
  for await (const _ of req);
  geminiKeys.push(String(req.headers["x-goog-api-key"] ?? ""));
  res.setHeader("content-type", "application/json");
  if (req.url?.startsWith("/models?")) return res.end(JSON.stringify({ models: [{ name: "models/gemini-test-flash", supportedGenerationMethods: ["generateContent"] }] }));
  res.end(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "Webden Gemini cevabı." }] }, finishReason: "STOP" }] }));
});
await new Promise<void>((r) => gemini.listen(0, "127.0.0.1", () => r()));
const geminiUrl = `http://127.0.0.1:${(gemini.address() as { port: number }).port}`;
const soon = Date.now() + 3600_000;
cal.events.set("t1", { id: "t1", etag: '"t1"', summary: "Takvim toplantısı", start: { dateTime: new Date(soon).toISOString() }, end: { dateTime: new Date(soon + 1800_000).toISOString() } });
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
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    // Sahte Google hizmetleri aynı kaynaktan (Drive: /fake, Takvim: /fakecal) sunulur.
    const target = url.pathname.startsWith("/fake/")
      ? { prefix: "/fake", base: fake.url }
      : url.pathname.startsWith("/fakecal/")
        ? { prefix: "/fakecal", base: cal.url }
        : url.pathname.startsWith("/fakegemini/")
          ? { prefix: "/fakegemini", base: geminiUrl }
          : null;
    if (target) {
      const to = new URL(target.base);
      const proxied = httpRequest({ host: to.hostname, port: to.port, method: req.method, path: url.pathname.slice(target.prefix.length) + url.search, headers: req.headers }, (r) => {
        const headers = { ...r.headers };
        if (headers.location) headers.location = headers.location.replace(target.base, `http://${req.headers.host}${target.prefix}`);
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
        // Yayındaki /app başlıklarıyla (CSP dahil): kurallar uygulamayı ya da Google bağlantılarını engellememeli.
        res.writeHead(200, { "content-type": type, "cache-control": "no-store", ...Object.fromEntries(APP_HEADERS) });
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
    // Tek tarayıcı bağlamı: yeni sekmeler aynı depolamayı (IndexedDB) paylaşır, sekmenin oturum belleği ayrıdır.
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "tr-TR" });
    const page = await ctx.newPage();
    const errors: string[] = [];
    const csp: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => /Content Security Policy|Refused to (load|connect|execute|apply|frame)/i.test(m.text()) && csp.push(m.text()));
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

    // Google Takvim: aynı oturumla kendiliğinden bağlandı, birincil takvim Takvim ekranında.
    const calStatus = await page.evaluate(async () => {
      const s = await window.nularcheWeb!.calendar.calendarStatus();
      return { google: s.accounts.google ?? null, links: s.links.map((l) => [l.provider, l.calendarId, l.dbId ?? null]) };
    });
    check(calStatus.google === "deneme@example.com", "Google Takvim hesabı girişle kendiliğinden bağlandı");
    check(calStatus.links.length === 1 && calStatus.links[0][0] === "google" && calStatus.links[0][1] === "deneme@example.com" && calStatus.links[0][2] === null, "birincil takvim görüntülemeye eklendi");
    await page.getByText("Takvim", { exact: true }).first().click();
    await page.getByText("Takvim toplantısı").first().waitFor({ timeout: 15_000 });
    check(true, "Google Takvim'deki etkinlik Takvim ekranında görünüyor");
    if (shots) await page.screenshot({ path: path.join(shots, "4-takvim.png") });
    const added = await page.evaluate(async () => {
      const c = window.nularcheWeb!.calendar;
      const view = (await c.calendarEvents()).calendars.find((v) => v.provider === "google")!;
      const start = Date.now() + 2 * 86_400_000;
      const r = await c.calendarEventSave(view.id, null, { title: "Webden etkinlik", when: { allDay: false, start, end: start + 3600_000 } });
      return r.ok;
    });
    check(added && [...cal.events.values()].some((e) => e.summary === "Webden etkinlik"), "web'den eklenen etkinlik Google Takvim'e yazıldı");

    // Ayarlar → Notlar ve Origin: Google Drive bağlı olarak görünür.
    await page.getByText("Ayarlar", { exact: true }).first().click();
    await page.getByText("Notlar ve Origin", { exact: true }).first().click();
    const driveCard = page.getByTestId("web-drive");
    await driveCard.waitFor({ timeout: 10_000 });
    check(/deneme@example\.com/.test((await driveCard.textContent()) ?? "") && /Uçtan uca şifreli/.test((await driveCard.textContent()) ?? ""), "Ayarlar'da Google Drive bağlı ve şifreli görünüyor");
    if (shots) await page.screenshot({ path: path.join(shots, "5-ayarlar-drive.png") });
    await page.keyboard.press("Escape");

    // Nularche AI (Gemini): anahtar Ayarlar'da girilir, istek tarayıcıda işlenir, cevap pencerede görünür.
    await page.getByText("Ayarlar", { exact: true }).first().click();
    await page.getByRole("tab", { name: "Yapay zekâ" }).click();
    await page.getByPlaceholder(/Anahtarı buraya yapıştırın/).fill("AIza-web-test");
    await page.getByRole("button", { name: "Kaydet", exact: true }).click();
    await page.getByText("Otomatik mod açık", { exact: true }).waitFor({ timeout: 10_000 });
    check(geminiKeys.includes("AIza-web-test"), "Gemini anahtarı doğrulandı");
    if (shots) await page.screenshot({ path: path.join(shots, "6-yapay-zeka.png") });
    await page.keyboard.press("Escape");
    await page.getByText("Masaüstü planı").first().click();
    await page.locator(".claude-btn").click();
    await page.getByRole("button", { name: /Düzelt/ }).click();
    await page.getByText("Webden Gemini cevabı.").first().waitFor({ timeout: 20_000 });
    check(true, "Nularche AI isteği Gemini ile tarayıcıda işlendi ve cevap göründü");
    if (shots) await page.screenshot({ path: path.join(shots, "7-nularche-ai.png") });
    await page.locator(".nai-panel .icon-btn").last().click().catch(() => undefined);

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
      const values = Object.keys(localStorage).map((k) => localStorage.getItem(k) ?? "").join("\n") + document.cookie;
      const dbs = (await indexedDB.databases?.())?.length ?? 0;
      const caches = (await globalThis.caches?.keys())?.length ?? 0;
      return { ls, dbs, caches, values };
    });
    check(!stored.values.includes("AIza-web-test") && !stored.values.includes("web-token") && !stored.values.includes(PASS), "Gemini anahtarı, Google belirteci ve parola tarayıcı depolamasında ya da çerezde yok");
    check(stored.dbs === 0 && stored.caches === 0 && !/node|note|origin|key/i.test(stored.ls), `tarayıcı depolamasında not ya da anahtar yok (localStorage: ${stored.ls || "boş"})`);
    check(!network.some((p) => p.startsWith("/api/") || p.startsWith("/files/")), "hiçbir /api ya da /files isteği ağa gitmedi");
    check(errors.length === 0, `sayfada hata yok${errors.length ? `: ${errors.join("; ")}` : ""}`);
    check(csp.length === 0, `güvenlik kuralı (CSP) ihlali yok${csp.length ? `: ${csp.slice(0, 3).join(" | ")}` : ""}`);

    // Kilitle: bekleyen değişiklik gönderilir, bellek silinir, Nularche kilit ekranı gelir (Google'a yeniden girilmez).
    check(await page.getByTestId("web-session").isVisible(), "kenar çubuğunda Kilitle ve Çıkış düğmeleri var");
    await page.evaluate(async () => {
      await fetch("/api/nodes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Kilit öncesi", parentNodeId: null, body: "hemen kilitlendi" }) });
    });
    await page.getByTestId("web-session").getByText("Kilitle").click();
    await page.waitForSelector(".nw-lockscreen .nw-input", { timeout: 20_000 });
    check(true, "kilitleyince Nularche kilit ekranı geliyor (Google girişi istenmiyor)");
    check(
      [...fake.files.values()].some((f) => !f.trashed && f.name.endsWith(".nlce") && decryptFile(keys, new Uint8Array(f.data)).rel.includes("Kilit")),
      "kilitlemeden hemen önceki değişiklik Drive'a gönderildi",
    );
    check(await page.evaluate(() => !("nularcheWeb" in window)), "kilitliyken sayfada oturum ve not kalmadı");
    const held = await page.evaluate(() => Object.keys(sessionStorage).map((k) => sessionStorage.getItem(k) ?? "").join("\n"));
    check(!held.includes(PASS_JS) && !held.includes("Masaüstü planı"), "kilitliyken sekmede yalnızca erişim izni duruyor (parola ve not yok)");
    await page.fill(".nw-lockscreen .nw-input", "yanlış parola");
    await page.click(".nw-lockscreen .nw-primary");
    await page.waitForSelector(".nw-lockscreen .nw-error", { timeout: 30_000 });
    check(/yanlış/i.test((await page.locator(".nw-lockscreen .nw-error").textContent()) ?? ""), "kilit ekranında yanlış parola reddediliyor");
    await page.fill(".nw-lockscreen .nw-input", PASS_JS);
    await page.click(".nw-lockscreen .nw-primary");
    await page.getByText("Kilit öncesi").first().waitFor({ timeout: 60_000 });
    check(true, "parolayla kilit açıldı, notlar Google'a girmeden geri geldi");
    check(await page.evaluate(() => sessionStorage.length === 0), "kilit açılınca sekmede devredilen izin de kalmadı");

    // Sekme kapatılınca her şey gider: aynı tarayıcıda yeni sekme giriş penceresiyle açılır.
    const tab2 = await page.context().newPage();
    await tab2.goto(`${base}/app/`);
    await tab2.waitForSelector(".nw-google");
    check(!(await tab2.locator(".nw-lockscreen").count()), "güvenilmeyen tarayıcıda yeni sekme hiçbir şey hatırlamıyor (giriş penceresi)");
    await tab2.close();

    // Bu tarayıcıya güven: notların şifreli kopyası tarayıcıda; yeni sekmede kilit ekranından Drive beklenmeden açılır.
    page.on("dialog", (d) => void d.accept());
    await page.getByText("Ayarlar", { exact: true }).first().click();
    await page.getByRole("tab", { name: "Güvenlik" }).click();
    // Onay penceresinden ve şifreli kopya yazılınca işaretlenir (kontrollü kutu): tıkla ve oturumda güveni bekle.
    await page.getByTestId("web-trust").click();
    await page.waitForFunction(() => window.nularcheWeb?.trusted(), undefined, { timeout: 20_000 });
    await page.keyboard.press("Escape");
    await page.evaluate(async () => {
      await fetch("/api/nodes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Güven sonrası", parentNodeId: null, body: "yerel kopyada" }) });
    });
    await page.waitForTimeout(1500);
    const idb = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const r = indexedDB.open("nularche-trusted");
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      const all = await new Promise<{ id: string; data: ArrayBuffer }[]>((res) => {
        const r = db.transaction("files").objectStore("files").getAll();
        r.onsuccess = () => res(r.result);
      });
      db.close();
      const text = all.map((x) => new TextDecoder("latin1").decode(x.data) + x.id).join("");
      return { count: all.length, leaks: ["Masaüstü planı", "Güven sonrası", "yerel kopyada", "Masa"].some((w) => text.includes(w)) };
    });
    check(idb.count > 0 && !idb.leaks, `güvenilen kopya tarayıcıda şifreli (${idb.count} kayıt, adlar ve içerik okunamıyor)`);
    const tab3 = await page.context().newPage();
    const errors3: string[] = [];
    // Bu sekmenin Google Drive istekleri (sahte Drive /fake altında); ilk sekme kendi eşitlemesini sürdürür.
    const driveCalls: string[] = [];
    tab3.on("request", (r) => r.url().includes("/fake/") && driveCalls.push(r.url()));
    tab3.on("pageerror", (e) => errors3.push(e.message));
    await tab3.goto(`${base}/app/`);
    await tab3.waitForSelector(".nw-lockscreen .nw-input", { timeout: 20_000 });
    check(/güvenilir/.test((await tab3.locator(".nw-lockscreen").textContent()) ?? ""), "güvenilen tarayıcıda yeni sekme kilit ekranıyla açılıyor");
    await tab3.fill(".nw-lockscreen .nw-input", PASS_JS);
    await tab3.click(".nw-lockscreen .nw-primary");
    await tab3.getByText("Güven sonrası").first().waitFor({ timeout: 60_000 });
    check(true, "notlar Google Drive beklenmeden bu tarayıcıdaki kopyadan geldi");
    check(await tab3.locator(".nw-reauth").isVisible(), "Drive'ı bağlama çubuğu görünüyor");
    check((await tab3.evaluate(() => window.nularcheWeb!.driveConnected())) === false && driveCalls.length === 0, `Google'a bağlanmadan Drive'a hiç istek gitmedi${driveCalls.length ? `: ${driveCalls.length}` : ""}`);
    await tab3.locator(".nw-reauth button").click();
    await tab3.waitForFunction(() => window.nularcheWeb?.driveConnected() && window.nularcheWeb.driveStatus().state === "idle", undefined, { timeout: 30_000 });
    check(true, "Bağlan'a basınca Drive bağlandı ve eşitlendi");
    check(errors3.length === 0, `yeni sekmede hata yok${errors3.length ? `: ${errors3.join("; ")}` : ""}`);

    // Çıkış: güvenilen kopya da silinir.
    tab3.on("dialog", (d) => void d.accept());
    await tab3.getByTestId("web-session").getByText("Çıkış yap").click();
    await tab3.waitForSelector(".nw-google", { timeout: 20_000 });
    const left = await tab3.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
    check(!left.includes("nularche-trusted"), "çıkış yapınca bu tarayıcıdaki kopya silindi");
    await tab3.close();
  } finally {
    await browser.close();
    server.close();
  }
} finally {
  await fake.close();
  await cal.close();
  gemini.close();
  await rm(desk, { recursive: true, force: true });
  await rm(out, { recursive: true, force: true });
}
if (failures.length) process.exit(1);
console.log("Web sürümü uçtan uca çalışıyor.");

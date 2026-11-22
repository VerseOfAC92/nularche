// Web sürümünün üretim girişini (Google ile oturum açma) görünmez Chrome'da denetler. Google'ın oturum açma betiği
// (GIS) yerine bir taklit konur; Drive ve Takvim istekleri gerçek www.googleapis.com adreslerine gider ve sahte
// sunuculara yönlendirilir (yayındaki güvenlik kuralları gerçek adreslerle sınanır). Denetlenenler:
//  - Google penceresi tıklamayla aynı anda açılır (Safari başka türlü engeller),
//  - Drive izni verilmezse kullanıcının dilinde (Türkçe ve İngilizce) anlaşılır bir mesaj çıkar,
//  - Apple Takvim için form yerine neden web'de kullanılamadığı yazar,
//  - erişim izninin süresi dolup tarayıcı yenileme penceresini engellerse "Yenile" çubuğu çıkar, tıklayınca bekleyen
//    eşitleme sürer.

import { createServer, request as httpRequest } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, type Page, type Route } from "playwright-core";
import { GoogleDrive } from "../../packages/core/src/drive-google.ts";
import { syncOrigin } from "../../packages/core/src/drive-sync.ts";
import { NodeStore } from "../../packages/core/src/node-store.ts";
import { startFakeDrive } from "../../packages/core/test/fake-drive.ts";
import { startFakeGoogleCalendar } from "../../packages/core/test/fake-google-calendar.ts";
import { buildWeb } from "../build-web.ts";
import { APP_HEADERS } from "../site-headers.ts";

const ALL = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly";

const fake = await startFakeDrive("deneme@example.com");
const cal = await startFakeGoogleCalendar("deneme@example.com");
const desk = await mkdtemp(path.join(tmpdir(), "nularche-desk-"));
const out = await mkdtemp(path.join(tmpdir(), "nularche-web-"));
const failures: string[] = [];
const check = (ok: unknown, what: string) => {
  console.log(`${ok ? "✔" : "✘"} ${what}`);
  if (!ok) failures.push(what);
};

try {
  // Masaüstünde oluşturulmuş (şifresiz) bir Origin.
  const d = new GoogleDrive({ clientId: "id", clientSecret: "s", refreshToken: "rt" }, { token: `${fake.url}/token`, api: `${fake.url}/drive/v3`, upload: `${fake.url}/upload/drive/v3` });
  const rootId = await d.createRoot("Nularche");
  const store = new NodeStore(desk);
  await store.ensureRoot();
  await store.create({ title: "Masaüstü planı", parentNodeId: null, body: "Bu not masaüstünde yazıldı." });
  await syncOrigin(desk, d, rootId, { host: "Masaüstü" });

  await buildWeb(out); // üretim girişi (main-web.ts)
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const rel = url.pathname.replace(/^\/app\/?/, "") || "index.html";
    try {
      if (!url.pathname.startsWith("/app/")) throw new Error("dış");
      const body = await readFile(path.join(out, rel));
      const type = rel.endsWith(".js") ? "text/javascript" : rel.endsWith(".css") ? "text/css" : rel.endsWith(".png") ? "image/png" : rel.endsWith(".woff2") ? "font/woff2" : "text/html";
      res.writeHead(200, { "content-type": type, "cache-control": "no-store", ...Object.fromEntries(APP_HEADERS) });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://localhost:${(server.address() as { port: number }).port}`;

  /** www.googleapis.com → sahte Drive / Takvim; yükleme oturumu adresi googleapis'e çevrilir. */
  const forward = async (route: Route) => {
    const url = new URL(route.request().url());
    const calendar = url.pathname.startsWith("/calendar/v3/");
    const target = calendar ? `${cal.url}${url.pathname.slice("/calendar/v3".length)}${url.search}` : `${fake.url}${url.pathname}${url.search}`;
    const t = new URL(target);
    const body = route.request().postDataBuffer();
    const res = await new Promise<{ status: number; headers: Record<string, string>; body: Buffer }>((resolve, reject) => {
      const r = httpRequest({ host: t.hostname, port: t.port, path: t.pathname + t.search, method: route.request().method(), headers: { ...route.request().headers(), host: t.host } }, (resp) => {
        const chunks: Buffer[] = [];
        resp.on("data", (c) => chunks.push(c));
        resp.on("end", () => {
          const headers: Record<string, string> = { "access-control-allow-origin": "*", "access-control-expose-headers": "location" };
          for (const [k, v] of Object.entries(resp.headers)) if (typeof v === "string") headers[k] = k === "location" ? v.replace(fake.url, "https://www.googleapis.com") : v;
          resolve({ status: resp.statusCode ?? 500, headers, body: Buffer.concat(chunks) });
        });
      });
      r.on("error", reject);
      if (body) r.write(body);
      r.end();
    });
    await route.fulfill(res);
  };

  /** Google'ın GIS betiğinin taklidi: pencere açma çağrısının tıklamayla aynı anda yapılıp yapılmadığını kaydeder. */
  const gisStub = (options: { scope: string; expiresIn: number; blockSilent: boolean }) => `
    (() => {
      window.__gis = { calls: [] };
      addEventListener("click", () => { window.__inClick = true; setTimeout(() => (window.__inClick = false)); }, true);
      window.google = { accounts: { oauth2: {
        revoke: (_t, done) => done && done(),
        initTokenClient: (config) => ({
          requestAccessToken: (o = {}) => {
            const inClick = !!window.__inClick && navigator.userActivation.isActive;
            window.__gis.calls.push({ prompt: o.prompt, inClick });
            setTimeout(() => {
              if (!inClick && ${options.blockSilent}) return config.error_callback && config.error_callback({ type: "popup_failed_to_open" });
              config.callback({ access_token: "web-token", expires_in: ${options.expiresIn}, scope: ${JSON.stringify(options.scope)} });
            }, 30);
          },
        }),
      } } };
    })();`;

  const browser = await chromium.launch({ headless: true, ...(process.env.NULARCHE_CHROME ? { executablePath: process.env.NULARCHE_CHROME } : { channel: "chrome" }) });
  const open = async (stub: Parameters<typeof gisStub>[0]): Promise<{ page: Page; csp: string[]; errors: string[] }> => {
    const context = await browser.newContext({ locale: "tr-TR" });
    await context.route("https://www.googleapis.com/**", forward);
    const page = await context.newPage();
    const csp: string[] = [];
    const errors: string[] = [];
    page.on("console", (m) => /Content Security Policy|Refused to/i.test(m.text()) && csp.push(m.text()));
    page.on("pageerror", (e) => errors.push(e.message));
    if (process.env.NULARCHE_DEBUG) {
      page.on("console", (m) => console.log("console:", m.text()));
      page.on("pageerror", (e) => console.log("pageerror:", e.message));
      page.on("close", () => console.log("sayfa kapandı"));
      page.on("crash", () => console.log("sayfa çöktü"));
    }
    await page.addInitScript(gisStub(stub));
    await page.goto(`${base}/app/`);
    await page.waitForSelector(".nw-google:not([disabled])");
    return { page, csp, errors };
  };
  try {
    // 1. Drive izni verilmezse
    {
      const { page } = await open({ scope: "https://www.googleapis.com/auth/calendar.events", expiresIn: 3600, blockSilent: false });
      await page.click(".nw-google");
      await page.waitForSelector(".nw-error");
      check(/Google Drive izni gerekli/.test((await page.locator(".nw-error").textContent()) ?? ""), "Drive izni verilmezse Türkçe ve anlaşılır mesaj çıkıyor");
      check((await page.locator(".nw-tagline").textContent()) === "Notlarınız, her yerden.", "slogan: Notlarınız, her yerden.");
      await page.context().close();
    }
    // 1b. Uyarılar seçilen dilde: İngilizce arayüzde Drive izni mesajı İngilizce.
    {
      const { page } = await open({ scope: "https://www.googleapis.com/auth/calendar.events", expiresIn: 3600, blockSilent: false });
      await page.click(".nw-lang");
      await page.click(".nw-google");
      await page.waitForSelector(".nw-error");
      const text = (await page.locator(".nw-error").textContent()) ?? "";
      check(/needs Google Drive access/.test(text) && !/[ığşİ]/.test(text), "İngilizce seçiliyken uyarı İngilizce (Türkçe karakter yok)");
      await page.context().close();
    }
    // 2. Giriş: pencere tıklamayla aynı anda; notlar açılır; süre dolunca "Yenile" çubuğu.
    const { page, csp, errors } = await open({ scope: ALL, expiresIn: 66, blockSilent: true });
    await page.click(".nw-google");
    await page.waitForSelector(".nw-shade", { state: "detached", timeout: 60_000 });
    const first = await page.evaluate(() => (window as unknown as { __gis: { calls: { prompt: string; inClick: boolean }[] } }).__gis.calls[0]);
    check(first?.prompt === "select_account" && first.inClick, "Google penceresi tıklamayla aynı anda açılıyor (Safari engellemez)");
    await page.getByText("Masaüstü planı").first().waitFor({ timeout: 30_000 });
    check(true, "gerçek googleapis adresleriyle notlar açıldı");
    const calOk = await page.evaluate(async () => (await window.nularcheWeb!.calendar.calendarStatus()).accounts.google === "deneme@example.com");
    check(calOk, "Google Takvim aynı girişle bağlandı");
    // Apple Takvim tarayıcıdan bağlanamaz: form yerine nedeni (seçilen dilde) gösterilir.
    await page.getByText("Ayarlar", { exact: true }).first().click();
    await page.getByRole("tab", { name: "Takvim" }).click();
    const apple = page.getByTestId("cal-apple-web");
    await apple.waitFor({ timeout: 10_000 });
    check(/masaüstü uygulamasında bağlayın/.test((await apple.textContent()) ?? "") && !(await page.getByPlaceholder(/Apple/).count()), "web'de Apple Takvim formu yerine açıklama var");
    await page.keyboard.press("Escape");
    // Kilitle → Nularche kilit ekranı; açınca Google penceresi açılmaz (devredilen izin kullanılır).
    const before = await page.evaluate(() => (window as unknown as { __gis: { calls: unknown[] } }).__gis.calls.length);
    await page.getByTestId("web-session").getByText("Kilitle").click();
    await page.waitForSelector(".nw-lockscreen .nw-primary", { timeout: 20_000 });
    const gisAfterReload = await page.evaluate(() => (window as unknown as { __gis: { calls: unknown[] } }).__gis.calls.length);
    await page.click(".nw-lockscreen .nw-primary");
    await page.getByText("Masaüstü planı").first().waitFor({ timeout: 30_000 });
    const lockCalls = await page.evaluate(() => (window as unknown as { __gis: { calls: { prompt: string; inClick: boolean }[] } }).__gis.calls);
    // Bu denetimde erişim izni birkaç saniyede dolar: kilit ekranındaki tıklama onu hesap seçtirmeden yeniler (prompt "").
    check(
      before > 0 && gisAfterReload === 0 && !lockCalls.some((c) => c.prompt === "select_account") && lockCalls.every((c) => c.inClick),
      `kilit açılırken Google hesap seçimi istenmedi; yalnızca süresi dolan izin tıklamayla yenilendi (${lockCalls.length} yenileme)`,
    );

    // Erişim izninin süresi dolar (66 sn − 60 sn pay): bir sonraki Drive isteği sessiz yenileme ister, tarayıcı engeller.
    await page.waitForTimeout(6500);
    await page.evaluate(async () => {
      await fetch("/api/nodes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Yenileme sonrası", parentNodeId: null, body: "x" }) });
    });
    await page.waitForSelector(".nw-reauth", { timeout: 15_000 });
    check(/Google oturumunun yenilenmesi/.test((await page.locator(".nw-reauth").textContent()) ?? ""), "süre dolunca 'Yenile' çubuğu çıkıyor");
    await page.locator(".nw-reauth button").click();
    const end = Date.now() + 15_000;
    let uploaded = false;
    while (!uploaded && Date.now() < end) {
      uploaded = [...fake.files.values()].some((f) => !f.trashed && f.name.startsWith("Yenileme"));
      if (!uploaded) await page.waitForTimeout(200);
    }
    const calls = await page.evaluate(() => (window as unknown as { __gis: { calls: { prompt: string; inClick: boolean }[] } }).__gis.calls);
    check(calls.some((c) => c.prompt === "" && c.inClick), "'Yenile' tıklaması pencereyi tıklamayla aynı anda açıyor");
    check(uploaded, "yenilemeden sonra bekleyen not Drive'a gönderildi");
    check(csp.length === 0, `güvenlik kuralı (CSP) ihlali yok${csp.length ? `: ${csp.slice(0, 3).join(" | ")}` : ""}`);
    check(errors.length === 0, `sayfada hata yok${errors.length ? `: ${errors.join("; ")}` : ""}`);
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
if (failures.length) process.exit(1);
console.log("Google ile giriş (üretim girişi) çalışıyor.");

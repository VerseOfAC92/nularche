// Masaüstü uygulamasının uçtan uca duman testi (Playwright + Electron).
// Sahte bir ev klasörü kullanır: gerçek Claude/ChatGPT/Gemini ayarlarına dokunmaz.
// Akış: ilk açılış sihirbazı → ChatGPT seç → Bağla (sahte ~/.codex/config.toml) → AI aracı
// MCP ile bağlanınca "✓ Bağlandı" bildirimi → Nularche AI penceresi.
// Kullanım: node scripts/e2e-desktop.ts [--shots <klasör>]
// Not: paketli uygulamada Electron fuse'ları (Node inspector kapalı) Playwright'ın bağlanmasını
// engellediği için test kaynak koddan çalıştırılır.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createServer } from "node:http";
import { _electron as electron } from "playwright-core";
import { projectRoot } from "../packages/core/src/config.ts";

const arg = (n: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : undefined);
const root = projectRoot();
const work = await mkdtemp(path.join(tmpdir(), "nularche-e2e-"));
const home = path.join(work, "home");
const userData = path.join(work, "ud");
const origin = path.join(work, "origin");
const shots = arg("--shots");
await mkdir(path.join(userData, "config"), { recursive: true });
await mkdir(origin, { recursive: true });
await writeFile(path.join(userData, "config", "settings.json"), JSON.stringify({ originDir: origin }));
if (shots) await mkdir(shots, { recursive: true });

// Sahte Gemini sunucusu: model listesi + önce update_node çağrısı, sonra metin cevap.
let geminiCalls = 0;
const systems: string[] = [];
const gemini = createServer(async (req, res) => {
  let raw = "";
  for await (const c of req) raw += c;
  res.setHeader("content-type", "application/json");
  if (req.url?.startsWith("/models?")) {
    return res.end(
      JSON.stringify({
        models: [
          { name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent"] },
          { name: "models/gemini-3.6-flash", supportedGenerationMethods: ["generateContent"] },
        ],
      }),
    );
  }
  // En yeni model sürekli "yüksek talep" (503) verir; Nularche eski modele geçmeli.
  if (req.url?.includes("gemini-3.8-flash")) {
    res.statusCode = 503;
    return res.end(JSON.stringify({ error: { message: "This model is currently experiencing high demand." } }));
  }
  geminiCalls++;
  const body = JSON.parse(raw);
  systems.push(body.systemInstruction?.parts?.[0]?.text ?? "");
  const text: string = body.contents[0].parts[0].text;
  if (body.contents.length === 1) {
    const id = /id: ([\w-]+), revision: (\w+)/.exec(text)!;
    return res.end(
      JSON.stringify({
        candidates: [
          {
            content: {
              role: "model",
              parts: [
                { functionCall: { name: "update_node", args: { node: id[1], body: "Gemini tarafından düzeltilmiş içerik", base_revision: id[2] } } },
              ],
            },
          },
        ],
      }),
    );
  }
  res.end(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "İçeriği düzelttim." }] }, finishReason: "STOP" }] }));
});
await new Promise<void>((r) => gemini.listen(0, "127.0.0.1", () => r()));
const geminiUrl = `http://127.0.0.1:${(gemini.address() as { port: number }).port}`;

const app = await electron.launch({
  executablePath: path.join(root, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"),
  // Sistem dilinden bağımsız olsun: ilk açılış Türkçe, sonra Ayarlar'dan İngilizceye geçilir.
  args: [root, "--lang=tr"],
  env: { ...process.env, HOME: home, NULARCHE_USER_DATA: userData, NULARCHE_E2E: "1", NULARCHE_GEMINI_API: geminiUrl },
});
const page = await app.firstWindow();
app.process().stderr?.on("data", (d) => process.env.E2E_VERBOSE && process.stderr.write(d));
page.on("console", (m) => process.env.E2E_VERBOSE && m.type() === "error" && console.error("[sayfa]", m.text()));
const shot = async (name: string) => shots && (await page.screenshot({ path: path.join(shots, `${name}.png`) }));

try {
  await page.getByText("Nularche'ye hoş geldiniz").waitFor({ timeout: 20_000 });
  await shot("1-hosgeldiniz");
  await page.getByRole("button", { name: "İleri" }).click();
  await page.getByRole("button", { name: /ChatGPT/ }).click();
  await page.getByText("ChatGPT uygulamasını açın").waitFor();
  await shot("2-chatgpt-secildi");
  await page.locator(".ai-howto").scrollIntoViewIfNeeded();
  await page.getByText("Nasıl bağlanır ve nasıl kullanılır?").waitFor();
  await shot("2b-rehber");
  await page.getByRole("button", { name: "Bağla", exact: true }).click();
  await page.getByText("Bağlantı kurulu").waitFor({ timeout: 10_000 });
  const toml = await readFile(path.join(home, ".codex/config.toml"), "utf8");
  assert.match(toml, /\[mcp_servers\.nularche\]/);
  assert.match(toml, /NULARCHE_ORIGIN = ".*origin"/);
  await shot("3-baglanti-yazildi");

  // AI aracını taklit et: config.toml'daki komutla MCP sunucusunu başlatıp "codex" olarak bağlan.
  const entry = toml.match(/command = "(.*)"\nargs = \[ "(.*)" \]/);
  assert.ok(entry, toml);
  const client = new Client({ name: "codex-mcp-client", version: "1.0" });
  await client.connect(
    new StdioClientTransport({
      command: entry[1],
      args: [entry[2]],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", NULARCHE_ORIGIN: origin } as Record<string, string>,
    }),
  );
  await page.getByText("✓ ChatGPT bağlandı").first().waitFor({ timeout: 10_000 });
  await shot("4-baglandi");
  await page.getByRole("button", { name: "İleri" }).click();
  await page.getByRole("button", { name: "Başla" }).click();
  await page.locator(".nai-panel").waitFor();
  await shot("5-nularche-ai");
  await client.close();

  // Otomatik mod: Gemini anahtarı → Nularche AI isteği arka planda işlenir, cevap pencerede görünür.
  await page.locator(".nai-panel .icon-btn").click(); // küçült
  await page.locator(".sidebar-foot .side-btn").last().click(); // Ayarlar
  await page.getByPlaceholder(/Anahtarı buraya yapıştırın/).fill("AIza-test-anahtari");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await page.getByText("✓ Otomatik mod açık").waitFor({ timeout: 10_000 });
  await shot("6-otomatik-mod");
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: /Yeni Arche/ })
    .first()
    .click();
  // Uzun başlık kesilmemeli: alan satır kaydırıp büyümeli.
  const longTitle = "Microsoft Identity & Communication Infrastructure: ADFS, WAP, ADRMS, Skype for Business and Teams";
  await page.locator(".title-input").fill(longTitle);
  const box = await page.locator(".title-input").evaluate((el: HTMLTextAreaElement) => ({
    h: el.clientHeight,
    sh: el.scrollHeight,
    w: el.clientWidth,
    sw: el.scrollWidth,
    line: parseFloat(getComputedStyle(el).lineHeight),
  }));
  assert.ok(box.h > box.line * 1.5, `başlık alt satıra geçmedi: ${JSON.stringify(box)}`);
  assert.ok(box.sh <= box.h + 1 && box.sw <= box.w + 1, `başlık kesildi: ${JSON.stringify(box)}`);
  await shot("6b-uzun-baslik");
  await page.locator(".title-input").fill("Test notu");
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("hatalı içerik");
  await page.waitForTimeout(1200);
  await page.locator(".claude-btn").click();
  await page.getByRole("button", { name: /Düzelt/ }).click();
  await page.getByText("İçeriği düzelttim.").waitFor({ timeout: 15_000 });
  await page.getByText("Gemini tarafından düzeltilmiş içerik").first().waitFor({ timeout: 10_000 });
  await page.getByText("gemini-3.6-flash", { exact: false }).first().waitFor({ timeout: 5_000 });
  assert.equal(geminiCalls, 2);
  await shot("7-otomatik-cevap");
  await page.locator(".nai-head").screenshot({ path: shots ? path.join(shots, "7b-baslik.png") : path.join(work, "baslik.png") });

  // Sohbet geçmişini temizle: onay penceresi kabul edilir, geçmiş boşalır, not değişmez.
  page.once("dialog", (d) => void d.accept());
  await page.getByTitle("Sohbet geçmişini temizle").click();
  await page.getByText("Merhaba! Bir Node açıp").waitFor({ timeout: 5_000 });
  await page.getByText("Gemini tarafından düzeltilmiş içerik").first().waitFor();
  await shot("8-gecmis-temizlendi");
  assert.match(systems.at(-1)!, /reply to the user in Turkish/);

  // Nularche AI penceresi başlığından sürüklenir; konum kalıcıdır, çift tıklayınca yerine döner.
  const head = page.locator(".nai-head");
  const before = (await page.locator(".nai-panel").boundingBox())!;
  const hb = (await head.boundingBox())!;
  await page.mouse.move(hb.x + 60, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x - 240, hb.y - 120, { steps: 8 });
  await page.mouse.up();
  const after = (await page.locator(".nai-panel").boundingBox())!;
  assert.ok(Math.abs(after.x - (before.x - 300)) < 3 && Math.abs(after.y - (before.y - 120 - hb.height / 2)) < 3, `sürüklenmedi: ${JSON.stringify({ before, after })}`);
  assert.ok(await page.evaluate(() => localStorage.getItem("nlc-nai-pos")), "konum kaydedilmedi");
  // Görüş alanının dışına taşınamaz.
  await page.mouse.move(after.x + 60, after.y + 15);
  await page.mouse.down();
  await page.mouse.move(-500, -500, { steps: 4 });
  await page.mouse.up();
  const clamped = (await page.locator(".nai-panel").boundingBox())!;
  assert.ok(clamped.x >= 7 && clamped.y >= 7, `pencere dışarı taştı: ${JSON.stringify(clamped)}`);
  await shot("9-surukle");
  await head.dblclick({ position: { x: 60, y: hb.height / 2 } });
  const reset = (await page.locator(".nai-panel").boundingBox())!;
  assert.ok(Math.abs(reset.x - before.x) < 2 && Math.abs(reset.y - before.y) < 2, "çift tıklama konumu sıfırlamadı");

  // Dil: Ayarlar → English; arayüz, kayıtlı ayar ve yapay zekâ cevap dili İngilizceye geçer.
  await page.locator(".sidebar-foot .side-btn").last().click();
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByRole("heading", { name: "Settings" }).waitFor({ timeout: 5_000 });
  await page.getByRole("heading", { name: "Appearance" }).waitFor();
  await shot("10-settings-en");
  await page.waitForTimeout(300);
  const saved = JSON.parse(await readFile(path.join(userData, "config", "settings.json"), "utf8"));
  assert.equal(saved.language, "en");
  await page.getByRole("button", { name: "Close" }).first().click();
  await page.getByPlaceholder("What should Gemini do?").fill("Fix this note");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelectorAll(".nai-reply").length >= 1, undefined, { timeout: 15_000 });
  await page.getByRole("button", { name: /Fix/ }).first().waitFor();
  await page.waitForTimeout(500);
  assert.match(systems.at(-1)!, /reply to the user in English/);
  await shot("11-nai-en");

  // Tema: varsayılan "sistem" ve işletim sisteminin koyu/açık temasını anında izler; seçim ayarlara kaydedilir.
  const themeNow = () => page.evaluate(() => document.documentElement.dataset.theme);
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  await page.locator(".sidebar-foot .side-btn").last().click();
  assert.equal(await page.locator(".segmented button.on").first().textContent(), "System (automatic)");
  await page.getByRole("button", { name: "Light", exact: true }).click();
  assert.equal(await themeNow(), "light");
  await shot("12-light");
  await page.waitForTimeout(300);
  assert.equal(JSON.parse(await readFile(path.join(userData, "config", "settings.json"), "utf8")).theme, "light");
  await page.emulateMedia({ colorScheme: "dark" });
  assert.equal(await themeNow(), "light", "elle seçilen tema sistem değişince bozulmamalı");
  await page.getByRole("button", { name: "System (automatic)", exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  await page.getByRole("button", { name: "Close" }).first().click();

  // Şablon galerisi: hazır "Görev panosu" şablonu veritabanı olarak oluşur; pano ve satırlar görünür.
  await page.locator(".side-btn", { hasText: "Templates" }).click();
  await page.locator(".tpl-card", { hasText: "Task board" }).click();
  await page.locator(".db .board-card").first().waitFor({ timeout: 10_000 });
  assert.equal(await page.locator(".title-input").inputValue(), "Task board");
  assert.ok((await page.locator(".db .board-card").count()) >= 2);
  // Yeni satır ekle ve tablo görünümünde durumunu seç.
  await page.locator(".db-tab", { hasText: "Table" }).click();
  await page.locator(".db-new-row").first().click();
  await page.locator(".title-cell input").first().fill("E2E satırı");
  await page.keyboard.press("Enter");
  await page.locator(".row-title", { hasText: "E2E satırı" }).waitFor({ timeout: 5_000 });
  await shot("13-veritabani");

  // Çöp: veritabanını sil, Çöp'te gör, geri getir. (Nularche AI penceresi menüyü örtmesin diye küçültülür.)
  if (await page.locator(".nai-panel").count()) await page.locator(".nai-panel .icon-btn").last().click();
  page.once("dialog", (d) => void d.accept());
  await page.locator(".topbar .icon-btn", { hasText: "⋯" }).click();
  await page.locator(".menu-pop button.danger").click();
  await page.locator(".side-btn", { hasText: "Trash" }).click();
  await page.locator(".trash-row", { hasText: "Task board" }).waitFor({ timeout: 5_000 });
  assert.match((await page.locator(".trash-row", { hasText: "Task board" }).textContent()) ?? "", /subpages/);
  await shot("14-cop");
  await page.locator(".trash-row", { hasText: "Task board" }).getByRole("button", { name: /Restore/ }).click();
  await page.locator(".trash-none").waitFor({ timeout: 5_000 });
  const restored = await page.evaluate(async () => (await (await fetch("/api/nodes")).json()).nodes.filter((n: { title: string }) => n.title === "Task board" || n.title === "E2E satırı").map((n: { path: string }) => n.path));
  assert.equal(restored.length, 2, `geri gelenler: ${restored}`);

  // 1.5: uygulama menüsü Biçim ve Görüntü menülerini içerir.
  const menus = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.map((i) => i.label) ?? []);
  assert.ok(menus.includes("Format") && menus.includes("View"), `menüler: ${menus}`);

  // 1.5: manzara arka planı açıkken satırlar 1.0'daki gibi pencere genişliğine uyar.
  const note = await page.evaluate(async () => {
    const res = await fetch("/api/nodes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Genişlik", parentNodeId: null, body: "Uzun bir paragraf. ".repeat(60) }) });
    await fetch("/api/prefs", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ writingBg: { kind: "scene", id: "lavender" }, writingBgEverywhere: true }) });
    return (await res.json()).id as string;
  });
  await page.evaluate((id) => (location.hash = id), note);
  await page.reload();
  await page.locator(".main.has-bg .ProseMirror").waitFor({ timeout: 10_000 });
  const pageWidth = async (w: number) => {
    await app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0].setSize(w, 860), w);
    await page.waitForTimeout(400);
    return page.evaluate(() => document.querySelector(".page")!.getBoundingClientRect().width);
  };
  const wide = await pageWidth(1500);
  const narrow = await pageWidth(1000);
  assert.ok(wide - narrow > 400, `sayfa pencereyle genişlemedi: ${wide} → ${narrow}`);
  await shot("15-manzara");

  // 1.5: odak modu ⇧⌘F ile açılır, sayfa yine pencereye uyar; Esc ile kapanır.
  await page.locator(".ProseMirror").click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+F" : "Control+Shift+F");
  await page.locator(".app.focus-mode").waitFor({ timeout: 5_000 });
  await page.waitForTimeout(800);
  const focusWidth = await page.evaluate(() => [document.querySelector(".page")!.getBoundingClientRect().width, innerWidth]);
  assert.ok(focusWidth[0] > focusWidth[1] - 120, `odak modunda satır genişliği pencereye uymadı: ${focusWidth}`);
  await shot("16-odak");
  await page.keyboard.press("Escape");
  await page.locator(".app.focus-mode").waitFor({ state: "detached", timeout: 5_000 });

  // Kapak eklenir, sonra tamamen kaldırılır: hem ekrandan hem dosyadan gider.
  await page.locator(".page-meta-actions button", { hasText: /cover|Kapak/i }).click({ force: true });
  await page.locator(".cover").waitFor({ timeout: 5_000 });
  await page.locator(".cover").hover();
  await page.locator(".cover-actions button", { hasText: /^(Remove|Kaldır)$/ }).click();
  await page.locator(".cover").waitFor({ state: "detached", timeout: 5_000 });
  await page.waitForTimeout(500);
  const coverAfter = await page.evaluate(async (id) => (await (await fetch(`/api/nodes/${id}`)).json()).cover ?? null, note);
  assert.equal(coverAfter, null, "kapak dosyadan kaldırılmadı");

  // Obsidian uyumu: wiki bağlantısı, matematik ve kutu çizilir; dosya açılıp kaydedilince bozulmaz.
  await page.evaluate(() => fetch("/api/prefs", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ writingBgEverywhere: false }) }));
  const obsidianBody = "Bkz. [[Genişlik]] ve [[Yok]]. $e^{i\\pi}+1=0$\n\n> [!info] Başlık\n> içerik\n\nDipnot[^1]\n\n[^1]: açıklama\n";
  const obs = await page.evaluate(async (body) => (await (await fetch("/api/nodes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Obsidian notu", parentNodeId: null, body }) })).json()).id as string, obsidianBody);
  await page.evaluate((id) => (location.hash = id), obs);
  await page.locator(".ProseMirror .wiki-link").first().waitFor({ timeout: 10_000 });
  assert.equal(await page.locator(".ProseMirror .wiki-link.unresolved").count(), 1);
  assert.ok(await page.locator(".ProseMirror .katex").count(), "matematik çizilmedi");
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" ek");
  await page.waitForTimeout(1500);
  const obsSaved = await page.evaluate(async (id) => (await (await fetch(`/api/nodes/${id}`)).json()).body as string, obs);
  for (const part of ["[[Genişlik]]", "[[Yok]]", "$e^{i\\pi}+1=0$", "> [!info] Başlık", "[^1]: açıklama"]) assert.ok(obsSaved.includes(part), `kaydedilen notta bozuldu: ${part}\n${obsSaved}`);

  // Komut paleti açılıp kapanır (yeni Chromium'da scrollIntoView Promise döndürür; arayüz çökmemeli), sonra grafik açılır.
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(`${mod}+Shift+P`);
  await page.locator(".picker input").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".picker").waitFor({ state: "detached" });
  assert.ok(await page.locator(".sidebar").count(), "palet kapanınca arayüz çöktü");
  await page.keyboard.press(`${mod}+Shift+P`);
  const uiLang = await page.evaluate(() => document.documentElement.lang);
  await page.locator(".picker input").fill(uiLang === "tr" ? "grafik görünümü" : "graph view");
  await page.locator(".picker .results button", { hasText: uiLang === "tr" ? "Grafik görünümü" : "Graph view" }).first().waitFor();
  await page.keyboard.press("Enter");
  await page.locator(".graph-canvas").waitFor({ timeout: 5_000 });
  await shot("17-grafik");
  // Hızlı geçiş: takma adla bulur.
  await page.keyboard.press(`${mod}+O`);
  await page.locator(".picker input").fill("obsidian");
  await page.locator(".picker .results button", { hasText: "Obsidian notu" }).first().waitFor();
  await page.keyboard.press("Enter");
  await page.locator(".title-input").waitFor();
  assert.equal(await page.locator(".title-input").inputValue(), "Obsidian notu");
  // Sekmeler: yeni sekme açılır, sekme çubuğu görünür, sekme kapanınca çubuk gizlenir ve önceki sayfa kalır.
  await page.keyboard.press(`${mod}+Alt+T`);
  await page.locator(".tab-bar .tab").nth(1).waitFor({ timeout: 5_000 });
  await page.keyboard.press(`${mod}+Alt+W`);
  await page.locator(".tab-bar").waitFor({ state: "detached", timeout: 5_000 });
  assert.equal(await page.locator(".title-input").inputValue(), "Obsidian notu");
  console.log(`Tamam. Ekran görüntüleri: ${shots ?? "(yok)"}`);
} catch (err) {
  await shot("hata").catch(() => undefined);
  console.error("Gemini çağrıları:", geminiCalls);
  console.error(
    "Köprü:",
    await page
      .evaluate(async () => {
        const b = (window as any).nularche;
        const keys = Object.keys(b);
        const reqs = await (await fetch("/api/ai")).json();
        let run: unknown = null;
        try {
          run = await b.autoRun(reqs.requests[0]?.id);
        } catch (e) {
          run = String(e);
        }
        return { keys, toast: document.querySelector(".toast")?.textContent ?? null, first: reqs.requests[0]?.status, run };
      })
      .catch((e) => String(e)),
  );
  throw err;
} finally {
  await app.close();
  gemini.close();
}

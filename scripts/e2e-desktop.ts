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
  await page.locator(".sidebar-foot .side-btn").click(); // Ayarlar
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
  await page.locator(".sidebar-foot .side-btn").click();
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

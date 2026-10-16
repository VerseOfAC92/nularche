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

const app = await electron.launch({
  executablePath: path.join(root, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"),
  args: [root],
  env: { ...process.env, HOME: home, NULARCHE_USER_DATA: userData, NULARCHE_E2E: "1" },
});
const page = await app.firstWindow();
const shot = async (name: string) => shots && (await page.screenshot({ path: path.join(shots, `${name}.png`) }));

try {
  await page.getByText("Nularche'ye hoş geldiniz").waitFor({ timeout: 20_000 });
  await shot("1-hosgeldiniz");
  await page.getByRole("button", { name: "İleri" }).click();
  await page.getByRole("button", { name: /ChatGPT/ }).click();
  await page.getByText("ChatGPT uygulamasını açın").waitFor();
  await shot("2-chatgpt-secildi");
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
  console.log(`Tamam. Ekran görüntüleri: ${shots ?? "(yok)"}`);
} finally {
  await app.close();
}

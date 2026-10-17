// Kurulmuş/paketlenmiş Nularche'yi doğrular (her işletim sisteminde aynı betik):
//   1. Uygulama geçici bir kullanıcı klasörüyle açılır, arayüz çizilir, Origin'e yazma/okuma ve yerel API denetlenir.
//   2. Aynı ikili MCP sunucusu olarak (ELECTRON_RUN_AS_NODE) çalıştırılır; araçlar listelenir, Node oluşturulup okunur.
// Kullanım: node scripts/smoke-packaged.ts <çalıştırılabilir dosya> [--no-sandbox]
//   macOS:   "/Applications/Nularche.app/Contents/MacOS/Nularche"
//   Windows: "%LOCALAPPDATA%\Programs\Nularche\Nularche.exe"
//   Linux:   /opt/Nularche/nularche
// Kullanıcının gerçek ayarlarına ve notlarına dokunmaz.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const exe = process.argv[2];
if (!exe || !existsSync(exe)) {
  console.error(`Çalıştırılabilir dosya bulunamadı: ${exe ?? "(verilmedi)"}`);
  process.exit(2);
}
const extraArgs = process.argv.includes("--no-sandbox") ? ["--no-sandbox"] : [];
// İlk açılış yavaş olabilir (ör. CI'da Rosetta'nın Intel ikilisini ilk kez çevirmesi): SMOKE_TIMEOUT_MS ile uzatılır.
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 120_000);
const resources =
  process.platform === "darwin" ? path.resolve(path.dirname(exe), "..", "Resources") : path.join(path.dirname(exe), "resources");
const mcpScript = path.join(resources, "mcp.mjs");
const work = await mkdtemp(path.join(tmpdir(), "nularche-smoke-"));
const result = path.join(work, "result.json");

try {
  // 1) Arayüz duman testi
  const code = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(exe, [...extraArgs, "--lang=en"], {
      env: { ...process.env, NULARCHE_SMOKE: result, NULARCHE_SMOKE_TIMEOUT_MS: String(Math.max(30_000, timeoutMs - 20_000)), NULARCHE_USER_DATA: path.join(work, "ud"), NULARCHE_E2E: "1", ELECTRON_ENABLE_LOGGING: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    child.stdout.on("data", (d) => (log += d));
    child.stderr.on("data", (d) => (log += d));
    const started = Date.now();
    const timer = setTimeout(() => (child.kill(), reject(new Error(`zaman aşımı (${timeoutMs} ms)\n${log.slice(-4000)}`))), timeoutMs);
    child.on("error", reject);
    child.on("exit", (c) => {
      clearTimeout(timer);
      console.log(`Uygulama ${((Date.now() - started) / 1000).toFixed(1)} sn içinde kapandı (çıkış kodu ${c})`);
      if (c !== 0) console.error(log.slice(-3000));
      resolve(c);
    });
  });
  const ui = JSON.parse(await readFile(result, "utf8"));
  console.log("Arayüz:", JSON.stringify(ui));
  assert.equal(code, 0, "uygulama başarıyla kapanmalı");
  assert.equal(ui.ok, true, "arayüz, Origin ve API denetimleri geçmeli");

  // 2) MCP sunucusu (Claude/ChatGPT/Gemini bağlantısının kullandığı mod)
  assert.ok(existsSync(mcpScript), `MCP betiği yok: ${mcpScript}`);
  const transport = new StdioClientTransport({
    command: exe,
    args: [mcpScript],
    env: { ...(process.env as Record<string, string>), ELECTRON_RUN_AS_NODE: "1", NULARCHE_ORIGIN: path.join(work, "mcp-origin") },
  });
  const client = new Client({ name: "nularche-smoke", version: "1.0.0" });
  await client.connect(transport);
  const tools = (await client.listTools()).tools.map((t) => t.name);
  assert.ok(tools.includes("create_database") && tools.includes("read_node"), `beklenen araçlar yok: ${tools.join(", ")}`);
  const created = (await client.callTool({ name: "create_node", arguments: { title: "MCP smoke", body: "merhaba", parent_node_id: "root" } })) as { content: { text: string }[] };
  const id = JSON.parse(created.content[0].text).id as string;
  const read = (await client.callTool({ name: "read_node", arguments: { node: id } })) as { content: { text: string }[] };
  assert.equal(JSON.parse(read.content[0].text).body.trim(), "merhaba");
  await client.close();
  console.log(`MCP: ${tools.length} araç, Node oluşturma/okuma tamam`);
  console.log(`TAMAM: ${ui.platform}-${ui.arch} ${ui.version}`);
} finally {
  await rm(work, { recursive: true, force: true }).catch(() => undefined);
}

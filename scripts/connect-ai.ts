// Kaynak koddan çalıştırırken "nularche" MCP sunucusunu bir AI aracına bağlar.
// (Kurulu masaüstü uygulamasında aynı işlem Ayarlar → Yapay zekâ ekranındadır.)
// Kullanım: npm run connect -- <claude-desktop | claude-code | codex | antigravity> [--yes]

import path from "node:path";
import { createInterface } from "node:readline/promises";
import { applyConnection, CONNECTIONS, findExecutable, planConnection, type ConnectionId, type McpEntry } from "../packages/core/src/ai-clients.ts";
import { projectRoot, resolveOriginDir } from "../packages/core/src/config.ts";

const id = process.argv[2] as ConnectionId;
if (!(id in CONNECTIONS)) {
  console.error(`Kullanım: npm run connect -- <${Object.keys(CONNECTIONS).join(" | ")}>`);
  process.exit(1);
}

const entry: McpEntry = {
  command: process.execPath, // Node'un mutlak yolu; AI araçları kabuk PATH'ini görmeyebilir.
  args: [path.join(projectRoot(), "packages/mcp/src/index.ts")],
  env: { NULARCHE_ORIGIN: resolveOriginDir() },
};

const spec = CONNECTIONS[id];
const plan = await planConnection(id, entry);
if (plan.status === "unchanged") {
  console.log(`${spec.name}: nularche zaten bağlı; değişiklik yok.`);
  process.exit(0);
}
console.log(`${spec.name} → ${plan.configPath}`);
console.log(`${plan.status === "add" ? "Eklenecek" : "Güncellenecek"} girdi: nularche =`, JSON.stringify(entry, null, 2));
if (plan.legacyServers.length) console.log(`Kaldırılacak eski kayıt: ${plan.legacyServers.join(", ")}`);
console.log(`Korunan diğer sunucular: ${plan.otherServers.join(", ") || "(yok)"}`);

if (!process.argv.includes("--yes")) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question("Devam edilsin mi? [e/H] ")).trim().toLowerCase();
  rl.close();
  if (!["e", "evet", "y", "yes"].includes(answer)) process.exit(0);
}

const { backup } = await applyConnection(id, entry, { claudeExecutable: id === "claude-code" ? await findExecutable("claude") : undefined });
if (backup) console.log(`Yedek: ${backup}`);
console.log(`Tamam. ${spec.name} uygulamasını yeniden başlatın; araçlarda “nularche” görünmeli.`);

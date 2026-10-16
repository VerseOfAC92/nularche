// Kaynak koddan çalıştırırken Claude Desktop'a "nularche" MCP sunucusunu ekler.
// (Kurulu masaüstü uygulamasında aynı işlem Ayarlar → Claude bağlantısı ekranındadır.)
// Kullanım: npm run register:desktop  (onaysız: npm run register:desktop -- --yes)

import path from "node:path";
import { createInterface } from "node:readline/promises";
import {
  applyClaudeDesktop,
  claudeCodeCommand,
  isClaudeDesktopRunning,
  planClaudeDesktop,
  type McpEntry,
} from "../packages/core/src/claude-config.ts";
import { projectRoot, resolveOriginDir } from "../packages/core/src/config.ts";

const entry: McpEntry = {
  command: process.execPath, // Node'un mutlak yolu; Claude Desktop kabuk PATH'ini görmez.
  args: [path.join(projectRoot(), "packages/mcp/src/index.ts")],
  env: { NULARCHE_ORIGIN: resolveOriginDir() },
};

if (isClaudeDesktopRunning()) {
  console.error("Claude Desktop açık. Önce tamamen kapatın (macOS: ⌘Q), sonra bu komutu Terminal'den tekrar çalıştırın.");
  process.exit(1);
}

const plan = await planClaudeDesktop(entry);
if (plan.status === "unchanged") {
  console.log("nularche zaten kayıtlı; değişiklik yok.");
  process.exit(0);
}
console.log(`Dosya: ${plan.configPath}`);
console.log(`${plan.status === "add" ? "Eklenecek" : "Güncellenecek"} girdi: mcpServers.nularche =`);
console.log(JSON.stringify(entry, null, 2));
if (plan.legacyServers.length) console.log(`Kaldırılacak eski kayıt: ${plan.legacyServers.join(", ")} (uygulamanın eski adı)`);
console.log(`Korunan diğer sunucular: ${plan.otherServers.join(", ") || "(yok)"}`);

if (!process.argv.includes("--yes")) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question("Devam edilsin mi? [e/H] ")).trim().toLowerCase();
  rl.close();
  if (!["e", "evet", "y", "yes"].includes(answer)) {
    console.log("İptal edildi.");
    process.exit(0);
  }
}

const { backup } = await applyClaudeDesktop(entry);
if (backup) console.log(`Yedek: ${backup}`);
console.log("Tamam. Claude Desktop'ı açın; araçlar menüsünde 'nularche' görünmeli.");
console.log(`\nClaude Code için:\n  ${claudeCodeCommand(entry)}`);

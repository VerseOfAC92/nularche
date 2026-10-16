// Claude Desktop / Claude Code'a "nularche" MCP sunucusunu kaydetme mantığı.
// CLI betiği ve masaüstü uygulamasının Ayarlar ekranı bunu ortak kullanır.
// Kurallar: yalnızca mcpServers.nularche eklenir/güncellenir (ve uygulamanın eski adıyla
// kaydedilmiş "notlar" girdisi kaldırılır), diğer girdiler korunur,
// yazmadan önce zaman damgalı yedek alınır, Claude Desktop açıkken yazılmaz
// (Claude Desktop config'i kapanışta yeniden yazar).

import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export const SERVER_NAME = "nularche";
/** Uygulamanın eski adı (Notlar) döneminden kalan kayıt; yalnızca bizim MCP betiğimizi gösteriyorsa kaldırılır. */
const LEGACY_NAME = "notlar";

export interface McpEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface DesktopPlan {
  configPath: string;
  status: "unchanged" | "add" | "update";
  entry: McpEntry;
  otherServers: string[];
  /** Kaldırılacak eski kayıtlar. */
  legacyServers: string[];
}

function isLegacyEntry(value: unknown): boolean {
  const args = (value as { args?: unknown })?.args;
  return Array.isArray(args) && args.some((a) => typeof a === "string" && /(notlar|nularche)[\\/].*mcp|notlar-mcp|nularche-mcp/i.test(a));
}

export function claudeDesktopConfigPath(platform = process.platform, env = process.env): string {
  if (platform === "darwin") return path.join(homedir(), "Library/Application Support/Claude/claude_desktop_config.json");
  if (platform === "win32") return path.join(env.APPDATA || path.join(homedir(), "AppData/Roaming"), "Claude/claude_desktop_config.json");
  return path.join(env.XDG_CONFIG_HOME || path.join(homedir(), ".config"), "Claude/claude_desktop_config.json");
}

export function isClaudeDesktopRunning(platform = process.platform): boolean {
  try {
    if (platform === "win32") {
      const out = execFileSync("tasklist", ["/FI", "IMAGENAME eq Claude.exe", "/NH"], { encoding: "utf8" });
      return /claude\.exe/i.test(out);
    }
    execFileSync("pgrep", ["-x", platform === "darwin" ? "Claude" : "claude"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function readConfig(configPath: string): Promise<Record<string, unknown>> {
  try {
    const value = JSON.parse(await readFile(configPath, "utf8"));
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
    throw new Error("config bir JSON nesnesi değil");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`Claude Desktop config okunamadı (${configPath}): ${(err as Error).message}`);
  }
}

export async function planClaudeDesktop(entry: McpEntry, configPath = claudeDesktopConfigPath()): Promise<DesktopPlan> {
  const config = await readConfig(configPath);
  const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
  const current = servers[SERVER_NAME];
  const legacyServers = isLegacyEntry(servers[LEGACY_NAME]) ? [LEGACY_NAME] : [];
  const same = current !== undefined && JSON.stringify(current) === JSON.stringify(entry);
  return {
    configPath,
    entry,
    status: current === undefined ? "add" : same && legacyServers.length === 0 ? "unchanged" : "update",
    otherServers: Object.keys(servers).filter((k) => k !== SERVER_NAME && !legacyServers.includes(k)),
    legacyServers,
  };
}

/** Girdiyi yazar; yedek dosyasının yolunu (dosya yoksa null) döndürür. */
export async function applyClaudeDesktop(
  entry: McpEntry,
  configPath = claudeDesktopConfigPath(),
  options: { checkRunning?: boolean } = {},
): Promise<{ backup: string | null }> {
  if ((options.checkRunning ?? true) && isClaudeDesktopRunning())
    throw new Error("Claude Desktop açık. Önce tamamen kapatın (macOS: ⌘Q), sonra tekrar deneyin.");
  const config = await readConfig(configPath);
  let backup: string | null = `${configPath}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  try {
    await copyFile(configPath, backup);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    backup = null;
  }
  const servers = { ...((config.mcpServers ?? {}) as Record<string, unknown>) };
  if (isLegacyEntry(servers[LEGACY_NAME])) delete servers[LEGACY_NAME];
  config.mcpServers = { ...servers, [SERVER_NAME]: entry };
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return { backup };
}

function shellQuote(s: string): string {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Claude Code için tek satırlık kayıt komutu. */
export function claudeCodeCommand(entry: McpEntry): string {
  const envFlags = Object.entries(entry.env).map(([k, v]) => `-e ${shellQuote(`${k}=${v}`)}`);
  return ["claude mcp add", SERVER_NAME, "--scope user", ...envFlags, "--", shellQuote(entry.command), ...entry.args.map(shellQuote)].join(" ");
}

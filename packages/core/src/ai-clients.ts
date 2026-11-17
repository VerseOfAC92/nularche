// Yapay zekâ bağlantıları: "nularche" MCP sunucusunu, kullanıcının kendi üyeliğiyle oturum açtığı
// resmi AI araçlarına kaydeder. Nularche hiçbir AI kimlik bilgisine (oturum, token, API anahtarı) dokunmaz;
// yalnızca her aracın kendi MCP yapılandırma dosyasına bir girdi ekler.
//
//   Claude  (Anthropic) → Claude Desktop, Claude Code
//   ChatGPT (OpenAI)    → ChatGPT masaüstü uygulaması + Codex CLI/IDE (ortak ~/.codex/config.toml)
//   Gemini  (Google)    → Google Antigravity CLI `agy` (~/.gemini/config/mcp_config.json)
//
// Yazma kuralları: yalnızca "nularche" girdisi eklenir/güncellenir, diğer her şey korunur, yazmadan önce
// zaman damgalı yedek alınır, bozuk (ayrıştırılamayan) dosyalara yazılmaz.

import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

export const SERVER_NAME = "nularche";
/** Uygulamanın eski adı (Notlar) döneminden kalan kayıt; yalnızca bizim MCP betiğimizi gösteriyorsa kaldırılır. */
const LEGACY_NAME = "notlar";

export interface McpEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export type ProviderId = "claude" | "chatgpt" | "gemini";
export type ConnectionId = "claude-desktop" | "claude-code" | "codex" | "antigravity";
export type LauncherId = "claude-desktop" | "claude-code" | "chatgpt-desktop" | "codex-cli" | "antigravity-cli";

export interface Provider {
  id: ProviderId;
  name: string;
  company: string;
  /** Bağlantıyı kullanabilen üyelikler (bilgilendirme amaçlı). */
  plans: string;
  connections: ConnectionId[];
  launchers: LauncherId[];
}

export const PROVIDERS: Provider[] = [
  {
    id: "claude",
    name: "Claude",
    company: "Anthropic",
    plans: "Claude Pro, Max, Team",
    connections: ["claude-desktop", "claude-code"],
    launchers: ["claude-desktop", "claude-code"],
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    company: "OpenAI",
    plans: "ChatGPT Plus, Pro, Business",
    connections: ["codex"],
    launchers: ["chatgpt-desktop", "codex-cli"],
  },
  {
    id: "gemini",
    name: "Gemini",
    company: "Google",
    plans: "Google AI Pro, Ultra",
    connections: ["antigravity"],
    launchers: ["antigravity-cli"],
  },
];

export interface ConnectionSpec {
  id: ConnectionId;
  provider: ProviderId;
  name: string;
  /** Kullanıcıya gösterilecek kısa açıklama. */
  description: string;
  format: "json" | "toml" | "claude-cli";
  /** Yazmadan önce kapatılması gereken uygulama (yapılandırmayı kapanışta yeniden yazanlar). */
  mustBeClosed?: string;
  downloadUrl: string;
}

export const CONNECTIONS: Record<ConnectionId, ConnectionSpec> = {
  "claude-desktop": {
    id: "claude-desktop",
    provider: "claude",
    name: "Claude Desktop",
    description: "Claude masaüstü uygulaması",
    format: "json",
    mustBeClosed: "Claude Desktop",
    downloadUrl: "https://claude.ai/download",
  },
  "claude-code": {
    id: "claude-code",
    provider: "claude",
    name: "Claude Code",
    description: "Terminalde Claude",
    format: "claude-cli",
    downloadUrl: "https://claude.com/product/claude-code",
  },
  codex: {
    id: "codex",
    provider: "chatgpt",
    name: "ChatGPT masaüstü + Codex",
    description: "ChatGPT masaüstü uygulaması, Codex CLI ve IDE eklentisi aynı ayarı paylaşır",
    format: "toml",
    downloadUrl: "https://openai.com/chatgpt/download/",
  },
  antigravity: {
    id: "antigravity",
    provider: "gemini",
    name: "Google Antigravity",
    description: "Google'ın terminal aracı agy (Gemini CLI'ın yerini aldı)",
    format: "json",
    downloadUrl: "https://antigravity.google/download",
  },
};

export interface LauncherSpec {
  id: LauncherId;
  provider: ProviderId;
  name: string;
  kind: "url" | "app" | "terminal";
  /** `kind: "url"` için açılacak adres. */
  url?: string;
  /** macOS uygulama paket kimliği ve olası konumları (`kind: "app"`). */
  bundleId?: string;
  appNames?: string[];
  /** `kind: "terminal"` için çalıştırılacak program; istem ilk argüman olarak verilebiliyorsa `promptArg: true`. */
  executable?: string;
  promptArg?: boolean;
  downloadUrl: string;
}

export const LAUNCHERS: Record<LauncherId, LauncherSpec> = {
  "claude-desktop": {
    id: "claude-desktop",
    provider: "claude",
    name: "Claude Desktop",
    kind: "url",
    url: "claude://",
    appNames: ["Claude.app"],
    downloadUrl: "https://claude.ai/download",
  },
  "claude-code": {
    id: "claude-code",
    provider: "claude",
    name: "Claude Code (terminal)",
    kind: "terminal",
    executable: "claude",
    promptArg: true,
    downloadUrl: "https://claude.com/product/claude-code",
  },
  "chatgpt-desktop": {
    id: "chatgpt-desktop",
    provider: "chatgpt",
    name: "ChatGPT masaüstü",
    kind: "app",
    bundleId: "com.openai.chat",
    appNames: ["ChatGPT.app"],
    downloadUrl: "https://openai.com/chatgpt/download/",
  },
  "codex-cli": {
    id: "codex-cli",
    provider: "chatgpt",
    name: "Codex (terminal)",
    kind: "terminal",
    executable: "codex",
    promptArg: true,
    downloadUrl: "https://github.com/openai/codex",
  },
  "antigravity-cli": {
    id: "antigravity-cli",
    provider: "gemini",
    name: "Antigravity (terminal)",
    kind: "terminal",
    executable: "agy",
    promptArg: false,
    downloadUrl: "https://antigravity.google/download",
  },
};

// --- Yollar -------------------------------------------------------------------------------------

export interface Env {
  platform: NodeJS.Platform;
  home: string;
  vars: NodeJS.ProcessEnv;
}

const defaultEnv = (): Env => ({ platform: process.platform, home: homedir(), vars: process.env });

export function connectionConfigPath(id: ConnectionId, env: Env = defaultEnv()): string {
  const { platform, home, vars } = env;
  switch (id) {
    case "claude-desktop":
      if (platform === "darwin") return path.join(home, "Library/Application Support/Claude/claude_desktop_config.json");
      if (platform === "win32") return path.join(vars.APPDATA || path.join(home, "AppData/Roaming"), "Claude/claude_desktop_config.json");
      return path.join(vars.XDG_CONFIG_HOME || path.join(home, ".config"), "Claude/claude_desktop_config.json");
    case "claude-code":
      return path.join(home, ".claude.json");
    case "codex":
      return path.join(vars.CODEX_HOME || path.join(home, ".codex"), "config.toml");
    case "antigravity":
      return path.join(home, ".gemini/config/mcp_config.json");
  }
}

// --- Kurulu araçları bulma -------------------------------------------------------------------------

/**
 * Bir komut satırı programını bulur. Finder/Başlat menüsünden açılan uygulamaların PATH'i kısıtlı
 * olduğundan yaygın kurulum klasörleri de taranır.
 */
export async function findExecutable(name: string, env: Env = defaultEnv()): Promise<string | null> {
  const { platform, home, vars } = env;
  const dirs = new Set((vars.PATH ?? "").split(path.delimiter).filter(Boolean));
  for (const d of [".local/bin", ".npm-global/bin", ".bun/bin", ".volta/bin", ".cargo/bin", "bin"]) dirs.add(path.join(home, d));
  if (platform !== "win32") ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/snap/bin"].forEach((d) => dirs.add(d));
  else if (vars.APPDATA) dirs.add(path.join(vars.APPDATA, "npm"));
  try {
    const nvm = path.join(home, ".nvm/versions/node");
    for (const v of await readdir(nvm)) dirs.add(path.join(nvm, v, "bin"));
  } catch {
    // nvm yok
  }
  const names = platform === "win32" ? [`${name}.exe`, `${name}.cmd`, `${name}.bat`, name] : [name];
  for (const dir of dirs) for (const n of names) if (existsSync(path.join(dir, n))) return path.join(dir, n);
  return null;
}

/** macOS'ta bir uygulamanın kurulu olup olmadığını denetler; diğer sistemlerde bilinemez (null). */
export function findApp(appNames: string[] | undefined, env: Env = defaultEnv()): string | null | undefined {
  if (!appNames?.length) return undefined;
  if (env.platform !== "darwin") return undefined;
  for (const dir of ["/Applications", path.join(env.home, "Applications")]) {
    for (const n of appNames) if (existsSync(path.join(dir, n))) return path.join(dir, n);
  }
  return null;
}

export function isAppRunning(name: string, platform = process.platform): boolean {
  try {
    if (platform === "win32") {
      return new RegExp(`${name}\\.exe`, "i").test(execFileSync("tasklist", ["/FI", `IMAGENAME eq ${name}.exe`, "/NH"], { encoding: "utf8" }));
    }
    execFileSync("pgrep", ["-x", platform === "darwin" ? name : name.toLowerCase()], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// --- Plan / uygulama ---------------------------------------------------------------------------------

export interface ConnectionPlan {
  id: ConnectionId;
  configPath: string;
  status: "unchanged" | "add" | "update";
  otherServers: string[];
  legacyServers: string[];
}

export class ConnectionError extends Error {}

function same(a: unknown, b: McpEntry): boolean {
  const x = a as Partial<McpEntry> | undefined;
  return (
    !!x && x.command === b.command && JSON.stringify(x.args ?? []) === JSON.stringify(b.args) && JSON.stringify(x.env ?? {}) === JSON.stringify(b.env)
  );
}

function isLegacyEntry(value: unknown): boolean {
  const args = (value as { args?: unknown })?.args;
  return Array.isArray(args) && args.some((a) => typeof a === "string" && /(notlar|nularche)[\\/].*mcp|notlar-mcp|nularche-mcp/i.test(a));
}

async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

function readJsonObject(text: string | null, file: string): Record<string, unknown> {
  if (text === null || text.trim() === "") return {};
  try {
    const v = JSON.parse(text);
    if (v && typeof v === "object" && !Array.isArray(v)) return v;
  } catch {
    // aşağıda
  }
  throw new ConnectionError(`Yapılandırma dosyası okunamadı (geçerli JSON değil): ${file}. Dosyayı düzeltmeden bağlantı yazılmaz.`);
}

function readTomlObject(text: string | null, file: string): Record<string, unknown> {
  if (text === null || text.trim() === "") return {};
  try {
    return parseToml(text) as Record<string, unknown>;
  } catch (err) {
    throw new ConnectionError(
      `Yapılandırma dosyası okunamadı (geçerli TOML değil): ${file}. Dosyayı düzeltmeden bağlantı yazılmaz. (${(err as Error).message.split("\n")[0]})`,
    );
  }
}

function serversOf(obj: Record<string, unknown>, key: string): Record<string, unknown> {
  const s = obj[key];
  return s && typeof s === "object" && !Array.isArray(s) ? (s as Record<string, unknown>) : {};
}

export async function planConnection(id: ConnectionId, entry: McpEntry, env: Env = defaultEnv()): Promise<ConnectionPlan> {
  const configPath = connectionConfigPath(id, env);
  const spec = CONNECTIONS[id];
  const text = await readText(configPath);
  const obj = spec.format === "toml" ? readTomlObject(text, configPath) : readJsonObject(text, configPath);
  const servers = serversOf(obj, spec.format === "toml" ? "mcp_servers" : "mcpServers");
  const current = servers[SERVER_NAME];
  const legacyServers = id === "claude-desktop" && isLegacyEntry(servers[LEGACY_NAME]) ? [LEGACY_NAME] : [];
  return {
    id,
    configPath,
    status: current === undefined ? "add" : same(current, entry) && legacyServers.length === 0 ? "unchanged" : "update",
    otherServers: Object.keys(servers).filter((k) => k !== SERVER_NAME && !legacyServers.includes(k)),
    legacyServers,
  };
}

async function backupAndWrite(file: string, original: string | null, next: string): Promise<string | null> {
  let backup: string | null = null;
  if (original !== null) {
    backup = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    await copyFile(file, backup);
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, next, "utf8");
  return backup;
}

/** TOML metninden `[mcp_servers.nularche]` ve alt tablolarını çıkarır; diğer satırlar (yorumlar dahil) korunur. */
export function removeTomlServer(text: string, name = SERVER_NAME): string {
  const header = /^\s*\[\s*([^\]]+?)\s*\]\s*(#.*)?$/;
  const target = new RegExp(`^mcp_servers\\s*\\.\\s*("?)${name}\\1(\\s*\\..*)?$`);
  const out: string[] = [];
  let skipping = false;
  for (const line of text.split(/\r?\n/)) {
    const m = header.exec(line);
    if (m && !line.trim().startsWith("[[")) skipping = target.test(m[1].trim());
    if (!skipping) out.push(line);
  }
  return out.join("\n").replace(/\n{3,}$/, "\n\n");
}

export function tomlServerBlock(entry: McpEntry, name = SERVER_NAME): string {
  return stringifyToml({ mcp_servers: { [name]: { command: entry.command, args: entry.args, env: entry.env } } }).trim();
}

export interface ApplyOptions {
  env?: Env;
  /** Uygulama açıkken yazmayı engelleme denetimi (testlerde kapatılır). */
  checkRunning?: boolean;
  /** Claude Code için bulunmuş `claude` programı. */
  claudeExecutable?: string | null;
}

/** Bağlantıyı yazar; yedek dosyasının yolunu (dosya yoksa null) döndürür. */
export async function applyConnection(id: ConnectionId, entry: McpEntry, options: ApplyOptions = {}): Promise<{ backup: string | null }> {
  const env = options.env ?? defaultEnv();
  const spec = CONNECTIONS[id];
  if (
    spec.mustBeClosed &&
    (options.checkRunning ?? true) &&
    isAppRunning(spec.mustBeClosed === "Claude Desktop" ? "Claude" : spec.mustBeClosed, env.platform)
  ) {
    throw new ConnectionError(
      `${spec.mustBeClosed} açık. Ayarlarını kapanışta yeniden yazdığı için önce tamamen kapatın (macOS: ⌘Q), sonra tekrar deneyin.`,
    );
  }
  const file = connectionConfigPath(id, env);

  if (spec.format === "claude-cli") {
    const exe = options.claudeExecutable;
    if (!exe) throw new ConnectionError("Claude Code bulunamadı. Önce Claude Code'u kurun ya da gösterilen komutu terminalde çalıştırın.");
    const run = promisify(execFile);
    // Var olan kaydı kaldır (yoksa hata verir, yok sayılır), sonra yeniden ekle.
    await run(exe, ["mcp", "remove", SERVER_NAME, "--scope", "user"]).catch(() => undefined);
    const envArgs = Object.entries(entry.env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
    await run(exe, ["mcp", "add", SERVER_NAME, "--scope", "user", ...envArgs, "--", entry.command, ...entry.args]);
    return { backup: null };
  }

  const original = await readText(file);
  if (spec.format === "json") {
    const obj = readJsonObject(original, file);
    const servers = { ...serversOf(obj, "mcpServers") };
    if (id === "claude-desktop" && isLegacyEntry(servers[LEGACY_NAME])) delete servers[LEGACY_NAME];
    obj.mcpServers = { ...servers, [SERVER_NAME]: entry };
    return { backup: await backupAndWrite(file, original, `${JSON.stringify(obj, null, 2)}\n`) };
  }

  // TOML (Codex / ChatGPT masaüstü): metni koruyarak yalnızca bizim tablomuzu değiştir.
  readTomlObject(original, file);
  const stripped = removeTomlServer(original ?? "");
  const leftover = serversOf(readTomlObject(stripped, file), "mcp_servers")[SERVER_NAME];
  if (leftover !== undefined) {
    throw new ConnectionError(`${file} dosyasında "${SERVER_NAME}" farklı bir biçimde tanımlı; lütfen o satırları elle kaldırıp tekrar deneyin.`);
  }
  const next = `${stripped.trimEnd()}${stripped.trim() ? "\n\n" : ""}${tomlServerBlock(entry)}\n`;
  const check = serversOf(readTomlObject(next, file), "mcp_servers")[SERVER_NAME];
  if (!same(check, entry)) throw new ConnectionError("TOML yazımı doğrulanamadı; dosyaya dokunulmadı.");
  return { backup: await backupAndWrite(file, original, next) };
}

// --- Komutlar ------------------------------------------------------------------------------------

function shellQuote(s: string): string {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Kullanıcının terminalde kendisi çalıştırabileceği eşdeğer bağlantı komutu (bilgi/yedek yol). */
export function manualCommand(id: ConnectionId, entry: McpEntry): string | null {
  const envFlags = (flag: string) => Object.entries(entry.env).map(([k, v]) => `${flag} ${shellQuote(`${k}=${v}`)}`);
  const cmd = [shellQuote(entry.command), ...entry.args.map(shellQuote)];
  if (id === "claude-code") return ["claude mcp add", SERVER_NAME, "--scope user", ...envFlags("-e"), "--", ...cmd].join(" ");
  if (id === "codex") return ["codex mcp add", SERVER_NAME, ...envFlags("--env"), "--", ...cmd].join(" ");
  return null;
}

/** Durum özeti: araç kurulu mu, bağlantı yazılı mı. */
export interface ConnectionStatus {
  id: ConnectionId;
  provider: ProviderId;
  name: string;
  description: string;
  /** true/false; bilinemiyorsa null. */
  installed: boolean | null;
  plan: ConnectionPlan | { error: string };
  manualCommand: string | null;
  downloadUrl: string;
  mustBeClosed?: string;
  running?: boolean;
}

export interface LauncherStatus {
  id: LauncherId;
  provider: ProviderId;
  name: string;
  installed: boolean | null;
  downloadUrl: string;
}

export async function connectionStatus(id: ConnectionId, entry: McpEntry, env: Env = defaultEnv()): Promise<ConnectionStatus> {
  const spec = CONNECTIONS[id];
  let installed: boolean | null = null;
  if (id === "claude-desktop") {
    const app = findApp(["Claude.app"], env);
    installed = app === undefined ? existsSync(path.dirname(connectionConfigPath(id, env))) || null : !!app;
  } else if (id === "claude-code") installed = !!(await findExecutable("claude", env));
  else if (id === "codex") {
    const app = findApp(["ChatGPT.app"], env);
    installed =
      !!app ||
      !!(await findExecutable("codex", env)) ||
      existsSync(path.dirname(connectionConfigPath(id, env))) ||
      (app === undefined ? null : false);
  } else if (id === "antigravity") installed = !!(await findExecutable("agy", env)) || existsSync(path.join(env.home, ".gemini"));
  let plan: ConnectionStatus["plan"];
  try {
    plan = await planConnection(id, entry, env);
  } catch (err) {
    plan = { error: (err as Error).message };
  }
  return {
    id,
    provider: spec.provider,
    name: spec.name,
    description: spec.description,
    installed,
    plan,
    manualCommand: manualCommand(id, entry),
    downloadUrl: spec.downloadUrl,
    mustBeClosed: spec.mustBeClosed,
    running: spec.mustBeClosed ? isAppRunning("Claude", env.platform) : undefined,
  };
}

export async function launcherStatus(id: LauncherId, env: Env = defaultEnv()): Promise<LauncherStatus> {
  const spec = LAUNCHERS[id];
  let installed: boolean | null = null;
  if (spec.kind === "terminal") installed = !!(await findExecutable(spec.executable!, env));
  else {
    const app = findApp(spec.appNames, env);
    installed = app === undefined ? null : !!app;
  }
  return { id, provider: spec.provider, name: spec.name, installed, downloadUrl: spec.downloadUrl };
}

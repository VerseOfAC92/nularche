// Masaüstü yapay zekâ entegrasyonu: seçilen AI aracını bulur, Nularche MCP bağlantısını kurar,
// aracın resmi uygulamasını açar ve araç Nularche'ye ilk bağlandığında uygulamayı öne getirir.
// Kullanıcı AI aracına kendi hesabıyla, aracın kendi arayüzünde giriş yapar; Nularche hiçbir
// oturum/kimlik bilgisine dokunmaz.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { app, BrowserWindow, clipboard, ipcMain, shell } from "electron";
import { AiActivity, type AiClientRecord } from "../../core/src/ai-activity.ts";
import {
  applyConnection,
  connectionStatus,
  CONNECTIONS,
  findExecutable,
  isAppRunning,
  LAUNCHERS,
  launcherStatus,
  PROVIDERS,
  type ConnectionId,
  type LauncherId,
  type McpEntry,
  type ProviderId,
} from "../../core/src/ai-clients.ts";
import { openInTerminal } from "./terminal.ts";

const run = promisify(execFile);
/** Uçtan uca testlerde dış uygulama/tarayıcı açılmaz ve hiçbir uygulama kapatılmaz. */
const dryRun = !!process.env.NULARCHE_E2E;

export interface AiSettings {
  aiProvider?: ProviderId;
  /** Sağlayıcı başına tercih edilen açma yolu (ör. ChatGPT için masaüstü uygulaması ya da Codex). */
  aiLaunchers?: Partial<Record<ProviderId, LauncherId>>;
  onboarded?: boolean;
}

export interface AiContext {
  entry: () => McpEntry;
  window: () => BrowserWindow | null;
  originRoot: () => string | null;
  settings: () => AiSettings;
  save: (patch: AiSettings) => Promise<void>;
  warning: () => string | null;
}

const isProvider = (v: unknown): v is ProviderId => PROVIDERS.some((p) => p.id === v);
const isLauncher = (v: unknown): v is LauncherId => typeof v === "string" && v in LAUNCHERS;
const isConnection = (v: unknown): v is ConnectionId => typeof v === "string" && v in CONNECTIONS;
const ALLOWED_DOWNLOADS = new Set([...Object.values(CONNECTIONS), ...Object.values(LAUNCHERS)].map((s) => s.downloadUrl));

async function waitUntil(check: () => boolean, timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return check();
}

/** Claude Desktop'ı nazikçe kapatır (yalnızca kullanıcı onay verdiğinde çağrılır). */
async function quitClaudeDesktop(): Promise<boolean> {
  if (dryRun) return true;
  try {
    if (process.platform === "darwin") await run("osascript", ["-e", 'tell application id "com.anthropic.claudefordesktop" to quit']);
    else if (process.platform === "win32") await run("taskkill", ["/IM", "claude.exe"]);
    else await run("pkill", ["-x", "claude"]);
  } catch {
    // Kapatma isteği başarısız olsa da aşağıda durumu denetliyoruz.
  }
  return waitUntil(() => !isAppRunning("Claude"), 15_000);
}

async function openLauncher(id: LauncherId, prompt: string | null): Promise<{ opened: boolean; message?: string }> {
  const spec = LAUNCHERS[id];
  if (prompt) clipboard.writeText(prompt);
  if (dryRun) return { opened: true };
  if (spec.kind === "url") {
    await shell.openExternal(spec.url!);
    return { opened: true };
  }
  if (spec.kind === "app") {
    if (process.platform === "darwin" && spec.bundleId) {
      try {
        await run("open", ["-b", spec.bundleId]);
        return { opened: true };
      } catch {
        await shell.openExternal(spec.downloadUrl);
        return { opened: false, message: `${spec.name} kurulu değil; indirme sayfası açıldı.` };
      }
    }
    await shell.openExternal(spec.downloadUrl);
    return { opened: false, message: `${spec.name} bu sistemde otomatik açılamıyor; uygulamayı kendiniz açın (istem panoya kopyalandı).` };
  }
  const exe = await findExecutable(spec.executable!);
  if (!exe) {
    await shell.openExternal(spec.downloadUrl);
    return { opened: false, message: `${spec.name} bulunamadı; kurulum sayfası açıldı.` };
  }
  await openInTerminal(exe, spec.promptArg ? prompt : null);
  return { opened: true };
}

export function registerAiIpc(ctx: AiContext): { onActivity: () => void; resetBaseline: () => Promise<void> } {
  let known: Set<string> | null = null;

  const activity = () => {
    const root = ctx.originRoot();
    return root ? new AiActivity(root) : null;
  };

  /** Yeni bir AI aracı ilk kez bağlandığında Nularche'yi öne getirir ve arayüze bildirir. */
  async function onActivity(): Promise<void> {
    const a = activity();
    if (!a) return;
    const clients = await a.clients();
    if (known === null) known = new Set();
    const fresh = clients.filter((c) => !known!.has(c.name));
    for (const c of fresh) known.add(c.name);
    const win = ctx.window();
    if (fresh.length && win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      if (process.platform === "darwin") app.focus({ steal: true });
      for (const c of fresh) win.webContents.send("nularche:ai-connected", c satisfies AiClientRecord);
    }
  }

  ipcMain.handle("nularche:ai-status", async () => {
    const entry = ctx.entry();
    const s = ctx.settings();
    return {
      provider: s.aiProvider ?? null,
      launchers: s.aiLaunchers ?? {},
      onboarded: !!s.onboarded,
      providers: PROVIDERS,
      connections: await Promise.all((Object.keys(CONNECTIONS) as ConnectionId[]).map((id) => connectionStatus(id, entry))),
      launcherStatus: await Promise.all((Object.keys(LAUNCHERS) as LauncherId[]).map((id) => launcherStatus(id))),
      clients: (await activity()?.clients()) ?? [],
      warning: ctx.warning(),
    };
  });

  ipcMain.handle("nularche:ai-set", async (_e, patch: unknown) => {
    const p = (patch ?? {}) as Record<string, unknown>;
    const next: AiSettings = {};
    if (p.provider === null || isProvider(p.provider)) next.aiProvider = (p.provider as ProviderId) ?? undefined;
    if (isProvider(p.provider) && isLauncher(p.launcher) && LAUNCHERS[p.launcher].provider === p.provider) {
      next.aiLaunchers = { ...ctx.settings().aiLaunchers, [p.provider]: p.launcher };
    }
    if (typeof p.onboarded === "boolean") next.onboarded = p.onboarded;
    await ctx.save(next);
  });

  ipcMain.handle("nularche:ai-connect", async (_e, id: unknown, options: unknown) => {
    if (!isConnection(id)) return { ok: false, error: "Bilinmeyen bağlantı" };
    const spec = CONNECTIONS[id];
    const restart = !!(options as { restartApp?: boolean } | undefined)?.restartApp;
    try {
      let reopened = false;
      if (spec.mustBeClosed && isAppRunning("Claude")) {
        if (!restart) return { ok: false, needsRestart: true, error: `${spec.mustBeClosed} açık.` };
        if (!(await quitClaudeDesktop())) return { ok: false, error: `${spec.mustBeClosed} kapatılamadı; lütfen kendiniz kapatıp tekrar deneyin.` };
        reopened = true;
      }
      const res = await applyConnection(id, ctx.entry(), { claudeExecutable: id === "claude-code" ? await findExecutable("claude") : undefined });
      if (reopened && !dryRun) await shell.openExternal("claude://");
      return { ok: true, backup: res.backup, restarted: reopened };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle("nularche:ai-open", async (_e, id: unknown, prompt: unknown) => {
    if (!isLauncher(id)) return { opened: false, message: "Bilinmeyen araç" };
    try {
      return await openLauncher(id, typeof prompt === "string" ? prompt : null);
    } catch (err) {
      return { opened: false, message: (err as Error).message };
    }
  });

  ipcMain.handle("nularche:ai-restart", async (_e, id: unknown) => {
    if (!isLauncher(id)) return { ok: false, error: "Bilinmeyen araç" };
    try {
      if (id === "claude-desktop" && isAppRunning("Claude")) {
        if (!(await quitClaudeDesktop())) return { ok: false, error: "Claude Desktop kapatılamadı; lütfen kendiniz kapatıp yeniden açın." };
      }
      const res = await openLauncher(id, null);
      return res.opened ? { ok: true } : { ok: false, error: res.message };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle("nularche:ai-download", (_e, url: unknown) => {
    if (typeof url === "string" && ALLOWED_DOWNLOADS.has(url) && !dryRun) return shell.openExternal(url);
  });

  return {
    onActivity: () => void onActivity(),
    /** Origin açıldığında: o ana kadar bağlanmış araçlar "yeni" sayılmaz. */
    resetBaseline: async () => {
      known = new Set(((await activity()?.clients()) ?? []).map((c) => c.name));
    },
  };
}

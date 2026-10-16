// Masaüstü yapay zekâ entegrasyonu: seçilen AI aracını bulur, Nularche MCP bağlantısını kurar,
// aracın resmi uygulamasını açar ve araç Nularche'ye ilk bağlandığında uygulamayı öne getirir.
// Kullanıcı AI aracına kendi hesabıyla, aracın kendi arayüzünde giriş yapar; Nularche hiçbir
// oturum/kimlik bilgisine dokunmaz.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { app, BrowserWindow, clipboard, ipcMain, safeStorage, shell } from "electron";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { checkGeminiKey, runGeminiAgent } from "../../core/src/ai-agent.ts";
import { NodeStore } from "../../core/src/node-store.ts";
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
import { d } from "./i18n.ts";

const run = promisify(execFile);
/** Uçtan uca testlerde dış uygulama/tarayıcı açılmaz ve hiçbir uygulama kapatılmaz. */
const dryRun = !!process.env.NULARCHE_E2E;

export interface AiSettings {
  aiProvider?: ProviderId;
  /** Sağlayıcı başına tercih edilen açma yolu (ör. ChatGPT için masaüstü uygulaması ya da Codex). */
  aiLaunchers?: Partial<Record<ProviderId, LauncherId>>;
  onboarded?: boolean;
  /** Otomatik mod: istekler kullanıcının Gemini API anahtarıyla arka planda işlenir. */
  autoMode?: boolean;
  /** En son cevap veren (tercih edilen) model. */
  geminiModel?: string;
  /** Anahtarla kullanılabilen modeller, deneme sırasıyla; ne zaman alındığı. */
  geminiModels?: string[];
  geminiModelsAt?: number;
}

export interface AiContext {
  entry: () => McpEntry;
  window: () => BrowserWindow | null;
  originRoot: () => string | null;
  settings: () => AiSettings;
  save: (patch: AiSettings) => Promise<void>;
  warning: () => string | null;
  configDir: () => string;
}

const isProvider = (v: unknown): v is ProviderId => PROVIDERS.some((p) => p.id === v);
const isLauncher = (v: unknown): v is LauncherId => typeof v === "string" && v in LAUNCHERS;
const isConnection = (v: unknown): v is ConnectionId => typeof v === "string" && v in CONNECTIONS;
export const GEMINI_KEY_URL = "https://aistudio.google.com/app/apikey";
const ALLOWED_DOWNLOADS = new Set([...Object.values(CONNECTIONS), ...Object.values(LAUNCHERS)].map((s) => s.downloadUrl).concat(GEMINI_KEY_URL));

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
    // Claude Desktop: istem yeni sohbette önceden yazılı açılır (destekleniyorsa); panoda da hazırdır.
    const url = prompt && id === "claude-desktop" ? `claude://claude.ai/new?q=${encodeURIComponent(prompt)}` : spec.url!;
    await shell.openExternal(url);
    return { opened: true };
  }
  if (spec.kind === "app") {
    if (process.platform === "darwin" && spec.bundleId) {
      try {
        await run("open", ["-b", spec.bundleId]);
        return { opened: true };
      } catch {
        await shell.openExternal(spec.downloadUrl);
        return { opened: false, message: d("ai.notInstalled", { name: spec.name }) };
      }
    }
    await shell.openExternal(spec.downloadUrl);
    return { opened: false, message: d("ai.cantOpen", { name: spec.name }) };
  }
  const exe = await findExecutable(spec.executable!);
  if (!exe) {
    await shell.openExternal(spec.downloadUrl);
    return { opened: false, message: d("ai.notFound", { name: spec.name }) };
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
    if (!isConnection(id)) return { ok: false, error: d("ai.unknownConnection") };
    const spec = CONNECTIONS[id];
    const restart = !!(options as { restartApp?: boolean } | undefined)?.restartApp;
    try {
      let reopened = false;
      if (spec.mustBeClosed && isAppRunning("Claude")) {
        if (!restart) return { ok: false, needsRestart: true, error: d("ai.isOpen", { name: spec.mustBeClosed ?? "" }) };
        if (!(await quitClaudeDesktop())) return { ok: false, error: d("ai.cantQuit", { name: spec.mustBeClosed ?? "" }) };
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
    if (!isLauncher(id)) return { opened: false, message: d("ai.unknownTool") };
    try {
      return await openLauncher(id, typeof prompt === "string" ? prompt : null);
    } catch (err) {
      return { opened: false, message: (err as Error).message };
    }
  });

  ipcMain.handle("nularche:ai-restart", async (_e, id: unknown) => {
    if (!isLauncher(id)) return { ok: false, error: d("ai.unknownTool") };
    try {
      if (id === "claude-desktop" && isAppRunning("Claude")) {
        if (!(await quitClaudeDesktop())) return { ok: false, error: d("ai.cantQuitClaude") };
      }
      const res = await openLauncher(id, null);
      return res.opened ? { ok: true } : { ok: false, error: res.message };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  // --- Otomatik mod (Gemini API anahtarı) -------------------------------------------------------
  const keyFile = () => path.join(ctx.configDir(), "gemini-key.bin");
  // Uçtan uca testlerde gerçek Anahtar Zinciri kullanılmaz.
  const canEncrypt = () => dryRun || safeStorage.isEncryptionAvailable();
  const encrypt = (k: string) => (dryRun ? Buffer.from(k) : safeStorage.encryptString(k));
  async function readKey(): Promise<string | null> {
    try {
      const buf = await readFile(keyFile());
      if (dryRun) return buf.toString("utf8");
      return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : null;
    } catch {
      return null;
    }
  }

  ipcMain.handle("nularche:auto-status", async () => ({
    enabled: !!ctx.settings().autoMode,
    hasKey: !!(await readKey()),
    model: ctx.settings().geminiModel ?? null,
    encryption: canEncrypt(),
  }));

  ipcMain.handle("nularche:auto-set-key", async (_e, key: unknown) => {
    if (typeof key !== "string" || !key.trim()) return { ok: false, error: d("ai.emptyKey") };
    if (!canEncrypt()) return { ok: false, error: d("ai.noEncryption") };
    try {
      const { model, models } = await checkGeminiKey(key.trim());
      await mkdir(ctx.configDir(), { recursive: true });
      await writeFile(keyFile(), encrypt(key.trim()), { mode: 0o600 });
      await ctx.save({ geminiModel: model, geminiModels: models, geminiModelsAt: Date.now(), autoMode: true });
      return { ok: true, model };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle("nularche:auto-clear", async () => {
    await rm(keyFile(), { force: true });
    await ctx.save({ autoMode: false, geminiModel: undefined });
  });

  ipcMain.handle("nularche:auto-enable", async (_e, enabled: unknown) => {
    await ctx.save({ autoMode: !!enabled });
  });

  /** Model listesi: önce en son çalışan model, sonra diğerleri; liste eski ya da yoksa yenilenir. */
  async function modelOrder(key: string): Promise<string[]> {
    const st = ctx.settings();
    let models = st.geminiModels ?? [];
    if (!models.length || Date.now() - (st.geminiModelsAt ?? 0) > 24 * 3600_000) {
      try {
        models = (await checkGeminiKey(key)).models;
        await ctx.save({ geminiModels: models, geminiModelsAt: Date.now() });
      } catch {
        // Liste alınamazsa elimizdekiyle devam edilir.
      }
    }
    const preferred = st.geminiModel;
    return preferred ? [preferred, ...models.filter((m) => m !== preferred)] : models;
  }

  // İstekler sırayla işlenir (aynı Node'a eşzamanlı düzenleme olmasın).
  let queue: Promise<unknown> = Promise.resolve();

  async function processRequest(requestId: string): Promise<{ ok: boolean; status?: string; error?: string }> {
    const root = ctx.originRoot();
    if (!root) return { ok: false, error: d("ai.noOrigin") };
    const activity = new AiActivity(root);
    const key = await readKey();
    if (!key) {
      // İstek askıda kalmasın: ne yapılması gerektiğini cevap olarak yaz.
      await activity
        .completeRequest(requestId, d("ai.keyMissingReply"), true)
        .catch(() => undefined);
      return { ok: false, error: d("ai.noKey") };
    }
    try {
      const { request, model } = await runGeminiAgent({
        store: new NodeStore(root),
        activity,
        requestId,
        apiKey: key,
        models: await modelOrder(key),
      });
      if (model && model !== ctx.settings().geminiModel) await ctx.save({ geminiModel: model });
      return { ok: request.status === "done", status: request.status };
    } catch (err) {
      await activity.completeRequest(requestId, `Beklenmeyen hata: ${(err as Error).message}`, true).catch(() => undefined);
      return { ok: false, error: (err as Error).message };
    }
  }

  const enqueue = (requestId: string) => {
    const run = queue.then(() => processRequest(requestId));
    queue = run.catch(() => undefined);
    return run;
  };

  ipcMain.handle("nularche:auto-run", async (_e, requestId: unknown) => {
    if (typeof requestId !== "string") return { ok: false, error: d("ai.badRequest") };
    return enqueue(requestId);
  });

  ipcMain.handle("nularche:auto-retry", async (_e, requestId: unknown) => {
    const root = ctx.originRoot();
    if (typeof requestId !== "string" || !root) return { ok: false, error: d("ai.badRequest") };
    try {
      await new AiActivity(root).retryRequest(requestId);
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
    return enqueue(requestId);
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

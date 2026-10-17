// Nularche masaüstü uygulaması: Electron ana süreci.
// Yerel sunucuyu süreç içinde başlatır, arayüzü bir pencerede açar ve küçük bir köprü (preload)
// üzerinden yalnızca masaüstüne özgü işlemleri sunar. `nularche://` derin bağlantılarını ve
// .nlc/.nla dosyalarını karşılar. Uygulama hiçbir AI kimlik bilgisine dokunmaz; AI işi kullanıcının
// seçtiği resmi araçta (Claude, ChatGPT, Gemini) "nularche" MCP sunucusuyla yapılır.

import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, shell, type MenuItemConstructorOptions } from "electron";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { exportArchive, importArchive, type ArchiveKind } from "../../core/src/archive.ts";
import { exportMarkdownZip, exportPageHtml, exportSite } from "../../core/src/export.ts";
import type { McpEntry } from "../../core/src/ai-clients.ts";
import { registerAiIpc, type AiSettings } from "./ai.ts";
import { d, desktopLang, isLang, setDesktopLang, systemLang, type Lang } from "./i18n.ts";
import { loadOrigin, type Origin } from "../../core/src/origin.ts";
import { startServer, type RunningServer } from "../../server/src/app.ts";

const REPO = "VerseOfAC92/nularche";
const PROTOCOL = "nularche";
const ARCHIVE_EXTS = [".nlc", ".nla"];
const DARK_BG = "#0b0d10";
const LIGHT_BG = "#eef1f4";

type ThemeChoice = "dark" | "light" | "system";
const isTheme = (v: unknown): v is ThemeChoice => v === "dark" || v === "light" || v === "system";

// --- İşletim sistemi dizin standartları (RFC-001 §3.3) ---------------------------------------
//   macOS   config: ~/Library/Preferences/io.nularche.app   data: ~/Library/Application Support/Nularche
//   Windows config: %APPDATA%\Nularche\config               data: %LOCALAPPDATA%\Nularche\data
//   Linux   config: ~/.config/nularche                      data: ~/.local/share/nularche
function platformDirs(): { config: string; data: string } {
  const home = homedir();
  if (process.platform === "darwin") {
    return { config: path.join(home, "Library/Preferences/io.nularche.app"), data: path.join(home, "Library/Application Support/Nularche") };
  }
  if (process.platform === "win32") {
    const roaming = process.env.APPDATA || path.join(home, "AppData/Roaming");
    const local = process.env.LOCALAPPDATA || path.join(home, "AppData/Local");
    return { config: path.join(roaming, "Nularche", "config"), data: path.join(local, "Nularche", "data") };
  }
  return {
    config: path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "nularche"),
    data: path.join(process.env.XDG_DATA_HOME || path.join(home, ".local/share"), "nularche"),
  };
}

// Test ve taşınabilir kullanım için tek bir klasör seçilebilir (ayarlar ve veriler onun altına).
const override = process.env.NULARCHE_USER_DATA ? path.resolve(process.env.NULARCHE_USER_DATA) : null;
const dirs = override ? { config: path.join(override, "config"), data: path.join(override, "data") } : platformDirs();
app.setName("Nularche");
app.setPath("userData", dirs.data);

interface Settings extends AiSettings {
  originDir?: string;
  skipVersion?: string;
  /** Arayüz dili; seçilmemişse sistem dilinden çıkarılır. */
  language?: Lang;
  /** Görünüm; seçilmemişse ("system") işletim sisteminin koyu/açık teması izlenir. */
  theme?: ThemeChoice;
}

const settingsPath = () => path.join(dirs.config, "settings.json");

async function loadSettings(): Promise<Settings> {
  try {
    return JSON.parse(await readFile(settingsPath(), "utf8"));
  } catch {
    return {};
  }
}

async function saveSettings(s: Settings): Promise<void> {
  await mkdir(dirs.config, { recursive: true });
  await writeFile(settingsPath(), JSON.stringify(s, null, 2));
}

/** Paketli uygulamada kaynak dosyaları `resources/`, geliştirmede `dist-desktop/` altındadır. */
function resourcePath(name: string): string {
  return app.isPackaged ? path.join(process.resourcesPath, name) : path.join(app.getAppPath(), "dist-desktop", name);
}

function webDist(): string {
  return app.isPackaged ? path.join(process.resourcesPath, "web") : path.join(app.getAppPath(), "packages/web/dist");
}

/**
 * MCP sunucusu betiği veri klasörüne kopyalanır; böylece Claude Desktop'taki kayıt uygulama
 * güncellense ya da (Linux AppImage gibi) her açılışta farklı yere bağlansa da geçerli kalır.
 */
async function installMcpScript(): Promise<string> {
  const target = path.join(dirs.data, "mcp", "nularche-mcp.mjs");
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(resourcePath("mcp.mjs"), target);
  return target;
}

/** AI aracının MCP sunucusunu başlatırken kullanacağı komut: uygulamanın kendi ikilisi Node olarak. */
function mcpEntry(mcpScript: string, originDir: string): McpEntry {
  const command = process.env.APPIMAGE || process.execPath;
  return { command, args: [mcpScript], env: { ELECTRON_RUN_AS_NODE: "1", NULARCHE_ORIGIN: originDir } };
}

const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;

/** Apple Silicon bir Mac'te Intel (x64) sürümü Rosetta ile çalışıyorsa doğru sürüm önerilir. */
function wrongArchitecture(): boolean {
  return process.platform === "darwin" && app.runningUnderARM64Translation;
}

/** Uygulama geçici bir konumdan (DMG, İndirilenler karantinası) çalışıyorsa MCP kaydı kalıcı olmaz. */
function unstableLocation(): string | null {
  if (wrongArchitecture()) {
    return d("warn.rosetta");
  }
  const exe = process.execPath;
  if (process.platform === "darwin" && (exe.startsWith("/Volumes/") || exe.includes("/AppTranslocation/"))) {
    return d("warn.translocated");
  }
  return null;
}

async function chooseOriginOnFirstRun(): Promise<string | null> {
  const documents = app.getPath("documents");
  // Varsayılan "Belgeler/Nularche"; bu ad başka bir şey için kullanılıyorsa (macOS büyük/küçük harf
  // ayırmadığından ör. "nularche" adlı bir proje klasörü) "Nularche Origin" kullanılır.
  const candidates = ["Nularche", "Nularche Origin", ...Array.from({ length: 8 }, (_, i) => `Nularche Origin ${i + 2}`)];
  const defaultDir = path.join(
    documents,
    candidates.find((n) => {
      const p = path.join(documents, n);
      return !existsSync(p) || existsSync(path.join(p, ".nularche", "origin.json"));
    }) ?? "Nularche Origin",
  );
  const legacy = [path.join(documents, "nularche", "origin"), path.join(documents, "notlar", "vault")].find((p) => existsSync(p));
  const choices = [...(legacy ? (["legacy"] as const) : []), "default", "pick", "quit"] as const;
  const label = { legacy: d("origin.useLegacy"), default: d("origin.useDefault"), pick: d("origin.pick"), quit: d("menu.quit") };
  const buttons = choices.map((c) => label[c]);
  const { response } = await dialog.showMessageBox({
    type: "question",
    title: "Nularche",
    message: d("origin.question"),
    detail: d("origin.detail", { dir: defaultDir }) + (legacy ? d("origin.legacy", { dir: legacy }) : ""),
    buttons,
    defaultId: 0,
    cancelId: buttons.length - 1,
  });
  const choice = choices[response];
  if (choice === "legacy") return legacy!;
  let dir: string | null = null;
  if (choice === "default") dir = defaultDir;
  else if (choice === "pick") dir = await pickFolder();
  if (!dir) return null;
  return (await confirmOriginFolder(dir)) ? dir : chooseOriginOnFirstRun();
}

const PROJECT_MARKERS = [".git", "package.json", "node_modules", "Cargo.toml", "pyproject.toml", "go.mod", ".obsidian"];
const ORIGIN_CONTENT = /\.(md|markdown|png|jpe?g|gif|webp|svg|pdf)$/i;

/**
 * Seçilen klasör boş değil ve bir Origin değilse (ör. bir yazılım projesi) kullanıcıdan onay ister.
 * Nularche bu klasördeki .md dosyalarını Node olarak gösterir ve düzenlenenlere frontmatter ekler.
 */
async function confirmOriginFolder(dir: string): Promise<boolean> {
  if (!existsSync(dir) || existsSync(path.join(dir, ".nularche", "origin.json"))) return true;
  let entries: string[];
  try {
    entries = (await readdir(dir)).filter((e) => e !== ".DS_Store");
  } catch {
    return true;
  }
  const markers = entries.filter((e) => PROJECT_MARKERS.includes(e));
  const foreign = entries.filter((e) => !e.startsWith(".") && path.extname(e) && !ORIGIN_CONTENT.test(e));
  if (markers.length === 0 && foreign.length === 0) return true;
  const { response } = await dialog.showMessageBox({
    type: "warning",
    title: "Nularche",
    message: d("origin.notOrigin"),
    detail: d("origin.notOriginDetail", { dir, files: [...markers, ...foreign].slice(0, 5).join(", ") }),
    buttons: [d("origin.pickOther"), d("origin.useAnyway"), d("common.cancel")],
    defaultId: 0,
    cancelId: 2,
  });
  return response === 1;
}

async function pickFolder(): Promise<string | null> {
  const res = await dialog.showOpenDialog({ title: d("origin.pickTitle"), properties: ["openDirectory", "createDirectory"] });
  return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0];
}

let settings: Settings = {};
let server: RunningServer | null = null;
let origin: Origin | null = null;
let win: BrowserWindow | null = null;
let mcpScript = "";
/** Sunucu başlamadan gelen derin bağlantılar ve dosyalar. */
const pendingOpens: string[] = [];
let ready = false;
/**
 * Paketlenmiş uygulama duman testi (scripts/smoke-packaged.ts): NULARCHE_SMOKE=<sonuç dosyası> ile açılan uygulama
 * ilk açılış pencerelerini atlar, geçici bir Origin kullanır, arayüz çizilince doğrulama sonucunu yazar ve kapanır.
 */
const SMOKE = process.env.NULARCHE_SMOKE || null;

async function finishSmoke(): Promise<void> {
  if (!SMOKE || !win || !server) return;
  const result: Record<string, unknown> = { version: app.getVersion(), platform: process.platform, arch: process.arch };
  try {
    await new Promise((r) => setTimeout(r, 1500));
    result.ui = await win.webContents.executeJavaScript(
      `({ title: document.title, sidebar: !!document.querySelector(".sidebar"), arches: document.body.innerText.includes("Arche") || document.body.innerText.includes("ARCHES"), lang: document.documentElement.lang })`,
    );
    const created = await server.store.create({ title: "Smoke", body: "ok" });
    result.storeRoundtrip = (await server.store.read(created.id)).body.trim() === "ok";
    const res = await fetch(`${server.url}/api/nodes`);
    result.api = res.ok && ((await res.json()) as { nodes: unknown[] }).nodes.length >= 1;
    result.ok = !!(result.ui as { sidebar?: boolean }).sidebar && result.storeRoundtrip === true && result.api === true;
  } catch (err) {
    result.ok = false;
    result.error = String(err);
  }
  await writeFile(SMOKE, JSON.stringify(result, null, 2));
  app.exit(result.ok ? 0 : 1);
}

/** Arayüz yüklenmeden istenen gezinme; arayüz açılışta `renderer-ready` ile alır. */
let pendingNav: string | null = null;
let rendererReady = false;

async function openOrigin(originDir: string): Promise<void> {
  await server?.close();
  server = await startServer({ originDir, webDist: webDist(), port: 0, onAiActivity: () => aiHooks?.onActivity() });
  origin = await loadOrigin(server.store.root);
  await aiHooks?.resetBaseline();
  settings.originDir = originDir;
  await saveSettings(settings);
  if (win) await win.loadURL(server.url);
}

function navigate(nodeId: string): void {
  if (!win || !rendererReady) {
    pendingNav = nodeId;
    if (!win && server) createWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  win.webContents.send("nularche:navigate", nodeId);
}

/** `nularche://open?node=…[&origin=…]`, `nularche://capture?text=…` ve .nlc/.nla dosyalarını işler. */
const debug = (...args: unknown[]) => process.env.NULARCHE_DEBUG && console.error("[nularche]", ...args);

async function handleOpen(target: string): Promise<void> {
  debug("open", target, { ready, server: !!server });
  if (!ready || !server) {
    pendingOpens.push(target);
    return;
  }
  try {
    if (target.toLowerCase().startsWith(`${PROTOCOL}://`)) {
      const url = new URL(target);
      const action = url.hostname || url.pathname.replace(/^\/+/, "");
      if (action === "open") {
        const wantOrigin = url.searchParams.get("origin");
        if (wantOrigin && origin && wantOrigin !== origin.id) {
          dialog.showMessageBox({
            type: "info",
            message: d("link.otherOrigin"),
            detail: d("link.otherOriginDetail"),
          });
          return;
        }
        const node = url.searchParams.get("node");
        if (node) navigate(node);
      } else if (action === "capture") {
        const text = (url.searchParams.get("text") ?? "").slice(0, 100_000);
        if (!text.trim()) return;
        const created = await server.store.capture(text, url.searchParams.get("title") ?? undefined);
        navigate(created.id);
      }
      return;
    }
    if (ARCHIVE_EXTS.includes(path.extname(target).toLowerCase())) await importArchiveFile(target);
  } catch (err) {
    dialog.showErrorBox("Nularche", String((err as Error).message ?? err));
  }
}

async function importArchiveFile(file: string): Promise<{ imported: number; rootIds: string[] } | null> {
  if (!server) return null;
  const { response } = await dialog.showMessageBox({
    type: "question",
    message: d("archive.importQuestion", { name: path.basename(file) }),
    detail: d("archive.importDetail"),
    buttons: [d("archive.import"), d("common.cancel")],
    defaultId: 0,
    cancelId: 1,
  });
  if (response !== 0) return null;
  const res = await importArchive(server.store, new Uint8Array(await readFile(file)));
  if (res.rootIds[0]) navigate(res.rootIds[0]);
  return { imported: res.imported, rootIds: res.rootIds };
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    title: "Nularche",
    backgroundColor: nativeTheme.shouldUseDarkColors ? DARK_BG : LIGHT_BG,
    show: false,
    webPreferences: {
      preload: resourcePath("preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Arayüz dili ilk çizimden önce bilinsin (yerel sunucunun portu her açılışta değiştiği için tarayıcı deposu kalıcı değildir).
      additionalArguments: [`--nlc-lang=${desktopLang()}`, `--nlc-theme=${settings.theme ?? "system"}`],
    },
  });
  win.once("ready-to-show", () => win?.show());
  // Dış bağlantılar varsayılan tarayıcıda açılır; uygulama penceresi yalnızca yerel sunucuyu gösterir.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (server && !url.startsWith(server.url)) {
      event.preventDefault();
      if (/^(https?|mailto):/.test(url)) void shell.openExternal(url);
    }
  });
  win.on("closed", () => {
    win = null;
    rendererReady = false;
  });
  // Yeniden yüklemede arayüz tekrar `renderer-ready` bildirene kadar gezinmeler kuyruğa alınır.
  win.webContents.on("did-start-navigation", (_e, _url, _inPlace, isMainFrame) => {
    if (isMainFrame) rendererReady = false;
  });
  if (server) void win.loadURL(server.url);
}

function buildMenu(): void {
  const isMac = process.platform === "darwin";
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" as const }] : []),
    {
      label: d("menu.file"),
      submenu: [
        { label: d("menu.openOrigin"), click: () => void changeOrigin() },
        { label: d("menu.revealOrigin"), click: () => settings.originDir && void shell.openPath(settings.originDir) },
        { type: "separator" },
        { label: d("menu.importArchive"), click: () => void pickAndImport() },
        { label: d("menu.exportOrigin"), click: () => void saveArchive(null, "nla") },
        { type: "separator" },
        isMac ? { role: "close", label: d("menu.closeWindow") } : { role: "quit", label: d("menu.quit") },
      ],
    },
    { role: "editMenu", label: d("menu.edit") },
    { role: "viewMenu", label: d("menu.view") },
    { role: "windowMenu", label: d("menu.window") },
    {
      role: "help",
      label: d("menu.help"),
      submenu: [
        { label: d("menu.github"), click: () => void shell.openExternal(`https://github.com/${REPO}`) },
        { label: d("menu.issue"), click: () => void shell.openExternal(`https://github.com/${REPO}/issues`) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function changeOrigin(): Promise<string | null> {
  const dir = await pickFolder();
  if (!dir) return null;
  if (!(await confirmOriginFolder(dir))) return changeOrigin();
  await openOrigin(dir);
  return dir;
}

async function pickAndImport(): Promise<{ imported: number; rootIds: string[] } | null> {
  const res = await dialog.showOpenDialog({
    title: d("archive.pickTitle"),
    properties: ["openFile"],
    filters: [{ name: d("archive.filter"), extensions: ["nla", "nlc"] }],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  return importArchiveFile(res.filePaths[0]);
}

async function saveArchive(nodeId: string | null, kind: ArchiveKind): Promise<string | null> {
  if (!server) return null;
  let name = origin?.name ?? "Origin";
  if (nodeId) name = (await server.store.read(nodeId)).title;
  const res = await dialog.showSaveDialog({
    defaultPath: `${name.replace(/[\\/:*?"<>|]/g, "-")}.${kind}`,
    filters: [{ name: kind === "nla" ? "Nularche Archive" : "Nularche Container", extensions: [kind] }],
  });
  if (res.canceled || !res.filePath) return null;
  const { data } = await exportArchive(server.store, { rootId: nodeId ?? undefined, kind });
  await writeFile(res.filePath, data);
  return res.filePath;
}

/** Sayfayı Markdown (.zip) ya da tek dosya HTML olarak kaydeder; site için klasör seçtirir ve dosyaları yazar. */
async function exportTo(kind: "md" | "html" | "site", nodeId: string | null): Promise<string | null> {
  if (!server) return null;
  const lang = desktopLang();
  if (kind === "site") {
    const res = await dialog.showOpenDialog({ title: d("export.siteFolder"), properties: ["openDirectory", "createDirectory"], buttonLabel: d("export.siteButton") });
    if (res.canceled || !res.filePaths[0]) return null;
    const dir = res.filePaths[0];
    const { files } = await exportSite(server.store, { rootId: nodeId ?? undefined, lang });
    for (const [rel, data] of Object.entries(files)) {
      const abs = path.join(dir, ...rel.split("/"));
      if (!abs.startsWith(dir + path.sep)) continue;
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, data);
    }
    void shell.openPath(path.join(dir, "index.html"));
    return dir;
  }
  if (!nodeId) return null;
  const out = kind === "html" ? await exportPageHtml(server.store, nodeId, lang) : await exportMarkdownZip(server.store, nodeId);
  const res = await dialog.showSaveDialog({
    defaultPath: path.join(app.getPath("documents"), out.name),
    filters: [kind === "html" ? { name: "HTML", extensions: ["html"] } : { name: "ZIP", extensions: ["zip"] }],
  });
  if (res.canceled || !res.filePath) return null;
  await writeFile(res.filePath, "html" in out ? out.html : out.data);
  shell.showItemInFolder(res.filePath);
  return res.filePath;
}

function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

let aiHooks: ReturnType<typeof registerAiIpc> | null = null;

function registerIpc(): void {
  aiHooks = registerAiIpc({
    entry: () => mcpEntry(mcpScript, settings.originDir!),
    window: () => win,
    originRoot: () => server?.store.root ?? null,
    settings: () => settings,
    save: async (patch) => {
      settings = { ...settings, ...patch };
      await saveSettings(settings);
    },
    warning: unstableLocation,
    configDir: () => dirs.config,
  });
  ipcMain.handle("nularche:renderer-ready", () => {
    rendererReady = true;
    if (SMOKE) void finishSmoke();
    const nav = pendingNav;
    pendingNav = null;
    return nav;
  });
  ipcMain.handle("nularche:info", () => ({
    version: app.getVersion(),
    platform: process.platform,
    originDir: settings.originDir,
    warning: unstableLocation(),
  }));
  ipcMain.handle("nularche:change-origin", () => changeOrigin());
  ipcMain.handle("nularche:set-theme", async (_e, theme: unknown) => {
    if (!isTheme(theme)) return;
    settings.theme = theme;
    nativeTheme.themeSource = theme;
    await saveSettings(settings);
  });
  ipcMain.handle("nularche:set-language", async (_e, lang: unknown) => {
    if (!isLang(lang)) return;
    settings.language = lang;
    setDesktopLang(lang);
    await saveSettings(settings);
    buildMenu();
  });
  ipcMain.handle("nularche:reveal-origin", () => settings.originDir && shell.openPath(settings.originDir));
  ipcMain.handle("nularche:copy", (_e, text: unknown) => {
    if (typeof text === "string") clipboard.writeText(text);
  });
  ipcMain.handle("nularche:open-external", (_e, url: unknown) => {
    if (typeof url === "string" && /^https:\/\//.test(url)) return shell.openExternal(url);
  });
  ipcMain.handle("nularche:print-pdf", async (e, suggestedName: unknown) => {
    const name = typeof suggestedName === "string" && suggestedName ? suggestedName.replace(/[\\/:*?"<>|]/g, "-") : "Node";
    const res = await dialog.showSaveDialog({ defaultPath: `${name}.pdf`, filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (res.canceled || !res.filePath) return null;
    const data = await e.sender.printToPDF({ printBackground: false, pageSize: "A4" });
    await writeFile(res.filePath, data);
    return res.filePath;
  });
  ipcMain.handle("nularche:export-archive", (_e, nodeId: unknown, kind: unknown) =>
    saveArchive(typeof nodeId === "string" ? nodeId : null, kind === "nlc" ? "nlc" : "nla"),
  );
  ipcMain.handle("nularche:import-archive", () => pickAndImport());
  ipcMain.handle("nularche:export", async (_e, kind: unknown, nodeId: unknown) => {
    if (kind !== "md" && kind !== "html" && kind !== "site") return { ok: false, error: "invalid" };
    try {
      return { ok: true, path: await exportTo(kind, typeof nodeId === "string" ? nodeId : null) };
    } catch (err) {
      return { ok: false, error: String((err as Error).message ?? err) };
    }
  });
  ipcMain.handle("nularche:check-update", async () => {
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { accept: "application/vnd.github+json" } });
      if (!res.ok) return null;
      const data = (await res.json()) as { tag_name?: string; html_url?: string };
      if (!data.tag_name || compareVersions(data.tag_name, app.getVersion()) <= 0 || data.tag_name === settings.skipVersion) return null;
      return { version: data.tag_name, url: data.html_url };
    } catch {
      return null;
    }
  });
  ipcMain.handle("nularche:skip-update", async (_e, version: unknown) => {
    if (typeof version === "string") {
      settings.skipVersion = version;
      await saveSettings(settings);
    }
  });
}

/** Komut satırı argümanlarından derin bağlantı ve arşiv dosyalarını ayıklar (Windows/Linux). */
function opensFromArgv(argv: string[]): string[] {
  return argv.slice(1).filter((a) => a.toLowerCase().startsWith(`${PROTOCOL}://`) || ARCHIVE_EXTS.includes(path.extname(a).toLowerCase()));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Geliştirmede (electron .) şema kaydı betik yoluyla yapılmalıdır.
  if (process.defaultApp && process.argv[1]) app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  else app.setAsDefaultProtocolClient(PROTOCOL);

  app.on("open-url", (event, url) => {
    event.preventDefault();
    void handleOpen(url);
  });
  app.on("open-file", (event, file) => {
    event.preventDefault();
    void handleOpen(file);
  });
  app.on("second-instance", (_e, argv) => {
    debug("second-instance", argv);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    for (const target of opensFromArgv(argv)) void handleOpen(target);
  });
  pendingOpens.push(...opensFromArgv(process.argv));

  app.whenReady().then(async () => {
    settings = await loadSettings();
    setDesktopLang(settings.language ?? systemLang(app.getLocale()));
    // Yerel menüler, iletişim kutuları ve pencere arka planı da seçilen temaya uysun.
    nativeTheme.themeSource = settings.theme ?? "system";
    if (wrongArchitecture() && !SMOKE) {
      const { response } = await dialog.showMessageBox({
        type: "warning",
        title: "Nularche",
        message: d("rosetta.message"),
        detail: d("rosetta.detail"),
        buttons: [d("rosetta.download"), d("rosetta.later")],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 0) void shell.openExternal(RELEASES_URL);
    }
    mcpScript = await installMcpScript();
    registerIpc();
    buildMenu();
    if (SMOKE) {
      const limit = Number(process.env.NULARCHE_SMOKE_TIMEOUT_MS || 90_000);
      setTimeout(() => (void writeFile(SMOKE, JSON.stringify({ ok: false, error: "timeout", rendererReady })).finally(() => app.exit(2))), limit);
      settings.originDir = path.join(dirs.data, "smoke-origin");
      settings.onboarded = true;
    }
    const originDir = settings.originDir && existsSync(settings.originDir) && !SMOKE ? settings.originDir : SMOKE ? settings.originDir! : await chooseOriginOnFirstRun();
    if (!originDir) return app.quit();
    try {
      await openOrigin(originDir);
    } catch (err) {
      dialog.showErrorBox(d("start.failed"), String(err));
      return app.quit();
    }
    createWindow();
    ready = true;
    for (const target of pendingOpens.splice(0)) void handleOpen(target);
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("before-quit", () => void server?.close());
}

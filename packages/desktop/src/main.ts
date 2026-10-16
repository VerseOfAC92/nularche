// Nularche masaüstü uygulaması: Electron ana süreci.
// Yerel sunucuyu süreç içinde başlatır, arayüzü bir pencerede açar ve küçük bir köprü (preload)
// üzerinden yalnızca masaüstüne özgü işlemleri sunar. `nularche://` derin bağlantılarını ve
// .nlc/.nla dosyalarını karşılar. Uygulama hiçbir AI kimlik bilgisine dokunmaz; AI işi kullanıcının
// seçtiği resmi araçta (Claude, ChatGPT, Gemini) "nularche" MCP sunucusuyla yapılır.

import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell, type MenuItemConstructorOptions } from "electron";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { exportArchive, importArchive, type ArchiveKind } from "../../core/src/archive.ts";
import type { McpEntry } from "../../core/src/ai-clients.ts";
import { registerAiIpc, type AiSettings } from "./ai.ts";
import { loadOrigin, type Origin } from "../../core/src/origin.ts";
import { startServer, type RunningServer } from "../../server/src/app.ts";

const REPO = "VerseOfAC92/nularche";
const PROTOCOL = "nularche";
const ARCHIVE_EXTS = [".nlc", ".nla"];
const DARK_BG = "#0b0d10";

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
    return "Bu Mac Apple Silicon işlemcili ama Nularche'nin Intel sürümü kurulu. Daha hızlı çalışması ve gelecekteki macOS sürümlerinde açılabilmesi için Apple Silicon sürümünü kurun.";
  }
  const exe = process.execPath;
  if (process.platform === "darwin" && (exe.startsWith("/Volumes/") || exe.includes("/AppTranslocation/"))) {
    return "Nularche disk görüntüsünden ya da karantinadaki bir konumdan çalışıyor. Yapay zekâ bağlantısının kalıcı olması için önce uygulamayı Uygulamalar klasörüne taşıyıp oradan açın.";
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
  const buttons = ["Varsayılan Origin'i kullan", "Klasör seç…", "Çık"];
  if (legacy) buttons.unshift("Mevcut notları kullan");
  const { response } = await dialog.showMessageBox({
    type: "question",
    title: "Nularche",
    message: "Origin'iniz nerede olsun?",
    detail:
      `Origin, tüm Node'larınızın düz Markdown (.md) dosyaları olarak durduğu ana veri kasasıdır.\n\nVarsayılan: ${defaultDir}` +
      (legacy ? `\nMevcut notlar: ${legacy}` : ""),
    buttons,
    defaultId: 0,
    cancelId: buttons.length - 1,
  });
  const choice = buttons[response];
  if (choice === "Mevcut notları kullan") return legacy!;
  let dir: string | null = null;
  if (choice === "Varsayılan Origin'i kullan") dir = defaultDir;
  else if (choice === "Klasör seç…") dir = await pickFolder();
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
    message: "Bu klasör bir Nularche Origin'i gibi görünmüyor.",
    detail:
      `${dir}\n\nKlasörde ${[...markers, ...foreign].slice(0, 5).join(", ")} gibi başka dosyalar var. ` +
      "Nularche buradaki .md dosyalarını Node olarak gösterir ve uygulamada düzenlediğiniz dosyaların başına kimlik bilgisi (frontmatter) ekler. " +
      "Notlarınız için boş ya da yalnızca notlardan oluşan bir klasör seçmeniz önerilir.",
    buttons: ["Başka klasör seç", "Yine de kullan", "Vazgeç"],
    defaultId: 0,
    cancelId: 2,
  });
  return response === 1;
}

async function pickFolder(): Promise<string | null> {
  const res = await dialog.showOpenDialog({ title: "Origin klasörünü seçin", properties: ["openDirectory", "createDirectory"] });
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
            message: "Bu bağlantı başka bir Origin'e ait.",
            detail: "Bağlantının ait olduğu Origin'i Dosya → Başka Origin aç ile açın.",
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
    message: `“${path.basename(file)}” içe aktarılsın mı?`,
    detail: "Arşivdeki Node'lar Shadow gelen kutusuna eklenir; mevcut Node'lara dokunulmaz.",
    buttons: ["İçe aktar", "Vazgeç"],
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
    backgroundColor: DARK_BG,
    show: false,
    webPreferences: { preload: resourcePath("preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false },
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
      label: "Dosya",
      submenu: [
        { label: "Başka Origin aç…", click: () => void changeOrigin() },
        { label: "Origin klasörünü göster", click: () => settings.originDir && void shell.openPath(settings.originDir) },
        { type: "separator" },
        { label: "Arşiv içe aktar (.nla / .nlc)…", click: () => void pickAndImport() },
        { label: "Origin'i dışa aktar (.nla)…", click: () => void saveArchive(null, "nla") },
        { type: "separator" },
        isMac ? { role: "close", label: "Pencereyi kapat" } : { role: "quit", label: "Çık" },
      ],
    },
    { role: "editMenu", label: "Düzen" },
    { role: "viewMenu", label: "Görünüm" },
    { role: "windowMenu", label: "Pencere" },
    {
      role: "help",
      label: "Yardım",
      submenu: [
        { label: "GitHub sayfası", click: () => void shell.openExternal(`https://github.com/${REPO}`) },
        { label: "Sorun bildir", click: () => void shell.openExternal(`https://github.com/${REPO}/issues`) },
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
    title: "Arşiv seçin",
    properties: ["openFile"],
    filters: [{ name: "Nularche arşivi", extensions: ["nla", "nlc"] }],
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
    if (wrongArchitecture()) {
      const { response } = await dialog.showMessageBox({
        type: "warning",
        title: "Nularche",
        message: "Bu Mac için doğru sürüm kurulu değil",
        detail:
          "Mac'iniz Apple Silicon (M serisi) işlemcili, ancak Nularche'nin Intel sürümü kurulu ve Rosetta ile çalışıyor. " +
          "macOS'un gelecek sürümleri Intel uygulamalarını açmayacak. Lütfen “Apple Silicon” sürümünü indirip kurun; notlarınız ve ayarlarınız korunur.",
        buttons: ["Apple Silicon sürümünü indir", "Şimdilik devam et"],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 0) void shell.openExternal(RELEASES_URL);
    }
    mcpScript = await installMcpScript();
    registerIpc();
    buildMenu();
    const originDir = settings.originDir && existsSync(settings.originDir) ? settings.originDir : await chooseOriginOnFirstRun();
    if (!originDir) return app.quit();
    try {
      await openOrigin(originDir);
    } catch (err) {
      dialog.showErrorBox("Nularche başlatılamadı", String(err));
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

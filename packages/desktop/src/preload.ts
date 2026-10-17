// Arayüze yalnızca dar, tipli bir köprü açılır; Node/Electron API'lerine doğrudan erişim yoktur.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(`nularche:${channel}`, ...args);

const argValue = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const langArg = argValue("nlc-lang");
const themeArg = argValue("nlc-theme");

contextBridge.exposeInMainWorld("nularche", {
  language: langArg === "tr" || langArg === "en" ? langArg : null,
  setLanguage: (lang: string) => invoke("set-language", lang),
  theme: themeArg === "dark" || themeArg === "light" || themeArg === "system" ? themeArg : null,
  setTheme: (theme: string) => invoke("set-theme", theme),
  rendererReady: () => invoke("renderer-ready"),
  info: () => invoke("info"),
  changeOrigin: () => invoke("change-origin"),
  revealOrigin: () => invoke("reveal-origin"),
  copy: (text: string) => invoke("copy", text),
  openExternal: (url: string) => invoke("open-external", url),
  aiStatus: () => invoke("ai-status"),
  aiSet: (patch: unknown) => invoke("ai-set", patch),
  aiConnect: (id: string, options?: { restartApp?: boolean }) => invoke("ai-connect", id, options),
  aiOpen: (launcher: string, prompt: string | null) => invoke("ai-open", launcher, prompt),
  aiRestart: (launcher: string) => invoke("ai-restart", launcher),
  autoStatus: () => invoke("auto-status"),
  autoSetKey: (key: string) => invoke("auto-set-key", key),
  autoClear: () => invoke("auto-clear"),
  autoEnable: (enabled: boolean) => invoke("auto-enable", enabled),
  autoRun: (requestId: string) => invoke("auto-run", requestId),
  autoRetry: (requestId: string) => invoke("auto-retry", requestId),
  aiDownload: (url: string) => invoke("ai-download", url),
  onAiConnected: (cb: (client: unknown) => void) => {
    const listener = (_e: IpcRendererEvent, c: unknown) => cb(c);
    ipcRenderer.on("nularche:ai-connected", listener);
    return () => ipcRenderer.removeListener("nularche:ai-connected", listener);
  },
  printPdf: (name: string) => invoke("print-pdf", name),
  exportArchive: (nodeId: string | null, kind: "nlc" | "nla") => invoke("export-archive", nodeId, kind),
  exportAs: (kind: "md" | "html" | "site", nodeId: string | null) => invoke("export", kind, nodeId),
  importArchive: () => invoke("import-archive"),
  checkUpdate: () => invoke("check-update"),
  skipUpdate: (version: string) => invoke("skip-update", version),
  onNavigate: (cb: (nodeId: string) => void) => {
    const listener = (_e: IpcRendererEvent, id: unknown) => typeof id === "string" && cb(id);
    ipcRenderer.on("nularche:navigate", listener);
    return () => ipcRenderer.removeListener("nularche:navigate", listener);
  },
});

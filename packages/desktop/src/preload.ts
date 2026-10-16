// Arayüze yalnızca dar, tipli bir köprü açılır; Node/Electron API'lerine doğrudan erişim yoktur.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(`nularche:${channel}`, ...args);

contextBridge.exposeInMainWorld("nularche", {
  rendererReady: () => invoke("renderer-ready"),
  info: () => invoke("info"),
  changeOrigin: () => invoke("change-origin"),
  revealOrigin: () => invoke("reveal-origin"),
  copy: (text: string) => invoke("copy", text),
  openExternal: (url: string) => invoke("open-external", url),
  claudeStatus: () => invoke("claude-status"),
  claudeApply: () => invoke("claude-apply"),
  openClaude: (prompt: string) => invoke("open-claude", prompt),
  printPdf: (name: string) => invoke("print-pdf", name),
  exportArchive: (nodeId: string | null, kind: "nlc" | "nla") => invoke("export-archive", nodeId, kind),
  importArchive: () => invoke("import-archive"),
  checkUpdate: () => invoke("check-update"),
  skipUpdate: (version: string) => invoke("skip-update", version),
  onNavigate: (cb: (nodeId: string) => void) => {
    const listener = (_e: IpcRendererEvent, id: unknown) => typeof id === "string" && cb(id);
    ipcRenderer.on("nularche:navigate", listener);
    return () => ipcRenderer.removeListener("nularche:navigate", listener);
  },
});

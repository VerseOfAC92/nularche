// Otomatik yedekleme (2.0, masaüstü): Origin'in tamamı kullanıcının seçtiği klasöre belirli aralıklarla `.nla` arşivi
// olarak yazılır (bkz. core/src/backup.ts). Ayarlar Origin başına uygulama ayarlarında tutulur; hiçbir hesap ya da
// bulut hizmeti kullanılmaz. Bir yedek başarısız olursa hata gösterilir ve bir sonraki denetimde yeniden denenir.

import { dialog, ipcMain, shell } from "electron";
import { BACKUP_INTERVALS, backupDue, backupOrigin, listBackups, type BackupInterval } from "../../core/src/backup.ts";
import type { NodeStore } from "../../core/src/node-store.ts";

export interface OriginBackup {
  dir?: string;
  interval: BackupInterval;
  keep: number;
  lastAt?: number;
  lastError?: string;
}

const CHECK_MS = 5 * 60_000;
const DEFAULTS: OriginBackup = { interval: "daily", keep: 10 };

export function registerBackupIpc(deps: {
  store: () => NodeStore | null;
  originDir: () => string | undefined;
  originName: () => string;
  load: () => Record<string, OriginBackup>;
  save: (all: Record<string, OriginBackup>) => Promise<void>;
  label: (key: "pickTitle" | "pickButton") => string;
}): { stop: () => void } {
  const current = (): OriginBackup => ({ ...DEFAULTS, ...(deps.originDir() ? deps.load()[deps.originDir()!] : undefined) });
  const update = async (patch: Partial<OriginBackup>) => {
    const key = deps.originDir();
    if (!key) return;
    await deps.save({ ...deps.load(), [key]: { ...current(), ...patch } });
  };
  let running = false;

  async function run(): Promise<{ ok: boolean; name?: string; error?: string }> {
    const store = deps.store();
    const cfg = current();
    if (!store || !cfg.dir) return { ok: false, error: "no folder" };
    if (running) return { ok: false, error: "busy" };
    running = true;
    try {
      const out = await backupOrigin(store, { dir: cfg.dir, originName: deps.originName(), keep: cfg.keep });
      await update({ lastAt: Date.now(), lastError: undefined });
      return { ok: true, name: out.name };
    } catch (e) {
      const error = (e as Error).message;
      await update({ lastError: error });
      return { ok: false, error };
    } finally {
      running = false;
    }
  }

  const tick = () => {
    const cfg = current();
    if (cfg.dir && backupDue(cfg.interval, cfg.lastAt)) void run();
  };
  const first = setTimeout(tick, 60_000);
  const timer = setInterval(tick, CHECK_MS);

  ipcMain.handle("nularche:backup-status", async () => {
    const cfg = current();
    const count = cfg.dir ? (await listBackups(cfg.dir, deps.originName())).length : 0;
    return { dir: cfg.dir ?? null, interval: cfg.interval, keep: cfg.keep, lastAt: cfg.lastAt ?? null, lastError: cfg.lastError ?? null, count };
  });
  ipcMain.handle("nularche:backup-choose-dir", async () => {
    const res = await dialog.showOpenDialog({ title: deps.label("pickTitle"), buttonLabel: deps.label("pickButton"), properties: ["openDirectory", "createDirectory"] });
    if (res.canceled || !res.filePaths[0]) return null;
    await update({ dir: res.filePaths[0] });
    return res.filePaths[0];
  });
  ipcMain.handle("nularche:backup-set", async (_e, patch: unknown) => {
    const p = (patch && typeof patch === "object" ? patch : {}) as Record<string, unknown>;
    const next: Partial<OriginBackup> = {};
    if ((BACKUP_INTERVALS as readonly unknown[]).includes(p.interval)) next.interval = p.interval as BackupInterval;
    if (typeof p.keep === "number" && Number.isFinite(p.keep)) next.keep = Math.max(1, Math.min(200, Math.round(p.keep)));
    await update(next);
  });
  ipcMain.handle("nularche:backup-now", () => run());
  ipcMain.handle("nularche:backup-reveal", () => {
    const dir = current().dir;
    if (dir) void shell.openPath(dir);
  });

  return {
    stop: () => {
      clearTimeout(first);
      clearInterval(timer);
    },
  };
}

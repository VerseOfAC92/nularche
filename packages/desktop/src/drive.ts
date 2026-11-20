// Masaüstü depolama: Origin'in Google Drive ile eşitlenmesi. Hesap bilgisi (yenileme belirteci) işletim sisteminin
// anahtar zinciriyle (safeStorage) şifreli olarak bu bilgisayarın ayar klasöründe durur. Origin klasörü her zaman
// çalışma kopyasıdır (hızlı ve çevrimdışı çalışır); Drive'daki "Nularche" klasörü onun eşidir. Eşitleme kuralları
// core/drive-sync.ts'te, Drive istemcisi core/drive-google.ts'tedir.

import { watch, type FSWatcher } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ipcMain, safeStorage, type BrowserWindow } from "electron";
import { DriveError, DRIVE_SCOPES, GoogleDrive } from "../../core/src/drive-google.ts";
import { clearSyncState, readSyncState, syncOrigin, writeSyncState, type DriveSyncCounts } from "../../core/src/drive-sync.ts";
import { authorizeGoogle, builtInGoogleClient, googleEndpoints, type GoogleClient } from "./google-auth.ts";
import { d } from "./i18n.ts";

const dryRun = !!process.env.NULARCHE_E2E;
const endpoints = {
  token: googleEndpoints.token,
  api: process.env.NULARCHE_DRIVE_API || undefined,
  upload: process.env.NULARCHE_DRIVE_UPLOAD || undefined,
};
/** Arka plan eşitleme aralığı; dosya değişikliklerinde ayrıca kısa bir gecikmeyle eşitlenir. */
const INTERVAL_MS = 60_000;
const CHANGE_DELAY_MS = 4_000;
const ROOT_NAME = "Nularche";

interface StoredDrive extends GoogleClient {
  account: string;
  refreshToken: string;
}

export interface DriveContext {
  window: () => BrowserWindow | null;
  originRoot: () => string | null;
  configDir: () => string;
}

type ErrorCode = "auth" | "network" | "quota" | "invalid" | "unknown";

export interface DriveStatus {
  /** Google ile tek tıkla bağlanma kullanılabilir mi (yerleşik istemci). */
  available: boolean;
  encryption: boolean;
  /** Bağlı Google hesabı. */
  account: string | null;
  /** Bu Origin Drive ile eşitleniyor mu. */
  linked: boolean;
  syncing: boolean;
  lastSync: number | null;
  lastError: { code: ErrorCode; message: string } | null;
  lastCounts: DriveSyncCounts | null;
}

const failure = (e: unknown): { code: ErrorCode; message: string } => ({
  code: e instanceof DriveError ? (e.code === "not_found" ? "invalid" : e.code) : "unknown",
  message: (e as Error).message,
});

export function registerDriveIpc(ctx: DriveContext): { onOriginChanged: () => void; flush: () => Promise<void> } {
  const credFile = () => path.join(ctx.configDir(), "drive-google.bin");
  const canEncrypt = () => dryRun || safeStorage.isEncryptionAvailable();
  let running: Promise<unknown> | null = null;
  let again = false;
  let timer: NodeJS.Timeout | null = null;
  let debounce: NodeJS.Timeout | null = null;
  let watcher: FSWatcher | null = null;
  let quietUntil = 0;
  let lastError: DriveStatus["lastError"] = null;
  let lastCounts: DriveSyncCounts | null = null;

  async function readAccount(): Promise<StoredDrive | null> {
    try {
      const buf = await readFile(credFile());
      const text = dryRun ? buf.toString("utf8") : safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : null;
      return text ? (JSON.parse(text) as StoredDrive) : null;
    } catch {
      return null;
    }
  }

  async function saveAccount(acc: StoredDrive): Promise<void> {
    await mkdir(ctx.configDir(), { recursive: true });
    const text = JSON.stringify(acc);
    await writeFile(credFile(), dryRun ? Buffer.from(text) : safeStorage.encryptString(text), { mode: 0o600 });
  }

  const api = (acc: StoredDrive) => new GoogleDrive({ clientId: acc.clientId, clientSecret: acc.clientSecret, refreshToken: acc.refreshToken }, endpoints);

  function announce(extra: Record<string, unknown> = {}): void {
    ctx.window()?.webContents.send("nularche:drive-synced", extra);
  }

  async function status(): Promise<DriveStatus> {
    const root = ctx.originRoot();
    const acc = await readAccount();
    const state = root ? await readSyncState(root) : null;
    return {
      available: dryRun || !!builtInGoogleClient(),
      encryption: canEncrypt(),
      account: acc?.account ?? null,
      linked: !!(acc && state),
      syncing: !!running,
      lastSync: state?.lastSync ?? null,
      lastError,
      lastCounts,
    };
  }

  /** Bir eşitleme turu; çalışırken yeni bir istek gelirse bittiğinde bir tur daha yapılır. */
  async function syncOnce(): Promise<{ ok: boolean; error?: string }> {
    const root = ctx.originRoot();
    const acc = await readAccount();
    const state = root ? await readSyncState(root) : null;
    if (!root || !acc || !state) return { ok: true };
    announce({ syncing: true });
    try {
      const report = await syncOrigin(root, api(acc), state.rootId, { host: os.hostname().replace(/\.local$/, "") });
      lastCounts = report.counts;
      lastError = report.errors.length ? { code: "unknown", message: report.errors.slice(0, 3).join("\n") } : null;
      if (report.state.account !== acc.account) await writeSyncState(root, { ...report.state, account: acc.account });
      quietUntil = Date.now() + 1500; // kendi yazdığımız dosyalar yeni bir tur başlatmasın
      announce({ downloaded: report.counts.downloaded > 0 || report.counts.deletedLocal > 0 || report.counts.conflicts > 0 });
      return { ok: !report.errors.length, error: lastError?.message };
    } catch (e) {
      lastError = failure(e);
      announce({});
      return { ok: false, error: lastError.message };
    }
  }

  function queueSync(): Promise<{ ok: boolean; error?: string }> {
    if (running) {
      again = true;
      return running as Promise<{ ok: boolean; error?: string }>;
    }
    const run = (async () => {
      let result = await syncOnce();
      while (again) {
        again = false;
        result = await syncOnce();
      }
      return result;
    })();
    running = run.finally(() => (running = null));
    return run;
  }

  /** Arka plan eşitlemesi ve dosya izleme: yalnızca bu Origin Drive'a bağlıyken. */
  async function schedule(): Promise<void> {
    if (timer) clearInterval(timer);
    timer = null;
    watcher?.close();
    watcher = null;
    const root = ctx.originRoot();
    if (!root || !(await readAccount()) || !(await readSyncState(root))) return;
    if (!dryRun) {
      timer = setInterval(() => void queueSync(), INTERVAL_MS);
      timer.unref?.();
    }
    try {
      watcher = watch(root, { recursive: true }, (_e, name) => {
        const rel = name?.toString() ?? "";
        if (!rel || Date.now() < quietUntil || rel.includes("drive-sync.json") || rel.endsWith(".tmp") || rel.includes("sync-removed")) return;
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => void queueSync(), CHANGE_DELAY_MS);
      });
    } catch {
      // izleme desteklenmiyorsa yalnızca zamanlayıcı çalışır
    }
    void queueSync();
  }

  ipcMain.handle("nularche:drive-status", () => status());

  /**
   * Google ile tek tıkla bağlanır ve bu Origin'i Drive'a bağlar. Drive'da daha önce oluşturulmuş bir Nularche
   * klasörü varsa (başka bir bilgisayardan) onunla birleşir; yoksa yenisi oluşturulur. İlk eşitleme her şeyi
   * (notlar, ekler, ayarlar) karşı tarafa taşır; hiçbir dosya silinmez.
   */
  ipcMain.handle("nularche:drive-connect", async () => {
    const root = ctx.originRoot();
    if (!root) return { ok: false, code: "invalid", error: "origin" };
    const client = builtInGoogleClient() ?? (dryRun ? { clientId: "e2e", clientSecret: "e2e" } : null);
    if (!client) return { ok: false, code: "invalid", error: d("drive.noClient") };
    if (!canEncrypt()) return { ok: false, code: "invalid", error: d("ai.noEncryption") };
    try {
      let acc = await readAccount();
      // Kayıtlı bağlantı geri alınmışsa (ör. Google hesabından kaldırılmış) yeniden giriş yapılır.
      if (acc) {
        try {
          await api(acc).account();
        } catch (e) {
          if (!(e instanceof DriveError && e.code === "auth")) throw e;
          acc = null;
        }
      }
      if (!acc) {
        const refreshToken = await authorizeGoogle(client, DRIVE_SCOPES, (m) => new DriveError("auth", m));
        const account = await new GoogleDrive({ ...client, refreshToken }, endpoints).account();
        acc = { ...client, refreshToken, account };
        await saveAccount(acc);
      }
      const drive = api(acc);
      const roots = await drive.findRoots();
      const existing = roots[0];
      const rootId = existing?.id ?? (await drive.createRoot(ROOT_NAME));
      const prev = await readSyncState(root);
      if (!prev || prev.rootId !== rootId) await writeSyncState(root, { version: 1, rootId, account: acc.account, files: {}, local: {} });
      await schedule();
      const result = await (running ?? queueSync());
      return { ok: true, account: acc.account, existing: !!existing, error: (result as { error?: string })?.error ?? null };
    } catch (e) {
      const f = failure(e);
      return { ok: false, code: f.code, error: f.message };
    }
  });

  /** Eşitlemeyi kapatır ve Google hesabının bağlantısını kaldırır: bu bilgisayardaki ve Drive'daki dosyalar kalır. */
  ipcMain.handle("nularche:drive-disconnect", async () => {
    await running?.catch(() => undefined);
    const root = ctx.originRoot();
    if (root) await clearSyncState(root);
    await rm(credFile(), { force: true });
    lastError = null;
    lastCounts = null;
    await schedule();
    announce({});
  });

  ipcMain.handle("nularche:drive-sync", () => queueSync());

  void schedule();
  return {
    onOriginChanged: () => void schedule(),
    /** Çıkmadan önce bekleyen değişiklikleri gönderir (en fazla birkaç saniye). */
    flush: async () => {
      if (debounce) {
        clearTimeout(debounce);
        debounce = null;
        await Promise.race([queueSync(), new Promise((r) => setTimeout(r, 4000))]);
      }
    },
  };
}

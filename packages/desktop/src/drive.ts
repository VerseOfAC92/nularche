// Masaüstü depolama: Origin'in Google Drive ile eşitlenmesi. Hesap bilgisi (yenileme belirteci) ve isteğe bağlı uçtan uca
// şifreleme anahtarı işletim sisteminin anahtar zinciriyle (safeStorage) şifreli olarak bu bilgisayarın ayar klasöründe
// durur; parola hiçbir yere yazılmaz. Origin klasörü her zaman çalışma kopyasıdır (hızlı ve çevrimdışı çalışır);
// Drive'daki "Nularche" klasörü onun eşidir. Eşitleme kuralları core/drive-sync.ts'te, Drive istemcisi
// core/drive-google.ts'tedir.

import { watch, type FSWatcher } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ipcMain, safeStorage, type BrowserWindow } from "electron";
import { DriveError, DRIVE_SCOPES, GoogleDrive } from "../../core/src/drive-google.ts";
import {
  clearSyncState,
  deriveKeys,
  DriveSyncError,
  keyCheck,
  newSalt,
  readSyncState,
  syncOrigin,
  writeSyncState,
  type DriveKeys,
  type DriveSyncCounts,
} from "../../core/src/drive-sync.ts";
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
const MIN_PASSPHRASE = 8;

interface StoredDrive extends GoogleClient {
  account: string;
  refreshToken: string;
  /** Şifreli kökün anahtarı (parolanın kendisi değil, ondan türetilen anahtar). */
  keys?: { rootId: string; enc: string; name: string };
}

export interface DriveContext {
  window: () => BrowserWindow | null;
  originRoot: () => string | null;
  configDir: () => string;
}

type ErrorCode = "auth" | "network" | "quota" | "invalid" | "empty_remote" | "wrong_key" | "unknown";

export interface DriveStatus {
  /** Google ile tek tıkla bağlanma kullanılabilir mi (yerleşik istemci). */
  available: boolean;
  encryption: boolean;
  /** Bağlı Google hesabı. */
  account: string | null;
  /** Bu Origin Drive ile eşitleniyor mu. */
  linked: boolean;
  /** Drive'daki kopya uçtan uca şifreli mi. */
  encrypted: boolean;
  /** Drive'daki kopya şifreli ama bu bilgisayarda anahtarı yok: parola girilmeli. */
  needsPassphrase: boolean;
  syncing: boolean;
  lastSync: number | null;
  lastError: { code: ErrorCode; message: string } | null;
  lastCounts: DriveSyncCounts | null;
}

const failure = (e: unknown): { code: ErrorCode; message: string } => ({
  code: e instanceof DriveError ? (e.code === "not_found" ? "invalid" : e.code) : e instanceof DriveSyncError ? e.code : "unknown",
  message: (e as Error).message,
});

export function registerDriveIpc(ctx: DriveContext): { onOriginChanged: () => void; flush: () => Promise<void> } {
  const credFile = () => path.join(ctx.configDir(), "drive-google.bin");
  const canEncrypt = () => dryRun || safeStorage.isEncryptionAvailable();
  let running: Promise<{ ok: boolean; error?: string }> | null = null;
  let again = false;
  let timer: NodeJS.Timeout | null = null;
  let debounce: NodeJS.Timeout | null = null;
  let watcher: FSWatcher | null = null;
  let quietUntil = 0;
  let lastError: DriveStatus["lastError"] = null;
  let lastCounts: DriveSyncCounts | null = null;
  let needsPassphrase = false;

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
  const keysFor = (acc: StoredDrive, rootId: string): DriveKeys | null =>
    acc.keys && acc.keys.rootId === rootId ? { enc: Buffer.from(acc.keys.enc, "base64"), name: Buffer.from(acc.keys.name, "base64") } : null;
  const storeKeys = (acc: StoredDrive, rootId: string, keys: DriveKeys): StoredDrive => ({
    ...acc,
    keys: { rootId, enc: keys.enc.toString("base64"), name: keys.name.toString("base64") },
  });

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
      encrypted: !!state?.encrypted,
      needsPassphrase: !!(acc && state && needsPassphrase),
      syncing: !!running,
      lastSync: state?.lastSync ?? null,
      lastError,
      lastCounts,
    };
  }

  /**
   * Bağlı kökün hâlâ geçerli olduğunu doğrular. Kök silinmiş ya da şifrelemeyle değiştirilmişse (başka bir bilgisayardan)
   * hiçbir dosya silinmeden yeni köke geçilir; şifreli köke geçmek için bu bilgisayarda parola gerekir.
   */
  async function resolveRoot(acc: StoredDrive, root: string): Promise<{ rootId: string; keys: DriveKeys | null } | null> {
    const state = await readSyncState(root);
    if (!state) return null;
    const drive = api(acc);
    const info = await drive.rootInfo(state.rootId);
    let rootId = state.rootId;
    let encrypted = !!info?.encrypted;
    if (!info || info.trashed) {
      const next = (await drive.findRoots()).find((r) => !r.trashed);
      if (!next) throw new DriveSyncError("empty_remote", d("drive.rootGone"));
      rootId = next.id;
      encrypted = next.encrypted;
      // Yeni köke birleştirerek geçilir (bilinen durum yok: hiçbir dosya silinmez).
      await writeSyncState(root, { version: 2, rootId, account: acc.account, encrypted, files: {}, local: state.local, bases: {} });
    } else if (encrypted !== !!state.encrypted) await writeSyncState(root, { ...state, encrypted });
    const keys = encrypted ? keysFor(acc, rootId) : null;
    needsPassphrase = encrypted && !keys;
    return needsPassphrase ? null : { rootId, keys };
  }

  /** Bir eşitleme turu; çalışırken yeni bir istek gelirse bittiğinde bir tur daha yapılır. */
  async function syncOnce(): Promise<{ ok: boolean; error?: string }> {
    const root = ctx.originRoot();
    const acc = await readAccount();
    if (!root || !acc || !(await readSyncState(root))) return { ok: true };
    announce({ syncing: true });
    try {
      const target = await resolveRoot(acc, root);
      if (!target) {
        announce({});
        return { ok: false, error: d("drive.needsPassphrase") };
      }
      const report = await syncOrigin(root, api(acc), target.rootId, { host: os.hostname().replace(/\.local$/, ""), keys: target.keys });
      lastCounts = report.counts;
      lastError = report.errors.length ? { code: "unknown", message: report.errors.slice(0, 3).join("\n") } : null;
      if (report.state.account !== acc.account) await writeSyncState(root, { ...report.state, account: acc.account });
      quietUntil = Date.now() + 1500; // kendi yazdığımız dosyalar yeni bir tur başlatmasın
      announce({ downloaded: report.counts.downloaded > 0 || report.counts.deletedLocal > 0 || report.counts.conflicts > 0 || report.counts.merged > 0 });
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
      return running;
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

  /** Bu Origin'in içeriğini yeni bir Drive köküne taşır (şifreleme açılırken ya da kapatılırken) ve eski kökü kalıcı siler. */
  async function moveToNewRoot(acc: StoredDrive, root: string, crypto: { keys: DriveKeys; salt: string } | null): Promise<{ ok: boolean; error?: string }> {
    await running?.catch(() => undefined);
    const state = await readSyncState(root);
    if (!state) return { ok: false, error: "not linked" };
    const drive = api(acc);
    const oldRoot = state.rootId;
    // Önce mevcut köke son değişiklikler gönderilir (başka bilgisayarlardan gelenler de alınır).
    const oldKeys = state.encrypted ? keysFor(acc, oldRoot) : null;
    if (!state.encrypted || oldKeys) await syncOrigin(root, drive, oldRoot, { host: os.hostname(), keys: oldKeys });
    const newRoot = await drive.createRoot(ROOT_NAME, crypto ? { salt: crypto.salt, check: keyCheck(crypto.keys) } : undefined);
    const next: StoredDrive = crypto ? storeKeys(acc, newRoot, crypto.keys) : { ...acc, keys: undefined };
    await saveAccount(next);
    await writeSyncState(root, { version: 2, rootId: newRoot, account: acc.account, encrypted: !!crypto, files: {}, local: state.local, bases: {} });
    const report = await syncOrigin(root, drive, newRoot, { host: os.hostname(), keys: crypto?.keys ?? null });
    if (report.errors.length) return { ok: false, error: report.errors.slice(0, 3).join("\n") };
    // Eski kök (ve içindeki her şey, Drive'ın sürüm geçmişi dahil) kalıcı silinir: içerik artık yeni kökte.
    await drive.remove(oldRoot);
    needsPassphrase = false;
    lastError = null;
    lastCounts = report.counts;
    announce({});
    return { ok: true };
  }

  ipcMain.handle("nularche:drive-status", () => status());

  /**
   * Google ile tek tıkla bağlanır ve bu Origin'i Drive'a bağlar. Drive'da daha önce oluşturulmuş bir Nularche
   * klasörü varsa (başka bir bilgisayardan) onunla birleşir; yoksa yenisi oluşturulur. İlk eşitleme her şeyi
   * (notlar, ekler, ayarlar) karşı tarafa taşır; hiçbir dosya silinmez. Klasör şifreliyse önce parola istenir.
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
      const existing = (await drive.findRoots()).find((r) => !r.trashed);
      const rootId = existing?.id ?? (await drive.createRoot(ROOT_NAME));
      const prev = await readSyncState(root);
      if (!prev || prev.rootId !== rootId) await writeSyncState(root, { version: 2, rootId, account: acc.account, encrypted: !!existing?.encrypted, files: {}, local: {}, bases: {} });
      if (existing?.encrypted && !keysFor(acc, rootId)) {
        needsPassphrase = true;
        announce({});
        return { ok: true, account: acc.account, existing: true, needsPassphrase: true, error: null };
      }
      await schedule();
      const result = await (running ?? queueSync());
      return { ok: true, account: acc.account, existing: !!existing, needsPassphrase: false, error: result.error ?? null };
    } catch (e) {
      const f = failure(e);
      return { ok: false, code: f.code, error: f.message };
    }
  });

  /** Başka bir bilgisayarda şifrelenmiş Drive klasörünü bu bilgisayarda açar (parola doğrulanır, anahtar saklanır). */
  ipcMain.handle("nularche:drive-unlock", async (_e, passphrase: unknown) => {
    const root = ctx.originRoot();
    const acc = await readAccount();
    const state = root ? await readSyncState(root) : null;
    if (!root || !acc || !state || typeof passphrase !== "string" || !passphrase) return { ok: false, code: "invalid", error: "input" };
    try {
      const info = await api(acc).rootInfo(state.rootId);
      if (!info?.encrypted || !info.salt || !info.check) return { ok: false, code: "invalid", error: d("drive.notEncrypted") };
      const keys = await deriveKeys(passphrase, info.salt);
      if (keyCheck(keys) !== info.check) return { ok: false, code: "wrong_passphrase", error: d("drive.wrongPassphrase") };
      await saveAccount(storeKeys(acc, state.rootId, keys));
      needsPassphrase = false;
      await schedule();
      const result = await (running ?? queueSync());
      return { ok: true, error: result.error ?? null };
    } catch (e) {
      const f = failure(e);
      return { ok: false, code: f.code, error: f.message };
    }
  });

  /** Uçtan uca şifrelemeyi açar: içerik parolayla şifrelenmiş yeni bir köke taşınır, eski açık kök kalıcı silinir. */
  ipcMain.handle("nularche:drive-encrypt", async (_e, passphrase: unknown) => {
    const root = ctx.originRoot();
    const acc = await readAccount();
    if (!root || !acc || typeof passphrase !== "string") return { ok: false, code: "invalid", error: "input" };
    if (passphrase.length < MIN_PASSPHRASE) return { ok: false, code: "invalid", error: d("drive.shortPassphrase") };
    try {
      const salt = newSalt();
      const keys = await deriveKeys(passphrase, salt);
      return await moveToNewRoot(acc, root, { keys, salt });
    } catch (e) {
      const f = failure(e);
      return { ok: false, code: f.code, error: f.message };
    }
  });

  /** Uçtan uca şifrelemeyi kapatır: içerik açık yeni bir köke taşınır, şifreli kök kalıcı silinir. */
  ipcMain.handle("nularche:drive-decrypt", async () => {
    const root = ctx.originRoot();
    const acc = await readAccount();
    if (!root || !acc) return { ok: false, code: "invalid", error: "input" };
    try {
      return await moveToNewRoot(acc, root, null);
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
    needsPassphrase = false;
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

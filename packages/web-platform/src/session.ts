// Web sürümünde bir Origin oturumu: Google Drive'daki Nularche kök klasörü bulunur, şifreliyse parola doğrulanır,
// notlar Drive'dan sayfanın belleğine (vfs) indirilir ve ortak API işleyicisi bağlanır. Sonraki değişiklikler kısa
// bir beklemeyle Drive'a gönderilir, Drive'daki değişiklikler düzenli aralıklarla çekilir. Kilitleme ya da çıkış
// bellekteki her şeyi siler; notlar ve anahtarlar diske, tarayıcı depolamasına ya da önbelleğe hiç yazılmaz.

import { AiActivity } from "../../core/src/ai-activity.ts";
import { Anamnesis } from "../../core/src/anamnesis.ts";
import { CommentStore } from "../../core/src/comments.ts";
import { deriveKeys, keyCheck, syncable, syncOrigin, type DriveApi, type DriveKeys, type DriveSyncReport, type RootInfo } from "../../core/src/drive-sync.ts";
import { NodeStore } from "../../core/src/node-store.ts";
import { createApi, EventHub } from "../../server/src/api.ts";
import { setApiHandler } from "./host.ts";
import { vfs } from "./vfs.ts";

/** Origin'in bellek içi yolu: Drive'daki kök klasörün adı (masaüstündeki Origin adıyla aynı; arayüzde görünür). */
export const originDir = (root: { name: string }) => `/${root.name.replace(/[\\/]/g, "-").trim() || "Origin"}`;

export type OriginRoot = { id: string; name: string; modified: number } & RootInfo;

export type OpenErrorCode = "no_origin" | "passphrase_required" | "wrong_passphrase";
export class OpenError extends Error {
  readonly code: OpenErrorCode;
  constructor(code: OpenErrorCode, message: string) {
    super(message);
    this.name = "OpenError";
    this.code = code;
  }
}

/** Drive'daki en yeni (çöpte olmayan) Nularche kök klasörü; masaüstü uygulamasıyla aynı seçim. */
export async function findOrigin(drive: DriveApi): Promise<OriginRoot> {
  const root = (await drive.findRoots()).find((r) => !r.trashed);
  if (!root) throw new OpenError("no_origin", "Bu Google Drive'da Nularche notu yok. Önce masaüstü uygulamasında Google Drive eşitlemesini açın.");
  return root;
}

/** Şifreli kökün parolasını doğrular ve anahtarları döndürür; açık kökte null. */
export async function unlockKeys(root: RootInfo, passphrase: string | null): Promise<DriveKeys | null> {
  if (!root.encrypted) return null;
  if (!passphrase || !root.salt || !root.check) throw new OpenError("passphrase_required", "Bu notlar uçtan uca şifreli; parolanızı girin.");
  const keys = await deriveKeys(passphrase, root.salt);
  if (keyCheck(keys) !== root.check) throw new OpenError("wrong_passphrase", "Parola yanlış.");
  return keys;
}

export interface WebOriginOptions {
  /** Değişiklik ile Drive'a gönderme arasındaki bekleme (ms). */
  pushDelay?: number;
  /** Drive'dan değişiklik çekme aralığı (ms); 0 kapatır. */
  pullEvery?: number;
  /** Eşitleme durumu (arayüzdeki gösterge için). */
  onStatus?: (status: SyncStatus) => void;
}

export type SyncStatus = { state: "syncing" } | { state: "idle"; at: number; report?: DriveSyncReport } | { state: "error"; message: string };

export interface WebOrigin {
  readonly root: OriginRoot;
  readonly store: NodeStore;
  /** Bekleyen değişiklikleri hemen Drive'a gönderir ve Drive'daki değişiklikleri çeker. */
  sync(): Promise<DriveSyncReport | null>;
  /** Drive'a henüz gönderilmemiş değişiklik ya da süren eşitleme var mı (sekme kapatılırken uyarı için). */
  pending(): boolean;
  /** Bekleyen değişiklikler gönderildikten sonra (`flush`) belleği temizler; oturum kullanılamaz hâle gelir. */
  close(options?: { flush?: boolean }): Promise<void>;
}

/** Drive'daki notları belleğe indirir ve API'yi bağlar. Önceki oturum varsa önce kapatılmış olmalıdır. */
export async function openOrigin(drive: DriveApi, root: OriginRoot, keys: DriveKeys | null, options: WebOriginOptions = {}): Promise<WebOrigin> {
  const pushDelay = options.pushDelay ?? 2000;
  const pullEvery = options.pullEvery ?? 60_000;
  const status = options.onStatus ?? (() => undefined);
  const dir = originDir(root);
  vfs.clear();
  await vfs.mkdir(dir, { recursive: true });

  let running: Promise<DriveSyncReport | null> | null = null;
  let again = false;
  let closed = false;
  let syncing = false;
  const runOnce = async (): Promise<DriveSyncReport | null> => {
    if (closed) return null;
    syncing = true;
    status({ state: "syncing" });
    try {
      const report = await syncOrigin(dir, drive, root.id, { host: "Web", keys });
      status({ state: "idle", at: Date.now(), report });
      return report;
    } catch (err) {
      status({ state: "error", message: err instanceof Error ? err.message : String(err) });
      throw err;
    } finally {
      syncing = false;
    }
  };
  /** Aynı anda tek eşitleme; sürerken gelen istek bittikten sonra bir kez daha çalışır. */
  const sync = (): Promise<DriveSyncReport | null> => {
    if (running) {
      again = true;
      return running;
    }
    running = runOnce().finally(() => {
      running = null;
      if (again && !closed) {
        again = false;
        void sync().catch(() => undefined);
      }
    });
    return running;
  };

  // İlk indirme: hata (ör. çözülemeyen dosya) oturumu açtırmaz.
  try {
    await sync();
  } catch (err) {
    vfs.clear();
    throw err;
  }

  const store = new NodeStore(dir);
  await store.ensureRoot();
  const events = new EventHub();
  const api = createApi({ store, activity: new AiActivity(store.root), comments: new CommentStore(store), anamnesis: new Anamnesis(store), events });

  let pushTimer: ReturnType<typeof setTimeout> | null = null;
  const schedulePush = () => {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushTimer = null;
      void sync().catch(() => undefined);
    }, pushDelay);
  };
  const unsubscribe = vfs.onChange((change) => {
    if (closed) return;
    events.emit("change");
    // Eşitlenmeyen dosyalar (eşitleme durumu, yerel önbellekler) göndermeyi tetiklemez. Eşitleme sürerken gelen
    // değişiklik (kullanıcı ya da indirilen dosya) bitince bir tur daha çalıştırır; ikinci tur yeni bir şey indirmediği
    // için döngü oluşmaz.
    if (!change.path.startsWith(`${dir}/`) || !syncable(change.path.slice(dir.length + 1))) return;
    if (syncing) again = true;
    else schedulePush();
  });
  const pullTimer = pullEvery > 0 ? setInterval(() => void sync().catch(() => undefined), pullEvery) : null;
  setApiHandler((request) => api.handle(request));

  return {
    root,
    store,
    sync,
    pending: () => !closed && (!!pushTimer || !!running),
    async close({ flush = true } = {}) {
      if (closed) return;
      if (pushTimer) {
        clearTimeout(pushTimer);
        pushTimer = null;
        if (flush) await sync().catch(() => undefined);
      } else if (flush && running) await running.catch(() => undefined);
      closed = true;
      if (pullTimer) clearInterval(pullTimer);
      unsubscribe();
      setApiHandler(null);
      events.close();
      vfs.clear();
    },
  };
}

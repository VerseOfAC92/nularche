// Origin ↔ bulut klasörü eşitlemesi (Google Drive). Bu modül sağlayıcıdan bağımsızdır: hangi dosyanın eşitleneceği,
// yerel ve uzak değişikliklerin son eşitlemeye göre nasıl birleştirileceği ve eşitleme durumu
// (`.nularche/drive-sync.json`) burada tanımlıdır. Google Drive istemcisi drive-google.ts'tedir; kimlik bilgileri
// masaüstü uygulamasında şifreli saklanır.
//
// Kurallar (dosya başına, son eşitlemede iki tarafta da aynı olan içeriğe göre):
//  - yalnızca bir taraf değiştiyse o taraf diğerine yazılır (silme dahil);
//  - iki taraf da değiştiyse uzak kopya yerel dosyanın yerine geçer, yerel hâl "(çakışma …)" adlı bir kopya olarak
//    saklanır ve o da yüklenir; silinenle düzenlenen çakışırsa düzenleme kazanır;
//  - ilk eşitlemede (bilinen durum yoksa) aynı içerik eşleşir, yalnız bir tarafta olan diğerine kopyalanır, farklı
//    içerik yukarıdaki çakışma kuralıyla birleşir. Hiçbir dosya sessizce kaybolmaz: uzakta silinen yerel dosya
//    `.nularche/sync-removed/` altına taşınır, yerelde silinen uzak dosya Drive çöpüne gider.

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export interface RemoteEntry {
  id: string;
  name: string;
  /** Üst klasörün id'si (kök klasörün kendisi için null). */
  parent: string | null;
  folder: boolean;
  md5?: string;
  size?: number;
}

/** Bulut sağlayıcısının eşitlemenin ihtiyaç duyduğu yüzü. Tüm öğeler bir kök klasör altında tutulur. */
export interface DriveApi {
  /** Bağlı hesabın görünen adı (e-posta). */
  account(): Promise<string>;
  /** Daha önce oluşturulmuş Nularche kök klasörleri (en yeni önce). */
  findRoots(): Promise<{ id: string; name: string; modified: number }[]>;
  createRoot(name: string): Promise<string>;
  /** Kökün altındaki bütün klasör ve dosyalar (çöptekiler hariç). */
  listTree(rootId: string): Promise<RemoteEntry[]>;
  createFolder(rootId: string, parent: string, name: string): Promise<RemoteEntry>;
  /** `id` verilirse içeriği günceller, yoksa `parent` altında yeni dosya oluşturur. */
  upload(rootId: string, input: { id?: string; parent: string; name: string; data: Uint8Array }): Promise<RemoteEntry>;
  download(id: string): Promise<Uint8Array>;
  /** Öğeyi bulutun çöp kutusuna taşır (geri getirilebilir). */
  trash(id: string): Promise<void>;
}

export const DRIVE_SYNC_FILE = path.join(".nularche", "drive-sync.json");
const REMOVED_DIR = ".nularche/sync-removed";

export interface SyncedFile {
  /** Son eşitlemede iki tarafta da bulunan içeriğin MD5'i. */
  md5: string;
  remoteId: string;
}

export interface DriveSyncState {
  version: 1;
  rootId: string;
  account?: string;
  lastSync?: number;
  /** Origin'e göre POSIX yol (NFC) → son eşitlenen hâl. */
  files: Record<string, SyncedFile>;
  /** Yerel dosya özeti önbelleği: değişmeyen dosyalar yeniden okunmasın diye. */
  local?: Record<string, { size: number; mtime: number; md5: string }>;
}

export interface DriveSyncCounts {
  uploaded: number;
  downloaded: number;
  deletedLocal: number;
  deletedRemote: number;
  conflicts: number;
}

export interface DriveSyncReport {
  state: DriveSyncState;
  counts: DriveSyncCounts;
  /** Dosya düzeyindeki hatalar; diğer dosyalar eşitlenmeye devam eder. */
  errors: string[];
}

/** Eşitlenmeyen yollar: eşitleme durumunun kendisi, kaldırılanlar, geçici ve sistem dosyaları. */
export function syncable(rel: string): boolean {
  if (rel === DRIVE_SYNC_FILE.split(path.sep).join("/") || rel.startsWith(`${REMOVED_DIR}/`)) return false;
  const base = rel.split("/").pop() ?? "";
  if (base === ".DS_Store" || base === "Thumbs.db" || base === "desktop.ini" || base.endsWith(".tmp") || base.startsWith("~$")) return false;
  const parts = rel.split("/");
  // Gizli klasörlerden yalnızca Nularche'nin kendi klasörü eşitlenir (ör. .git, .obsidian değil).
  if (parts.slice(0, -1).some((p) => p.startsWith(".") && p !== ".nularche")) return false;
  if (parts[0] === "node_modules") return false;
  return true;
}

const nfc = (s: string) => s.normalize("NFC");
const md5 = (data: Uint8Array) => createHash("md5").update(data).digest("hex");

export async function readSyncState(root: string): Promise<DriveSyncState | null> {
  try {
    const raw = JSON.parse(await readFile(path.join(root, DRIVE_SYNC_FILE), "utf8"));
    if (!raw || typeof raw.rootId !== "string" || !raw.rootId || typeof raw.files !== "object") return null;
    const files: Record<string, SyncedFile> = {};
    for (const [k, v] of Object.entries(raw.files as Record<string, unknown>)) {
      const f = v as Partial<SyncedFile>;
      if (typeof f?.md5 === "string" && typeof f.remoteId === "string") files[k] = { md5: f.md5, remoteId: f.remoteId };
    }
    return {
      version: 1,
      rootId: raw.rootId,
      account: typeof raw.account === "string" ? raw.account : undefined,
      lastSync: typeof raw.lastSync === "number" ? raw.lastSync : undefined,
      files,
      local: raw.local && typeof raw.local === "object" ? raw.local : {},
    };
  } catch {
    return null;
  }
}

export async function writeSyncState(root: string, state: DriveSyncState): Promise<void> {
  const file = path.join(root, DRIVE_SYNC_FILE);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(state));
  await rename(tmp, file);
}

/** Eşitlemeyi bırakır: durum dosyası silinir; yerel ve uzak dosyalar olduğu gibi kalır. */
export async function clearSyncState(root: string): Promise<void> {
  await rm(path.join(root, DRIVE_SYNC_FILE), { force: true });
}

interface LocalFile {
  rel: string;
  abs: string;
  size: number;
  mtime: number;
  md5: string;
}

async function scanLocal(root: string, cache: DriveSyncState["local"]): Promise<Map<string, LocalFile>> {
  const out = new Map<string, LocalFile>();
  async function walk(dir: string, relDir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
      throw e;
    }
    for (const e of entries) {
      const rel = nfc(relDir ? `${relDir}/${e.name}` : e.name);
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!syncable(`${rel}/x`)) continue;
        await walk(abs, rel);
      } else if (e.isFile() && syncable(rel)) {
        const st = await stat(abs).catch(() => null);
        if (!st) continue;
        const known = cache?.[rel];
        const sum = known && known.size === st.size && known.mtime === st.mtimeMs ? known.md5 : md5(await readFile(abs));
        out.set(rel, { rel, abs, size: st.size, mtime: st.mtimeMs, md5: sum });
      }
    }
  }
  await walk(root, "");
  return out;
}

/** Uzak ağacı Origin'e göre yollara çevirir (yol, klasör adlarından hesaplanır; Drive'da yeniden adlandırma izlenir). */
function remotePaths(rootId: string, entries: RemoteEntry[]): { files: Map<string, RemoteEntry>; folders: Map<string, string> } {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const pathOf = (e: RemoteEntry, seen = new Set<string>()): string | null => {
    if (seen.has(e.id)) return null;
    seen.add(e.id);
    if (e.parent === rootId) return nfc(e.name);
    const parent = e.parent ? byId.get(e.parent) : undefined;
    if (!parent || !parent.folder) return null;
    const p = pathOf(parent, seen);
    return p === null ? null : `${p}/${nfc(e.name)}`;
  };
  const files = new Map<string, RemoteEntry>();
  const folders = new Map<string, string>([["", rootId]]);
  for (const e of entries) {
    const p = pathOf(e);
    if (p === null) continue;
    if (e.folder) folders.set(p, e.id);
    else if (syncable(p) && !files.has(p)) files.set(p, e);
  }
  return { files, folders };
}

/** Çakışan yerel hâlin saklanacağı yol: "Not (çakışma Mac 2026-11-20 14.05).md". */
export function conflictPath(rel: string, host: string, now: number, exists: (p: string) => boolean): string {
  const dir = path.posix.dirname(rel);
  const ext = path.posix.extname(rel);
  const base = path.posix.basename(rel, ext);
  const d = new Date(now);
  const p2 = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}.${p2(d.getMinutes())}`;
  const safeHost = host.replace(/[\\/:*?"<>|]/g, "").slice(0, 40) || "device";
  for (let i = 1; ; i++) {
    const name = `${base} (conflict ${safeHost} ${stamp}${i > 1 ? ` ${i}` : ""})${ext}`;
    const candidate = dir === "." ? name : `${dir}/${name}`;
    if (!exists(candidate)) return candidate;
  }
}

async function writeLocal(root: string, rel: string, data: Uint8Array): Promise<void> {
  const abs = path.join(root, ...rel.split("/"));
  await mkdir(path.dirname(abs), { recursive: true });
  const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.${randomUUID()}.tmp`);
  await writeFile(tmp, data);
  await rename(tmp, abs);
}

/** Uzakta silinen dosyayı yerelden kaldırır ama `.nularche/sync-removed/` altında saklar. */
async function removeLocal(root: string, rel: string, now: number): Promise<void> {
  const abs = path.join(root, ...rel.split("/"));
  const day = new Date(now).toISOString().slice(0, 10);
  const dest = path.join(root, ...REMOVED_DIR.split("/"), day, ...rel.split("/"));
  await mkdir(path.dirname(dest), { recursive: true });
  await rename(abs, dest).catch(async (e) => {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  });
}

export interface DriveSyncOptions {
  /** Çakışma kopyalarının adında görünen cihaz adı. */
  host: string;
  now?: number;
  /** Aynı anda en çok kaç aktarım (varsayılan 4). */
  concurrency?: number;
  /** İptal: eşitleme sırasında Origin değişirse. */
  signal?: AbortSignal;
}

/**
 * Origin'i bulut klasörüyle bir kez eşitler ve güncellenmiş durumu kaydedip döndürür.
 * `state` yoksa (ilk bağlantı) `rootId`'deki klasörle hiçbir şey bilinmeden birleştirilir.
 */
export async function syncOrigin(root: string, api: DriveApi, rootId: string, options: DriveSyncOptions): Promise<DriveSyncReport> {
  const now = options.now ?? Date.now();
  const prev = await readSyncState(root);
  const base = prev && prev.rootId === rootId ? prev.files : {};
  const state: DriveSyncState = { version: 1, rootId, account: prev?.account, files: {}, local: {} };
  const counts: DriveSyncCounts = { uploaded: 0, downloaded: 0, deletedLocal: 0, deletedRemote: 0, conflicts: 0 };
  const errors: string[] = [];

  const local = await scanLocal(root, prev?.local);
  const { files: remote, folders } = remotePaths(rootId, await api.listTree(rootId));

  // Uzak klasörler gerektikçe ve tek kez oluşturulur.
  const pendingFolders = new Map<string, Promise<string>>();
  const folderId = (dir: string): Promise<string> => {
    if (dir === "" || dir === ".") return Promise.resolve(rootId);
    const known = folders.get(dir);
    if (known) return Promise.resolve(known);
    let p = pendingFolders.get(dir);
    if (!p) {
      p = folderId(path.posix.dirname(dir) === "." ? "" : path.posix.dirname(dir)).then(async (parent) => {
        const made = await api.createFolder(rootId, parent, path.posix.basename(dir));
        folders.set(dir, made.id);
        return made.id;
      });
      pendingFolders.set(dir, p);
    }
    return p;
  };
  const dirOf = (rel: string) => (path.posix.dirname(rel) === "." ? "" : path.posix.dirname(rel));

  const taken = new Set([...local.keys(), ...remote.keys()]);
  const tasks: (() => Promise<void>)[] = [];
  const keep = (rel: string, md5sum: string, remoteId: string) => (state.files[rel] = { md5: md5sum, remoteId });

  const upload = async (rel: string, file: LocalFile, remoteId?: string) => {
    const data = await readFile(file.abs);
    const sum = md5(data);
    const made = await api.upload(rootId, { id: remoteId, parent: await folderId(dirOf(rel)), name: path.posix.basename(rel), data });
    keep(rel, sum, made.id);
    // Yüklemeden sonra dosya değişmediyse özeti önbelleğe alınır.
    if (sum === file.md5) state.local![rel] = { size: file.size, mtime: file.mtime, md5: sum };
    counts.uploaded++;
  };
  const download = async (rel: string, entry: RemoteEntry) => {
    const data = await api.download(entry.id);
    await writeLocal(root, rel, data);
    const st = await stat(path.join(root, ...rel.split("/")));
    const sum = md5(data);
    keep(rel, sum, entry.id);
    state.local![rel] = { size: st.size, mtime: st.mtimeMs, md5: sum };
    counts.downloaded++;
  };
  /** İki taraf da farklı içerikle değişti: yerel hâl bir kopyaya taşınır ve yüklenir, uzak içerik indirilir. */
  const conflict = async (rel: string, file: LocalFile, entry: RemoteEntry) => {
    const copy = conflictPath(rel, options.host, now, (p) => taken.has(p));
    taken.add(copy);
    const absCopy = path.join(root, ...copy.split("/"));
    await rename(file.abs, absCopy);
    const st = await stat(absCopy);
    await upload(copy, { ...file, rel: copy, abs: absCopy, size: st.size, mtime: st.mtimeMs });
    await download(rel, entry);
    counts.conflicts++;
  };

  for (const rel of [...taken].sort()) {
    const L = local.get(rel);
    const R = remote.get(rel);
    const b = base[rel];
    if (L) state.local![rel] = { size: L.size, mtime: L.mtime, md5: L.md5 };
    const lSum = L?.md5;
    const rSum = R?.md5;
    // Drive bazı dosyalar için MD5 vermez (ör. Google dokümanları); bunlar yalnızca indirilmez, karşılaştırılmaz.
    if (R && !rSum && !L) continue;
    if (L && R && lSum === rSum) {
      keep(rel, lSum!, R.id);
      continue;
    }
    const lChanged = lSum !== b?.md5;
    const rChanged = rSum !== b?.md5;
    let task: (() => Promise<void>) | null = null;
    if (!b) {
      if (L && !R) task = () => upload(rel, L);
      else if (R && !L) task = () => download(rel, R);
      else if (L && R) task = () => conflict(rel, L, R);
    } else if (lChanged && !rChanged) {
      if (L) task = () => upload(rel, L, R?.id ?? b.remoteId);
      else if (R)
        task = async () => {
          await api.trash(R.id);
          counts.deletedRemote++;
        };
    } else if (rChanged && !lChanged) {
      if (R) task = () => download(rel, R);
      else if (L)
        task = async () => {
          await removeLocal(root, rel, now);
          delete state.local![rel];
          counts.deletedLocal++;
        };
    } else {
      // İki taraf da değişti.
      if (L && R) task = () => conflict(rel, L, R);
      else if (R) task = () => download(rel, R); // yerelde silinmiş, uzakta düzenlenmiş: düzenleme kazanır
      else if (L) task = () => upload(rel, L); // uzakta silinmiş, yerelde düzenlenmiş: düzenleme kazanır
    }
    if (!task) continue;
    // Başarısız aktarımda eski bilinen durum korunur; bir sonraki eşitleme yeniden dener.
    const t = task;
    tasks.push(async () => {
      try {
        await t();
      } catch (e) {
        if (b) state.files[rel] = b;
        errors.push(`${rel}: ${(e as Error).message}`);
      }
    });
  }

  const limit = Math.max(1, options.concurrency ?? 4);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      while (next < tasks.length) {
        if (options.signal?.aborted) return;
        await tasks[next++]();
      }
    }),
  );

  state.lastSync = now;
  await writeSyncState(root, state);
  return { state, counts, errors };
}

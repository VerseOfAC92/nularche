// Origin ↔ bulut klasörü eşitlemesi (Google Drive). Bu modül sağlayıcıdan bağımsızdır: hangi dosyanın eşitleneceği,
// yerel ve uzak değişikliklerin son eşitlemeye göre nasıl birleştirileceği, isteğe bağlı uçtan uca şifreleme ve
// eşitleme durumu (`.nularche/drive-sync.json`) burada tanımlıdır. Google Drive istemcisi drive-google.ts'tedir;
// kimlik bilgileri ve şifreleme anahtarı masaüstü uygulamasında işletim sisteminin parola deposunda saklanır.
//
// Ne eşitlenir: kullanıcının oluşturduğu içerik ve ayarlar (notlar, ekler, arayüz tercihleri, Marginalia, Epoch'lar,
// CSS parçacıkları). Bilgisayarın kendi kayıtları eşitlenmez (otomatik sürüm geçmişi, Nularche AI kayıtları ve geri
// alma kopyaları, takvim önbelleği ve bağlantı durumu); bunların Drive'a daha önce gitmiş kopyaları çöpe taşınır.
//
// Kurallar (dosya başına, son eşitlemede iki tarafta da bilinen içeriğe göre):
//  - yalnızca bir taraf değiştiyse o taraf diğerine yazılır (silme dahil);
//  - iki taraf da değiştiyse: ayar dosyaları (ui.json) anahtar anahtar birleştirilir; diğer dosyalarda uzak sürüm
//    yerine geçer ve yerel hâl "(conflict …)" adlı bir kopya olarak saklanıp yüklenir; silinenle düzenlenen
//    çakışırsa düzenleme kazanır;
//  - hiçbir dosya sessizce kaybolmaz: uzakta silinen yerel dosya `.nularche/sync-removed/` altına taşınır, yerelde
//    silinen uzak dosya Drive çöpüne gider.

import { createCipheriv, createDecipheriv, createHash, createHmac, pbkdf2, randomBytes, randomUUID } from "node:crypto";
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

export interface RootInfo {
  trashed: boolean;
  /** Uçtan uca şifreli kök: içerik ve dosya adları kullanıcının parolasından türetilen anahtarla şifrelidir. */
  encrypted: boolean;
  salt?: string;
  check?: string;
}

/** Bulut sağlayıcısının eşitlemenin ihtiyaç duyduğu yüzü. Tüm öğeler bir kök klasör altında tutulur. */
export interface DriveApi {
  /** Bağlı hesabın görünen adı (e-posta). */
  account(): Promise<string>;
  /** Daha önce oluşturulmuş Nularche kök klasörleri (en yeni önce). */
  findRoots(): Promise<({ id: string; name: string; modified: number } & RootInfo)[]>;
  createRoot(name: string, crypto?: { salt: string; check: string }): Promise<string>;
  /** Kök klasörün durumu; yoksa null. */
  rootInfo(rootId: string): Promise<RootInfo | null>;
  /** Kökün altındaki bütün klasör ve dosyalar (çöptekiler hariç). */
  listTree(rootId: string): Promise<RemoteEntry[]>;
  createFolder(rootId: string, parent: string, name: string): Promise<RemoteEntry>;
  /** `id` verilirse içeriği günceller, yoksa `parent` altında yeni dosya oluşturur. */
  upload(rootId: string, input: { id?: string; parent: string; name: string; data: Uint8Array }): Promise<RemoteEntry>;
  download(id: string): Promise<Uint8Array>;
  /** Öğeyi bulutun çöp kutusuna taşır (geri getirilebilir). */
  trash(id: string): Promise<void>;
  /** Öğeyi kalıcı olarak siler (çöp kutusu ve sürüm geçmişi dahil); kilitlenen notların şifresiz izleri için. */
  remove(id: string): Promise<void>;
}

// --- Kalıcı silme listesi ----------------------------------------------------------------------------------------
// Bir not kilitlenince şifresiz eski hâlleri buluttan da iz bırakmadan kalkmalıdır. NodeStore kilitlenen notun yolunu
// ve Epoch klasörünü bu listeye yazar; eşitleme Drive'da o notun dosyasını kalıcı olarak silip şifreli hâlini yeni bir
// dosya olarak yükler (Drive'ın sürüm geçmişinde şifresiz içerik kalmaz) ve Epoch dosyalarını kalıcı olarak siler.

const PURGE_FILE = path.join(".nularche", "sync-purge.json");

export interface PurgeList {
  /** Drive'daki dosyası kalıcı silinip yeniden oluşturulacak notlar. */
  replace: string[];
  /** Drive'da altındaki her şey kalıcı silinecek yollar (ör. `.nularche/epochs/<id>/`). */
  prefixes: string[];
}

export async function readPurgeList(root: string): Promise<PurgeList> {
  try {
    const raw = JSON.parse(await readFile(path.join(root, PURGE_FILE), "utf8"));
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : []);
    return { replace: strings(raw.replace), prefixes: strings(raw.prefixes) };
  } catch {
    return { replace: [], prefixes: [] };
  }
}

/** Kilitlenen notun izlerini kalıcı silme listesine ekler (Drive bağlı olmasa da; sonradan bağlanınca uygulanır). */
export async function markForPurge(root: string, add: Partial<PurgeList>): Promise<void> {
  const cur = await readPurgeList(root);
  const next: PurgeList = {
    replace: [...new Set([...cur.replace, ...(add.replace ?? []).map(nfc)])],
    prefixes: [...new Set([...cur.prefixes, ...(add.prefixes ?? []).map(nfc)])],
  };
  const file = path.join(root, PURGE_FILE);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(next));
  await rename(tmp, file);
}

async function finishPurge(root: string, done: PurgeList): Promise<void> {
  const cur = await readPurgeList(root);
  const left: PurgeList = { replace: cur.replace.filter((r) => !done.replace.includes(r)), prefixes: cur.prefixes.filter((p) => !done.prefixes.includes(p)) };
  if (!left.replace.length && !left.prefixes.length) await rm(path.join(root, PURGE_FILE), { force: true });
  else await writeFile(path.join(root, PURGE_FILE), JSON.stringify(left));
}

export const DRIVE_SYNC_FILE = path.join(".nularche", "drive-sync.json");
const STATE_REL = ".nularche/drive-sync.json";
const REMOVED_DIR = ".nularche/sync-removed";

/**
 * `.nularche` içinde eşitlenen yollar (izin listesi). Listede olmayan her şey bu bilgisayarda kalır; böylece ileride
 * eklenecek iç kayıtlar da kendiliğinden buluta gitmez.
 */
const SYNCED_NULARCHE = ["ui.json", "origin.json", "comments/", "epochs/", "snippets/", "annotations/"];
/** İki tarafta da değiştiğinde anahtar anahtar birleştirilen ayar dosyaları. */
const MERGEABLE = new Set([".nularche/ui.json"]);

/** Eşitlenen yollar: notlar ve ekler ile `.nularche` izin listesi; geçici, sistem ve gizli dosyalar hariç. */
export function syncable(rel: string): boolean {
  const parts = rel.split("/");
  const base = parts[parts.length - 1] ?? "";
  if (!base || base === ".DS_Store" || base === "Thumbs.db" || base === "desktop.ini" || base.endsWith(".tmp") || base.startsWith("~$")) return false;
  if (parts[0] === ".nularche") {
    const inner = parts.slice(1).join("/");
    return SYNCED_NULARCHE.some((p) => (p.endsWith("/") ? inner.startsWith(p) && inner.length > p.length : inner === p));
  }
  // Diğer gizli klasör ve dosyalar (ör. .trash, .git) ve bağımlılık klasörleri eşitlenmez.
  if (parts.some((p) => p.startsWith("."))) return false;
  if (parts[0] === "node_modules") return false;
  return true;
}

/** Bilgisayara özel Nularche kaydı: Drive'da bulunursa çöpe taşınır. */
export function localOnly(rel: string): boolean {
  return rel.startsWith(".nularche/") && !syncable(rel) && rel !== STATE_REL;
}

const nfc = (s: string) => s.normalize("NFC");
const md5 = (data: Uint8Array) => createHash("md5").update(data).digest("hex");

// --- Uçtan uca şifreleme --------------------------------------------------------------------------------------
// Anahtar, kullanıcının parolasından PBKDF2-SHA256 (600.000 tur) ile türetilir; tarayıcıda da WebCrypto ile aynısı
// yapılabilir. İçerik AES-256-GCM ile şifrelenir; dosyanın Origin'deki yolu şifreli içeriğin başındadır. Drive'daki
// dosya adı yolun HMAC'idir: iki bilgisayar aynı yol için aynı adı üretir, ama addan yol okunamaz.

export interface DriveKeys {
  enc: Buffer;
  name: Buffer;
}

const MAGIC = Buffer.from("NLCE1");
const PBKDF2_ROUNDS = 600_000;

export function newSalt(): string {
  return randomBytes(16).toString("base64url");
}

export async function deriveKeys(passphrase: string, salt: string): Promise<DriveKeys> {
  const raw = await new Promise<Buffer>((resolve, reject) =>
    pbkdf2(passphrase.normalize("NFC"), Buffer.from(salt, "base64url"), PBKDF2_ROUNDS, 64, "sha256", (err, key) => (err ? reject(err) : resolve(key))),
  );
  return { enc: raw.subarray(0, 32), name: raw.subarray(32) };
}

/** Parolanın doğru olup olmadığını anlamak için kökte saklanan değer (anahtarı ele vermez). */
export const keyCheck = (keys: DriveKeys) => createHmac("sha256", keys.name).update("nularche-check").digest("hex").slice(0, 32);

export const encryptedName = (keys: DriveKeys, rel: string) => `${createHmac("sha256", keys.name).update(rel).digest("hex").slice(0, 40)}.nlce`;

export function encryptFile(keys: DriveKeys, rel: string, data: Uint8Array): Uint8Array {
  const head = Buffer.from(JSON.stringify({ p: rel }), "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(head.length);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keys.enc, iv);
  const body = Buffer.concat([cipher.update(Buffer.concat([len, head, Buffer.from(data)])), cipher.final()]);
  return Buffer.concat([MAGIC, iv, body, cipher.getAuthTag()]);
}

export function decryptFile(keys: DriveKeys, blob: Uint8Array): { rel: string; data: Uint8Array } {
  const buf = Buffer.from(blob);
  if (buf.length < MAGIC.length + 12 + 16 + 4 || !buf.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Not a Nularche encrypted file");
  const iv = buf.subarray(MAGIC.length, MAGIC.length + 12);
  const tag = buf.subarray(buf.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", keys.enc, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(buf.subarray(MAGIC.length + 12, buf.length - 16)), decipher.final()]);
  const n = plain.readUInt32BE(0);
  const head = JSON.parse(plain.subarray(4, 4 + n).toString("utf8")) as { p?: unknown };
  if (typeof head.p !== "string" || !head.p) throw new Error("Encrypted file has no path");
  return { rel: nfc(head.p), data: plain.subarray(4 + n) };
}

// --- Durum -----------------------------------------------------------------------------------------------------

export interface SyncedFile {
  /** Son eşitlemede iki tarafta da bulunan (açık) içeriğin MD5'i. */
  md5: string;
  /** Drive'daki dosyanın içerik MD5'i (şifreli kökte şifreli hâlin). */
  remoteMd5: string;
  remoteId: string;
}

export interface DriveSyncState {
  version: 2;
  rootId: string;
  account?: string;
  /** Kök şifreli mi (anahtar burada değil, parola deposundadır). */
  encrypted?: boolean;
  lastSync?: number;
  /** Origin'e göre POSIX yol (NFC) → son eşitlenen hâl. */
  files: Record<string, SyncedFile>;
  /** Yerel dosya özeti önbelleği: değişmeyen dosyalar yeniden okunmasın diye. */
  local?: Record<string, { size: number; mtime: number; md5: string }>;
  /** Birleştirilen ayar dosyalarının son eşitlenen içeriği (üç yönlü birleştirmenin tabanı). */
  bases?: Record<string, string>;
}

export interface DriveSyncCounts {
  uploaded: number;
  downloaded: number;
  deletedLocal: number;
  deletedRemote: number;
  conflicts: number;
  merged: number;
  /** Drive'dan kaldırılan bilgisayara özel kayıtlar. */
  cleaned: number;
}

export interface DriveSyncReport {
  state: DriveSyncState;
  counts: DriveSyncCounts;
  /** Dosya düzeyindeki hatalar; diğer dosyalar eşitlenmeye devam eder. */
  errors: string[];
}

export type DriveSyncErrorCode = "empty_remote" | "wrong_key" | "mass_delete";

export class DriveSyncError extends Error {
  readonly code: DriveSyncErrorCode;
  /** Toplu silmede: Drive'dan silinecek dosya sayısı. */
  readonly count?: number;
  constructor(code: DriveSyncErrorCode, message: string, count?: number) {
    super(message);
    this.name = "DriveSyncError";
    this.code = code;
    this.count = count;
  }
}

/** Toplu silme koruması: bu kadar ya da daha fazla dosya ve eşitlenenlerin bu oranı birden silinirse onay istenir. */
const MASS_DELETE_MIN = 5;
const MASS_DELETE_RATIO = 0.3;

export async function readSyncState(root: string): Promise<DriveSyncState | null> {
  try {
    const raw = JSON.parse(await readFile(path.join(root, DRIVE_SYNC_FILE), "utf8"));
    if (!raw || typeof raw.rootId !== "string" || !raw.rootId || typeof raw.files !== "object") return null;
    const files: Record<string, SyncedFile> = {};
    for (const [k, v] of Object.entries(raw.files as Record<string, unknown>)) {
      const f = v as Partial<SyncedFile>;
      // Sürüm 1'de uzak içerik açık içerikle aynıydı.
      if (typeof f?.md5 === "string" && typeof f.remoteId === "string") files[k] = { md5: f.md5, remoteMd5: typeof f.remoteMd5 === "string" ? f.remoteMd5 : f.md5, remoteId: f.remoteId };
    }
    return {
      version: 2,
      rootId: raw.rootId,
      account: typeof raw.account === "string" ? raw.account : undefined,
      encrypted: raw.encrypted === true,
      lastSync: typeof raw.lastSync === "number" ? raw.lastSync : undefined,
      files,
      local: raw.local && typeof raw.local === "object" ? raw.local : {},
      bases: raw.bases && typeof raw.bases === "object" ? raw.bases : {},
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
        // Klasörün içinde eşitlenecek bir şey olabilir mi (ör. .nularche/epochs)?
        if (!syncable(`${rel}/x`) && !(rel === ".nularche" || SYNCED_NULARCHE.some((p) => `.nularche/${p}`.startsWith(`${rel}/`)))) continue;
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

interface RemoteFile {
  id: string;
  /** Drive'daki içeriğin MD5'i. */
  md5?: string;
  /** Şifreli kökte yolu öğrenmek için indirilmiş açık içerik (yeniden indirilmesin). */
  plain?: Uint8Array;
}

/** Açık kökte yol, klasör adlarından hesaplanır (Drive'da yeniden adlandırma izlenir). */
function plainTree(rootId: string, entries: RemoteEntry[]): { files: Map<string, RemoteFile>; folders: Map<string, string> } {
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
  const files = new Map<string, RemoteFile>();
  const folders = new Map<string, string>([["", rootId]]);
  for (const e of entries) {
    const p = pathOf(e);
    if (p === null) continue;
    if (e.folder) folders.set(p, e.id);
    else if (!files.has(p)) files.set(p, { id: e.id, md5: e.md5 });
  }
  return { files, folders };
}

/** Çakışan yerel hâlin saklanacağı yol: "Not (conflict Mac 2026-11-20 14.05).md". */
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

/** JSON nesnelerini anahtar anahtar üç yönlü birleştirir; iki taraf da aynı anahtarı değiştirdiyse yerel kazanır. */
export function mergeJson(base: unknown, local: unknown, remote: unknown): Record<string, unknown> | null {
  const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
  const b = obj(base) ?? {};
  const l = obj(local);
  const r = obj(remote);
  if (!l || !r) return null;
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  const out: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])) {
    const v = same(l[k], b[k]) ? r[k] : same(r[k], b[k]) ? l[k] : l[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
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
  /** Şifreli kök için anahtarlar; açık kökte verilmez. */
  keys?: DriveKeys | null;
  now?: number;
  /** Aynı anda en çok kaç aktarım (varsayılan 4). */
  concurrency?: number;
  signal?: AbortSignal;
  /**
   * Drive'dan geri getirme: bu bilgisayarda eksik dosyalar Drive'dan indirilir (Drive'dan hiçbir şey silinmez); farklı
   * olanlarda Drive'daki hâl geçerli olur, buradaki hâl çakışma kopyası olarak saklanır.
   */
  restore?: boolean;
  /** Toplu silme onaylandı: bu bilgisayardan silinen dosyalar Drive'dan da silinir. */
  allowDeletes?: boolean;
}

/**
 * Origin'i bulut klasörüyle bir kez eşitler ve güncellenmiş durumu kaydedip döndürür.
 * Durum yoksa ya da başka bir köke aitse (ilk bağlantı) hiçbir şey bilinmeden birleştirilir.
 */
export async function syncOrigin(root: string, api: DriveApi, rootId: string, options: DriveSyncOptions): Promise<DriveSyncReport> {
  const now = options.now ?? Date.now();
  const keys = options.keys ?? null;
  const prev = await readSyncState(root);
  const base = prev && prev.rootId === rootId ? prev.files : {};
  const bases = prev && prev.rootId === rootId ? (prev.bases ?? {}) : {};
  const state: DriveSyncState = { version: 2, rootId, account: prev?.account, encrypted: !!keys, files: {}, local: {}, bases: {} };
  const counts: DriveSyncCounts = { uploaded: 0, downloaded: 0, deletedLocal: 0, deletedRemote: 0, conflicts: 0, merged: 0, cleaned: 0 };
  const errors: string[] = [];

  const local = await scanLocal(root, prev?.local);
  const listed = await api.listTree(rootId);
  const purge = await readPurgeList(root);
  const purgeDone: PurgeList = { replace: [], prefixes: [...purge.prefixes] };
  const purged = (rel: string) => purge.prefixes.some((p) => rel.startsWith(p));

  // Uzak dosyalar → yol. Şifreli kökte ad yolun HMAC'idir; tanınmayan adlar (başka bilgisayarda oluşturulmuş) indirilip
  // çözülerek yolu öğrenilir.
  let remote: Map<string, RemoteFile>;
  const folders = new Map<string, string>([["", rootId]]);
  const cleanup: string[] = [];
  if (keys) {
    remote = new Map();
    const known = new Map<string, string>();
    for (const rel of new Set([...local.keys(), ...Object.keys(base)])) known.set(encryptedName(keys, rel), rel);
    const byId = new Map(Object.entries(base).map(([rel, f]) => [f.remoteId, rel]));
    for (const e of listed) {
      if (e.folder) continue;
      let rel = known.get(e.name) ?? byId.get(e.id);
      let plain: Uint8Array | undefined;
      if (!rel) {
        try {
          const dec = decryptFile(keys, await api.download(e.id));
          rel = dec.rel;
          plain = dec.data;
        } catch {
          // Başka bir anahtarla şifrelenmiş ya da bozuk dosya: dokunulmaz.
          errors.push(`${e.name}: ${keys ? "cannot decrypt" : "unknown"}`);
          continue;
        }
      }
      if (localOnly(rel)) cleanup.push(e.id);
      else if (syncable(rel) && !remote.has(rel)) remote.set(rel, { id: e.id, md5: e.md5, plain });
    }
  } else {
    const tree = plainTree(rootId, listed);
    for (const [p, id] of tree.folders) {
      // Bilgisayara özel kayıt klasörleri (ör. .nularche/history) Drive'dan içleriyle birlikte kalkar.
      if (p.startsWith(".nularche/") && !syncable(`${p}/x`) && !SYNCED_NULARCHE.some((w) => `.nularche/${w}`.startsWith(`${p}/`))) cleanup.push(id);
      else folders.set(p, id);
    }
    remote = new Map();
    for (const [rel, f] of tree.files) {
      if (localOnly(rel)) cleanup.push(f.id);
      else if (syncable(rel)) remote.set(rel, f);
    }
  }

  // Güvenlik: daha önce eşitlenmiş dosyalar varken Drive tarafı tamamen boş görünüyorsa (kök değişti, silindi ya da
  // erişim kalktı) yerel dosyalar silinmesin diye durulur.
  if (remote.size === 0 && Object.keys(base).length > 0 && local.size > 0) {
    throw new DriveSyncError("empty_remote", "The Nularche folder in Google Drive looks empty; sync stopped so that no local file is removed.");
  }

  const pendingFolders = new Map<string, Promise<string>>();
  const folderId = (dir: string): Promise<string> => {
    if (keys || dir === "" || dir === ".") return Promise.resolve(rootId); // şifreli kök düzdür
    const knownId = folders.get(dir);
    if (knownId) return Promise.resolve(knownId);
    let p = pendingFolders.get(dir);
    if (!p) {
      const parentDir = path.posix.dirname(dir) === "." ? "" : path.posix.dirname(dir);
      p = folderId(parentDir).then(async (parent) => {
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
  const keep = (rel: string, plainMd5: string, remoteMd5: string, remoteId: string) => (state.files[rel] = { md5: plainMd5, remoteMd5, remoteId });

  const put = async (rel: string, data: Uint8Array, remoteId?: string) => {
    // Kilitlenen not: eski Drive dosyası (ve sürüm geçmişi) kalıcı silinir, şifreli hâli yeni dosya olarak yüklenir.
    if (remoteId && purge.replace.includes(rel)) {
      await api.remove(remoteId);
      remoteId = undefined;
      purgeDone.replace.push(rel);
    }
    const blob = keys ? encryptFile(keys, rel, data) : data;
    const made = await api.upload(rootId, { id: remoteId, parent: await folderId(dirOf(rel)), name: keys ? encryptedName(keys, rel) : path.posix.basename(rel), data: blob });
    keep(rel, md5(data), made.md5 ?? md5(blob), made.id);
  };
  const upload = async (rel: string, file: LocalFile, remoteId?: string) => {
    const data = await readFile(file.abs);
    await put(rel, data, remoteId);
    if (md5(data) === file.md5) state.local![rel] = { size: file.size, mtime: file.mtime, md5: file.md5 };
    counts.uploaded++;
  };
  const fetchPlain = async (r: RemoteFile): Promise<Uint8Array> => {
    if (r.plain) return r.plain;
    const blob = await api.download(r.id);
    if (!keys) return blob;
    try {
      return decryptFile(keys, blob).data;
    } catch {
      throw new DriveSyncError("wrong_key", "A file in Google Drive could not be decrypted with this passphrase.");
    }
  };
  const store = async (rel: string, data: Uint8Array) => {
    await writeLocal(root, rel, data);
    const st = await stat(path.join(root, ...rel.split("/")));
    state.local![rel] = { size: st.size, mtime: st.mtimeMs, md5: md5(data) };
  };
  const download = async (rel: string, r: RemoteFile) => {
    const data = await fetchPlain(r);
    await store(rel, data);
    keep(rel, md5(data), r.md5 ?? "", r.id);
    counts.downloaded++;
  };
  /** İki taraf da değişti: ayar dosyası birleştirilir, diğerlerinde yerel hâl kopyaya taşınıp yüklenir ve uzak hâl indirilir. */
  const reconcile = async (rel: string, file: LocalFile, r: RemoteFile, restoring = false) => {
    const theirs = await fetchPlain(r);
    if (md5(theirs) === file.md5) {
      keep(rel, file.md5, r.md5 ?? "", r.id);
      return;
    }
    if (MERGEABLE.has(rel) && restoring) {
      // Geri getirmede ayar dosyası Drive'daki hâline döner (ayar dosyasının çakışma kopyası anlamsızdır).
      await store(rel, theirs);
      keep(rel, md5(theirs), r.md5 ?? "", r.id);
      counts.downloaded++;
      return;
    }
    if (MERGEABLE.has(rel)) {
      const parse = (b: Uint8Array | string | undefined) => {
        try {
          return b === undefined ? {} : JSON.parse(typeof b === "string" ? b : Buffer.from(b).toString("utf8"));
        } catch {
          return null;
        }
      };
      const merged = mergeJson(parse(bases[rel]), parse(await readFile(file.abs)), parse(theirs));
      if (merged) {
        const data = Buffer.from(`${JSON.stringify(merged, null, 2)}\n`);
        await store(rel, data);
        await put(rel, data, r.id);
        counts.merged++;
        return;
      }
    }
    const copy = conflictPath(rel, options.host, now, (p) => taken.has(p));
    taken.add(copy);
    const absCopy = path.join(root, ...copy.split("/"));
    await rename(file.abs, absCopy);
    const st = await stat(absCopy);
    await upload(copy, { ...file, rel: copy, abs: absCopy, size: st.size, mtime: st.mtimeMs });
    await store(rel, theirs);
    keep(rel, md5(theirs), r.md5 ?? "", r.id);
    counts.downloaded++;
    counts.conflicts++;
  };

  const tasks: (() => Promise<void>)[] = [];
  /** Bu turda Drive'dan silinecek (bu bilgisayarda silinmiş) dosyalar: toplu silme koruması için sayılır. */
  const plannedDeletes: string[] = [];
  for (const rel of [...taken].sort()) {
    const L = local.get(rel);
    const R = remote.get(rel);
    const b = base[rel];
    // Kilitlenen notun şifresiz izleri (Epoch'lar): yerelde silindi, Drive'da kalıcı silinir.
    if (purged(rel) && !L) {
      if (R)
        tasks.push(async () => {
          try {
            await api.remove(R.id);
            counts.deletedRemote++;
          } catch (e) {
            purgeDone.prefixes = purgeDone.prefixes.filter((p) => !rel.startsWith(p));
            errors.push(`${rel}: ${(e as Error).message}`);
          }
        });
      continue;
    }
    if (L) state.local![rel] = { size: L.size, mtime: L.mtime, md5: L.md5 };
    // Drive bazı dosyalar için MD5 vermez (ör. Google dokümanları): bunlar yalnızca yerelde yoksa atlanır.
    if (R && !R.md5 && !L) continue;
    let task: (() => Promise<void>) | null = null;
    if (!b) {
      if (L && !R) task = () => upload(rel, L);
      else if (R && !L) task = () => download(rel, R);
      else if (L && R) task = () => reconcile(rel, L, R);
    } else {
      const lChanged = (L?.md5 ?? null) !== b.md5;
      const rChanged = (R?.md5 ?? null) !== b.remoteMd5;
      if (options.restore && R) {
        // Drive'dan geri getirme: eksik dosya indirilir, farklı olan Drive'daki hâline döner (yerel hâl kopyaya).
        if (!L) task = () => download(rel, R);
        else if (lChanged || rChanged) task = () => reconcile(rel, L, R, true);
      } else if (!lChanged && !rChanged) {
        if (L && R) keep(rel, b.md5, b.remoteMd5, R.id);
        // Kilitlenmiş ama Drive'daki dosyası eski (sürüm geçmişinde şifresiz hâli olabilir): yeniden oluşturulur.
        if (L && R && purge.replace.includes(rel)) task = () => upload(rel, L, R.id);
      } else if (lChanged && !rChanged) {
        if (L) task = () => upload(rel, L, R?.id ?? b.remoteId);
        else if (R) {
          plannedDeletes.push(rel);
          task = async () => {
            await api.trash(R.id);
            counts.deletedRemote++;
          };
        }
      } else if (rChanged && !lChanged) {
        if (R) task = () => download(rel, R);
        else if (L)
          task = async () => {
            await removeLocal(root, rel, now);
            delete state.local![rel];
            counts.deletedLocal++;
          };
      } else if (L && R) task = () => reconcile(rel, L, R);
      else if (R) task = () => download(rel, R); // yerelde silinmiş, uzakta düzenlenmiş: düzenleme kazanır
      else if (L) task = () => upload(rel, L); // uzakta silinmiş, yerelde düzenlenmiş: düzenleme kazanır
    }
    if (!task) continue;
    const t = task;
    tasks.push(async () => {
      try {
        await t();
      } catch (e) {
        if (e instanceof DriveSyncError) throw e;
        // Başarısız aktarımda eski bilinen durum korunur; bir sonraki eşitleme yeniden dener.
        if (b) state.files[rel] = b;
        errors.push(`${rel}: ${(e as Error).message}`);
      }
    });
  }
  // Toplu silme koruması: bu bilgisayardaki klasör boşaldıysa ya da notların büyük kısmı birden silindiyse Drive'dan
  // hiçbir şey silinmez; kullanıcı ya Drive'dan geri getirmeyi ya da silmeyi onaylamayı seçer.
  const known = Object.keys(base).filter((r) => !localOnly(r)).length;
  if (!options.allowDeletes && plannedDeletes.length && (local.size === 0 || (plannedDeletes.length >= MASS_DELETE_MIN && plannedDeletes.length >= known * MASS_DELETE_RATIO))) {
    throw new DriveSyncError("mass_delete", `${plannedDeletes.length} files were deleted on this computer; nothing was deleted from Google Drive yet.`, plannedDeletes.length);
  }

  // Drive'a daha önce gitmiş bilgisayara özel kayıtlar kalıcı silinir (içlerinde kilitli notların şifresiz eski
  // hâlleri olabilir; asılları bu bilgisayarda durur).
  for (const id of cleanup)
    tasks.push(async () => {
      try {
        await api.remove(id);
        counts.cleaned++;
      } catch (e) {
        errors.push(`cleanup: ${(e as Error).message}`);
      }
    });

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

  // Birleştirilen ayar dosyalarının eşitlenen hâli bir sonraki birleştirmenin tabanıdır.
  for (const rel of MERGEABLE) {
    if (!state.files[rel]) continue;
    const text = await readFile(path.join(root, ...rel.split("/")), "utf8").catch(() => null);
    if (text !== null && md5(Buffer.from(text)) === state.files[rel].md5) state.bases![rel] = text;
    else if (bases[rel] !== undefined) state.bases![rel] = bases[rel];
  }
  // Kilitlenip yerelde yeniden yazılmamış (henüz yüklenmemiş) notlar listede kalır; Drive'da dosyası olmayanlar düşer.
  for (const rel of purge.replace) if (!remote.has(rel) && !purgeDone.replace.includes(rel)) purgeDone.replace.push(rel);
  if (purge.replace.length || purge.prefixes.length) await finishPurge(root, purgeDone);
  state.lastSync = now;
  await writeSyncState(root, state);
  return { state, counts, errors };
}

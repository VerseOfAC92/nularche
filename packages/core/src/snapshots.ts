// Anlık görüntü geçmişi: Origin'in tamamının belirli anlardaki hâli. İçerik adresli ve artımlıdır: her dosyanın
// içeriği bir kez, özetiyle adlandırılmış sıkıştırılmış bir nesne olarak saklanır; bir anlık görüntü yalnızca
// "yol → nesne" listesidir. Değişmeyen dosyalar yeniden okunmaz (boyut ve değişiklik zamanı önceki listeyle aynıysa
// özet yeniden kullanılır), yalnızca yeni içerikler yazılır.
//
// Anahtar verilirse (masaüstünde işletim sisteminin anahtar zincirinde korunan rastgele bir anahtar) nesneler ve
// listeler AES-256-GCM ile şifrelenir; nesne adları da anahtarlı özettir (HMAC), böylece bilinen bir dosyanın varlığı
// adından anlaşılamaz. Anlık görüntüler bu bilgisayarın güvenlik ağıdır, Google Drive ile eşitlenmez.
//
// Yer: `.nularche/snapshots/objects/<ilk iki>/<özet>` ve `.nularche/snapshots/manifests/<zaman>-<rastgele>.json`.
// Kapsam: gizli klasörler (`.nularche`, `.trash`, `.git`…) dışındaki bütün dosyalar (notlar ve ekler).

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { isLockedBody } from "./note-text.ts";
import { parseNodeFile } from "./node-file.ts";

export interface SnapshotEntry {
  /** Origin'e göre yol (`/` ayırıcılı). */
  path: string;
  hash: string;
  size: number;
  mtime: number;
  /** Not dosyasıysa notun id'si (kilitlenen notun eski sürümlerini silebilmek için). */
  id?: string;
}

interface Manifest {
  v: 1;
  id: string;
  at: number;
  label?: string;
  auto: boolean;
  files: SnapshotEntry[];
  /** Çok büyük olduğu için alınmayan dosyalar. */
  skipped?: string[];
}

export interface SnapshotSummary {
  id: string;
  at: number;
  label?: string;
  auto: boolean;
  files: number;
  bytes: number;
  skipped: number;
  /** Bir önceki anlık görüntüye göre. */
  added: number;
  changed: number;
  removed: number;
}

export type SnapshotFileStatus = "same" | "changed" | "deleted" | "added";

export interface SnapshotFile {
  path: string;
  status: SnapshotFileStatus;
  size: number;
}

/** Tek dosya için üst sınır: daha büyük ekler (ör. videolar) anlık görüntüye girmez. */
export const SNAPSHOT_MAX_FILE = 64 * 1024 * 1024;
/** Saklanan otomatik anlık görüntüler: son N tanesi, ayrıca son 30 günün her gününden biri. Adlandırılanlar silinmez. */
const KEEP_RECENT_AUTO = 48;
const KEEP_DAILY_DAYS = 30;

const MAGIC_PLAIN = Buffer.from("NSP0");
const MAGIC_SEALED = Buffer.from("NSE1");

export class SnapshotError extends Error {
  readonly code: "not_found" | "invalid" | "key";
  constructor(code: "not_found" | "invalid" | "key", message: string) {
    super(message);
    this.code = code;
  }
}

export class SnapshotStore {
  readonly dir: string;
  private readonly key: Buffer | null;
  private busy: Promise<unknown> = Promise.resolve();

  readonly root: string;

  constructor(root: string, options: { key?: Uint8Array | null } = {}) {
    this.root = root;
    this.dir = path.join(root, ".nularche", "snapshots");
    this.key = options.key ? Buffer.from(options.key) : null;
    if (this.key && this.key.length !== 32) throw new SnapshotError("key", "Anlık görüntü anahtarı 32 bayt olmalı.");
  }

  get encrypted(): boolean {
    return !!this.key;
  }

  /** İşlemler sırayla yürür (iki anlık görüntü aynı anda nesne yazmasın / temizlemesin). */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.busy.then(fn, fn);
    this.busy = next.catch(() => undefined);
    return next;
  }

  // ------------------------------------------------------------------ şifreleme ve nesneler

  private seal(data: Buffer): Buffer {
    const packed = gzipSync(data);
    if (!this.key) return Buffer.concat([MAGIC_PLAIN, packed]);
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.key, iv);
    const body = Buffer.concat([c.update(packed), c.final()]);
    return Buffer.concat([MAGIC_SEALED, iv, c.getAuthTag(), body]);
  }

  private open(raw: Buffer): Buffer {
    const magic = raw.subarray(0, 4);
    if (magic.equals(MAGIC_PLAIN)) return gunzipSync(raw.subarray(4));
    if (!magic.equals(MAGIC_SEALED)) throw new SnapshotError("invalid", "Tanınmayan anlık görüntü verisi.");
    if (!this.key) throw new SnapshotError("key", "Bu anlık görüntü şifreli; anahtarı bu bilgisayarda yok.");
    const d = createDecipheriv("aes-256-gcm", this.key, raw.subarray(4, 16));
    d.setAuthTag(raw.subarray(16, 32));
    try {
      return gunzipSync(Buffer.concat([d.update(raw.subarray(32)), d.final()]));
    } catch {
      throw new SnapshotError("key", "Anlık görüntü bu bilgisayarın anahtarıyla açılamadı.");
    }
  }

  private hashOf(data: Buffer): string {
    return this.key ? createHmac("sha256", this.key).update(data).digest("hex") : createHash("sha256").update(data).digest("hex");
  }

  private objectPath(hash: string): string {
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new SnapshotError("invalid", "Geçersiz nesne adı.");
    return path.join(this.dir, "objects", hash.slice(0, 2), hash);
  }

  private async putObject(data: Buffer): Promise<string> {
    const hash = this.hashOf(data);
    const file = this.objectPath(hash);
    if (await exists(file)) return hash;
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(tmp, this.seal(data));
    await rename(tmp, file);
    return hash;
  }

  private async getObject(hash: string): Promise<Buffer> {
    try {
      return this.open(await readFile(this.objectPath(hash)));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new SnapshotError("not_found", "Anlık görüntünün bir parçası eksik.");
      throw e;
    }
  }

  // ------------------------------------------------------------------ listeler

  private manifestsDir(): string {
    return path.join(this.dir, "manifests");
  }

  private manifestFile(id: string): string {
    if (!/^\d{13}-[0-9a-f]{8}$/.test(id)) throw new SnapshotError("invalid", `Geçersiz anlık görüntü: ${id}`);
    return path.join(this.manifestsDir(), `${id}.snap`);
  }

  private async ids(): Promise<string[]> {
    try {
      return (await readdir(this.manifestsDir()))
        .filter((f) => /^\d{13}-[0-9a-f]{8}\.snap$/.test(f))
        .map((f) => f.slice(0, -5))
        .sort();
    } catch {
      return [];
    }
  }

  private async readManifest(id: string): Promise<Manifest> {
    const file = this.manifestFile(id);
    let raw: Buffer;
    try {
      raw = await readFile(file);
    } catch {
      throw new SnapshotError("not_found", `Anlık görüntü bulunamadı: ${id}`);
    }
    const m = JSON.parse(this.open(raw).toString("utf8")) as Manifest;
    if (m.v !== 1 || !Array.isArray(m.files)) throw new SnapshotError("invalid", "Bozuk anlık görüntü listesi.");
    return m;
  }

  private async writeManifest(m: Manifest): Promise<void> {
    await mkdir(this.manifestsDir(), { recursive: true });
    const file = this.manifestFile(m.id);
    const tmp = `${file}.tmp`;
    await writeFile(tmp, this.seal(Buffer.from(JSON.stringify(m))));
    await rename(tmp, file);
  }

  /** Okunabilen listeler (anahtarı olmayan ya da bozuk olanlar atlanır), eskiden yeniye. */
  private async manifests(): Promise<Manifest[]> {
    const out: Manifest[] = [];
    for (const id of await this.ids()) {
      try {
        out.push(await this.readManifest(id));
      } catch {
        // okunamayan liste: listede görünmez, temizlikte de dokunulmaz
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ Origin taraması

  private async scan(): Promise<{ path: string; abs: string; size: number; mtime: number }[]> {
    const out: { path: string; abs: string; size: number; mtime: number }[] = [];
    const walk = async (dir: string, rel: string) => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name.startsWith(".") || e.name === "node_modules") continue;
        const abs = path.join(dir, e.name);
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) await walk(abs, r);
        else if (e.isFile()) {
          const st = await stat(abs);
          out.push({ path: r, abs, size: st.size, mtime: Math.floor(st.mtimeMs) });
        }
      }
    };
    await walk(this.root, "");
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  // ------------------------------------------------------------------ genel işlemler

  /**
   * Anlık görüntü alır. `auto` ise ve son anlık görüntüden beri hiçbir şey değişmediyse alınmaz (null).
   */
  create(options: { label?: string; auto?: boolean } = {}): Promise<SnapshotSummary | null> {
    return this.serial(async () => {
      const all = await this.manifests();
      const last = all.at(-1);
      const known = new Map((last?.files ?? []).map((f) => [f.path, f]));
      const files: SnapshotEntry[] = [];
      const skipped: string[] = [];
      for (const f of await this.scan()) {
        if (f.size > SNAPSHOT_MAX_FILE) {
          skipped.push(f.path);
          continue;
        }
        const prev = known.get(f.path);
        if (prev && prev.size === f.size && prev.mtime === f.mtime && (await exists(this.objectPath(prev.hash)))) {
          files.push(prev);
          continue;
        }
        let data: Buffer;
        try {
          data = await readFile(f.abs);
        } catch {
          continue; // tarama ile okuma arasında silinmiş
        }
        const hash = await this.putObject(data);
        files.push({ path: f.path, hash, size: data.length, mtime: f.mtime, ...noteId(f.path, data) });
      }
      const label = options.label?.trim().slice(0, 120) || undefined;
      if (options.auto && last && !label && sameFiles(last.files, files)) return null;
      const at = Math.max(Date.now(), (last?.at ?? 0) + 1);
      const m: Manifest = { v: 1, id: `${at}-${randomBytes(4).toString("hex")}`, at, auto: !!options.auto, files, ...(label ? { label } : {}), ...(skipped.length ? { skipped } : {}) };
      await this.writeManifest(m);
      await this.prune();
      return summarize(m, last);
    });
  }

  async list(): Promise<SnapshotSummary[]> {
    const all = await this.manifests();
    return all.map((m, i) => summarize(m, all[i - 1])).reverse();
  }

  /** Anlık görüntüdeki dosyalar ve şimdiki hâle göre durumları (bugün olup o an olmayanlar "added"). */
  async files(id: string): Promise<SnapshotFile[]> {
    const m = await this.readManifest(id);
    const now = new Map((await this.scan()).map((f) => [f.path, f]));
    const out: SnapshotFile[] = [];
    for (const f of m.files) {
      const cur = now.get(f.path);
      let status: SnapshotFileStatus = "deleted";
      if (cur) {
        if (cur.size !== f.size) status = "changed";
        else if (cur.mtime === f.mtime) status = "same";
        else status = this.hashOf(await readFile(cur.abs)) === f.hash ? "same" : "changed";
      }
      out.push({ path: f.path, status, size: f.size });
      now.delete(f.path);
    }
    for (const f of now.values()) if (f.size <= SNAPSHOT_MAX_FILE) out.push({ path: f.path, status: "added", size: f.size });
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  /** Anlık görüntüdeki bir dosyanın içeriği (önizleme). */
  async read(id: string, file: string): Promise<Buffer> {
    const m = await this.readManifest(id);
    const f = m.files.find((x) => x.path === file);
    if (!f) throw new SnapshotError("not_found", `Bu anlık görüntüde yok: ${file}`);
    return this.getObject(f.hash);
  }

  /**
   * Geri yükler. `paths` verilirse yalnızca o dosyalar (anlık görüntüde olmayan bir yol şimdi varsa silinir); verilmezse
   * Origin'in tamamı o ana döner: sonradan eklenen dosyalar da kaldırılır. Önce şimdiki hâlin anlık görüntüsü alınır,
   * böylece geri yükleme de geri alınabilir.
   */
  async restore(id: string, options: { paths?: string[]; beforeLabel?: string } = {}): Promise<{ restored: number; removed: number; before: string | null }> {
    const m = await this.readManifest(id);
    const before = await this.create({ label: options.beforeLabel ?? "Geri yüklemeden önce" });
    return this.serial(async () => {
      const wanted = options.paths ? new Set(options.paths.map(normalizeRel)) : null;
      const target = new Map(m.files.map((f) => [f.path, f]));
      let restored = 0;
      let removed = 0;
      // Önce bütün içerikler okunur: eksik parça varsa hiçbir şeye dokunulmaz.
      const contents = new Map<string, Buffer>();
      for (const f of m.files) if (!wanted || wanted.has(f.path)) contents.set(f.path, await this.getObject(f.hash));
      for (const [rel, data] of contents) {
        const abs = this.absInside(rel);
        const cur = await readFile(abs).catch(() => null);
        if (cur && cur.equals(data)) continue;
        await mkdir(path.dirname(abs), { recursive: true });
        const tmp = `${abs}.${randomBytes(4).toString("hex")}.restoring`;
        await writeFile(tmp, data);
        await rename(tmp, abs);
        const mtime = target.get(rel)!.mtime / 1000;
        await utimes(abs, mtime, mtime).catch(() => undefined);
        restored++;
      }
      const current = await this.scan();
      const emptied = new Set<string>();
      for (const f of current) {
        if (target.has(f.path) || f.size > SNAPSHOT_MAX_FILE) continue;
        if (wanted && !wanted.has(f.path)) continue;
        await rm(f.abs, { force: true });
        emptied.add(path.dirname(f.abs));
        removed++;
      }
      // Silinen dosyalarla boşalan klasörler (ör. sonradan eklenmiş bir notun klasörü) de kaldırılır.
      for (const dir of emptied) await removeIfEmpty(this.root, dir);
      return { restored, removed, before: before?.id ?? null };
    });
  }

  remove(id: string): Promise<void> {
    return this.serial(async () => {
      await rm(this.manifestFile(id), { force: true });
      await this.gc();
    });
  }

  /** Adlandırır ya da adını kaldırır (adlandırılmış anlık görüntüler otomatik temizlikte silinmez). */
  rename(id: string, label: string | null): Promise<SnapshotSummary> {
    return this.serial(async () => {
      const m = await this.readManifest(id);
      const clean = label?.trim().slice(0, 120);
      if (clean) m.label = clean;
      else delete m.label;
      await this.writeManifest(m);
      return summarize(m, undefined);
    });
  }

  /**
   * Kilitlenen notların eski sürümlerini siler: verilen notların şifresiz içerikli kayıtları bütün anlık görüntülerden
   * çıkarılır, artık kullanılmayan nesneler silinir. Silinen kayıt sayısını döndürür.
   */
  purgeNotes(ids: Iterable<string>): Promise<number> {
    const target = new Set(ids);
    if (!target.size) return Promise.resolve(0);
    return this.serial(async () => {
      let dropped = 0;
      const plainCache = new Map<string, boolean>();
      const isPlain = async (hash: string) => {
        if (!plainCache.has(hash)) {
          let plain = true;
          try {
            plain = !isLockedBody(parseNodeFile((await this.getObject(hash)).toString("utf8")).body);
          } catch {
            plain = true;
          }
          plainCache.set(hash, plain);
        }
        return plainCache.get(hash)!;
      };
      for (const m of await this.manifests()) {
        const keep: SnapshotEntry[] = [];
        for (const f of m.files) {
          if (f.id && target.has(f.id) && (await isPlain(f.hash))) dropped++;
          else keep.push(f);
        }
        if (keep.length !== m.files.length) await this.writeManifest({ ...m, files: keep });
      }
      if (dropped) await this.gc();
      return dropped;
    });
  }

  /** Eski otomatik anlık görüntüleri seyreltir. */
  private async prune(): Promise<void> {
    const all = await this.manifests();
    const autos = all.filter((m) => m.auto && !m.label);
    const keep = new Set(autos.slice(-KEEP_RECENT_AUTO).map((m) => m.id));
    const days = new Set<string>();
    const cutoff = Date.now() - KEEP_DAILY_DAYS * 86_400_000;
    for (const m of [...autos].reverse()) {
      const day = new Date(m.at).toISOString().slice(0, 10);
      if (m.at >= cutoff && !days.has(day)) {
        days.add(day);
        keep.add(m.id);
      }
    }
    let removed = 0;
    for (const m of autos) {
      if (keep.has(m.id)) continue;
      await rm(this.manifestFile(m.id), { force: true });
      removed++;
    }
    if (removed) await this.gc();
  }

  /** Hiçbir listenin kullanmadığı nesneleri siler. Okunamayan bir liste varsa (anahtar yok) hiçbir şey silinmez. */
  private async gc(): Promise<void> {
    const ids = await this.ids();
    const all = await this.manifests();
    if (all.length !== ids.length) return;
    const used = new Set(all.flatMap((m) => m.files.map((f) => f.hash)));
    const base = path.join(this.dir, "objects");
    let shards: string[];
    try {
      shards = await readdir(base);
    } catch {
      return;
    }
    for (const shard of shards) {
      if (!/^[0-9a-f]{2}$/.test(shard)) continue;
      const names = await readdir(path.join(base, shard)).catch(() => [] as string[]);
      for (const n of names) if (!used.has(n)) await rm(path.join(base, shard, n), { force: true });
    }
  }

  private absInside(rel: string): string {
    const clean = normalizeRel(rel);
    if (!clean || clean.split("/").some((s) => s === ".." || s.startsWith("."))) throw new SnapshotError("invalid", `Geçersiz yol: ${rel}`);
    const abs = path.join(this.root, ...clean.split("/"));
    if (!abs.startsWith(this.root + path.sep)) throw new SnapshotError("invalid", `Geçersiz yol: ${rel}`);
    return abs;
  }
}

function normalizeRel(rel: string): string {
  return rel.replace(/\\/g, "/").replace(/^\/+/, "");
}

async function exists(p: string): Promise<boolean> {
  return stat(p).then(
    () => true,
    () => false,
  );
}

function noteId(rel: string, data: Buffer): { id?: string } {
  if (!rel.toLowerCase().endsWith(".md")) return {};
  const head = data.subarray(0, 2048).toString("utf8");
  const m = /^---\r?\n(?:[\s\S]*?\r?\n)?id:\s*["']?([\w-]{1,64})["']?\s*\r?\n/.exec(head);
  return m ? { id: m[1] } : {};
}

function sameFiles(a: SnapshotEntry[], b: SnapshotEntry[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((f, i) => f.path === b[i].path && f.hash === b[i].hash);
}

function summarize(m: Manifest, prev: Manifest | undefined): SnapshotSummary {
  const before = new Map((prev?.files ?? []).map((f) => [f.path, f.hash]));
  let added = 0;
  let changed = 0;
  for (const f of m.files) {
    const h = before.get(f.path);
    if (h === undefined) added++;
    else if (h !== f.hash) changed++;
    before.delete(f.path);
  }
  return {
    id: m.id,
    at: m.at,
    ...(m.label ? { label: m.label } : {}),
    auto: m.auto,
    files: m.files.length,
    bytes: m.files.reduce((s, f) => s + f.size, 0),
    skipped: m.skipped?.length ?? 0,
    added: prev ? added : m.files.length,
    changed: prev ? changed : 0,
    removed: prev ? before.size : 0,
  };
}

/** Klasör boşsa siler ve boşalan üst klasörlerle devam eder (Origin kökünde durur). */
async function removeIfEmpty(root: string, dir: string): Promise<void> {
  for (let d = dir; d.startsWith(root + path.sep); d = path.dirname(d)) {
    const names = await readdir(d).catch(() => null);
    if (!names || names.length) return;
    await rm(d, { recursive: true, force: true });
  }
}

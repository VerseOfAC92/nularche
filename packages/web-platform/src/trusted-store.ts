// "Bu tarayıcıya güven": notların bu tarayıcıda (IndexedDB) şifreli bir kopyası tutulur; uygulama açılınca notlar
// Google Drive'ı beklemeden bu kopyadan gelir, eşitleme arkadan sürer. Kopya, uçtan uca şifreli Origin'de parolanızdan
// türetilen anahtarla şifrelenir (parola bilinmeden okunamaz); şifresiz Origin'de bu tarayıcıya bağlı, dışarı
// aktarılamayan bir anahtar kullanılır. Dosya yolları da açık durmaz (kayıt adı yolun HMAC'idir, yol şifreli içeriktedir).
// Güven kaldırılınca ya da çıkış yapılınca veritabanı tümüyle silinir. Güvenilmeyen tarayıcıda hiçbir şey yazılmaz.

import type { DriveKeys } from "../../core/src/drive-sync.ts";
import type { OriginRoot } from "./session.ts";

const DB = "nularche-trusted";
const META = "meta";
const FILES = "files";

export interface TrustMeta {
  v: 1;
  account: string;
  root: OriginRoot;
  /** passphrase: anahtar Origin parolasından türetilir; device: bu tarayıcıda saklanan dışarı aktarılamaz anahtar. */
  mode: "passphrase" | "device";
  /** device kipinde anahtarlar (CryptoKey, extractable: false). */
  deviceKeys?: { enc: CryptoKey; name: CryptoKey };
  savedAt: number;
}

interface FileRecord {
  id: string;
  iv: Uint8Array;
  data: ArrayBuffer;
}

const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore(META);
      r.result.createObjectStore(FILES, { keyPath: "id" });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** Güvenilen tarayıcı kaydı (yoksa null). Veritabanı hiç yoksa oluşturmaz. */
export async function readTrustMeta(): Promise<TrustMeta | null> {
  if (typeof indexedDB === "undefined") return null;
  const dbs = await indexedDB.databases?.().catch(() => null);
  if (dbs && !dbs.some((d) => d.name === DB)) return null;
  const db = await openDb();
  try {
    return ((await req(db.transaction(META).objectStore(META).get(META))) as TrustMeta | undefined) ?? null;
  } finally {
    db.close();
  }
}

/** Güveni kaldırır: notların bu tarayıcıdaki kopyası ve anahtarlar silinir. */
export function forgetTrusted(): Promise<void> {
  return new Promise((resolve) => {
    const r = indexedDB.deleteDatabase(DB);
    r.onsuccess = r.onerror = r.onblocked = () => resolve();
  });
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Parola kipinde yerel anahtarlar: Origin anahtarlarından ayrı amaçla türetilir (Drive'daki kopyayla karışmaz). */
async function passphraseKeys(keys: DriveKeys): Promise<{ enc: CryptoKey; name: CryptoKey }> {
  const base = await crypto.subtle.importKey("raw", new Uint8Array(keys.enc), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const derive = async (label: string) => new Uint8Array(await crypto.subtle.sign("HMAC", base, enc.encode(label)));
  return {
    enc: await crypto.subtle.importKey("raw", await derive("nularche-trusted-browser/enc"), "AES-GCM", false, ["encrypt", "decrypt"]),
    name: await crypto.subtle.importKey("raw", await derive("nularche-trusted-browser/name"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
  };
}

export interface TrustedStore {
  /** Kopyadaki bütün dosyalar (Origin içindeki yol → içerik ve değişme zamanı). */
  load(): Promise<Map<string, { data: Uint8Array; mtime: number }>>;
  /** Değişen dosyaları yazar, silinenleri kaldırır (tek işlemde). */
  write(changes: { put: { rel: string; data: Uint8Array; mtime: number }[]; remove: string[] }): Promise<void>;
  /** Hesap ve kök bilgisini günceller (ör. eşitleme sonrası). */
  touch(account: string, root: OriginRoot): Promise<void>;
}

function storeWith(keys: { enc: CryptoKey; name: CryptoKey }): TrustedStore {
  const idOf = async (rel: string) => Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", keys.name, enc.encode(rel))).slice(0, 20), (b) => b.toString(16).padStart(2, "0")).join("");
  return {
    async load() {
      const db = await openDb();
      try {
        const all = (await req(db.transaction(FILES).objectStore(FILES).getAll())) as FileRecord[];
        const out = new Map<string, { data: Uint8Array; mtime: number }>();
        for (const r of all) {
          const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(r.iv) }, keys.enc, r.data));
          const view = new DataView(plain.buffer, plain.byteOffset);
          const pathLen = view.getUint32(0);
          const mtime = view.getFloat64(4);
          const rel = dec.decode(plain.subarray(12, 12 + pathLen));
          out.set(rel, { data: plain.slice(12 + pathLen), mtime });
        }
        return out;
      } finally {
        db.close();
      }
    },
    async write({ put, remove }) {
      if (!put.length && !remove.length) return;
      // Şifreleme işlemden önce: IndexedDB işlemi await sırasında kapanmasın.
      const records: FileRecord[] = [];
      for (const f of put) {
        const path = enc.encode(f.rel);
        const plain = new Uint8Array(12 + path.length + f.data.length);
        const view = new DataView(plain.buffer);
        view.setUint32(0, path.length);
        view.setFloat64(4, f.mtime);
        plain.set(path, 12);
        plain.set(f.data, 12 + path.length);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        records.push({ id: await idOf(f.rel), iv, data: await crypto.subtle.encrypt({ name: "AES-GCM", iv }, keys.enc, plain) });
      }
      const gone = await Promise.all(remove.map(idOf));
      const db = await openDb();
      try {
        const tx = db.transaction(FILES, "readwrite");
        const os = tx.objectStore(FILES);
        for (const r of records) os.put(r);
        for (const id of gone) os.delete(id);
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = tx.onabort = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    },
    async touch(account, root) {
      const db = await openDb();
      try {
        const os = db.transaction(META, "readwrite").objectStore(META);
        const meta = (await req(os.get(META))) as TrustMeta | undefined;
        if (meta) await req(db.transaction(META, "readwrite").objectStore(META).put({ ...meta, account, root, savedAt: Date.now() }, META));
      } finally {
        db.close();
      }
    },
  };
}

/** Güveni açar: kayıt yazılır (dosyalar ayrıca `write` ile). Şifreli Origin'de `keys` gereklidir. */
export async function createTrusted(account: string, root: OriginRoot, keys: DriveKeys | null): Promise<TrustedStore> {
  await forgetTrusted();
  let local: { enc: CryptoKey; name: CryptoKey };
  let meta: TrustMeta;
  if (keys) {
    local = await passphraseKeys(keys);
    meta = { v: 1, account, root, mode: "passphrase", savedAt: Date.now() };
  } else {
    local = {
      enc: await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]),
      name: await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
    };
    meta = { v: 1, account, root, mode: "device", deviceKeys: local, savedAt: Date.now() };
  }
  const db = await openDb();
  try {
    await req(db.transaction(META, "readwrite").objectStore(META).put(meta, META));
  } finally {
    db.close();
  }
  return storeWith(local);
}

/** Güvenilen kopyayı açar: parola kipinde Origin anahtarlarıyla (parola önceden doğrulanmış olmalı). */
export async function openTrusted(meta: TrustMeta, keys: DriveKeys | null): Promise<TrustedStore> {
  if (meta.mode === "device") {
    if (!meta.deviceKeys) throw new Error("trusted_corrupt");
    return storeWith(meta.deviceKeys);
  }
  if (!keys) throw new Error("passphrase_required");
  return storeWith(await passphraseKeys(keys));
}

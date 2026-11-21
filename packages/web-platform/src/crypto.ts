// `node:crypto` yerine geçen modül (web sürümü): çekirdeğin kullandığı özet, HMAC, AES-256-GCM, PBKDF2 ve
// rastgele değer işlevleri. Hesaplar denetlenmiş @noble kütüphaneleriyle (MIT) yapılır; rastgelelik tarayıcının
// `crypto.getRandomValues` kaynağındandır. Çıktılar Node ile bayt bayt aynıdır (Drive'daki şifreli dosyalar iki
// tarafta da açılır); bunu test/crypto-parity.test.ts denetler.

import { gcm } from "@noble/ciphers/aes.js";
import { hmac } from "@noble/hashes/hmac.js";
import { md5 } from "@noble/hashes/legacy.js";
import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { Buffer } from "./buffer.ts";

type Bytes = Uint8Array;
type Input = string | Uint8Array;
type Digest = "hex" | "base64" | "base64url" | "latin1" | "binary";

const HASHES = { sha256, sha512, md5 } as const;
type HashName = keyof typeof HASHES;

const bytesOf = (x: Input, enc?: BufferEncoding): Bytes => (typeof x === "string" ? Buffer.from(x, enc ?? "utf8") : x);
const hashOf = (name: string) => {
  const h = HASHES[name.toLowerCase().replace("-", "") as HashName];
  if (!h) throw new Error(`Digest method not supported: ${name}`);
  return h;
};

function output(bytes: Bytes, enc?: Digest): never {
  const b = Buffer.from(bytes);
  return (enc ? b.toString(enc) : b) as never;
}

interface Updatable {
  update(data: Input, enc?: BufferEncoding): Updatable;
  digest(enc?: Digest): never;
}

export function createHash(name: string): Updatable {
  const h = hashOf(name).create();
  const api: Updatable = {
    update(data, enc) {
      h.update(bytesOf(data, enc));
      return api;
    },
    digest: (enc) => output(h.digest(), enc),
  };
  return api;
}

export function createHmac(name: string, key: Input): Updatable {
  const h = hmac.create(hashOf(name), bytesOf(key));
  const api: Updatable = {
    update(data, enc) {
      h.update(bytesOf(data, enc));
      return api;
    },
    digest: (enc) => output(h.digest(), enc),
  };
  return api;
}

export function randomBytes(n: number): Buffer {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 65536) globalThis.crypto.getRandomValues(out.subarray(i, Math.min(n, i + 65536)));
  return Buffer.from(out);
}

export const randomUUID = (): string => globalThis.crypto.randomUUID();

const checkGcm = (alg: string, key: Bytes, iv: Bytes) => {
  if (alg.toLowerCase() !== "aes-256-gcm") throw new Error(`Cipher not supported in the web version: ${alg}`);
  if (key.length !== 32) throw new Error("Invalid key length");
  if (iv.length < 1) throw new Error("Invalid initialization vector");
};

/** AES-256-GCM: Node'daki gibi update/final/getAuthTag; şifreleme `final()` çağrısında yapılır. */
export function createCipheriv(alg: string, key: Input, iv: Input) {
  const k = bytesOf(key);
  const n = bytesOf(iv);
  checkGcm(alg, k, n);
  const chunks: Bytes[] = [];
  let tag: Bytes | null = null;
  return {
    update(data: Input, enc?: BufferEncoding): Buffer {
      chunks.push(bytesOf(data, enc));
      return Buffer.alloc(0);
    },
    final(): Buffer {
      const sealed = gcm(k, n).encrypt(Buffer.concat(chunks));
      tag = sealed.subarray(sealed.length - 16);
      return Buffer.from(sealed.subarray(0, sealed.length - 16));
    },
    getAuthTag(): Buffer {
      if (!tag) throw new Error("Attempting to get auth tag in unsupported state");
      return Buffer.from(tag);
    },
  };
}

export function createDecipheriv(alg: string, key: Input, iv: Input) {
  const k = bytesOf(key);
  const n = bytesOf(iv);
  checkGcm(alg, k, n);
  const chunks: Bytes[] = [];
  let tag: Bytes | null = null;
  return {
    setAuthTag(t: Input) {
      tag = bytesOf(t);
      return this;
    },
    update(data: Input, enc?: BufferEncoding): Buffer {
      chunks.push(bytesOf(data, enc));
      return Buffer.alloc(0);
    },
    final(): Buffer {
      if (!tag) throw new Error("Unsupported state or unable to authenticate data");
      try {
        return Buffer.from(gcm(k, n).decrypt(Buffer.concat([...chunks, tag])));
      } catch {
        throw new Error("Unsupported state or unable to authenticate data");
      }
    },
  };
}

/** Node'daki geri çağırmalı `pbkdf2`. */
export function pbkdf2(password: Input, salt: Input, iterations: number, keylen: number, digest: string, cb: (err: Error | null, key: Buffer) => void): void {
  pbkdf2Async(hashOf(digest), bytesOf(password), bytesOf(salt), { c: iterations, dkLen: keylen }).then(
    (k) => cb(null, Buffer.from(k)),
    (e: Error) => cb(e, Buffer.alloc(0)),
  );
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) throw new RangeError("Input buffers must have the same byte length");
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

export default { createHash, createHmac, randomBytes, randomUUID, createCipheriv, createDecipheriv, pbkdf2, timingSafeEqual };

// Not kilitleme: gövde, kullanıcının parolasından türetilen anahtarla tarayıcıda (WebCrypto) şifrelenir.
// PBKDF2-SHA256 (600 000 tur) + AES-256-GCM. Parola ya da anahtar hiçbir zaman diske ya da sunucuya gitmez;
// diske yalnızca şifreli yük yazılır (bkz. core/src/note-text.ts). Parola unutulursa içerik kurtarılamaz.

import { lockedBody, lockedPayload } from "../../core/src/note-text.ts";

const ITERATIONS = 600_000;

interface Payload {
  v: 1;
  kdf: "PBKDF2-SHA256";
  iter: number;
  salt: string;
  iv: string;
  data: string;
  hint?: string;
}

const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf instanceof Uint8Array ? buf : new Uint8Array(buf))));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Açık notların anahtarları (yalnızca bellekte; "Tüm kilitli notları kapat" ile silinir). */
const session = new Map<string, { key: CryptoKey; salt: Uint8Array; iter: number; hint?: string }>();
const listeners = new Set<() => void>();

async function derive(password: string, salt: Uint8Array, iter: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password.normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: iter }, base, { name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
}

async function seal(key: CryptoKey, salt: Uint8Array, iter: number, text: string, hint: string | undefined, notice: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text));
  const payload: Payload = { v: 1, kdf: "PBKDF2-SHA256", iter, salt: b64(salt), iv: b64(iv), data: b64(data), ...(hint ? { hint } : {}) };
  return lockedBody(JSON.stringify(payload), notice);
}

export function lockHint(body: string): string | undefined {
  try {
    return (JSON.parse(lockedPayload(body) ?? "{}") as Payload).hint;
  } catch {
    return undefined;
  }
}

/** Notu ilk kez kilitler: yeni tuz ve anahtar üretir; kilitli gövdeyi döndürür ve anahtarı oturumda tutar. */
export async function lockNote(nodeId: string, password: string, text: string, hint: string | undefined, notice: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await derive(password, salt, ITERATIONS);
  session.set(nodeId, { key, salt, iter: ITERATIONS, hint });
  listeners.forEach((l) => l());
  return seal(key, salt, ITERATIONS, text, hint, notice);
}

/** Kilitli gövdeyi açar; parola yanlışsa null. Başarılıysa anahtar oturumda tutulur. */
export async function unlockNote(nodeId: string, password: string, body: string): Promise<string | null> {
  const raw = lockedPayload(body);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Payload;
    const salt = unb64(p.salt);
    const key = await derive(password, salt, p.iter);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(p.iv) as BufferSource }, key, unb64(p.data) as BufferSource);
    session.set(nodeId, { key, salt, iter: p.iter, hint: p.hint });
    listeners.forEach((l) => l());
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

/** Oturumda açık olan kilitli notu, aynı anahtarla yeniden şifreler (her kayıtta yeni IV). */
export async function resealNote(nodeId: string, text: string, notice: string): Promise<string | null> {
  const s = session.get(nodeId);
  return s ? seal(s.key, s.salt, s.iter, text, s.hint, notice) : null;
}

export const isUnlocked = (nodeId: string) => session.has(nodeId);

export function forgetNote(nodeId: string): void {
  session.delete(nodeId);
  listeners.forEach((l) => l());
}

/** "Tüm kilitli notları kapat". */
export function closeAllLocked(): void {
  session.clear();
  listeners.forEach((l) => l());
}

export function onLockChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

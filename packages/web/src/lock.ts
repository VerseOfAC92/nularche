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
  /** Şifreli Arche'ye ait not: Arche'nin ortak anahtarıyla şifrelidir (oturumda `arche:<id>` altında tutulur). */
  arche?: string;
}

/** Şifreli Arche'nin parametreleri (Arche'nin `archeLock` alanı): tuz, tur sayısı, ipucu ve parola denetimi. */
export interface ArcheLock {
  salt: string;
  iter: number;
  check: string;
  hint?: string;
}

const archeKey = (archeId: string) => `arche:${archeId}`;

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

async function seal(key: CryptoKey, salt: Uint8Array, iter: number, text: string, hint: string | undefined, notice: string, arche?: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text));
  const payload: Payload = { v: 1, kdf: "PBKDF2-SHA256", iter, salt: b64(salt), iv: b64(iv), data: b64(data), ...(hint ? { hint } : {}), ...(arche ? { arche } : {}) };
  return lockedBody(JSON.stringify(payload), notice);
}

function payloadOf(body: string): Payload | null {
  try {
    const raw = lockedPayload(body);
    return raw ? (JSON.parse(raw) as Payload) : null;
  } catch {
    return null;
  }
}

async function open(key: CryptoKey, p: Payload): Promise<string> {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(p.iv) as BufferSource }, key, unb64(p.data) as BufferSource);
  return new TextDecoder().decode(plain);
}

/** Notun şifreli Arche'ye ait olup olmadığı (gövdedeki işarete göre). */
export const lockedArche = (body: string): string | null => payloadOf(body)?.arche ?? null;

/** Arche parolasının denetim değeri: anahtarla bilinen bir metin şifrelenir (parolanın kendisi saklanmaz). */
async function checkValue(key: CryptoKey): Promise<string> {
  const iv = new Uint8Array(12); // sabit IV yalnızca bu denetim metni için; içerik şifrelemesinde kullanılmaz
  return b64(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode("nularche-arche")));
}

/** Arche'yi şifrelemek için yeni anahtar üretir ve oturumda açar; Arche'ye yazılacak parametreleri döndürür. */
export async function createArcheLock(archeId: string, password: string, hint?: string): Promise<ArcheLock> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await derive(password, salt, ITERATIONS);
  session.set(archeKey(archeId), { key, salt, iter: ITERATIONS, hint });
  listeners.forEach((l) => l());
  return { salt: b64(salt), iter: ITERATIONS, check: await checkValue(key), ...(hint ? { hint } : {}) };
}

/** Şifreli Arche'yi parolayla açar (yanlışsa false); içindeki bütün notlar artık parola sormadan açılır. */
export async function unlockArche(archeId: string, lock: ArcheLock, password: string): Promise<boolean> {
  const salt = unb64(lock.salt);
  const key = await derive(password, salt, lock.iter);
  if ((await checkValue(key)) !== lock.check) return false;
  session.set(archeKey(archeId), { key, salt, iter: lock.iter, hint: lock.hint });
  listeners.forEach((l) => l());
  return true;
}

export const isArcheUnlocked = (archeId: string) => session.has(archeKey(archeId));

/** Şifreli Arche'nin anahtarını bellekten siler (Arche'nin notları yeniden parola ister). */
export function forgetArche(archeId: string): void {
  session.delete(archeKey(archeId));
  listeners.forEach((l) => l());
}

/** Şifreli Arche'nin açık anahtarıyla bir not gövdesini şifreler (Arche açık değilse null). */
export async function sealForArche(archeId: string, text: string, notice: string): Promise<string | null> {
  const s = session.get(archeKey(archeId));
  return s ? seal(s.key, s.salt, s.iter, text, s.hint, notice, archeId) : null;
}

/**
 * Oturumdaki anahtarla kilitli gövdeyi açar (notun kendi anahtarı ya da şifreli Arche'nin anahtarı); anahtar yoksa ya
 * da açılamazsa null. Arche'si açık notlar böylece parola sormadan açılır.
 */
export async function openWithSession(nodeId: string, body: string): Promise<string | null> {
  const p = payloadOf(body);
  if (!p) return null;
  const s = session.get(p.arche ? archeKey(p.arche) : nodeId);
  if (!s) return null;
  try {
    return await open(s.key, p);
  } catch {
    return null;
  }
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
  const p = payloadOf(body);
  if (!p) return null;
  try {
    const salt = unb64(p.salt);
    const key = await derive(password, salt, p.iter);
    const text = await open(key, p);
    // Şifreli Arche'nin notuysa anahtar Arche için tutulur: Arche'nin diğer notları da açılır.
    session.set(p.arche ? archeKey(p.arche) : nodeId, { key, salt, iter: p.iter, hint: p.hint });
    listeners.forEach((l) => l());
    return text;
  } catch {
    return null;
  }
}

/** Oturumda açık olan kilitli notu, aynı anahtarla yeniden şifreler (her kayıtta yeni IV). Şifreli Arche'nin notu
 *  Arche'nin anahtarıyla şifrelenir. */
export async function resealNote(nodeId: string, text: string, notice: string, archeId?: string | null): Promise<string | null> {
  const own = session.get(nodeId);
  if (own) return seal(own.key, own.salt, own.iter, text, own.hint, notice);
  return archeId ? sealForArche(archeId, text, notice) : null;
}

export const isUnlocked = (nodeId: string, archeId?: string | null) => session.has(nodeId) || (!!archeId && session.has(archeKey(archeId)));

export function forgetNote(nodeId: string, archeId?: string | null): void {
  session.delete(nodeId);
  if (archeId) session.delete(archeKey(archeId));
  listeners.forEach((l) => l());
}

/** Şu an açık (anahtarı bellekte) kilitli not ve şifreli Arche sayısı. */
export function openLockedCount(): number {
  return session.size;
}

/** "Tüm kilitli notları kapat": notların ve şifreli Arche'lerin anahtarları bellekten silinir. */
export function closeAllLocked(): void {
  session.clear();
  listeners.forEach((l) => l());
}

export function onLockChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

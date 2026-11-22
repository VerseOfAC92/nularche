// Şifreli Arche: bir Arche'nin bütün notlarını tek parolayla şifreler ya da şifrelemeyi kaldırır. Anahtarlar yalnızca
// bellekte tutulur (bkz. lock.ts); Arche'ye yalnızca anahtar türetme parametreleri ve parola denetim değeri yazılır.
// Yeni şifrelenen Arche'ler tam şifrelidir (archeLock.v 2): içerik, başlıklar, özellikler ve ağaç yapısı (bkz.
// crypta.ts). Eski sürümlerde yalnızca içeriği şifrelenmiş Arche'ler, parolayla ilk açıldıklarında tam şifrelemeye
// yükseltilir; şifreleme yarıda kalırsa kalan notlar Arche bir sonraki açılışta mühürlenir.

import { isLockedBody } from "../../core/src/note-text.ts";
import { api, rawNodeApi, type NodeMeta } from "./api.ts";
import { sealArche, unsealArche } from "./crypta.ts";
import { createArcheLock, forgetArche, isArcheUnlocked, lockedArche, onLockChange, openWithSession, sealForArche, unlockedArches } from "./lock.ts";

export interface ArcheCryptResult {
  /** İşlenen not sayısı. */
  done: number;
  /** Kendi parolasıyla kilitli olduğu için olduğu gibi bırakılan notlar. */
  skipped: number;
}

/** Arche'yi verilen parolayla şifreler; Arche bu oturumda açık kalır. */
export async function encryptArche(arche: NodeMeta, _nodes: NodeMeta[], password: string, hint: string, _notice: string, onProgress?: (done: number, total: number) => void): Promise<ArcheCryptResult> {
  const lock = await createArcheLock(arche.id, password, hint.trim() || undefined);
  // Önce parametreler yazılır: bundan sonra Arche'ye eklenen notlar da şifrelenir.
  await rawNodeApi.update(arche.id, { fields: { archeLock: lock } });
  const done = await sealArche(rawNodeApi, arche.id, onProgress);
  sealed.add(arche.id);
  return { done, skipped: 0 };
}

/**
 * Arche'nin şifrelemesini kaldırır (Arche bu oturumda açık olmalı): Arche'nin anahtarıyla şifrelenmiş bütün notlar —
 * Arche'den başka yere taşınmış olanlar da — şifresiz yazılır.
 */
export async function decryptArche(arche: NodeMeta, nodes: NodeMeta[], onProgress?: (done: number, total: number) => void): Promise<ArcheCryptResult> {
  if (!isArcheUnlocked(arche.id)) throw new Error("arche locked");
  if (arche.archeLock?.v === 2) {
    const r = await unsealArche(rawNodeApi, arche.id, onProgress);
    if (!r.skipped) forgetArche(arche.id);
    return r;
  }
  const candidates = nodes.filter((n) => n.locked);
  const result: ArcheCryptResult = { done: 0, skipped: 0 };
  for (const [i, m] of candidates.entries()) {
    const doc = await api.read(m.id);
    if (lockedArche(doc.body) === arche.id) {
      const text = await openWithSession(doc.id, doc.body);
      if (text === null) result.skipped++;
      else {
        await api.update(m.id, { body: text, fields: { locked: null }, baseRevision: doc.revision });
        result.done++;
      }
    }
    onProgress?.(i + 1, candidates.length);
  }
  if (!result.skipped) {
    await api.update(arche.id, { fields: { archeLock: null } });
    forgetArche(arche.id);
  }
  return result;
}

/** Bu oturumda mühürleme denetimi yapılmış Arche'ler. */
const sealed = new Set<string>();

/**
 * Şifreli bir Arche açıldığında (Ayarlar, Arche ya da not ekranı): eski sürümde yalnızca içeriği şifrelenmiş Arche tam
 * şifrelemeye yükseltilir; tam şifreli Arche'de henüz mühürlenmemiş notlar (dışarıdan eklenen, taşınan ya da yapay
 * zekâ araçlarının oluşturduğu) mühürlenir. Bittiğinde `onDone` çağrılır (liste yenilensin).
 */
export function watchCrypta(onDone: () => void, onProgress?: (done: number, total: number) => void): () => void {
  let running = false;
  const check = async () => {
    if (running) return;
    running = true;
    try {
      for (const id of unlockedArches()) {
        if (sealed.has(id)) continue;
        const root = (await rawNodeApi.list()).find((n) => n.id === id);
        if (!root?.archeLock) continue;
        if (root.archeLock.v !== 2) await rawNodeApi.update(id, { fields: { archeLock: { ...root.archeLock, v: 2 } } });
        await sealArche(rawNodeApi, id, onProgress);
        sealed.add(id);
      }
    } catch {
      // Çakışma ya da bağlantı hatası: Arche bir sonraki kilit değişikliğinde yeniden denenir.
    } finally {
      running = false;
      onDone();
    }
  };
  void check();
  return onLockChange(() => void check());
}

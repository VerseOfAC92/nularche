// Şifreli Arche: bir Arche'nin bütün notlarını tek parolayla şifreler ya da şifrelemeyi kaldırır. Anahtarlar yalnızca
// bellekte tutulur (bkz. lock.ts); Arche'ye yalnızca anahtar türetme parametreleri ve parola denetim değeri yazılır.
// Şifreleme yarıda kalırsa kalan notlar açıldıklarında şifrelenir (NodeView). Başlıklar, özellikler ve Arche'nin
// ağaçtaki yapısı görünür kalır; içerik (gövde) şifrelidir.

import { isLockedBody } from "../../core/src/note-text.ts";
import { api, type NodeMeta } from "./api.ts";
import { createArcheLock, forgetArche, isArcheUnlocked, lockedArche, openWithSession, sealForArche } from "./lock.ts";

export interface ArcheCryptResult {
  /** İşlenen not sayısı. */
  done: number;
  /** Kendi parolasıyla kilitli olduğu için olduğu gibi bırakılan notlar. */
  skipped: number;
}

/** Arche'nin kendisi ve alt notları (Arche'nin kökü dahil). */
const membersOf = (archeId: string, nodes: NodeMeta[]) => nodes.filter((n) => n.archeId === archeId);

/** Arche'yi verilen parolayla şifreler; Arche bu oturumda açık kalır. */
export async function encryptArche(arche: NodeMeta, nodes: NodeMeta[], password: string, hint: string, notice: string, onProgress?: (done: number, total: number) => void): Promise<ArcheCryptResult> {
  const lock = await createArcheLock(arche.id, password, hint.trim() || undefined);
  // Önce parametreler yazılır: bundan sonra Arche'ye eklenen notlar da şifrelenir.
  await api.update(arche.id, { fields: { archeLock: lock } });
  const members = membersOf(arche.id, nodes);
  const result: ArcheCryptResult = { done: 0, skipped: 0 };
  for (const [i, m] of members.entries()) {
    const doc = await api.read(m.id);
    if (doc.locked || isLockedBody(doc.body)) {
      if (lockedArche(doc.body) !== arche.id) result.skipped++;
    } else {
      const sealed = await sealForArche(arche.id, doc.body, notice);
      if (sealed === null) throw new Error("arche key missing");
      await api.update(m.id, { body: sealed, fields: { locked: true }, baseRevision: doc.revision });
      result.done++;
    }
    onProgress?.(i + 1, members.length);
  }
  return result;
}

/**
 * Arche'nin şifrelemesini kaldırır (Arche bu oturumda açık olmalı): Arche'nin anahtarıyla şifrelenmiş bütün notlar —
 * Arche'den başka yere taşınmış olanlar da — şifresiz yazılır.
 */
export async function decryptArche(arche: NodeMeta, nodes: NodeMeta[], onProgress?: (done: number, total: number) => void): Promise<ArcheCryptResult> {
  if (!isArcheUnlocked(arche.id)) throw new Error("arche locked");
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

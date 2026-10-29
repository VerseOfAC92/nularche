// Akıllı klasörler: kayıtlı filtrelerle oluşan dinamik not listeleri (Apple Notlar'daki Smart Folders).
// Tanımlar Origin tercihlerinde (`smartFolders`) saklanır; eşleşme Node listesindeki bilgilerden hesaplanır.

import type { NodeMeta } from "../api.ts";

export interface SmartFolder {
  id: string;
  name: string;
  icon?: string;
  /** Koşulların tümü mü, herhangi biri mi sağlansın. */
  match: "all" | "any";
  tags?: string[];
  tagMode?: "any" | "all";
  /** Son N gün içinde oluşturulmuş / düzenlenmiş. */
  createdDays?: number;
  editedDays?: number;
  checklist?: "has" | "open" | "done";
  attachments?: boolean;
  archeIds?: string[];
  pinned?: boolean;
  locked?: boolean;
}

const DAY = 86_400_000;
const key = (s: string) => s.toLocaleLowerCase("tr");

/** Akıllı klasörün kapsadığı notlar (şablonlar ve veritabanı tanımları hariç). */
export function smartMatches(folder: SmartFolder, nodes: NodeMeta[], now = Date.now()): NodeMeta[] {
  return nodes.filter((n) => !n.template && !n.database && matches(folder, n, now));
}

function matches(f: SmartFolder, n: NodeMeta, now: number): boolean {
  const checks: boolean[] = [];
  if (f.tags?.length) {
    const own = n.tags.map(key);
    const has = (t: string) => own.some((o) => o === key(t) || o.startsWith(`${key(t)}/`));
    checks.push(f.tagMode === "all" ? f.tags.every(has) : f.tags.some(has));
  }
  if (f.createdDays) checks.push(now - n.createdAt <= f.createdDays * DAY);
  if (f.editedDays) checks.push(now - n.updatedAt <= f.editedDays * DAY);
  if (f.checklist === "has") checks.push(n.todos > 0);
  if (f.checklist === "open") checks.push(n.todos > n.done);
  if (f.checklist === "done") checks.push(n.todos > 0 && n.todos === n.done);
  if (f.attachments) checks.push(n.attachments > 0);
  if (f.archeIds?.length) checks.push(!!n.archeId && f.archeIds.includes(n.archeId));
  if (f.pinned) checks.push(!!n.pinned);
  if (f.locked) checks.push(!!n.locked);
  if (!checks.length) return false;
  return f.match === "any" ? checks.some(Boolean) : checks.every(Boolean);
}

export const newSmartId = () => `sf_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

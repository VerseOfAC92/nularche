// Yazma hedefleri (2.0): günlük kelime günlüğü, oturum sayacı ve seri (art arda yazılan günler).
// Günlük, Origin tercihlerinde (`writingLog`: "YYYY-MM-DD" → o gün yazılan net kelime) tutulur; en çok 400 gün.
// Sayım editörün sözcük sayısındaki değişimden yapılır: not açıldığında taban alınır, sonraki artış/azalış o güne
// eklenir (bir gün eksiye düşmez). Başka bir yerde (ör. AI) yapılan değişiklikler not yeniden yüklenince taban
// sıfırlandığı için sayılmaz.

import { useSyncExternalStore } from "react";
import { getPref, setPref } from "../prefs.ts";

const LOG_DAYS = 400;
const baselines = new Map<string, number>();
let session = 0;
const listeners = new Set<() => void>();

export function dayKey(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Editörden gelen sözcük sayısı; `docKey` notun o anki yüklemesini tanımlar. */
export function trackWords(docKey: string, words: number): void {
  const base = baselines.get(docKey);
  baselines.set(docKey, words);
  if (base === undefined || base === words) return;
  const delta = words - base;
  // Yapıştırma ya da büyük silme gibi tek seferde 2000'den fazla kelimelik değişimler yazma sayılmaz.
  if (Math.abs(delta) > 2000) return;
  session = Math.max(0, session + delta);
  const log = { ...getPref<Record<string, number>>("writingLog", {}) };
  const today = dayKey();
  log[today] = Math.max(0, (log[today] ?? 0) + delta);
  const keys = Object.keys(log).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - LOG_DAYS))) delete log[k];
  setPref("writingLog", log);
  listeners.forEach((l) => l());
}

export function forgetDoc(docKey: string): void {
  baselines.delete(docKey);
}

export function useSessionWords(): number {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => session,
  );
}

/** Bugün yazılan kelime ve art arda en az bir kelime yazılan gün sayısı (bugün henüz yazılmadıysa dünden geriye). */
export function writingStats(log: Record<string, number>, now = new Date()): { today: number; streak: number; week: number[] } {
  const today = log[dayKey(now)] ?? 0;
  let streak = 0;
  const d = new Date(now);
  if (!today) d.setDate(d.getDate() - 1);
  while ((log[dayKey(d)] ?? 0) > 0) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  const week: number[] = [];
  for (let i = 6; i >= 0; i--) {
    const x = new Date(now);
    x.setDate(x.getDate() - i);
    week.push(log[dayKey(x)] ?? 0);
  }
  return { today, streak, week };
}

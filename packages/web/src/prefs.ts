// Arayüz tercihleri (odak modu arka planı, liste görünümü, son notlar, akıllı klasörler…).
// Origin'deki `.nularche/ui.json` dosyasında tutulur (bkz. core/src/prefs.ts); açılışta bir kez okunur, değişiklikler
// kısa bir gecikmeyle toplu yazılır. Sunucuya ulaşılamazsa yalnızca bu oturumda geçerli olur.

import { useSyncExternalStore } from "react";
import { api } from "./api.ts";

let values: Record<string, unknown> = {};
let loaded = false;
const listeners = new Set<() => void>();
let pending: Record<string, unknown> = {};
let timer: number | undefined;

export async function loadPrefs(): Promise<void> {
  try {
    values = { ...(await api.prefs()), ...pending };
  } catch {
    // yalnızca bu oturum
  }
  loaded = true;
  listeners.forEach((l) => l());
}

export function prefsLoaded(): boolean {
  return loaded;
}

export function getPref<T>(key: string, fallback: T): T {
  const v = values[key];
  return v === undefined || v === null ? fallback : (v as T);
}

export function setPref(key: string, value: unknown): void {
  values = { ...values, [key]: value };
  pending[key] = value ?? null;
  listeners.forEach((l) => l());
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    const patch = pending;
    pending = {};
    api.setPrefs(patch).catch(() => undefined);
  }, 400);
}

/** Tercihi okur ve değişince bileşeni yeniden çizer. */
export function usePref<T>(key: string, fallback: T): [T, (v: T) => void] {
  const value = useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => values[key],
  );
  return [value === undefined || value === null ? fallback : (value as T), (v: T) => setPref(key, v)];
}

/** Son açılan notlar (en yeni önce, en çok 30). */
export function pushRecent(id: string): void {
  const list = getPref<string[]>("recent", []).filter((x) => x !== id);
  setPref("recent", [id, ...list].slice(0, 30));
}

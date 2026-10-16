// Arayüz dili (Türkçe / English). Metinler `strings.ts` sözlüğündedir; `t()` her yerde
// (React dışında da) geçerli dili kullanır. Dil değişince uygulama yeniden çizilir.

import { useSyncExternalStore } from "react";
import { STRINGS, type StringKey } from "./strings.ts";

export type Lang = "tr" | "en";
const KEY = "nlc-lang";

function detect(): Lang {
  // Masaüstünde dil ayarlardadır (yerel sunucunun portu değiştiği için tarayıcı deposu kalıcı değildir).
  const bridged = (window as { nularche?: { language?: unknown } }).nularche?.language;
  if (bridged === "tr" || bridged === "en") return bridged;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "tr" || saved === "en") return saved;
  } catch {
    // depolama kapalı
  }
  return (navigator.language || "en").toLowerCase().startsWith("tr") ? "tr" : "en";
}

let current: Lang = detect();
document.documentElement.lang = current;
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  current = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // yalnızca bu oturum
  }
  document.documentElement.lang = lang;
  listeners.forEach((l) => l());
}

export function useLang(): Lang {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => current,
  );
}

/** Metni geçerli dilde döndürür; `{ad}` biçimindeki yer tutucular `vars` ile doldurulur. */
export function t(key: StringKey, vars?: Record<string, string | number>): string {
  const entry = STRINGS[key];
  let s: string = entry[current] ?? entry.tr;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** Tarih/saat biçimlendirme için yerel ayar. */
export const locale = () => (current === "tr" ? "tr-TR" : "en-GB");

export type { StringKey };

/** “az önce / 5 dk önce / 2 sa önce / tarih” biçiminde göreli zaman. */
export function ago(ms: number): string {
  const d = (Date.now() - ms) / 1000;
  if (d < 60) return t("time.justNow");
  if (d < 3600) return t("time.minutesAgo", { n: Math.floor(d / 60) });
  if (d < 86400) return t("time.hoursAgo", { n: Math.floor(d / 3600) });
  return new Date(ms).toLocaleDateString(locale());
}

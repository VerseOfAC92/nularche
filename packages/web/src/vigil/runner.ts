// Vigil çalıştırıcısı: ana pencerede dakikada bir zamanı gelen otomasyonları çalıştırır (bkz.
// core/src/vigil-schedule.ts). Yapay zekâ işleri Nularche AI isteği olarak oluşturulur; otomatik mod açıksa arka
// planda hemen işlenir, değilse Nularche AI penceresinde gönderilmeyi bekler. Özet işleri yerelde not yazar.

import { cleanVigils, isDue, type Vigil, type VigilResult } from "../../../core/src/vigil-schedule.ts";
import { api } from "../api.ts";
import { desktop } from "../desktop.ts";
import { getLang, t } from "../i18n/index.ts";
import { getPref, prefsLoaded, setPref } from "../prefs.ts";

let running = false;

const stamp = (now: number) => new Date(now).toLocaleDateString(getLang() === "en" ? "en-GB" : "tr-TR", { day: "numeric", month: "long", year: "numeric" });

/** Tek bir otomasyonu hemen çalıştırır ve sonucunu döndürür (zamanlayıcı ve "Şimdi çalıştır"). */
export async function runVigil(v: Vigil, now = Date.now()): Promise<VigilResult> {
  try {
    if (v.action.kind === "digest") {
      const res = await fetch("/api/vigil/digest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ days: v.action.days, parentId: v.action.parentId ?? null, title: `${v.name} — ${stamp(now)}`, lang: getLang() }),
      });
      const doc = (await res.json()) as { id?: string; message?: string };
      if (!res.ok || !doc.id) throw new Error(doc.message ?? res.statusText);
      return { at: now, ok: true, nodeId: doc.id, message: t("vigil.digestDone") };
    }
    const auto = desktop ? await desktop.autoStatus().catch(() => null) : null;
    const autoOn = !!(auto?.enabled && auto.hasKey);
    const status = desktop && !autoOn ? await desktop.aiStatus().catch(() => null) : null;
    const instruction = `${v.action.prompt.trim()}\n\n${t("vigil.aiContext", { name: v.name, date: stamp(now) })}`;
    const req = await api.aiRequest({ provider: autoOn ? "gemini" : (status?.provider ?? null), label: `Vigil · ${v.name}`, instruction, language: getLang() });
    if (autoOn && desktop) {
      const r = await desktop.autoRun(req.id);
      return { at: now, ok: r.ok, requestId: req.id, message: r.ok ? t("vigil.aiDone") : (r.error ?? t("vigil.aiPending")) };
    }
    return { at: now, ok: true, requestId: req.id, message: t("vigil.aiPending") };
  } catch (e) {
    return { at: now, ok: false, message: (e as Error).message };
  }
}

/** Sonucu tercihlere yazar (son çalışma zamanı ve sonuç). */
export function recordRun(id: string, result: VigilResult): void {
  const list = cleanVigils(getPref("vigils", []));
  setPref(
    "vigils",
    list.map((v) => (v.id === id ? { ...v, lastRun: result.at, lastResult: result } : v)),
  );
}

async function tick(onToast: (msg: string) => void): Promise<void> {
  if (running || !prefsLoaded()) return;
  running = true;
  try {
    const now = Date.now();
    for (const v of cleanVigils(getPref("vigils", []))) {
      if (!isDue(v, now, v.created)) continue;
      // Önce çalıştı diye işaretlenir: iş uzun sürse ya da hata verse de aynı an için yeniden başlamaz.
      recordRun(v.id, { at: now, ok: true, message: "…" });
      const result = await runVigil(v, now);
      recordRun(v.id, result);
      onToast(result.ok ? t("vigil.ran", { name: v.name, result: result.message ?? "" }) : t("vigil.failed", { name: v.name, error: result.message ?? "" }));
    }
  } finally {
    running = false;
  }
}

export function installVigilRunner(onToast: (msg: string) => void): () => void {
  const first = window.setTimeout(() => void tick(onToast), 15_000);
  const timer = window.setInterval(() => void tick(onToast), 60_000);
  return () => (clearTimeout(first), clearInterval(timer));
}

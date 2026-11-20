// Vigil zamanlaması (saf işlevler; arayüz de kullanır): tanımlar, bir sonraki ve son çalışma anı, doğrulama.
// Çalıştırma ve özet notu vigil.ts içindedir.

export type VigilFreq = "daily" | "weekly" | "monthly";

export interface VigilSchedule {
  freq: VigilFreq;
  /** Haftalıkta gün: 1 pazartesi … 7 pazar. */
  weekday?: number;
  /** Aylıkta gün: 1–28. */
  day?: number;
  /** "HH:MM", yerel saat. */
  time: string;
}

export type VigilAction = { kind: "ai"; prompt: string } | { kind: "digest"; days: number; parentId?: string | null };

export interface VigilResult {
  at: number;
  ok: boolean;
  message?: string;
  nodeId?: string;
  requestId?: string;
}

export interface Vigil {
  id: string;
  name: string;
  enabled: boolean;
  schedule: VigilSchedule;
  action: VigilAction;
  /** Oluşturulma zamanı: daha önceki zamanlanmış anlar "kaçırılmış" sayılmaz. */
  created?: number;
  lastRun?: number;
  lastResult?: VigilResult;
}

const hm = (time: string): [number, number] => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  const h = m ? Math.min(23, Number(m[1])) : 9;
  const min = m ? Math.min(59, Number(m[2])) : 0;
  return [h, min];
};

/** Verilen günün (yerel) zamanlanan anı; o gün uygun değilse null. */
function occurrenceOn(day: Date, s: VigilSchedule): number | null {
  const [h, m] = hm(s.time);
  if (s.freq === "weekly") {
    const wd = ((day.getDay() + 6) % 7) + 1; // 1 pazartesi
    if (wd !== (s.weekday ?? 1)) return null;
  }
  if (s.freq === "monthly" && day.getDate() !== Math.min(28, Math.max(1, s.day ?? 1))) return null;
  const d = new Date(day);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

/** `after`dan sonraki ilk çalışma zamanı. */
export function nextRun(s: VigilSchedule, after: number): number {
  const day = new Date(after);
  day.setHours(0, 0, 0, 0);
  for (let i = 0; i < 400; i++) {
    const at = occurrenceOn(day, s);
    if (at !== null && at > after) return at;
    day.setDate(day.getDate() + 1);
  }
  return Number.POSITIVE_INFINITY;
}

/** `now`a kadar (dahil) son çalışma zamanı. */
export function lastOccurrence(s: VigilSchedule, now: number): number | null {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  for (let i = 0; i < 400; i++) {
    const at = occurrenceOn(day, s);
    if (at !== null && at <= now) return at;
    day.setDate(day.getDate() - 1);
  }
  return null;
}

/** Çalışma zamanı geldi mi: son zamanlanan an geçmiş ve o andan beri çalışmamış (oluşturulmadan önceki anlar sayılmaz). */
export function isDue(v: Vigil, now: number, createdAt?: number): boolean {
  if (!v.enabled) return false;
  const last = lastOccurrence(v.schedule, now);
  if (last === null) return false;
  if (createdAt !== undefined && last < createdAt) return false;
  return !v.lastRun || v.lastRun < last;
}

/** Sonraki çalışmaların listesi (takvimde gösterilir). */
export function upcomingRuns(v: Vigil, from: number, until: number): number[] {
  const out: number[] = [];
  let t = from - 1;
  while (out.length < 400) {
    t = nextRun(v.schedule, t);
    if (!Number.isFinite(t) || t > until) break;
    out.push(t);
  }
  return out;
}

/** Tercihlerden gelen veriyi doğrular (bozuk tanımlar atlanır). */
export function cleanVigils(raw: unknown): Vigil[] {
  if (!Array.isArray(raw)) return [];
  const out: Vigil[] = [];
  for (const x of raw.slice(0, 50)) {
    if (!x || typeof x !== "object") continue;
    const v = x as Vigil;
    if (typeof v.id !== "string" || !/^[\w-]{1,40}$/.test(v.id) || typeof v.name !== "string") continue;
    const s = v.schedule ?? ({} as VigilSchedule);
    if (!["daily", "weekly", "monthly"].includes(s.freq) || typeof s.time !== "string") continue;
    const a = v.action as VigilAction;
    if (!a || (a.kind !== "ai" && a.kind !== "digest")) continue;
    out.push(v);
  }
  return out;
}

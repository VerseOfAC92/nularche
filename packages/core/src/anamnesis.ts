// Anamnesis: notlardan bilgi kartları ve aralıklı tekrar. Notta `Soru :: Cevap` satırı bir kart, `Terim ::: Tanım`
// iki yönlü iki kart olur (kod blokları hariç). Kartların tekrar durumu `.nularche/anamnesis.json` dosyasındadır ve
// Google Drive ile eşitlenir; kartın kimliği notun kimliği ve soru metninden türetilir (not taşınsa da korunur).
//
// Zamanlama FSRS-5 algoritmasıyla yapılır (açık yayımlanmış formüller, varsayılan ağırlıklar, hedef hatırlama
// %90). Yeni ve unutulan kartlar 10 dakika sonra yeniden sorulur; diğer aralıklar gün cinsindendir.

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { NodeStore } from "./node-store.ts";
import { cardKeyInput, extractRawCards } from "./anamnesis-cards.ts";
import { NodeError } from "./errors.ts";

export type Grade = 1 | 2 | 3 | 4; // Tekrar, Zor, İyi, Kolay

export interface CardState {
  due: number;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  last: number;
  /** 0 yeni, 1 öğreniliyor/yeniden öğreniliyor, 2 tekrar. */
  state: 0 | 1 | 2;
}

export interface Card {
  id: string;
  noteId: string;
  noteTitle: string;
  archeId: string | null;
  front: string;
  back: string;
  /** Kartın notun gövdesindeki satırı (0'dan). */
  line: number;
}

const W = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621];
const DECAY = -0.5;
const FACTOR = 19 / 81;
const RETENTION = 0.9;
const DAY = 86_400_000;
const RELEARN_MS = 10 * 60_000;
const MAX_INTERVAL_DAYS = 36_500;

const clampD = (d: number) => Math.min(10, Math.max(1, d));
const initStability = (g: Grade) => Math.max(0.1, W[g - 1]);
const initDifficulty = (g: Grade) => clampD(W[4] - Math.exp(W[5] * (g - 1)) + 1);

/** Hatırlama olasılığı: `elapsedDays` gün sonra, kararlılık `s` iken. */
export function retrievability(elapsedDays: number, s: number): number {
  return Math.pow(1 + (FACTOR * elapsedDays) / s, DECAY);
}

/** Kararlılığa göre bir sonraki aralık (gün), hedef hatırlama %90. */
export function intervalDays(s: number): number {
  const i = (s / FACTOR) * (Math.pow(RETENTION, 1 / DECAY) - 1);
  return Math.min(MAX_INTERVAL_DAYS, Math.max(1, Math.round(i)));
}

function nextDifficulty(d: number, g: Grade): number {
  const delta = -W[6] * (g - 3);
  const dPrime = d + (delta * (10 - d)) / 9;
  return clampD(W[7] * initDifficulty(4) + (1 - W[7]) * dPrime);
}

function recallStability(d: number, s: number, r: number, g: Grade): number {
  const hard = g === 2 ? W[15] : 1;
  const easy = g === 4 ? W[16] : 1;
  return s * (Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) * (Math.exp(W[10] * (1 - r)) - 1) * hard * easy + 1);
}

function forgetStability(d: number, s: number, r: number): number {
  return Math.min(s, W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp(W[14] * (1 - r)));
}

/** Kartı değerlendirir ve yeni durumunu döndürür. */
export function review(prev: CardState | undefined, grade: Grade, now = Date.now()): CardState {
  if (!prev || prev.state === 0) {
    const s = initStability(grade);
    const d = initDifficulty(grade);
    if (grade === 1) return { due: now + RELEARN_MS, stability: s, difficulty: d, reps: 1, lapses: 0, last: now, state: 1 };
    return { due: now + intervalDays(s) * DAY, stability: s, difficulty: d, reps: 1, lapses: 0, last: now, state: 2 };
  }
  const elapsed = Math.max(0, (now - prev.last) / DAY);
  const r = retrievability(elapsed, prev.stability);
  const d = nextDifficulty(prev.difficulty, grade);
  // Aynı gün içinde tekrar (öğrenme adımı): kısa dönem kararlılık güncellemesi.
  const sameDay = elapsed < 1;
  let s: number;
  if (sameDay) s = prev.stability * Math.exp(W[17] * (grade - 3 + W[18]));
  else s = grade === 1 ? forgetStability(prev.difficulty, prev.stability, r) : recallStability(prev.difficulty, prev.stability, r, grade);
  s = Math.max(0.1, s);
  if (grade === 1) return { due: now + RELEARN_MS, stability: s, difficulty: d, reps: prev.reps + 1, lapses: prev.lapses + (prev.state === 2 ? 1 : 0), last: now, state: 1 };
  return { due: now + intervalDays(s) * DAY, stability: s, difficulty: d, reps: prev.reps + 1, lapses: prev.lapses, last: now, state: 2 };
}

/** Dört değerlendirmenin her biri için bir sonraki tekrar zamanı (arayüzdeki düğmelerde gösterilir). */
export function preview(prev: CardState | undefined, now = Date.now()): Record<Grade, number> {
  return { 1: review(prev, 1, now).due - now, 2: review(prev, 2, now).due - now, 3: review(prev, 3, now).due - now, 4: review(prev, 4, now).due - now };
}

// ------------------------------------------------------------------ kartları notlardan çıkarma

const cardId = (noteId: string, front: string, dir: string) => createHash("sha256").update(cardKeyInput(noteId, front, dir)).digest("hex").slice(0, 20);

export function extractCards(body: string, note: { id: string; title: string; archeId: string | null }): Card[] {
  return extractRawCards(body).map((c) => ({ id: cardId(note.id, c.front, c.dir), noteId: note.id, noteTitle: note.title, archeId: note.archeId, front: c.front, back: c.back, line: c.line }));
}

// ------------------------------------------------------------------ depo

interface AnamnesisFile {
  v: 1;
  cards: Record<string, CardState>;
  /** Gün (YYYY-MM-DD) → o gün ilk kez gösterilen yeni kart sayısı. */
  introduced?: Record<string, number>;
}

export interface AnamnesisQueue {
  /** Şimdi sorulacak kartlar: önce vadesi gelenler (en eskiden), sonra günlük sınır içinde yeni kartlar. */
  queue: (Card & { state?: CardState; next: Record<Grade, number> })[];
  counts: { total: number; due: number; new: number; learning: number; reviewedToday: number };
}

const fileOf = (root: string) => path.join(root, ".nularche", "anamnesis.json");
const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

export class Anamnesis {
  private chain: Promise<unknown> = Promise.resolve();
  private readonly store: NodeStore;

  constructor(store: NodeStore) {
    this.store = store;
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async load(): Promise<AnamnesisFile> {
    try {
      const d = JSON.parse(await readFile(fileOf(this.store.root), "utf8")) as AnamnesisFile;
      return d && typeof d.cards === "object" ? { v: 1, cards: d.cards, introduced: d.introduced ?? {} } : { v: 1, cards: {} };
    } catch {
      return { v: 1, cards: {}, introduced: {} };
    }
  }

  private async save(d: AnamnesisFile): Promise<void> {
    const file = fileOf(this.store.root);
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(d));
    await rename(tmp, file);
  }

  /** Origin'deki bütün kartlar (isteğe bağlı olarak tek bir Arche'den). */
  async cards(archeId?: string | null): Promise<Card[]> {
    const out: Card[] = [];
    for (const n of await this.store.list()) {
      if (n.locked || n.template || n.database) continue;
      if (archeId !== undefined && n.archeId !== archeId) continue;
      const doc = await this.store.read(n.id);
      if (!doc.body.includes("::")) continue;
      out.push(...extractCards(doc.body, { id: n.id, title: n.title, archeId: n.archeId }));
    }
    return out;
  }

  /**
   * `extra`: şifreli notların pencerede çözülmüş kartları. Yalnızca gerçekten kilitli notlara ait olanlar ve kimliği
   * sunucunun aynı metinden üreteceği kimlikle eşleşenler kabul edilir.
   */
  async queue(options: { archeId?: string | null; newPerDay?: number; now?: number; extra?: { noteId: string; front: string; back: string; line: number; dir: "f" | "r" }[] } = {}): Promise<AnamnesisQueue> {
    const now = options.now ?? Date.now();
    const data = await this.load();
    const cards = await this.cards(options.archeId);
    if (options.extra?.length) {
      const metas = new Map((await this.store.list()).map((n) => [n.id, n]));
      for (const x of options.extra.slice(0, 5000)) {
        const n = metas.get(x.noteId);
        if (!n?.locked || typeof x.front !== "string" || typeof x.back !== "string" || !x.front.trim() || !x.back.trim()) continue;
        if (options.archeId !== undefined && n.archeId !== options.archeId) continue;
        cards.push({ id: cardId(n.id, x.front, x.dir === "r" ? "r" : "f"), noteId: n.id, noteTitle: n.title, archeId: n.archeId, front: x.front.slice(0, 4000), back: x.back.slice(0, 4000), line: Number(x.line) || 0 });
      }
    }
    const seen = new Set<string>();
    const unique = cards.filter((c) => !seen.has(c.id) && seen.add(c.id));
    const dueCards = unique.filter((c) => data.cards[c.id] && data.cards[c.id].due <= now).sort((a, b) => data.cards[a.id].due - data.cards[b.id].due);
    const fresh = unique.filter((c) => !data.cards[c.id]);
    const allowance = Math.max(0, (options.newPerDay ?? 20) - (data.introduced?.[today(now)] ?? 0));
    const queue = [...dueCards, ...fresh.slice(0, allowance)].map((c) => ({ ...c, ...(data.cards[c.id] ? { state: data.cards[c.id] } : {}), next: preview(data.cards[c.id], now) }));
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return {
      queue,
      counts: {
        total: unique.length,
        due: dueCards.length,
        new: fresh.length,
        learning: unique.filter((c) => data.cards[c.id]?.state === 1).length,
        reviewedToday: unique.filter((c) => (data.cards[c.id]?.last ?? 0) >= start.getTime()).length,
      },
    };
  }

  grade(id: string, grade: Grade, now = Date.now()): Promise<CardState> {
    if (!/^[0-9a-f]{20}$/.test(id) || ![1, 2, 3, 4].includes(grade)) return Promise.reject(new NodeError("invalid", "invalid_grade"));
    return this.serial(async () => {
      const data = await this.load();
      const prev = data.cards[id];
      if (!prev) {
        const day = today(now);
        data.introduced = Object.fromEntries(Object.entries(data.introduced ?? {}).filter(([d]) => d >= today(now - 14 * DAY)));
        data.introduced[day] = (data.introduced[day] ?? 0) + 1;
      }
      const next = review(prev, grade, now);
      data.cards[id] = next;
      await this.save(data);
      return next;
    });
  }
}

// Lectio (PDF okuyucu) işaretlemeleri: her PDF için `.nularche/annotations/<yolun özeti>.json`. Vurgular sayfa ve
// sayfaya göre oranlı dikdörtgenlerle (0–1) saklanır; metin, renk ve isteğe bağlı yorum içerir. Dosya kullanıcının
// içeriğidir ve Google Drive ile eşitlenir. PDF yeniden adlandırılınca işaretlemeleri de taşınır.

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "pink", "purple"] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

export interface PdfHighlight {
  id: string;
  page: number;
  /** Sayfaya oranlı dikdörtgenler: [x, y, genişlik, yükseklik], 0–1. */
  rects: [number, number, number, number][];
  text: string;
  color: HighlightColor;
  comment?: string;
  created: number;
}

export interface PdfAnnotations {
  v: 1;
  path: string;
  /** İşaretlemelerin aktarıldığı not. */
  noteId?: string;
  /** Son okunan sayfa. */
  lastPage?: number;
  highlights: PdfHighlight[];
}

const MAX_HIGHLIGHTS = 5000;

function fileFor(root: string, pdfPath: string): string {
  const key = createHash("sha256").update(pdfPath.replace(/\\/g, "/")).digest("hex").slice(0, 32);
  return path.join(root, ".nularche", "annotations", `${key}.json`);
}

const num01 = (x: unknown) => typeof x === "number" && Number.isFinite(x) && x >= -0.01 && x <= 1.01;

/** Dışarıdan gelen veriyi doğrular; geçersiz vurgular atlanır. */
export function cleanAnnotations(pdfPath: string, raw: unknown): PdfAnnotations {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<PdfAnnotations>;
  const highlights: PdfHighlight[] = [];
  for (const h of Array.isArray(r.highlights) ? r.highlights.slice(0, MAX_HIGHLIGHTS) : []) {
    if (!h || typeof h !== "object") continue;
    const id = typeof h.id === "string" && /^[\w-]{1,40}$/.test(h.id) ? h.id : null;
    const page = Number.isInteger(h.page) && h.page >= 1 && h.page <= 100_000 ? h.page : null;
    const rects = Array.isArray(h.rects) ? h.rects.filter((q) => Array.isArray(q) && q.length === 4 && q.every(num01)).slice(0, 400) : [];
    if (!id || !page || !rects.length) continue;
    highlights.push({
      id,
      page,
      rects: rects as PdfHighlight["rects"],
      text: typeof h.text === "string" ? h.text.slice(0, 20_000) : "",
      color: HIGHLIGHT_COLORS.includes(h.color) ? h.color : "yellow",
      ...(typeof h.comment === "string" && h.comment.trim() ? { comment: h.comment.slice(0, 20_000) } : {}),
      created: typeof h.created === "number" ? h.created : Date.now(),
    });
  }
  return {
    v: 1,
    path: pdfPath,
    ...(typeof r.noteId === "string" && /^[\w-]{1,64}$/.test(r.noteId) ? { noteId: r.noteId } : {}),
    ...(Number.isInteger(r.lastPage) && r.lastPage! >= 1 ? { lastPage: r.lastPage } : {}),
    highlights,
  };
}

export async function readAnnotations(root: string, pdfPath: string): Promise<PdfAnnotations> {
  try {
    return cleanAnnotations(pdfPath, JSON.parse(await readFile(fileFor(root, pdfPath), "utf8")));
  } catch {
    return { v: 1, path: pdfPath, highlights: [] };
  }
}

export async function writeAnnotations(root: string, pdfPath: string, data: unknown): Promise<PdfAnnotations> {
  const clean = cleanAnnotations(pdfPath, data);
  const file = fileFor(root, pdfPath);
  if (!clean.highlights.length && !clean.noteId && !clean.lastPage) {
    await rm(file, { force: true });
    return clean;
  }
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(clean, null, 1)}\n`);
  await rename(tmp, file);
  return clean;
}

/** PDF yeniden adlandırılınca işaretlemelerini yeni yola taşır. */
export async function moveAnnotations(root: string, from: string, to: string): Promise<void> {
  const data = await readAnnotations(root, from);
  if (!data.highlights.length && !data.noteId && !data.lastPage) return;
  await writeAnnotations(root, to, { ...data, path: to });
  await rm(fileFor(root, from), { force: true });
}

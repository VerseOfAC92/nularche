// Yorumlar (2.0): bir notun pasajlarına bağlı yorum dizileri. Markdown dosyası değiştirilmez; yorumlar Origin'in
// `.nularche/comments/<not id>.json` dosyalarında tutulur (Origin ile birlikte yedeklenir ve taşınır). Bağlantı noktası
// alıntılanan metindir (ve çevresi); metin değişip bulunamazsa yorum "yerinden kopmuş" olarak gösterilir, silinmez.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { NodeError, type NodeStore } from "./node-store.ts";
import { isLockedBody } from "./note-text.ts";
export { locateAnchor } from "./writing.ts";

export interface CommentAnchor {
  /** Yorumlanan metin (düz metin olarak). */
  text: string;
  /** Öncesinden ve sonrasından birkaç karakter: aynı metin birden çok yerde geçerse doğru yeri bulmak için. */
  prefix?: string;
  suffix?: string;
}

export interface CommentReply {
  id: string;
  body: string;
  author?: string;
  createdAt: number;
}

export interface NoteComment {
  id: string;
  anchor: CommentAnchor;
  body: string;
  author?: string;
  createdAt: number;
  updatedAt: number;
  resolved?: boolean;
  replies: CommentReply[];
}

const MAX_COMMENTS = 500;
const MAX_TEXT = 20_000;
const DIR = path.join(".nularche", "comments");

function clean(s: unknown, max = MAX_TEXT): string {
  return typeof s === "string" ? s.replace(/\r\n/g, "\n").trim().slice(0, max) : "";
}

function normAnchor(a: unknown): CommentAnchor {
  const r = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
  const text = clean(r.text, 2000);
  if (!text) throw new NodeError("invalid", "Yorum için metin seçilmeli.");
  const prefix = typeof r.prefix === "string" ? r.prefix.slice(-60) : "";
  const suffix = typeof r.suffix === "string" ? r.suffix.slice(0, 60) : "";
  return { text, ...(prefix ? { prefix } : {}), ...(suffix ? { suffix } : {}) };
}

function normAuthor(v: unknown): string | undefined {
  const a = clean(v, 80);
  return a || undefined;
}

export class CommentStore {
  private readonly store: NodeStore;
  constructor(store: NodeStore) {
    this.store = store;
  }

  private file(id: string): string {
    if (!/^[\w-]{1,64}$/.test(id)) throw new NodeError("invalid", `Geçersiz id: ${id}`);
    return path.join(this.store.root, DIR, `${id}.json`);
  }

  /** Not var olmalı ve kilitli olmamalı (kilitli notların içeriğine bağlı veri açığa çıkmasın). */
  private async noteId(ref: string): Promise<string> {
    const n = await this.store.read(ref);
    if (n.locked || isLockedBody(n.body)) throw new NodeError("invalid", "Kilitli notlara yorum eklenemez ve okunamaz.");
    return n.id;
  }

  private async load(id: string): Promise<NoteComment[]> {
    try {
      const data = JSON.parse(await readFile(this.file(id), "utf8")) as { comments?: unknown };
      return Array.isArray(data.comments) ? (data.comments as NoteComment[]).filter((c) => c && typeof c.id === "string" && c.anchor) : [];
    } catch {
      return [];
    }
  }

  private async save(id: string, comments: NoteComment[]): Promise<void> {
    const file = this.file(id);
    if (!comments.length) return void (await rm(file, { force: true }));
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${randomUUID()}.tmp`;
    await writeFile(tmp, `${JSON.stringify({ version: 1, comments }, null, 2)}\n`);
    await rename(tmp, file);
  }

  async list(ref: string): Promise<NoteComment[]> {
    return (await this.load(await this.noteId(ref))).sort((a, b) => a.createdAt - b.createdAt);
  }

  async add(ref: string, input: { anchor: unknown; body: unknown; author?: unknown }): Promise<NoteComment> {
    const id = await this.noteId(ref);
    const body = clean(input.body);
    if (!body) throw new NodeError("invalid", "Yorum boş olamaz.");
    const comments = await this.load(id);
    if (comments.length >= MAX_COMMENTS) throw new NodeError("invalid", `Bir notta en fazla ${MAX_COMMENTS} yorum olabilir.`);
    const now = Date.now();
    const author = normAuthor(input.author);
    const c: NoteComment = { id: randomUUID(), anchor: normAnchor(input.anchor), body, ...(author ? { author } : {}), createdAt: now, updatedAt: now, replies: [] };
    await this.save(id, [...comments, c]);
    return c;
  }

  private async change(ref: string, commentId: string, fn: (c: NoteComment) => NoteComment | null): Promise<NoteComment | null> {
    const id = await this.noteId(ref);
    const comments = await this.load(id);
    const i = comments.findIndex((c) => c.id === commentId);
    if (i < 0) throw new NodeError("not_found", "Yorum bulunamadı.");
    const next = fn(structuredClone(comments[i]));
    const out = next ? comments.map((c, j) => (j === i ? next : c)) : comments.filter((_, j) => j !== i);
    await this.save(id, out);
    return next;
  }

  async update(ref: string, commentId: string, patch: { body?: unknown; resolved?: unknown }): Promise<NoteComment> {
    return (await this.change(ref, commentId, (c) => {
      if (patch.body !== undefined) {
        const body = clean(patch.body);
        if (!body) throw new NodeError("invalid", "Yorum boş olamaz.");
        c.body = body;
      }
      if (patch.resolved !== undefined) {
        if (patch.resolved === true) c.resolved = true;
        else delete c.resolved;
      }
      c.updatedAt = Date.now();
      return c;
    }))!;
  }

  async reply(ref: string, commentId: string, input: { body: unknown; author?: unknown }): Promise<NoteComment> {
    const body = clean(input.body);
    if (!body) throw new NodeError("invalid", "Yanıt boş olamaz.");
    return (await this.change(ref, commentId, (c) => {
      if (c.replies.length >= 200) throw new NodeError("invalid", "Bu yoruma daha fazla yanıt eklenemez.");
      const author = normAuthor(input.author);
      c.replies.push({ id: randomUUID(), body, ...(author ? { author } : {}), createdAt: Date.now() });
      c.updatedAt = Date.now();
      return c;
    }))!;
  }

  async remove(ref: string, commentId: string): Promise<void> {
    await this.change(ref, commentId, () => null);
  }

  /** Not başına açık (çözülmemiş) yorum sayıları. */
  async counts(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const n of await this.store.list()) {
      if (n.locked) continue;
      const open = (await this.load(n.id)).filter((c) => !c.resolved).length;
      if (open) out[n.id] = open;
    }
    return out;
  }
}

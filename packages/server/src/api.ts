// Nularche'nin yerel API'si (`/api/…`) ve Origin dosyaları (`/files/…`): standart web `Request` alıp `Response`
// döndüren tek bir işleyici. Masaüstünde Node HTTP sunucusu (app.ts) istekleri buna iletir; web sürümünde aynı
// işleyici tarayıcıda, bellek içi dosya sistemi üzerinde çalışır (docs/web-version.md). Güvenlik denetimleri
// (Host, Origin, oturum anahtarı) ve arayüz dosyalarının sunumu taşıyıcıya özgüdür ve burada değildir.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { NodeError, type NodeStore } from "../../core/src/node-store.ts";
import { nodeErrorText, type NodeErrorReason } from "../../core/src/errors.ts";
import { SnapshotError, type SnapshotStore } from "../../core/src/snapshots.ts";
import { citationSettings, findLibraryFiles, loadLibrary } from "../../core/src/citations-store.ts";
import { readAnnotations, writeAnnotations } from "../../core/src/annotations.ts";
import { runQuery } from "../../core/src/query.ts";
import { type Anamnesis, type Grade } from "../../core/src/anamnesis.ts";
import { writeDigest } from "../../core/src/vigil.ts";
import { loadOrigin } from "../../core/src/origin.ts";
import { AI_DIR, type AiActivity, isReplyLanguage } from "../../core/src/ai-activity.ts";
import { exportMarkdownZip, exportPageHtml, exportSite, zipFiles } from "../../core/src/export.ts";
import type { ProviderId } from "../../core/src/ai-clients.ts";
import { exportPageDocument } from "../../core/src/export-doc.ts";
import { importFiles } from "../../core/src/import.ts";
import { readPrefs, readSnippets, writePrefs } from "../../core/src/prefs.ts";
import { compileManuscript } from "../../core/src/manuscript.ts";
import type { CommentStore } from "../../core/src/comments.ts";
import { CAPTURE_KINDS, captureText, promoteCapture, readCaptureConfig, writeCaptureConfig, type CaptureKind } from "../../core/src/capture.ts";

export type ApiEvent = "change" | "ai" | "comments";

/**
 * Origin'de değişen bir dosyanın (Origin köküne göre, "/" ayraçlı yol) arayüze hangi olayla bildirileceği: Nularche AI
 * kaydı "ai", yorumlar "comments", notlar "change"; diğer gizli ve geçici dosyalar (.trash, eşitleme durumu) bildirilmez.
 * Masaüstü (dosya izleyici) ve web sürümü (bellek içi dosya sistemi) aynı kuralı kullanır.
 */
export function changeEventFor(rel: string): ApiEvent | null {
  if (rel === AI_DIR || rel.startsWith(`${AI_DIR}/`)) return "ai";
  if (rel.startsWith(".nularche/comments/")) return "comments";
  if (rel.split("/").some((seg) => seg.startsWith("."))) return null;
  return "change";
}

/** Art arda gelen aynı türden değişiklikleri kısa bir beklemeyle tek bildirime toplar. */
export function changeNotifier(events: EventHub, onEvent?: (event: ApiEvent) => void): { notify(rel: string): void; close(): void } {
  const delay: Record<ApiEvent, number> = { ai: 100, comments: 120, change: 150 };
  const timers = new Map<ApiEvent, ReturnType<typeof setTimeout>>();
  return {
    notify(rel) {
      const event = changeEventFor(rel);
      if (!event) return;
      clearTimeout(timers.get(event));
      const timer = setTimeout(() => {
        timers.delete(event);
        events.emit(event);
        onEvent?.(event);
      }, delay[event]);
      (timer as { unref?: () => void }).unref?.();
      timers.set(event, timer);
    },
    close() {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    },
  };
}

const encoder = new TextEncoder();

/** Canlı bildirimler (`/api/events`, Server-Sent Events): açık akışlara olay yazar. */
export class EventHub {
  private streams = new Set<ReadableStreamDefaultController<Uint8Array>>();

  emit(kind: ApiEvent): void {
    const chunk = encoder.encode(`event: ${kind}\ndata: {}\n\n`);
    for (const c of this.streams) {
      try {
        c.enqueue(chunk);
      } catch {
        this.streams.delete(c);
      }
    }
  }

  stream(signal?: AbortSignal): Response {
    let ctrl!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start: (c) => {
        ctrl = c;
        this.streams.add(c);
        c.enqueue(encoder.encode(": bağlandı\n\n"));
      },
      cancel: () => void this.streams.delete(ctrl),
    });
    signal?.addEventListener("abort", () => {
      this.streams.delete(ctrl);
      try {
        ctrl.close();
      } catch {
        // zaten kapalı
      }
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
  }

  close(): void {
    for (const c of this.streams) {
      try {
        c.close();
      } catch {
        // zaten kapalı
      }
    }
    this.streams.clear();
  }
}

export interface ApiContext {
  store: NodeStore;
  activity: AiActivity;
  comments: CommentStore;
  anamnesis: Anamnesis;
  events: EventHub;
  /** Anlık görüntüler (Strata) yalnızca masaüstünde; yoksa ilgili uçlar "unavailable" döner. */
  snapshots?: SnapshotStore;
}

export interface Api {
  /** `/api/` ya da `/files/` isteğini işler; başka bir yolsa null (taşıyıcı kendisi sunar). */
  handle(request: Request): Promise<Response | null>;
}

/** Dosya uzantısı → içerik türü (Origin dosyaları ve masaüstünde arayüz dosyaları). */
export const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".json": "application/json",
};

const base64Bytes = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function createApi(ctx: ApiContext): Api {
  const { store, activity, comments, anamnesis, events } = ctx;


  const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  /** Hata cevabı: arayüz `reason` ve `vars` ile metni kullanıcının dilinde gösterir; `message` Türkçe yedektir. */
  const failure = (status: number, error: string, reason: NodeErrorReason, vars: Record<string, string | number> = {}): Response =>
    json(status, { error, reason, vars, message: nodeErrorText(reason, vars, "tr") });

  const file = (name: string, type: string, data: Uint8Array | string): Response =>
    new Response(data as BodyInit, {
      status: 200,
      headers: { "content-type": type, "cache-control": "no-store", "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}` },
    });

  /** İstek gövdesi, sınırı aşmadan parça parça okunur. */
  async function readBody(request: Request, limit: number): Promise<Uint8Array> {
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > limit) throw new NodeError("invalid", "body_too_large");
    if (!request.body) return new Uint8Array();
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel().catch(() => undefined);
        throw new NodeError("invalid", "body_too_large");
      }
      chunks.push(value);
    }
    const out = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }

  async function readJson(request: Request, limit = 10 * 1024 * 1024): Promise<Record<string, unknown>> {
    const buf = await readBody(request, limit);
    if (buf.length === 0) return {};
    try {
      const value = JSON.parse(new TextDecoder().decode(buf));
      if (value && typeof value === "object" && !Array.isArray(value)) return value;
    } catch {
      // aşağıda hata
    }
    throw new NodeError("invalid", "invalid_json");
  }

  const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
  const obj = (v: unknown): Record<string, unknown> | undefined =>
    v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

  async function handleSnapshots(request: Request, url: URL, parts: string[], method: string): Promise<Response> {
    const snapshots = ctx.snapshots;
    if (!snapshots) return failure(404, "unavailable", "snapshots_unavailable");
    try {
      const [, sid, action] = parts;
      if (!sid && method === "GET") return json(200, { snapshots: await snapshots.list(), encrypted: await snapshots.isEncrypted() });
      if (!sid && method === "POST") {
        const b = await readJson(request);
        return json(201, await snapshots.create({ label: str(b.label) ?? "" }));
      }
      if (sid && !action && method === "DELETE") {
        await snapshots.remove(sid);
        return json(200, { deleted: sid });
      }
      if (sid && action === "files" && method === "GET") return json(200, { files: await snapshots.files(sid) });
      if (sid && action === "file" && method === "GET") {
        const file = url.searchParams.get("path") ?? "";
        const data = await snapshots.read(sid, file);
        // Önizleme yalnızca metin notları için; ham içerik ve betik çalıştırılabilecek türler gönderilmez.
        if (!/\.(md|txt|json|canvas|csv)$/i.test(file)) return json(200, { path: file, text: null, size: data.length });
        return json(200, { path: file, text: new TextDecoder().decode(data.subarray(0, 512 * 1024)), size: data.length });
      }
      if (sid && action === "restore" && method === "POST") {
        const b = await readJson(request);
        const paths = Array.isArray(b.paths) ? b.paths.filter((p): p is string => typeof p === "string") : undefined;
        const out = await snapshots.restore(sid, { paths, beforeLabel: str(b.beforeLabel) });
        store.invalidate();
        return json(200, out);
      }
      if (sid && action === "rename" && method === "POST") {
        const b = await readJson(request);
        return json(200, await snapshots.rename(sid, str(b.label) ?? null));
      }
      return failure(404, "not_found", "unknown_endpoint");
    } catch (e) {
      if (e instanceof SnapshotError) return json(e.code === "not_found" ? 404 : 400, { error: e.code, reason: e.reason, vars: e.vars, message: e.message });
      throw e;
    }
  }

  async function handleApi(request: Request, url: URL): Promise<Response> {
    const parts = url.pathname.split("/").filter(Boolean).slice(1).map(decodeURIComponent); // "api" sonrası
    const method = request.method;
    const route = `${method} ${parts[0] ?? ""}${parts[2] ? `/:id/${parts[2]}` : parts[1] ? "/:id" : ""}`;
    const id = parts[1];

    if (parts[0] === "snapshots") return handleSnapshots(request, url, parts, method);
    if (parts[0] === "anamnesis") {
      // GET: kuyruk; POST: kuyruk + pencerede çözülmüş şifreli not kartları (`extra`).
      if ((method === "GET" || method === "POST") && !parts[1]) {
        const b = method === "POST" ? await readJson(request, 8 * 1024 * 1024) : {};
        const arche = url.searchParams.get("arche");
        const prefs = await readPrefs(store.root);
        const newPerDay = Number(prefs.anamnesisNewPerDay);
        const extra = Array.isArray(b.extra) ? (b.extra as { noteId: string; front: string; back: string; line: number; dir: "f" | "r" }[]) : undefined;
        return json(200, await anamnesis.queue({ archeId: arche === null ? undefined : arche === "shadow" ? null : arche, newPerDay: Number.isInteger(newPerDay) && newPerDay >= 0 ? newPerDay : 20, extra }));
      }
      if (method === "POST" && parts[1] === "grade") {
        const b = await readJson(request);
        try {
          return json(200, await anamnesis.grade(str(b.id) ?? "", Number(b.grade) as Grade));
        } catch (e) {
          return json(400, { error: "invalid", message: (e as Error).message });
        }
      }
      return failure(404, "not_found", "unknown_endpoint");
    }
    if (parts[0] === "vigil" && parts[1] === "digest" && method === "POST") {
      const b = await readJson(request);
      const days = Number(b.days);
      const doc = await writeDigest(store, { days: Number.isFinite(days) ? days : 7, title: str(b.title) ?? "Vigil", parentId: str(b.parentId) ?? null, lang: b.lang === "en" ? "en" : "tr" });
      return json(201, doc);
    }
    if (parts[0] === "query" && method === "POST") {
      const b = await readJson(request);
      return json(200, await runQuery(store, str(b.query) ?? "", { selfId: str(b.selfId) }));
    }
    if (parts[0] === "citations" && method === "GET") {
      // Kaynakça: kayıtlar (CSL-JSON), seçili stil, okunamayan dosyalar ve Origin'deki aday dosyalar.
      const settings = await citationSettings(store.root);
      const lib = await loadLibrary(store.root, settings.files);
      return json(200, { style: settings.style, files: settings.files, items: [...lib.items.values()], problems: lib.problems, available: await findLibraryFiles(store.root) });
    }

    if (parts[0] === "ai") {
      if (method === "GET" && parts.length === 1) {
        return json(200, { clients: await activity.clients(), requests: await activity.listRequests(30) });
      }
      if (method === "POST" && parts[1] === "requests" && parts.length === 2) {
        const b = await readJson(request);
        const provider = ["claude", "chatgpt", "gemini"].includes(String(b.provider)) ? (b.provider as ProviderId) : null;
        return json(
          201,
          await activity.createRequest({
            provider,
            label: str(b.label) ?? "",
            instruction: str(b.instruction) ?? "",
            nodeId: str(b.nodeId),
            nodeTitle: str(b.nodeTitle),
            selection: str(b.selection),
            language: isReplyLanguage(b.language) ? b.language : undefined,
            readOnly: b.readOnly === true,
          }),
        );
      }
      if (method === "POST" && parts[1] === "clear") {
        return json(200, await activity.clearHistory());
      }
      if (method === "POST" && parts[1] === "requests" && parts[3] === "cancel") {
        const b = await readJson(request);
        return json(200, await activity.cancelRequest(parts[2], str(b.reply) ?? "İptal edildi."));
      }
      if (method === "POST" && parts[1] === "requests" && parts[3] === "undo") {
        return json(200, await activity.undo(store, parts[2]));
      }
      return failure(404, "not_found", "unknown_endpoint");
    }

    switch (route) {
      case "GET events":
        return events.stream(request.signal);
      case "GET search":
        return json(200, { results: await store.search(url.searchParams.get("q") ?? "", 30) });
      case "GET origin":
        return json(200, await loadOrigin(store.root));
      case "GET shadow":
        return json(200, await store.shadow());
      case "POST capture": {
        const b = await readJson(request);
        const out = await captureText(store, str(b.text) ?? "", str(b.title));
        return json(201, "routed" in out ? { routed: out.routed } : out.node);
      }
      case "GET capture-config":
        return json(200, await readCaptureConfig(store.root));
      case "PUT capture-config":
        return json(200, await writeCaptureConfig(store.root, await readJson(request)));
      case "POST nodes/:id/promote": {
        const b = await readJson(request);
        const kind = (CAPTURE_KINDS as readonly string[]).includes(String(b.kind)) ? (b.kind as CaptureKind) : undefined;
        return json(200, await promoteCapture(store, id, { kind, target: str(b.target) }));
      }
      case "GET nodes/:id/manuscript":
        return json(200, await compileManuscript(store, id));
      case "GET nodes/:id/comments":
        return json(200, { comments: await comments.list(id) });
      case "POST nodes/:id/comments": {
        const b = await readJson(request);
        const cid = str(b.commentId) ?? "";
        switch (b.action) {
          case "update":
            return json(200, await comments.update(id, cid, { body: b.body, resolved: b.resolved }));
          case "reply":
            return json(200, await comments.reply(id, cid, { body: b.body, author: b.author }));
          case "delete":
            await comments.remove(id, cid);
            return json(200, { deleted: cid });
          default:
            return json(201, await comments.add(id, { anchor: b.anchor, body: b.body, author: b.author }));
        }
      }
      case "GET comments":
        return json(200, { counts: await comments.counts() });
      case "POST nodes/:id/checkpoint": {
        const b = await readJson(request);
        return json(201, await store.checkpoint(id, str(b.label) ?? ""));
      }
      case "POST nodes/:id/history-delete": {
        const b = await readJson(request);
        await store.deleteHistory(id, Number(b.at));
        return json(200, { deleted: Number(b.at) });
      }
      case "GET nodes/:id/wiki":
        return json(200, { entries: await store.wikiEntries(id) });
      case "GET nodes/:id/wiki-mentions":
        return json(200, { mentions: await store.wikiMentions(id) });
      case "GET wiki-terms":
        return json(200, { terms: await store.wikiTerms() });
      case "GET trash":
        return json(200, { entries: await store.listTrash() });
      case "POST trash/:id/restore":
        return json(200, await store.restoreTrash(id));
      case "DELETE trash/:id":
        await store.deleteTrash(id);
        return json(200, { deleted: id });
      case "DELETE trash": {
        const entries = await store.listTrash();
        for (const e of entries) await store.deleteTrash(e.entry);
        return json(200, { deleted: entries.length });
      }
      case "GET nodes":
        return json(200, { nodes: await store.list() });
      case "POST nodes": {
        const b = await readJson(request);
        return json(
          201,
          await store.create({ title: str(b.title) ?? "", parentNodeId: str(b.parentNodeId) ?? null, body: str(b.body), fields: obj(b.fields) }),
        );
      }
      case "GET nodes/:id":
        return json(200, await store.read(id));
      case "PUT nodes/:id": {
        const b = await readJson(request);
        return json(
          200,
          await store.update(id, { body: str(b.body), title: str(b.title), baseRevision: str(b.baseRevision), fields: obj(b.fields), properties: obj(b.properties) }),
        );
      }
      case "DELETE nodes/:id":
        return json(200, await store.trash(id));
      case "POST nodes/:id/move": {
        const b = await readJson(request);
        return json(200, await store.move(id, str(b.parentNodeId) ?? null));
      }
      case "POST nodes/:id/duplicate": {
        const b = await readJson(request);
        const parent = b.parentNodeId === undefined ? undefined : (str(b.parentNodeId) ?? null);
        return json(201, await store.duplicate(id, { parentNodeId: parent, title: str(b.title), fields: obj(b.fields) }));
      }
      case "GET nodes/:id/export": {
        const lang = url.searchParams.get("lang") === "en" ? "en" : "tr";
        const format = url.searchParams.get("format");
        if (format === "rtf" || format === "docx" || format === "txt") {
          const out = await exportPageDocument(store, id, format);
          return file(out.name, out.mime, out.data);
        }
        if (url.searchParams.get("format") === "html") {
          const out = await exportPageHtml(store, id, lang);
          return file(out.name, "text/html; charset=utf-8", out.html);
        }
        if (url.searchParams.get("format") === "site") {
          const out = await exportSite(store, { rootId: id, lang });
          return file("site.zip", "application/zip", zipFiles(out.files));
        }
        const out = await exportMarkdownZip(store, id);
        return file(out.name, "application/zip", out.data);
      }
      case "GET site": {
        const out = await exportSite(store, { lang: url.searchParams.get("lang") === "en" ? "en" : "tr" });
        return file("site.zip", "application/zip", zipFiles(out.files));
      }
      case "GET nodes/:id/backlinks":
        return json(200, { nodes: await store.backlinks(id) });
      case "GET nodes/:id/outgoing":
        return json(200, await store.outgoing(id));
      case "GET nodes/:id/mentions":
        return json(200, { mentions: await store.unlinkedMentions(id) });
      case "POST nodes/:id/link-mention": {
        const b = await readJson(request);
        return json(200, await store.linkMention(str(b.source) ?? "", id));
      }
      case "POST nodes/:id/merge": {
        const b = await readJson(request);
        return json(200, await store.merge(id, str(b.into) ?? ""));
      }
      case "GET nodes/:id/history": {
        const at = Number(url.searchParams.get("at"));
        if (at) return json(200, { at, body: await store.historyBody(id, at) });
        return json(200, { entries: await store.history(id) });
      }
      case "POST nodes/:id/restore": {
        const b = await readJson(request);
        return json(200, await store.restoreHistory(id, Number(b.at), str(b.baseRevision)));
      }
      case "GET graph":
        return json(200, await store.graph());
      case "GET snippets":
        return json(200, { snippets: await readSnippets(store.root) });
      case "POST reorder": {
        const b = await readJson(request);
        const ids = Array.isArray(b.ids) ? b.ids.filter((x): x is string => typeof x === "string") : [];
        return json(200, { nodes: await store.reorder(str(b.parentNodeId) ?? null, ids) });
      }
      case "GET tags":
        return json(200, { tags: await store.tags() });
      case "POST tags/:id/rename": {
        const b = await readJson(request);
        return json(200, { changed: await store.renameTag(id, str(b.to) ?? "") });
      }
      case "GET attachments":
        return json(200, { attachments: await store.listAttachments() });
      case "POST attachments/:id/rename": {
        const b = await readJson(request);
        return json(200, { path: await store.renameAttachment(str(b.path) ?? "", str(b.name) ?? "") });
      }
      case "GET annotations": {
        const pdf = url.searchParams.get("path") ?? "";
        if (!/\.pdf$/i.test(pdf) || !(await store.pathExists(pdf))) return failure(404, "not_found", "pdf_not_found");
        return json(200, await readAnnotations(store.root, pdf));
      }
      case "PUT annotations": {
        const pdf = url.searchParams.get("path") ?? "";
        if (!/\.pdf$/i.test(pdf) || !(await store.pathExists(pdf))) return failure(404, "not_found", "pdf_not_found");
        return json(200, await writeAnnotations(store.root, pdf, await readJson(request, 20 * 1024 * 1024)));
      }
      case "GET prefs":
        return json(200, await readPrefs(store.root));
      case "PUT prefs":
        return json(200, await writePrefs(store.root, await readJson(request)));
      case "POST import": {
        const b = await readJson(request, 300 * 1024 * 1024);
        const files = (Array.isArray(b.files) ? b.files : [])
          .map((f) => obj(f))
          .filter((f): f is Record<string, unknown> => !!f && typeof f.path === "string" && typeof f.data === "string")
          .map((f) => ({ path: String(f.path), data: base64Bytes(String(f.data)) }));
        const parent = b.parentNodeId === undefined ? undefined : (str(b.parentNodeId) ?? null);
        return json(201, await importFiles(store, files, parent));
      }
      case "POST attachments": {
        const name = url.searchParams.get("name") || "dosya";
        const data = await readBody(request, 200 * 1024 * 1024);
        return json(201, { path: await store.saveAttachment(name, data) });
      }
    }
    return failure(404, "not_found", "unknown_endpoint");
  }

  /** Origin içindeki ekleri ve dosyaları sunar (`/files/<Origin yolu>`); gizli klasörler ve Origin dışı reddedilir. */
  async function serveVaultFile(url: URL): Promise<Response> {
    const rel = decodeURIComponent(url.pathname.slice("/files/".length));
    const abs = store.abs(rel);
    try {
      const data = await readFile(abs);
      const type = MIME[path.extname(abs).toLowerCase()] ?? "application/octet-stream";
      // Etkin içerik (HTML/SVG) uygulamanın kökeninde çalışmasın.
      return new Response(data as BodyInit, {
        status: 200,
        headers: { "content-type": type, "content-security-policy": "sandbox", "x-content-type-options": "nosniff", "cache-control": "no-cache" },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  }

  return {
    async handle(request: Request): Promise<Response | null> {
      const url = new URL(request.url);
      const isApi = url.pathname.startsWith("/api/");
      if (!isApi && !url.pathname.startsWith("/files/")) return null;
      try {
        return isApi ? await handleApi(request, url) : await serveVaultFile(url);
      } catch (err) {
        if (err instanceof NodeError) {
          const status = err.code === "not_found" ? 404 : err.code === "conflict" ? 409 : 400;
          return json(status, { ...err.details, error: err.code, reason: err.reason, vars: err.vars, message: err.message });
        }
        console.error(err);
        return json(500, { error: "internal", message: String(err) });
      }
    },
  };
}

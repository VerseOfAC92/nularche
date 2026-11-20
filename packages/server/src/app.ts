// Yerel HTTP sunucusu: JSON API + derlenmiş web arayüzü + canlı değişiklik bildirimi (SSE).
// Yalnızca 127.0.0.1'e bağlanır.

import { timingSafeEqual } from "node:crypto";
import { watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { NodeError, NodeStore } from "../../core/src/node-store.ts";
import { SnapshotError, SnapshotStore } from "../../core/src/snapshots.ts";
import { citationSettings, findLibraryFiles, loadLibrary } from "../../core/src/citations-store.ts";
import { readAnnotations, writeAnnotations } from "../../core/src/annotations.ts";
import { runQuery } from "../../core/src/query.ts";
import { Anamnesis, type Grade } from "../../core/src/anamnesis.ts";
import { writeDigest } from "../../core/src/vigil.ts";
import { loadOrigin } from "../../core/src/origin.ts";
import { AI_DIR, AiActivity, isReplyLanguage } from "../../core/src/ai-activity.ts";
import { exportMarkdownZip, exportPageHtml, exportSite, zipFiles } from "../../core/src/export.ts";
import type { ProviderId } from "../../core/src/ai-clients.ts";
import { exportPageDocument } from "../../core/src/export-doc.ts";
import { importFiles } from "../../core/src/import.ts";
import { readPrefs, readSnippets, writePrefs } from "../../core/src/prefs.ts";
import { compileManuscript } from "../../core/src/manuscript.ts";
import { CommentStore } from "../../core/src/comments.ts";
import { CAPTURE_KINDS, captureText, promoteCapture, readCaptureConfig, writeCaptureConfig, type CaptureKind } from "../../core/src/capture.ts";

const HOST = "127.0.0.1";

export interface ServerOptions {
  originDir: string;
  /** Derlenmiş web arayüzü klasörü (index.html içerir). */
  webDist: string;
  /** 0 = rastgele boş port. */
  port: number;
  /** Ek izinli Origin'ler (ör. Vite geliştirme sunucusu). */
  extraOrigins?: string[];
  /** Nularche AI etkinliği değiştiğinde (ör. masaüstünde "✓ Bağlandı" bildirimi için). */
  onAiActivity?: () => void;
  /**
   * Oturum anahtarı: verilirse her istek `nularche_session` çerezini ya da `x-nularche-token` başlığını taşımalıdır.
   * Masaüstü uygulaması her açılışta rastgele bir anahtar üretip yalnızca kendi penceresine çerez olarak verir; böylece
   * bilgisayardaki başka bir kullanıcı ya da program 127.0.0.1 üzerinden notlara erişemez. Verilmezse (tarayıcı
   * sürümü, testler) yalnızca Host ve Origin denetimi uygulanır.
   */
  token?: string;
  /**
   * Anlık görüntü anahtarı (32 bayt): verilirse anlık görüntüler şifrelenir. Masaüstü uygulaması bunu işletim sisteminin
   * anahtar zincirinde korur; Origin'e ya da Drive'a yazılmaz.
   */
  snapshotKey?: Uint8Array | null;
  /** Otomatik anlık görüntü aralığı (dakika). Verilmezse otomatik anlık görüntü alınmaz (testler, tarayıcı). */
  autoSnapshotMinutes?: number;
}

export const SESSION_COOKIE = "nularche_session";

/**
 * Arayüzün içerik güvenlik politikası: betikler yalnızca uygulamanın kendi dosyalarından, bağlantılar yalnızca yerel
 * sunucuya; notlardaki web görselleri ve gizlilik dostu YouTube çerçevesi dışında dış kaynak yok. Notlara ya da içe
 * aktarılan dosyalara gömülmüş HTML/JS'e karşı ikinci kalkandır.
 */
export const APP_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https: http:",
  "media-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-src https://www.youtube-nocookie.com https://www.youtube.com",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

/** Sabit sürede karşılaştırma (anahtar zamanlama ile tahmin edilemesin). */
function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function requestToken(req: IncomingMessage): string {
  const header = req.headers["x-nularche-token"];
  if (typeof header === "string" && header) return header;
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === SESSION_COOKIE) return decodeURIComponent(v.join("="));
  }
  return "";
}

export interface RunningServer {
  port: number;
  url: string;
  store: NodeStore;
  snapshots: SnapshotStore;
  close(): Promise<void>;
}

export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const WEB_DIST = path.resolve(options.webDist);
  let PORT = options.port;
  const store = new NodeStore(options.originDir);
  const activity = new AiActivity(store.root);
  const comments = new CommentStore(store);
  await store.ensureRoot();
  // Bakım (bir kez, hızlı): eski düzendeki Epoch'ları kendi klasörüne taşı; kilitli notların geçmişinde kalmış
  // şifresiz sürümleri sil. Başarısız olsa da Origin açılır.
  await store.migrateEpochs().catch(() => 0);
  await store.purgeLockedPlaintext().catch(() => 0);

  // --- Anlık görüntüler: kilitlenen notun şifresiz sürümleri anlık görüntülerden de silinir.
  const snapshots = new SnapshotStore(store.root, { key: options.snapshotKey ?? null });
  const anamnesis = new Anamnesis(store);
  store.lockPurgeHooks.add((ids) => snapshots.purgeNotes(ids));
  await store
    .list()
    .then((all) => snapshots.purgeNotes(all.filter((n) => n.locked).map((n) => n.id)))
    .catch(() => 0);
  let snapshotTimer: NodeJS.Timeout | undefined;
  if (options.autoSnapshotMinutes && options.autoSnapshotMinutes > 0) {
    const every = options.autoSnapshotMinutes * 60_000;
    const tick = () => void snapshots.create({ auto: true }).catch((e) => console.error("snapshot", e));
    // Açılıştan kısa süre sonra bir kez (açılıştaki hâl), sonra düzenli aralıklarla; değişiklik yoksa alınmaz.
    snapshotTimer = setTimeout(function loop() {
      tick();
      snapshotTimer = setTimeout(loop, every);
    }, 30_000);
    snapshotTimer.unref();
  }

  // --- Canlı bildirim: Origin'de (AI araçları dahil) bir dosya değişince istemcilere haber ver.
  const clients = new Set<ServerResponse>();
  let pending: NodeJS.Timeout | undefined;
  let pendingAi: NodeJS.Timeout | undefined;
  const aiPrefix = AI_DIR.split("/").join(path.sep);
  const commentsPrefix = [".nularche", "comments"].join(path.sep);
  let pendingComments: NodeJS.Timeout | undefined;
  const watcher = watch(store.root, { recursive: true }, (_event, filename) => {
    const name = filename?.toString() ?? "";
    // Nularche AI etkinliği (istekler, bağlanan istemciler) ayrı bir olay olarak bildirilir.
    if (name.startsWith(aiPrefix)) {
      clearTimeout(pendingAi);
      pendingAi = setTimeout(() => {
        for (const res of clients) res.write(`event: ai\ndata: {}\n\n`);
        options.onAiActivity?.();
      }, 100);
      return;
    }
    // Yorumlar gizli klasördedir; açık görünümler ayrı bir olayla yenilenir.
    if (name.startsWith(commentsPrefix)) {
      clearTimeout(pendingComments);
      pendingComments = setTimeout(() => {
        for (const res of clients) res.write(`event: comments\ndata: {}\n\n`);
      }, 120);
      return;
    }
    if (name.split(path.sep).some((seg) => seg.startsWith("."))) return; // .trash, geçici dosyalar
    clearTimeout(pending);
    pending = setTimeout(() => {
      for (const res of clients) res.write(`event: change\ndata: {}\n\n`);
    }, 150);
  });

  const MIME: Record<string, string> = {
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

  function send(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  }

  function sendFile(res: ServerResponse, name: string, type: string, data: Uint8Array | string): void {
    res.writeHead(200, {
      "content-type": type,
      "cache-control": "no-store",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    });
    res.end(data);
  }

  async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) throw new NodeError("invalid", "İstek gövdesi çok büyük");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async function readJson(req: IncomingMessage, limit = 10 * 1024 * 1024): Promise<Record<string, unknown>> {
    const buf = await readBody(req, limit);
    if (buf.length === 0) return {};
    try {
      const value = JSON.parse(buf.toString("utf8"));
      if (value && typeof value === "object" && !Array.isArray(value)) return value;
    } catch {
      // aşağıda hata
    }
    throw new NodeError("invalid", "Geçersiz JSON");
  }

  const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
  const obj = (v: unknown): Record<string, unknown> | undefined =>
    v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

  async function handleSnapshots(req: IncomingMessage, res: ServerResponse, url: URL, parts: string[], method: string): Promise<void> {
    try {
      const [, sid, action] = parts;
      if (!sid && method === "GET") return send(res, 200, { snapshots: await snapshots.list(), encrypted: snapshots.encrypted });
      if (!sid && method === "POST") {
        const b = await readJson(req);
        return send(res, 201, await snapshots.create({ label: str(b.label) ?? "" }));
      }
      if (sid && !action && method === "DELETE") {
        await snapshots.remove(sid);
        return send(res, 200, { deleted: sid });
      }
      if (sid && action === "files" && method === "GET") return send(res, 200, { files: await snapshots.files(sid) });
      if (sid && action === "file" && method === "GET") {
        const file = url.searchParams.get("path") ?? "";
        const data = await snapshots.read(sid, file);
        // Önizleme yalnızca metin notları için; ham içerik ve betik çalıştırılabilecek türler gönderilmez.
        if (!/\.(md|txt|json|canvas|csv)$/i.test(file)) return send(res, 200, { path: file, text: null, size: data.length });
        return send(res, 200, { path: file, text: data.subarray(0, 512 * 1024).toString("utf8"), size: data.length });
      }
      if (sid && action === "restore" && method === "POST") {
        const b = await readJson(req);
        const paths = Array.isArray(b.paths) ? b.paths.filter((p): p is string => typeof p === "string") : undefined;
        const out = await snapshots.restore(sid, { paths, beforeLabel: str(b.beforeLabel) });
        store.invalidate();
        return send(res, 200, out);
      }
      if (sid && action === "rename" && method === "POST") {
        const b = await readJson(req);
        return send(res, 200, await snapshots.rename(sid, str(b.label) ?? null));
      }
      return send(res, 404, { error: "not_found", message: "Bilinmeyen uç nokta" });
    } catch (e) {
      if (e instanceof SnapshotError) return send(res, e.code === "not_found" ? 404 : 400, { error: e.code, message: e.message });
      throw e;
    }
  }

  async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const parts = url.pathname.split("/").filter(Boolean).slice(1).map(decodeURIComponent); // "api" sonrası
    const method = req.method ?? "GET";
    const route = `${method} ${parts[0] ?? ""}${parts[2] ? `/:id/${parts[2]}` : parts[1] ? "/:id" : ""}`;
    const id = parts[1];

    if (parts[0] === "snapshots") return handleSnapshots(req, res, url, parts, method);
    if (parts[0] === "anamnesis") {
      if (method === "GET" && !parts[1]) {
        const arche = url.searchParams.get("arche");
        const prefs = await readPrefs(store.root);
        const newPerDay = Number(prefs.anamnesisNewPerDay);
        return send(res, 200, await anamnesis.queue({ archeId: arche === null ? undefined : arche === "shadow" ? null : arche, newPerDay: Number.isInteger(newPerDay) && newPerDay >= 0 ? newPerDay : 20 }));
      }
      if (method === "POST" && parts[1] === "grade") {
        const b = await readJson(req);
        try {
          return send(res, 200, await anamnesis.grade(str(b.id) ?? "", Number(b.grade) as Grade));
        } catch (e) {
          return send(res, 400, { error: "invalid", message: (e as Error).message });
        }
      }
      return send(res, 404, { error: "not_found", message: "Bilinmeyen uç nokta" });
    }
    if (parts[0] === "vigil" && parts[1] === "digest" && method === "POST") {
      const b = await readJson(req);
      const days = Number(b.days);
      const doc = await writeDigest(store, { days: Number.isFinite(days) ? days : 7, title: str(b.title) ?? "Vigil", parentId: str(b.parentId) ?? null, lang: b.lang === "en" ? "en" : "tr" });
      return send(res, 201, doc);
    }
    if (parts[0] === "query" && method === "POST") {
      const b = await readJson(req);
      return send(res, 200, await runQuery(store, str(b.query) ?? "", { selfId: str(b.selfId) }));
    }
    if (parts[0] === "citations" && method === "GET") {
      // Kaynakça: kayıtlar (CSL-JSON), seçili stil, okunamayan dosyalar ve Origin'deki aday dosyalar.
      const settings = await citationSettings(store.root);
      const lib = await loadLibrary(store.root, settings.files);
      return send(res, 200, { style: settings.style, files: settings.files, items: [...lib.items.values()], problems: lib.problems, available: await findLibraryFiles(store.root) });
    }

    if (parts[0] === "ai") {
      if (method === "GET" && parts.length === 1) {
        return send(res, 200, { clients: await activity.clients(), requests: await activity.listRequests(30) });
      }
      if (method === "POST" && parts[1] === "requests" && parts.length === 2) {
        const b = await readJson(req);
        const provider = ["claude", "chatgpt", "gemini"].includes(String(b.provider)) ? (b.provider as ProviderId) : null;
        return send(
          res,
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
        return send(res, 200, await activity.clearHistory());
      }
      if (method === "POST" && parts[1] === "requests" && parts[3] === "cancel") {
        const b = await readJson(req);
        return send(res, 200, await activity.cancelRequest(parts[2], str(b.reply) ?? "İptal edildi."));
      }
      if (method === "POST" && parts[1] === "requests" && parts[3] === "undo") {
        return send(res, 200, await activity.undo(store, parts[2]));
      }
      return send(res, 404, { error: "not_found", message: "Bilinmeyen uç nokta" });
    }

    switch (route) {
      case "GET events":
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        res.write(": bağlandı\n\n");
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      case "GET search":
        return send(res, 200, { results: await store.search(url.searchParams.get("q") ?? "", 30) });
      case "GET origin":
        return send(res, 200, await loadOrigin(store.root));
      case "GET shadow":
        return send(res, 200, await store.shadow());
      case "POST capture": {
        const b = await readJson(req);
        const out = await captureText(store, str(b.text) ?? "", str(b.title));
        return send(res, 201, "routed" in out ? { routed: out.routed } : out.node);
      }
      case "GET capture-config":
        return send(res, 200, await readCaptureConfig(store.root));
      case "PUT capture-config":
        return send(res, 200, await writeCaptureConfig(store.root, await readJson(req)));
      case "POST nodes/:id/promote": {
        const b = await readJson(req);
        const kind = (CAPTURE_KINDS as readonly string[]).includes(String(b.kind)) ? (b.kind as CaptureKind) : undefined;
        return send(res, 200, await promoteCapture(store, id, { kind, target: str(b.target) }));
      }
      case "GET nodes/:id/manuscript":
        return send(res, 200, await compileManuscript(store, id));
      case "GET nodes/:id/comments":
        return send(res, 200, { comments: await comments.list(id) });
      case "POST nodes/:id/comments": {
        const b = await readJson(req);
        const cid = str(b.commentId) ?? "";
        switch (b.action) {
          case "update":
            return send(res, 200, await comments.update(id, cid, { body: b.body, resolved: b.resolved }));
          case "reply":
            return send(res, 200, await comments.reply(id, cid, { body: b.body, author: b.author }));
          case "delete":
            await comments.remove(id, cid);
            return send(res, 200, { deleted: cid });
          default:
            return send(res, 201, await comments.add(id, { anchor: b.anchor, body: b.body, author: b.author }));
        }
      }
      case "GET comments":
        return send(res, 200, { counts: await comments.counts() });
      case "POST nodes/:id/checkpoint": {
        const b = await readJson(req);
        return send(res, 201, await store.checkpoint(id, str(b.label) ?? ""));
      }
      case "POST nodes/:id/history-delete": {
        const b = await readJson(req);
        await store.deleteHistory(id, Number(b.at));
        return send(res, 200, { deleted: Number(b.at) });
      }
      case "GET nodes/:id/wiki":
        return send(res, 200, { entries: await store.wikiEntries(id) });
      case "GET nodes/:id/wiki-mentions":
        return send(res, 200, { mentions: await store.wikiMentions(id) });
      case "GET wiki-terms":
        return send(res, 200, { terms: await store.wikiTerms() });
      case "GET trash":
        return send(res, 200, { entries: await store.listTrash() });
      case "POST trash/:id/restore":
        return send(res, 200, await store.restoreTrash(id));
      case "DELETE trash/:id":
        await store.deleteTrash(id);
        return send(res, 200, { deleted: id });
      case "DELETE trash": {
        const entries = await store.listTrash();
        for (const e of entries) await store.deleteTrash(e.entry);
        return send(res, 200, { deleted: entries.length });
      }
      case "GET nodes":
        return send(res, 200, { nodes: await store.list() });
      case "POST nodes": {
        const b = await readJson(req);
        return send(
          res,
          201,
          await store.create({ title: str(b.title) ?? "", parentNodeId: str(b.parentNodeId) ?? null, body: str(b.body), fields: obj(b.fields) }),
        );
      }
      case "GET nodes/:id":
        return send(res, 200, await store.read(id));
      case "PUT nodes/:id": {
        const b = await readJson(req);
        return send(
          res,
          200,
          await store.update(id, { body: str(b.body), title: str(b.title), baseRevision: str(b.baseRevision), fields: obj(b.fields), properties: obj(b.properties) }),
        );
      }
      case "DELETE nodes/:id":
        return send(res, 200, await store.trash(id));
      case "POST nodes/:id/move": {
        const b = await readJson(req);
        return send(res, 200, await store.move(id, str(b.parentNodeId) ?? null));
      }
      case "POST nodes/:id/duplicate": {
        const b = await readJson(req);
        const parent = b.parentNodeId === undefined ? undefined : (str(b.parentNodeId) ?? null);
        return send(res, 201, await store.duplicate(id, { parentNodeId: parent, title: str(b.title), fields: obj(b.fields) }));
      }
      case "GET nodes/:id/export": {
        const lang = url.searchParams.get("lang") === "en" ? "en" : "tr";
        const format = url.searchParams.get("format");
        if (format === "rtf" || format === "docx" || format === "txt") {
          const out = await exportPageDocument(store, id, format);
          return sendFile(res, out.name, out.mime, out.data);
        }
        if (url.searchParams.get("format") === "html") {
          const out = await exportPageHtml(store, id, lang);
          return sendFile(res, out.name, "text/html; charset=utf-8", out.html);
        }
        if (url.searchParams.get("format") === "site") {
          const out = await exportSite(store, { rootId: id, lang });
          return sendFile(res, "site.zip", "application/zip", zipFiles(out.files));
        }
        const out = await exportMarkdownZip(store, id);
        return sendFile(res, out.name, "application/zip", out.data);
      }
      case "GET site": {
        const out = await exportSite(store, { lang: url.searchParams.get("lang") === "en" ? "en" : "tr" });
        return sendFile(res, "site.zip", "application/zip", zipFiles(out.files));
      }
      case "GET nodes/:id/backlinks":
        return send(res, 200, { nodes: await store.backlinks(id) });
      case "GET nodes/:id/outgoing":
        return send(res, 200, await store.outgoing(id));
      case "GET nodes/:id/mentions":
        return send(res, 200, { mentions: await store.unlinkedMentions(id) });
      case "POST nodes/:id/link-mention": {
        const b = await readJson(req);
        return send(res, 200, await store.linkMention(str(b.source) ?? "", id));
      }
      case "POST nodes/:id/merge": {
        const b = await readJson(req);
        return send(res, 200, await store.merge(id, str(b.into) ?? ""));
      }
      case "GET nodes/:id/history": {
        const at = Number(url.searchParams.get("at"));
        if (at) return send(res, 200, { at, body: await store.historyBody(id, at) });
        return send(res, 200, { entries: await store.history(id) });
      }
      case "POST nodes/:id/restore": {
        const b = await readJson(req);
        return send(res, 200, await store.restoreHistory(id, Number(b.at), str(b.baseRevision)));
      }
      case "GET graph":
        return send(res, 200, await store.graph());
      case "GET snippets":
        return send(res, 200, { snippets: await readSnippets(store.root) });
      case "POST reorder": {
        const b = await readJson(req);
        const ids = Array.isArray(b.ids) ? b.ids.filter((x): x is string => typeof x === "string") : [];
        return send(res, 200, { nodes: await store.reorder(str(b.parentNodeId) ?? null, ids) });
      }
      case "GET tags":
        return send(res, 200, { tags: await store.tags() });
      case "POST tags/:id/rename": {
        const b = await readJson(req);
        return send(res, 200, { changed: await store.renameTag(id, str(b.to) ?? "") });
      }
      case "GET attachments":
        return send(res, 200, { attachments: await store.listAttachments() });
      case "POST attachments/:id/rename": {
        const b = await readJson(req);
        return send(res, 200, { path: await store.renameAttachment(str(b.path) ?? "", str(b.name) ?? "") });
      }
      case "GET annotations": {
        const pdf = url.searchParams.get("path") ?? "";
        if (!/\.pdf$/i.test(pdf) || !(await store.pathExists(pdf))) return send(res, 404, { error: "not_found", message: "PDF bulunamadı" });
        return send(res, 200, await readAnnotations(store.root, pdf));
      }
      case "PUT annotations": {
        const pdf = url.searchParams.get("path") ?? "";
        if (!/\.pdf$/i.test(pdf) || !(await store.pathExists(pdf))) return send(res, 404, { error: "not_found", message: "PDF bulunamadı" });
        return send(res, 200, await writeAnnotations(store.root, pdf, await readJson(req, 20 * 1024 * 1024)));
      }
      case "GET prefs":
        return send(res, 200, await readPrefs(store.root));
      case "PUT prefs":
        return send(res, 200, await writePrefs(store.root, await readJson(req)));
      case "POST import": {
        const b = await readJson(req, 300 * 1024 * 1024);
        const files = (Array.isArray(b.files) ? b.files : [])
          .map((f) => obj(f))
          .filter((f): f is Record<string, unknown> => !!f && typeof f.path === "string" && typeof f.data === "string")
          .map((f) => ({ path: String(f.path), data: new Uint8Array(Buffer.from(String(f.data), "base64")) }));
        const parent = b.parentNodeId === undefined ? undefined : (str(b.parentNodeId) ?? null);
        return send(res, 201, await importFiles(store, files, parent));
      }
      case "POST attachments": {
        const name = url.searchParams.get("name") || "dosya";
        const data = await readBody(req, 200 * 1024 * 1024);
        return send(res, 201, { path: await store.saveAttachment(name, data) });
      }
    }
    send(res, 404, { error: "not_found", message: "Bilinmeyen uç nokta" });
  }

  /** Origin içindeki ekleri ve dosyaları sunar (`/files/<Origin yolu>`); gizli klasörler ve Origin dışı reddedilir. */
  async function serveVaultFile(res: ServerResponse, url: URL): Promise<void> {
    const rel = decodeURIComponent(url.pathname.slice("/files/".length));
    const file = store.abs(rel);
    try {
      const data = await readFile(file);
      const type = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
      // Etkin içerik (HTML/SVG) yerel sunucu kökeninde çalışmasın.
      res.writeHead(200, {
        "content-type": type,
        "content-security-policy": "sandbox",
        "x-content-type-options": "nosniff",
        "cache-control": "no-cache",
      });
      res.end(data);
    } catch {
      res.writeHead(404).end();
    }
  }

  async function serveStatic(res: ServerResponse, url: URL): Promise<void> {
    const rel = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
    let file = path.join(WEB_DIST, rel);
    if (!file.startsWith(WEB_DIST) || !path.extname(file)) file = path.join(WEB_DIST, "index.html");
    try {
      const data = await readFile(file);
      const ext = path.extname(file);
      res.writeHead(200, {
        "content-type": MIME[ext] ?? "application/octet-stream",
        "x-content-type-options": "nosniff",
        ...(ext === ".html" ? { "content-security-policy": APP_CSP, "referrer-policy": "no-referrer" } : {}),
      });
      res.end(data);
    } catch {
      if (file.endsWith("index.html")) {
        res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
        res.end("Arayüz derlenmemiş. Önce `npm run build` çalıştırın.");
      } else {
        res.writeHead(404).end();
      }
    }
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
    // DNS rebinding'e karşı: yalnızca yerel Host başlıklarını kabul et.
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    // Başka sitelerden gelen istekleri (CSRF) reddet.
    const origin = req.headers.origin;
    const originOk =
      !origin || origin === `http://localhost:${PORT}` || origin === `http://127.0.0.1:${PORT}` || (options.extraOrigins ?? []).includes(origin);
    if ((host !== "127.0.0.1" && host !== "localhost") || !originOk) {
      res.writeHead(403).end();
      return;
    }
    // Oturum anahtarı olmayan istekler (başka kullanıcılar ya da programlar) reddedilir.
    if (options.token && !sameToken(requestToken(req), options.token)) {
      res.writeHead(401, { "content-type": "text/plain; charset=utf-8" }).end("Nularche: unauthorized");
      return;
    }
    try {
      if (url.pathname.startsWith("/api/")) await handleApi(req, res, url);
      else if (url.pathname.startsWith("/files/")) await serveVaultFile(res, url);
      else await serveStatic(res, url);
    } catch (err) {
      if (err instanceof NodeError) {
        const status = err.code === "not_found" ? 404 : err.code === "conflict" ? 409 : 400;
        send(res, status, { error: err.code, message: err.message, ...err.details });
      } else {
        console.error(err);
        if (!res.headersSent) send(res, 500, { error: "internal", message: String(err) });
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, HOST, () => resolve());
  });
  const address = server.address();
  if (address && typeof address === "object") PORT = address.port;

  return {
    port: PORT,
    url: `http://127.0.0.1:${PORT}`,
    store,
    snapshots,
    close: async () => {
      clearTimeout(snapshotTimer);
      watcher.close();
      for (const res of clients) res.end();
      clients.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

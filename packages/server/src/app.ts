// Yerel HTTP sunucusu: JSON API + derlenmiş web arayüzü + canlı değişiklik bildirimi (SSE).
// Yalnızca 127.0.0.1'e bağlanır.

import { watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { NodeError, NodeStore } from "../../core/src/node-store.ts";
import { loadOrigin } from "../../core/src/origin.ts";

const HOST = "127.0.0.1";

export interface ServerOptions {
  originDir: string;
  /** Derlenmiş web arayüzü klasörü (index.html içerir). */
  webDist: string;
  /** 0 = rastgele boş port. */
  port: number;
  /** Ek izinli Origin'ler (ör. Vite geliştirme sunucusu). */
  extraOrigins?: string[];
}

export interface RunningServer {
  port: number;
  url: string;
  store: NodeStore;
  close(): Promise<void>;
}

export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const WEB_DIST = path.resolve(options.webDist);
  let PORT = options.port;
  const store = new NodeStore(options.originDir);
  await store.ensureRoot();

  // --- Canlı bildirim: Origin.de (Claude MCP ile dahil) bir dosya değişince istemcilere haber ver.
  const clients = new Set<ServerResponse>();
  let pending: NodeJS.Timeout | undefined;
  const watcher = watch(store.root, { recursive: true }, (_event, filename) => {
    const name = filename?.toString() ?? "";
    if (name.split(path.sep).some((seg) => seg.startsWith("."))) return; // .trash, geçici dosyalar
    clearTimeout(pending);
    pending = setTimeout(() => {
      for (const res of clients) res.write(`event: change\ndata: {}\n\n`);
    }, 150);
  });

  const MIME: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
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

  async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
    const buf = await readBody(req, 10 * 1024 * 1024);
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

  async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const parts = url.pathname.split("/").filter(Boolean).slice(1).map(decodeURIComponent); // "api" sonrası
    const method = req.method ?? "GET";
    const route = `${method} ${parts[0] ?? ""}${parts[2] ? `/:id/${parts[2]}` : parts[1] ? "/:id" : ""}`;
    const id = parts[1];

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
        return send(res, 201, await store.capture(str(b.text) ?? "", str(b.title)));
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
          await store.update(id, { body: str(b.body), title: str(b.title), baseRevision: str(b.baseRevision), fields: obj(b.fields) }),
        );
      }
      case "DELETE nodes/:id":
        return send(res, 200, await store.trash(id));
      case "POST nodes/:id/move": {
        const b = await readJson(req);
        return send(res, 200, await store.move(id, str(b.parentNodeId) ?? null));
      }
      case "GET nodes/:id/backlinks":
        return send(res, 200, { nodes: await store.backlinks(id) });
      case "POST reorder": {
        const b = await readJson(req);
        const ids = Array.isArray(b.ids) ? b.ids.filter((x): x is string => typeof x === "string") : [];
        return send(res, 200, { nodes: await store.reorder(str(b.parentNodeId) ?? null, ids) });
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
      res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
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
    close: async () => {
      watcher.close();
      for (const res of clients) res.end();
      clients.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

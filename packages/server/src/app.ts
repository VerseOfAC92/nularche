// Masaüstünün yerel HTTP sunucusu: yalnızca 127.0.0.1'e bağlanır; Host/Origin ve oturum anahtarı denetimlerini
// yapar, derlenmiş arayüzü sunar ve `/api`, `/files` isteklerini ortak işleyiciye (api.ts) iletir. Origin'deki
// dosya değişikliklerini izleyip canlı bildirim gönderir.

import { timingSafeEqual } from "node:crypto";
import { watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { NodeStore } from "../../core/src/node-store.ts";
import { SnapshotStore } from "../../core/src/snapshots.ts";
import { Anamnesis } from "../../core/src/anamnesis.ts";
import { AI_DIR, AiActivity } from "../../core/src/ai-activity.ts";
import { CommentStore } from "../../core/src/comments.ts";
import { createApi, EventHub, MIME } from "./api.ts";

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
   * Oturum anahtarı: verilirse her istek `x-nularche-token` başlığını taşımalıdır. Masaüstü uygulaması her açılışta
   * rastgele bir anahtar üretir ve yalnızca kendi pencerelerinin bu sunucuya giden isteklerine başlık olarak ekler
   * (çerez kullanılmaz: macOS'ta çerez deposu anahtar zinciri izni ister ve açılışı bekletir); böylece
   * bilgisayardaki başka bir kullanıcı ya da program 127.0.0.1 üzerinden notlara erişemez. Verilmezse (tarayıcı
   * sürümü, testler) yalnızca Host ve Origin denetimi uygulanır.
   */
  token?: string;
  /**
   * Anlık görüntü anahtarı (32 bayt): verilirse anlık görüntüler şifrelenir. Masaüstü uygulaması bunu işletim sisteminin
   * anahtar zincirinde korur; Origin'e ya da Drive'a yazılmaz.
   */
  snapshotKey?: Uint8Array | null | (() => Promise<Uint8Array | null>);
  /** Otomatik anlık görüntü aralığı (dakika). Verilmezse otomatik anlık görüntü alınmaz (testler, tarayıcı). */
  autoSnapshotMinutes?: number;
}

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
  return typeof header === "string" ? header : "";
}

/** Node isteği → web `Request` (gövde akış olarak geçer; bağlantı kapanınca `signal` iptal olur). */
function toRequest(req: IncomingMessage, url: URL): Request {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) for (const x of v) headers.append(k, x);
    else if (v !== undefined) headers.set(k, v);
  }
  const abort = new AbortController();
  req.once("close", () => abort.abort());
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(url, {
    method: req.method,
    headers,
    signal: abort.signal,
    ...(hasBody ? { body: Readable.toWeb(req) as ReadableStream, duplex: "half" } : {}),
  } as RequestInit);
}

/** Web `Response` → Node yanıtı; akışlı gövdeler (canlı bildirimler) parça parça yazılır. */
async function writeResponse(response: Response, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const headers: Record<string, string> = {};
  response.headers.forEach((v, k) => (headers[k] = v));
  res.writeHead(response.status, headers);
  if (!response.body) return void res.end();
  const reader = response.body.getReader();
  const stop = () => void reader.cancel().catch(() => undefined);
  req.once("close", stop);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } finally {
    req.off("close", stop);
    res.end();
  }
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
  // Açılışı bekletmez (anahtar gerekebilir).
  void store
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
  const events = new EventHub();
  const api = createApi({ store, activity, comments, anamnesis, events, snapshots });
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
        events.emit("ai");
        options.onAiActivity?.();
      }, 100);
      return;
    }
    // Yorumlar gizli klasördedir; açık görünümler ayrı bir olayla yenilenir.
    if (name.startsWith(commentsPrefix)) {
      clearTimeout(pendingComments);
      pendingComments = setTimeout(() => {
        events.emit("comments");
      }, 120);
      return;
    }
    if (name.split(path.sep).some((seg) => seg.startsWith("."))) return; // .trash, geçici dosyalar
    clearTimeout(pending);
    pending = setTimeout(() => {
      events.emit("change");
    }, 150);
  });

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
      const response = await api.handle(toRequest(req, url));
      if (response) await writeResponse(response, req, res);
      else await serveStatic(res, url);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain; charset=utf-8" }).end(String(err));
      else res.end();
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
      events.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

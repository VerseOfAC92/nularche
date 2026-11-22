// Web sürümünde /api ve /files istekleri ağa gitmez: service worker isteği yakalar, MessageChannel ile isteği yapan
// sayfaya iletir; sayfadaki ortak API işleyicisi (server/src/api.ts) yanıtı üretir ve gövde parça parça geri akar.
// Böylece fetch, EventSource (/api/events), <img src="/files/…"> ve pdf.js istekleri masaüstündekiyle aynı çalışır.
// Bu dosya iki tarafın da kullandığı saf işlevleri içerir; Node'da (MessageChannel, Request, Response) test edilir.

/** Service worker → sayfa: tek bir istek. Gövde aktarılır (kopyalanmaz). */
export interface BridgeRequest {
  type: "nularche-request";
  method: string;
  url: string;
  headers: [string, string][];
  body: ArrayBuffer | null;
}

/** Sayfa → service worker: önce başlık, sonra gövde parçaları, en sonda bitiş ya da hata. */
export type BridgeReply =
  | { type: "head"; status: number; statusText: string; headers: [string, string][] }
  | { type: "chunk"; data: ArrayBuffer }
  | { type: "end" }
  | { type: "error"; message: string };

/** Service worker → sayfa: okuyucu vazgeçti (örneğin EventSource kapandı); işleyicinin isteği iptal edilir. */
export interface BridgeCancel {
  type: "cancel";
}

export type ApiHandler = (request: Request) => Promise<Response | null>;

/** Yalnızca aynı kaynaktan, sayfanın kendi yaptığı /api ve /files istekleri iletilir; sayfa geçişleri ağa kalır. */
export function shouldForward(request: Pick<Request, "url" | "mode">, origin: string): boolean {
  if (request.mode === "navigate") return false;
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return false;
  }
  return url.origin === origin && (url.pathname.startsWith("/api/") || url.pathname.startsWith("/files/"));
}

/** Gövdesi olamayan durum kodları (Response bunlara gövde verilmesine izin vermez). */
const NULL_BODY = new Set([101, 103, 204, 205, 304]);

/** Sayfa bu sürede başlığı göndermezse (sayfa kapanmış ya da yanıt vermiyor) istek 504 ile biter. */
export const HEAD_TIMEOUT_MS = 30_000;

/** Taşıyıcının kendi iletileri arayüzün dilinde: sayfada belgenin dili, service worker'da tarayıcının dili. */
const inTurkish = () => {
  const lang = (typeof document !== "undefined" ? document.documentElement.lang : "") || (typeof navigator !== "undefined" ? navigator.language : "");
  return lang.toLowerCase().startsWith("tr");
};
const say = (en: string, tr: string) => (inTurkish() ? tr : en);

const plain = (status: number, message: string) =>
  new Response(JSON.stringify({ error: message }), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

/**
 * Service worker tarafı: isteği bir porta yazar ve sayfanın yanıtını akış olarak döndürür. `post` isteği sayfaya
 * iletir (ör. `client.postMessage(msg, transfer)`).
 */
export async function forwardRequest(
  request: Request,
  post: (message: BridgeRequest, transfer: Transferable[]) => void,
  timeoutMs = HEAD_TIMEOUT_MS,
): Promise<Response> {
  const body = request.method === "GET" || request.method === "HEAD" ? null : await request.arrayBuffer();
  const channel = new MessageChannel();
  const port = channel.port1;
  const message: BridgeRequest = { type: "nularche-request", method: request.method, url: request.url, headers: [...request.headers], body };
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let finished = false;
  const close = () => {
    finished = true;
    port.onmessage = null;
    port.close();
  };
  const cancel = () => {
    if (finished) return;
    port.postMessage({ type: "cancel" } satisfies BridgeCancel);
    close();
  };
  request.signal?.addEventListener("abort", () => {
    if (finished) return;
    try {
      controller?.error(new DOMException(say("The request was cancelled.", "İstek iptal edildi."), "AbortError"));
    } catch {
      // Akış zaten kapanmış.
    }
    cancel();
  });

  return await new Promise<Response>((resolve) => {
    const timer = setTimeout(() => {
      cancel();
      resolve(plain(504, say("The Nularche page did not respond.", "Nularche sayfası yanıt vermedi.")));
    }, timeoutMs);
    port.onmessage = (event: MessageEvent<BridgeReply>) => {
      const msg = event.data;
      if (msg.type === "head") {
        clearTimeout(timer);
        if (NULL_BODY.has(msg.status) || request.method === "HEAD") {
          cancel();
          resolve(new Response(null, { status: msg.status, statusText: msg.statusText, headers: msg.headers }));
          return;
        }
        const stream = new ReadableStream<Uint8Array>({
          start: (c) => void (controller = c),
          cancel,
        });
        resolve(new Response(stream, { status: msg.status, statusText: msg.statusText, headers: msg.headers }));
      } else if (msg.type === "chunk") controller?.enqueue(new Uint8Array(msg.data));
      else if (msg.type === "end") {
        controller?.close();
        close();
      } else if (msg.type === "error") {
        clearTimeout(timer);
        if (controller) controller.error(new Error(msg.message));
        else resolve(plain(500, msg.message));
        close();
      }
    };
    post(message, body ? [channel.port2, body] : [channel.port2]);
  });
}

/**
 * Sayfa tarafı: service worker'dan gelen isteği işleyiciye verir, yanıtı porta yazar. `handler` yoksa (Origin henüz
 * açılmadı ya da kilitli) 503 döner. Okuyucu vazgeçerse işleyicinin isteği iptal edilir.
 */
export async function answerRequest(message: BridgeRequest, port: MessagePort, handler: ApiHandler | null): Promise<void> {
  const abort = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let cancelled = false;
  port.onmessage = (event: MessageEvent<BridgeCancel>) => {
    if (event.data?.type !== "cancel") return;
    cancelled = true;
    abort.abort();
    void reader?.cancel().catch(() => undefined);
    port.close();
  };
  const send = (reply: BridgeReply, transfer: Transferable[] = []) => {
    if (!cancelled) port.postMessage(reply, transfer);
  };
  let response: Response;
  try {
    const request = new Request(message.url, { method: message.method, headers: message.headers, body: message.body, signal: abort.signal });
    response = handler
      ? ((await handler(request)) ?? plain(404, say("Not found.", "Bulunamadı.")))
      : plain(503, say("Nularche is locked or not open yet.", "Nularche kilitli ya da henüz açılmadı."));
  } catch (err) {
    send({ type: "error", message: err instanceof Error ? err.message : String(err) });
    port.close();
    return;
  }
  send({ type: "head", status: response.status, statusText: response.statusText, headers: [...response.headers] });
  if (!response.body) {
    send({ type: "end" });
    if (!cancelled) port.close();
    return;
  }
  reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || cancelled) break;
      // Aktarılacak tampon yalnızca bu parçayı içermeli (alttaki tampon daha büyük ya da paylaşımlı olabilir).
      const data = value.slice().buffer;
      send({ type: "chunk", data }, [data]);
    }
    send({ type: "end" });
  } catch (err) {
    if (!cancelled) send({ type: "error", message: err instanceof Error ? err.message : String(err) });
  } finally {
    if (!cancelled) port.close();
  }
}

export const isBridgeRequest = (data: unknown): data is BridgeRequest =>
  typeof data === "object" && data !== null && (data as { type?: unknown }).type === "nularche-request";

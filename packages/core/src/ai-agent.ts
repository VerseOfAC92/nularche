// Nularche AI otomatik modu: Nularche AI isteğini, kullanıcının kendi (ücretsiz) Gemini API anahtarıyla
// arka planda işler. Gemini, notları aşağıdaki araçlarla okur ve düzenler; her düzenlemeden önce geri
// alma kopyası alınır ve sonuç, isteğin cevabı olarak Nularche AI penceresinde görünür.

import { AiActivity, REPLY_LANGUAGE_NAME, type AiRequest, type ReplyLanguage } from "./ai-activity.ts";
import { NodeError, NodeStore, SHADOW, type NodeMeta } from "./node-store.ts";
import { rearrangeBlocks, splitBlocks, type BlockItem } from "./blocks.ts";

/** Bu uzunluğun üstündeki notlar baştan yazılmaz; numaralı bloklar olarak gösterilir ve rearrange_node ile düzenlenir. */
export const LONG_NOTE_CHARS = 20_000;

const numbered = (body: string) =>
  splitBlocks(body)
    .map((b, i) => `[${i}]\n${b}`)
    .join("\n\n");

/** Gemini API kökü; testlerde sahte bir sunucu verilebilir (`api` seçeneği). */
export const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta";
export const AUTO_CLIENT = "nularche-auto (Gemini)";

type Fetch = typeof fetch;

/** Hata anlatımları: kullanıcıya isteğin (ya da arayüzün) dilinde gösterilir. */
const AGENT_TEXT = {
  request_timeout: { tr: () => "İstek süre sınırını aştı.", en: () => "The request ran out of time." },
  call_timeout: { tr: (v: V) => `Gemini ${v.min} dakika içinde yanıt vermedi.`, en: (v: V) => `Gemini did not answer within ${v.min} minutes.` },
  network: {
    tr: (v: V) => `Gemini'ye ulaşılamadı (${v.detail}). İnternet bağlantınızı kontrol edin.`,
    en: (v: V) => `Gemini could not be reached (${v.detail}). Check your internet connection.`,
  },
  key_invalid: { tr: () => "Gemini API anahtarı geçersiz. Ayarlar → Yapay zekâ bölümünden yeni bir anahtar girin.", en: () => "The Gemini API key is invalid. Enter a new key under Settings → AI." },
  key_rejected: {
    tr: () => "Gemini API anahtarı reddedildi. Anahtarın doğru olduğunu ve Generative Language API'nin açık olduğunu kontrol edin.",
    en: () => "The Gemini API key was rejected. Check that the key is correct and the Generative Language API is enabled.",
  },
  quota: {
    tr: () => "Gemini ücretsiz kotası şimdilik doldu. Bir süre sonra tekrar deneyin (günlük kota gece Pasifik saatiyle sıfırlanır).",
    en: () => "The free Gemini quota is used up for now. Try again later (the daily quota resets at midnight Pacific time).",
  },
  model_unavailable: { tr: (v: V) => `Model kullanılamıyor: ${v.detail}`, en: (v: V) => `Model unavailable: ${v.detail}` },
  busy: { tr: (v: V) => `Geçici Gemini hatası (${v.status}): ${v.detail}`, en: (v: V) => `Temporary Gemini error (${v.status}): ${v.detail}` },
  error: { tr: (v: V) => `Gemini hatası (${v.status}): ${v.detail}`, en: (v: V) => `Gemini error (${v.status}): ${v.detail}` },
  no_models_for_key: { tr: () => "Bu anahtarla kullanılabilen bir Gemini modeli bulunamadı.", en: () => "No Gemini model is available with this key." },
  no_reply: { tr: (v: V) => `Cevap üretilmedi (${v.detail}).`, en: (v: V) => `No answer was produced (${v.detail}).` },
  empty_reply: { tr: () => "Boş cevap döndü.", en: () => "The answer was empty." },
  too_many_steps: { tr: () => "İstek çok fazla adım gerektirdi; daha küçük parçalara bölmeyi deneyin.", en: () => "The request needed too many steps; try splitting it into smaller parts." },
  no_models: { tr: () => "Kullanılabilir Gemini modeli yok. Ayarlar'da anahtarı yeniden kaydedin.", en: () => "No Gemini model is available. Save the key again in Settings." },
  cancelled: { tr: () => "İptal edildi.", en: () => "Cancelled." },
  deadline: {
    tr: (v: V) => `Gemini ${v.min} dakika içinde isteği bitiremedi${v.tried ? ` (${v.tried})` : ""}. İsteği daha küçük parçalara bölüp tekrar deneyin.`,
    en: (v: V) => `Gemini could not finish the request within ${v.min} minutes${v.tried ? ` (${v.tried})` : ""}. Split it into smaller parts and try again.`,
  },
  offline: { tr: () => "Gemini'ye ulaşılamadı. İnternet bağlantınızı kontrol edip “Tekrar dene”ye basın.", en: () => "Gemini could not be reached. Check your internet connection and press “Retry”." },
  all_quota: {
    tr: (v: V) => `Tüm Gemini modellerinin ücretsiz kotası şimdilik dolu (${v.tried}). Bir süre sonra “Tekrar dene”ye basın; günlük kota gece Pasifik saatiyle sıfırlanır.`,
    en: (v: V) => `The free quota of every Gemini model is used up for now (${v.tried}). Press “Retry” later; the daily quota resets at midnight Pacific time.`,
  },
  all_failed: {
    tr: (v: V) => `Tüm Gemini modelleri denendi ama şu an yanıt alınamadı: ${v.tried}. Birkaç dakika sonra “Tekrar dene”ye basın.`,
    en: (v: V) => `Every Gemini model was tried but none answered right now: ${v.tried}. Press “Retry” in a few minutes.`,
  },
} satisfies Record<string, { tr: (v: V) => string; en: (v: V) => string }>;
type V = Record<string, string | number>;
export type AgentErrorCode = keyof typeof AGENT_TEXT;

/** Denenen modellerin durumu (ör. "a (kota dolu)"): hata metninde isteğin dilinde gösterilir. */
const TRIED_LABEL: Record<"quota" | "model" | "network" | "timeout" | "busy", { tr: string; en: string }> = {
  quota: { tr: "kota dolu", en: "quota used up" },
  model: { tr: "kullanılamıyor", en: "unavailable" },
  network: { tr: "bağlantı yok", en: "no connection" },
  timeout: { tr: "yanıt vermedi", en: "no answer" },
  busy: { tr: "yoğun", en: "busy" },
};

export class AgentError extends Error {
  /** busy: geçici yoğunluk/sunucu hatası; quota: kota; model: model bulunamadı/desteklenmiyor; timeout: yanıt gelmedi. */
  readonly kind: "auth" | "quota" | "network" | "model" | "busy" | "timeout" | "other";
  readonly code: AgentErrorCode;
  readonly vars: V;
  constructor(kind: AgentError["kind"], code: AgentErrorCode, vars: V = {}) {
    super(AGENT_TEXT[code].tr(vars));
    this.kind = kind;
    this.code = code;
    this.vars = vars;
  }
  /** Kullanıcıya gösterilecek metin, verilen dilde. */
  text(lang: ReplyLanguage): string {
    return AGENT_TEXT[this.code][lang](this.vars);
  }
}

/** Tek bir Gemini çağrısının üst süresi: yanıt vermeyen bağlantı isteği (ve arkasındaki sırayı) sonsuza dek bekletmesin. */
export const CALL_TIMEOUT_MS = 180_000;
/** Bir isteğin tüm model denemeleriyle birlikte üst süresi. */
export const REQUEST_DEADLINE_MS = 8 * 60_000;

async function call(fetchImpl: Fetch, api: string, apiKey: string, path: string, body?: unknown, signal?: AbortSignal): Promise<any> {
  const timeout = AbortSignal.timeout(CALL_TIMEOUT_MS);
  const abort = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let res: Response;
  let data: any;
  try {
    res = await fetchImpl(`${api}/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "x-goog-api-key": apiKey, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: abort,
    });
    data = await res.json().catch((err) => {
      if (abort.aborted) throw err;
      return {};
    });
  } catch (err) {
    if (signal?.aborted) throw new AgentError("timeout", "request_timeout");
    if (timeout.aborted) throw new AgentError("timeout", "call_timeout", { min: CALL_TIMEOUT_MS / 60_000 });
    throw new AgentError("network", "network", { detail: (err as Error).message });
  }
  if (res.ok) return data;
  const msg: string = data?.error?.message ?? res.statusText;
  if (res.status === 400 && /api key/i.test(msg)) throw new AgentError("auth", "key_invalid");
  if (res.status === 401 || res.status === 403) throw new AgentError("auth", "key_rejected");
  if (res.status === 429) throw new AgentError("quota", "quota");
  if (res.status === 404 || (res.status === 400 && /model|not supported|not found/i.test(msg))) throw new AgentError("model", "model_unavailable", { detail: msg });
  if (res.status >= 500) throw new AgentError("busy", "busy", { status: res.status, detail: msg });
  throw new AgentError("other", "error", { status: res.status, detail: msg });
}

interface GeminiModel {
  name: string;
  supportedGenerationMethods?: string[];
}

/**
 * Anahtarla kullanılabilen modelleri deneme sırasına dizer: önce kararlı Flash modelleri (yeniden eskiye),
 * sonra Flash-Lite (yeniden eskiye), sonra diğerleri. Bir model yoğun ya da kullanılamaz olduğunda
 * sıradaki denenir.
 */
export function rankGeminiModels(models: GeminiModel[]): string[] {
  const usable = models
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""))
    .filter((n) => /^gemini-/.test(n) && !/(preview|exp|tts|image|live|embedding|audio|learnlm|thinking|computer)/.test(n));
  const version = (n: string) => Number(/gemini-(\d+(?:\.\d+)?)/.exec(n)?.[1] ?? 0);
  const tier = (n: string) => (/flash-lite/.test(n) ? 1 : /flash/.test(n) ? 2 : 0);
  const pinned = (n: string) => (/-\d{3}$/.test(n) ? 1 : 0); // sürüm sabitlenmiş adlar (ör. -001) takma adlardan sonra
  return [...new Set(usable)].sort((a, b) => tier(b) - tier(a) || version(b) - version(a) || pinned(a) - pinned(b) || a.localeCompare(b));
}

export function pickGeminiModel(models: GeminiModel[]): string | null {
  return rankGeminiModels(models)[0] ?? null;
}

/** Anahtarı doğrular ve modelleri deneme sırasıyla döndürür. */
export async function checkGeminiKey(apiKey: string, fetchImpl: Fetch = fetch, api = GEMINI_API): Promise<{ model: string; models: string[] }> {
  const data = await call(fetchImpl, api, apiKey, "models?pageSize=200");
  const models = rankGeminiModels(data.models ?? []);
  if (!models.length) throw new AgentError("model", "no_models_for_key");
  return { model: models[0], models };
}

const TOOLS = [
  {
    name: "list_nodes",
    description:
      "Node'ların (sayfaların) başlık, yol ve id'lerini listeler. parent_node_id='root' Arche'leri, bir id o Node'un alt Node'larını verir.",
    parameters: { type: "object", properties: { parent_node_id: { type: "string" } } },
  },
  {
    name: "read_node",
    description: "Bir Node'un Markdown içeriğini ve düzenleme için gereken revision değerini döndürür.",
    parameters: { type: "object", properties: { node: { type: "string", description: "Node id'si" } }, required: ["node"] },
  },
  {
    name: "search_nodes",
    description: "Başlık ve içerikte tam metin arama yapar; kısa parçacıklar döndürür.",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "update_node",
    description: "Node'un içeriğini tamamen değiştirir ve/veya başlığını yeniler. base_revision olarak read_node'dan aldığın revision'ı ver.",
    parameters: {
      type: "object",
      properties: {
        node: { type: "string" },
        body: { type: "string", description: "Yeni tam Markdown içerik" },
        title: { type: "string" },
        base_revision: { type: "string" },
      },
      required: ["node"],
    },
  },
  {
    name: "rearrange_node",
    description:
      "Uzun bir notu baştan yazmadan yeniden düzenler: not boş satırlarla ayrılmış numaralı bloklardan oluşur (read_node ya da istekteki [n] numaraları). items sırasıyla yeni notu kurar: {block: n} mevcut bloğu olduğu gibi yerleştirir, {text: \"...\"} yeni metin (ör. '## Image' başlığı) ekler. Her blok en fazla bir kez kullanılır; yerleştirilmeyen her blok drop içinde açıkça listelenmelidir. Gruplama, sıralama ve başlık ekleme için bunu kullan.",
    parameters: {
      type: "object",
      properties: {
        node: { type: "string" },
        base_revision: { type: "string" },
        items: {
          type: "array",
          items: { type: "object", properties: { block: { type: "integer" }, text: { type: "string" } } },
        },
        drop: { type: "array", items: { type: "integer" }, description: "Kullanıcı silinmesini istediyse kaldırılacak blok numaraları" },
      },
      required: ["node", "items"],
    },
  },
  {
    name: "append_to_node",
    description: "Node'un sonuna Markdown metin ekler.",
    parameters: {
      type: "object",
      properties: { node: { type: "string" }, text: { type: "string" }, base_revision: { type: "string" } },
      required: ["node", "text"],
    },
  },
  {
    name: "create_node",
    description: "Yeni Node oluşturur. parent_node_id: üst Node id'si, kök için 'root', gelen kutusu için 'shadow'.",
    parameters: {
      type: "object",
      properties: { title: { type: "string" }, body: { type: "string" }, parent_node_id: { type: "string" } },
      required: ["title"],
    },
  },
];

const SYSTEM = [
  "Sen Nularche AI'sın: kullanıcının Nularche not uygulamasındaki notları (Node'lar) üzerinde çalışan bir asistansın.",
  "Kullanıcının isteğini araçları kullanarak yerine getir. Bir Node'u değiştirirken update_node'a güncel revision'ı base_revision olarak ver; çakışma olursa read_node ile yeniden oku.",
  "Önce isteğin niyetini belirle. Kullanıcı açıkça bir değişiklik (düzenle, yeniden yaz, düzelt, ekle, sil, grupla, sırala, çevir ve nota yaz, oluştur…) istemiyorsa — soru, özet, analiz, açıklama, kontrol, fikir ya da öneri istiyorsa — hiçbir notu değiştirme ve yeni not oluşturma; yalnızca cevabı yaz. Emin değilsen değiştirme; cevabında ne yapabileceğini öner.",
  "İçerik uydurma; teknik bilgileri değiştirme, yalnızca isteneni yap. Markdown biçimini koru ve düzgün kullan.",
  "İş bitince araç çağırmadan, kullanıcıya kısa ve net bir cevap yaz: ne yaptığını ya da sorunun cevabını. Bu cevap Nularche AI penceresinde gösterilir.",
].join("\n");

/** Cevap dili: kullanıcının arayüz dili (eski isteklerde Türkçe). Not içeriğinin dili istek gerektirmedikçe değişmez. */
const replyLanguageRule = (req: AiRequest) =>
  `Write your final reply to the user in ${REPLY_LANGUAGE_NAME[req.language ?? "tr"]}. Do not change the language of the notes unless the request asks for it.`;

const WRITE_TOOLS = new Set(["update_node", "rearrange_node", "append_to_node", "create_node"]);
const READ_ONLY_RULE = "Bu istek yalnızca cevap istiyor: notları değiştirecek araçların yok; yalnızca oku ve cevap yaz.";

const summary = (m: NodeMeta) => ({ id: m.id, title: m.title, path: m.path, parent_node_id: m.parentNodeId });

async function runTool(store: NodeStore, activity: AiActivity, requestId: string, name: string, args: Record<string, any>): Promise<unknown> {
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  switch (name) {
    case "list_nodes": {
      let all = await store.list();
      if (args.parent_node_id === "root") all = all.filter((m) => m.archeId === m.id);
      else if (args.parent_node_id) all = all.filter((m) => m.parentNodeId === args.parent_node_id);
      return { nodes: all.slice(0, 200).map(summary), total: all.length };
    }
    case "read_node": {
      const n = await store.read(String(args.node));
      if (n.locked) return { ...summary(n), locked: true, body: "", note: "Bu not kilitli; içeriği okunamaz." };
      if (n.body.length > LONG_NOTE_CHARS)
        return { ...summary(n), revision: n.revision, tags: n.tags, long: true, note: "Uzun not: [n] numaralı bloklar olarak gösterildi; düzenlemek için rearrange_node kullan.", blocks: numbered(n.body) };
      return { ...summary(n), revision: n.revision, tags: n.tags, body: n.body };
    }
    case "rearrange_node": {
      const id = String(args.node);
      const items = (Array.isArray(args.items) ? args.items : []) as BlockItem[];
      const drop = (Array.isArray(args.drop) ? args.drop : []).map(Number);
      const current = await store.read(id);
      if (args.base_revision && args.base_revision !== current.revision)
        throw new NodeError("conflict", "Not bu arada değişti; read_node ile yeniden oku (blok numaraları değişmiş olabilir).");
      const built = rearrangeBlocks(splitBlocks(current.body), items, drop);
      if ("error" in built) throw new NodeError("invalid", built.error);
      const n = await activity.editWithSnapshot(store, id, () => store.update(id, { body: built.body, baseRevision: current.revision }), requestId);
      return { ...summary(n), revision: n.revision, blocks: splitBlocks(n.body).length };
    }
    case "search_nodes":
      return { results: await store.search(String(args.query ?? ""), 10) };
    case "update_node": {
      const n = await activity.editWithSnapshot(
        store,
        String(args.node),
        () => store.update(String(args.node), { body: str(args.body), title: str(args.title), baseRevision: str(args.base_revision) }),
        requestId,
      );
      return { ...summary(n), revision: n.revision };
    }
    case "append_to_node": {
      const n = await activity.editWithSnapshot(
        store,
        String(args.node),
        () => store.append(String(args.node), String(args.text ?? ""), str(args.base_revision)),
        requestId,
      );
      return { ...summary(n), revision: n.revision };
    }
    case "create_node": {
      const parent =
        args.parent_node_id === "root" ? null : args.parent_node_id === "shadow" || !args.parent_node_id ? SHADOW : String(args.parent_node_id);
      const n = await store.create({ title: String(args.title ?? "Adsız"), body: str(args.body), parentNodeId: parent });
      return { ...summary(n), revision: n.revision };
    }
  }
  throw new NodeError("invalid", `Bilinmeyen araç: ${name}`);
}

export interface AgentOptions {
  store: NodeStore;
  activity: AiActivity;
  requestId: string;
  apiKey: string;
  /** Deneme sırasına göre modeller; ilki tercih edilen (en son çalışan) modeldir. */
  models: string[];
  fetchImpl?: Fetch;
  /** Gemini API kökü (varsayılan GEMINI_API). */
  api?: string;
  maxSteps?: number;
  /** Yoğunluk hatasında aynı modeli yeniden denemeden önce bekleme (ms). */
  retryDelayMs?: number;
  /** İsteğin toplam üst süresi (ms); varsayılan REQUEST_DEADLINE_MS. */
  deadlineMs?: number;
  /** Kullanıcı isteği iptal ettiğinde tetiklenir. */
  signal?: AbortSignal;
}

export interface AgentResult {
  request: AiRequest;
  /** Cevabı veren model (başarısızsa null). */
  model: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function buildIntro(o: AgentOptions, req: AiRequest): Promise<string> {
  const intro: string[] = [`İstek: ${req.instruction}`];
  if (req.nodeId) {
    try {
      const n = await o.store.read(req.nodeId);
      if (n.body.length > LONG_NOTE_CHARS)
        intro.push(
          `İlgili Node: “${n.title}” (id: ${n.id}, revision: ${n.revision})`,
          `Bu not uzun (${n.body.length} karakter). Baştan yazma (update_node ile tüm içeriği gönderme); bloklar aşağıda [n] numaralarıyla. Gruplama, sıralama ya da başlık ekleme için rearrange_node, sona ekleme için append_to_node kullan. Blokların metnini değiştirmeden taşı.`,
          "İçerik (numaralı bloklar):",
          numbered(n.body),
        );
      else intro.push(`İlgili Node: “${n.title}” (id: ${n.id}, revision: ${n.revision})`, "İçerik:", n.body);
    } catch {
      intro.push(`İlgili Node id: ${req.nodeId} (okunamadı)`);
    }
  }
  if (req.selection) intro.push("Kullanıcının seçtiği metin (yalnızca bunun üzerinde çalış):", req.selection);
  return intro.join("\n\n");
}

/** Tek bir modelle konuşmayı yürütür; cevap metnini döndürür ya da AgentError fırlatır. */
async function converse(o: AgentOptions, req: AiRequest, model: string, fetchImpl: Fetch, signal: AbortSignal): Promise<string> {
  const contents: any[] = [{ role: "user", parts: [{ text: await buildIntro(o, req) }] }];
  for (let step = 0; step < (o.maxSteps ?? 12); step++) {
    const data = await call(fetchImpl, o.api ?? GEMINI_API, o.apiKey, `models/${encodeURIComponent(model)}:generateContent`, {
      systemInstruction: { parts: [{ text: `${SYSTEM}\n${replyLanguageRule(req)}${req.readOnly ? `\n${READ_ONLY_RULE}` : ""}` }] },
      contents,
      tools: [{ functionDeclarations: req.readOnly ? TOOLS.filter((t) => !WRITE_TOOLS.has(t.name)) : TOOLS }],
      generationConfig: { temperature: 0.3 },
    }, signal);
    const parts: any[] = data?.candidates?.[0]?.content?.parts ?? [];
    const calls = parts.filter((p) => p.functionCall);
    if (calls.length === 0) {
      const text = parts
        .filter((p) => typeof p.text === "string" && !p.thought)
        .map((p) => p.text)
        .join("")
        .trim();
      const reason = data?.candidates?.[0]?.finishReason;
      if (!text) throw reason ? new AgentError("busy", "no_reply", { detail: reason }) : new AgentError("busy", "empty_reply");
      return text;
    }
    // Model içeriğini olduğu gibi (thought signature'lar dahil) geçmişe ekle, sonra araç sonuçlarını gönder.
    contents.push({ role: "model", parts });
    const responses = [];
    for (const p of calls) {
      const { name, args, id } = p.functionCall;
      let response: unknown;
      try {
        if (req.readOnly && WRITE_TOOLS.has(name)) throw new NodeError("invalid", "Bu istek yalnızca cevap istiyor; notlar değiştirilemez.");
        response = { result: await runTool(o.store, o.activity, req.id, name, args ?? {}) };
      } catch (err) {
        response = { error: err instanceof NodeError ? `${err.code}: ${err.message}` : String((err as Error).message ?? err) };
      }
      responses.push({ functionResponse: { ...(id ? { id } : {}), name, response } });
    }
    contents.push({ role: "user", parts: responses });
  }
  throw new AgentError("other", "too_many_steps");
}

/**
 * İsteği Gemini ile işler. Bir model yoğun (5xx), kotası dolu (429) ya da kullanılamaz (404) ise önce kısa
 * bir bekleyişle bir kez daha dener, sonra sıradaki modele geçer; çalışan ilk modelin cevabını döndürür.
 * İstek her durumda tamamlanmış ya da başarısız olarak işaretlenir.
 */
export async function runGeminiAgent(o: AgentOptions): Promise<AgentResult> {
  const fetchImpl = o.fetchImpl ?? fetch;
  const req = await o.activity.takeRequest(o.requestId, AUTO_CLIENT);
  if (!req) throw new NodeError("not_found", "İstek bulunamadı");
  // Sırada beklerken iptal edilen ya da başka yerde tamamlanan istek işlenmez.
  if (req.status !== "received") return { request: req, model: null };
  const lang: ReplyLanguage = req.language ?? "tr";
  const tried: string[] = [];
  let lastKind: AgentError["kind"] | null = null;
  // Bütün denemelerin üst süresi: istekler sırayla işlendiği için takılan bir istek diğerlerini bekletmesin.
  const timeLimit = AbortSignal.timeout(o.deadlineMs ?? REQUEST_DEADLINE_MS);
  const deadline = o.signal ? AbortSignal.any([timeLimit, o.signal]) : timeLimit;
  try {
    if (!o.models.length) throw new AgentError("model", "no_models");
    for (const model of o.models) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const reply = await converse(o, req, model, fetchImpl, deadline);
          return { request: await o.activity.completeRequest(req.id, reply, false, `Gemini · ${model}`), model };
        } catch (err) {
          if (!(err instanceof AgentError)) throw err;
          if (err.kind === "auth" || err.kind === "other") throw err;
          if (o.signal?.aborted) throw new AgentError("other", "cancelled");
          if (deadline.aborted) throw new AgentError("timeout", "deadline", { min: Math.round((o.deadlineMs ?? REQUEST_DEADLINE_MS) / 60_000), tried: tried.join(", ") });
          lastKind = err.kind;
          // Yoğunluk ve bağlantı hatalarında aynı modeli bir kez daha dene; kota/model hatasında hemen sıradakine geç.
          if ((err.kind === "busy" || err.kind === "network") && attempt === 0) {
            await sleep(o.retryDelayMs ?? 2000);
            continue;
          }
          const why = err.kind === "quota" || err.kind === "model" || err.kind === "network" || err.kind === "timeout" ? err.kind : "busy";
          tried.push(`${model} (${TRIED_LABEL[why][lang]})`);
          break;
        }
      }
    }
    if (lastKind === "network") throw new AgentError("network", "offline");
    throw new AgentError(lastKind ?? "busy", lastKind === "quota" ? "all_quota" : "all_failed", { tried: tried.join(", ") });
  } catch (err) {
    // Hata, isteğin dilinde cevap olarak yazılır (dil verilmemiş eski isteklerde Türkçe).
    const message =
      err instanceof AgentError
        ? err.text(lang)
        : err instanceof NodeError
          ? err.message
          : `${lang === "en" ? "Unexpected error" : "Beklenmeyen hata"}: ${(err as Error).message ?? err}`;
    return { request: await o.activity.completeRequest(req.id, message, true), model: null };
  }
}

/**
 * Ses kaydını Gemini ile yazıya döker ya da özetler. Modeller sırayla denenir (yoğun/kota dolu modelden sonrakine geçilir).
 * Ses yalnızca kullanıcının kendi Gemini anahtarıyla Google'a gönderilir; Nularche başka bir yere göndermez.
 */
export async function transcribeAudio(o: {
  apiKey: string;
  models: string[];
  data: Uint8Array;
  mime: string;
  mode: "transcript" | "summary";
  language: "tr" | "en";
  fetchImpl?: Fetch;
  api?: string;
}): Promise<{ text: string; model: string }> {
  const fetchImpl = o.fetchImpl ?? fetch;
  const prompt =
    o.mode === "transcript"
      ? `Transcribe this audio recording verbatim in its original language. Use short paragraphs. If there are several speakers, prefix lines with "Speaker 1:", "Speaker 2:" etc. Reply with the transcript only, as plain Markdown.`
      : `Summarise this audio recording in ${REPLY_LANGUAGE_NAME[o.language]} as 3–7 Markdown bullet points, then list any action items as "- [ ]" checkboxes. Reply with the Markdown only.`;
  let last: AgentError | null = null;
  for (const model of o.models) {
    try {
      const data = await call(fetchImpl, o.api ?? GEMINI_API, o.apiKey, `models/${encodeURIComponent(model)}:generateContent`, {
        contents: [{ role: "user", parts: [{ inline_data: { mime_type: o.mime, data: Buffer.from(o.data).toString("base64") } }, { text: prompt }] }],
        generationConfig: { temperature: 0.2 },
      });
      const text = (data?.candidates?.[0]?.content?.parts ?? [])
        .filter((p: any) => typeof p.text === "string" && !p.thought)
        .map((p: any) => p.text)
        .join("")
        .trim();
      if (text) return { text, model };
      last = new AgentError("busy", "empty_reply");
    } catch (err) {
      if (!(err instanceof AgentError) || err.kind === "auth") throw err;
      last = err;
    }
  }
  throw last ?? new AgentError("model", "no_models");
}

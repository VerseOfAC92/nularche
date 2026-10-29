// Nularche AI otomatik modu: Nularche AI isteğini, kullanıcının kendi (ücretsiz) Gemini API anahtarıyla
// arka planda işler. Gemini, notları aşağıdaki araçlarla okur ve düzenler; her düzenlemeden önce geri
// alma kopyası alınır ve sonuç, isteğin cevabı olarak Nularche AI penceresinde görünür.

import { AiActivity, REPLY_LANGUAGE_NAME, type AiRequest } from "./ai-activity.ts";
import { NodeError, NodeStore, SHADOW, type NodeMeta } from "./node-store.ts";

// Testlerde sahte bir Gemini sunucusu kullanılabilir.
const API = process.env.NULARCHE_GEMINI_API || "https://generativelanguage.googleapis.com/v1beta";
export const AUTO_CLIENT = "nularche-auto (Gemini)";

type Fetch = typeof fetch;

export class AgentError extends Error {
  /** busy: geçici yoğunluk/sunucu hatası; quota: kota; model: model bulunamadı/desteklenmiyor. */
  readonly kind: "auth" | "quota" | "network" | "model" | "busy" | "other";
  constructor(kind: AgentError["kind"], message: string) {
    super(message);
    this.kind = kind;
  }
}

async function call(fetchImpl: Fetch, apiKey: string, path: string, body?: unknown): Promise<any> {
  let res: Response;
  try {
    res = await fetchImpl(`${API}/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "x-goog-api-key": apiKey, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    throw new AgentError("network", `Gemini'ye ulaşılamadı (${(err as Error).message}). İnternet bağlantınızı kontrol edin.`);
  }
  const data = await res.json().catch(() => ({}));
  if (res.ok) return data;
  const msg: string = data?.error?.message ?? res.statusText;
  if (res.status === 400 && /api key/i.test(msg))
    throw new AgentError("auth", "Gemini API anahtarı geçersiz. Ayarlar → Yapay zekâ bölümünden yeni bir anahtar girin.");
  if (res.status === 401 || res.status === 403)
    throw new AgentError(
      "auth",
      "Gemini API anahtarı reddedildi. Anahtarın doğru olduğunu ve Generative Language API'nin açık olduğunu kontrol edin.",
    );
  if (res.status === 429)
    throw new AgentError(
      "quota",
      "Gemini ücretsiz kotası şimdilik doldu. Bir süre sonra tekrar deneyin (günlük kota gece Pasifik saatiyle sıfırlanır).",
    );
  if (res.status === 404 || (res.status === 400 && /model|not supported|not found/i.test(msg)))
    throw new AgentError("model", `Model kullanılamıyor: ${msg}`);
  if (res.status >= 500) throw new AgentError("busy", `Geçici Gemini hatası (${res.status}): ${msg}`);
  throw new AgentError("other", `Gemini hatası (${res.status}): ${msg}`);
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
export async function checkGeminiKey(apiKey: string, fetchImpl: Fetch = fetch): Promise<{ model: string; models: string[] }> {
  const data = await call(fetchImpl, apiKey, "models?pageSize=200");
  const models = rankGeminiModels(data.models ?? []);
  if (!models.length) throw new AgentError("model", "Bu anahtarla kullanılabilen bir Gemini modeli bulunamadı.");
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
  "İçerik uydurma; teknik bilgileri değiştirme, yalnızca isteneni yap. Markdown biçimini koru ve düzgün kullan.",
  "İş bitince araç çağırmadan, kullanıcıya kısa ve net bir cevap yaz: ne yaptığını ya da sorunun cevabını. Bu cevap Nularche AI penceresinde gösterilir.",
].join("\n");

/** Cevap dili: kullanıcının arayüz dili (eski isteklerde Türkçe). Not içeriğinin dili istek gerektirmedikçe değişmez. */
const replyLanguageRule = (req: AiRequest) =>
  `Write your final reply to the user in ${REPLY_LANGUAGE_NAME[req.language ?? "tr"]}. Do not change the language of the notes unless the request asks for it.`;

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
      return { ...summary(n), revision: n.revision, tags: n.tags, body: n.body };
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
  maxSteps?: number;
  /** Yoğunluk hatasında aynı modeli yeniden denemeden önce bekleme (ms). */
  retryDelayMs?: number;
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
      intro.push(`İlgili Node: “${n.title}” (id: ${n.id}, revision: ${n.revision})`, "İçerik:", n.body);
    } catch {
      intro.push(`İlgili Node id: ${req.nodeId} (okunamadı)`);
    }
  }
  if (req.selection) intro.push("Kullanıcının seçtiği metin (yalnızca bunun üzerinde çalış):", req.selection);
  return intro.join("\n\n");
}

/** Tek bir modelle konuşmayı yürütür; cevap metnini döndürür ya da AgentError fırlatır. */
async function converse(o: AgentOptions, req: AiRequest, model: string, fetchImpl: Fetch): Promise<string> {
  const contents: any[] = [{ role: "user", parts: [{ text: await buildIntro(o, req) }] }];
  for (let step = 0; step < (o.maxSteps ?? 12); step++) {
    const data = await call(fetchImpl, o.apiKey, `models/${encodeURIComponent(model)}:generateContent`, {
      systemInstruction: { parts: [{ text: `${SYSTEM}\n${replyLanguageRule(req)}` }] },
      contents,
      tools: [{ functionDeclarations: TOOLS }],
      generationConfig: { temperature: 0.3 },
    });
    const parts: any[] = data?.candidates?.[0]?.content?.parts ?? [];
    const calls = parts.filter((p) => p.functionCall);
    if (calls.length === 0) {
      const text = parts
        .filter((p) => typeof p.text === "string" && !p.thought)
        .map((p) => p.text)
        .join("")
        .trim();
      const reason = data?.candidates?.[0]?.finishReason;
      if (!text) throw new AgentError("busy", reason ? `Cevap üretilmedi (${reason}).` : "Boş cevap döndü.");
      return text;
    }
    // Model içeriğini olduğu gibi (thought signature'lar dahil) geçmişe ekle, sonra araç sonuçlarını gönder.
    contents.push({ role: "model", parts });
    const responses = [];
    for (const p of calls) {
      const { name, args, id } = p.functionCall;
      let response: unknown;
      try {
        response = { result: await runTool(o.store, o.activity, req.id, name, args ?? {}) };
      } catch (err) {
        response = { error: err instanceof NodeError ? `${err.code}: ${err.message}` : String((err as Error).message ?? err) };
      }
      responses.push({ functionResponse: { ...(id ? { id } : {}), name, response } });
    }
    contents.push({ role: "user", parts: responses });
  }
  throw new AgentError("other", "İstek çok fazla adım gerektirdi; daha küçük parçalara bölmeyi deneyin.");
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
  const tried: string[] = [];
  let lastKind: AgentError["kind"] | null = null;
  try {
    if (!o.models.length) throw new AgentError("model", "Kullanılabilir Gemini modeli yok. Ayarlar'da anahtarı yeniden kaydedin.");
    for (const model of o.models) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const reply = await converse(o, req, model, fetchImpl);
          return { request: await o.activity.completeRequest(req.id, reply, false, `Gemini · ${model}`), model };
        } catch (err) {
          if (!(err instanceof AgentError)) throw err;
          if (err.kind === "auth" || err.kind === "other") throw err;
          lastKind = err.kind;
          // Yoğunluk ve bağlantı hatalarında aynı modeli bir kez daha dene; kota/model hatasında hemen sıradakine geç.
          if ((err.kind === "busy" || err.kind === "network") && attempt === 0) {
            await sleep(o.retryDelayMs ?? 2000);
            continue;
          }
          tried.push(
            `${model} (${err.kind === "quota" ? "kota dolu" : err.kind === "model" ? "kullanılamıyor" : err.kind === "network" ? "bağlantı yok" : "yoğun"})`,
          );
          break;
        }
      }
    }
    if (lastKind === "network") throw new AgentError("network", "Gemini'ye ulaşılamadı. İnternet bağlantınızı kontrol edip “Tekrar dene”ye basın.");
    throw new AgentError(
      lastKind ?? "busy",
      lastKind === "quota"
        ? `Tüm Gemini modellerinin ücretsiz kotası şimdilik dolu (${tried.join(", ")}). Bir süre sonra “Tekrar dene”ye basın; günlük kota gece Pasifik saatiyle sıfırlanır.`
        : `Tüm Gemini modelleri denendi ama şu an yanıt alınamadı: ${tried.join(", ")}. Birkaç dakika sonra “Tekrar dene”ye basın.`,
    );
  } catch (err) {
    const message = err instanceof AgentError || err instanceof NodeError ? err.message : `Beklenmeyen hata: ${(err as Error).message ?? err}`;
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
}): Promise<{ text: string; model: string }> {
  const fetchImpl = o.fetchImpl ?? fetch;
  const prompt =
    o.mode === "transcript"
      ? `Transcribe this audio recording verbatim in its original language. Use short paragraphs. If there are several speakers, prefix lines with "Speaker 1:", "Speaker 2:" etc. Reply with the transcript only, as plain Markdown.`
      : `Summarise this audio recording in ${REPLY_LANGUAGE_NAME[o.language]} as 3–7 Markdown bullet points, then list any action items as "- [ ]" checkboxes. Reply with the Markdown only.`;
  let last: AgentError | null = null;
  for (const model of o.models) {
    try {
      const data = await call(fetchImpl, o.apiKey, `models/${encodeURIComponent(model)}:generateContent`, {
        contents: [{ role: "user", parts: [{ inline_data: { mime_type: o.mime, data: Buffer.from(o.data).toString("base64") } }, { text: prompt }] }],
        generationConfig: { temperature: 0.2 },
      });
      const text = (data?.candidates?.[0]?.content?.parts ?? [])
        .filter((p: any) => typeof p.text === "string" && !p.thought)
        .map((p: any) => p.text)
        .join("")
        .trim();
      if (text) return { text, model };
      last = new AgentError("busy", "Boş cevap döndü.");
    } catch (err) {
      if (!(err instanceof AgentError) || err.kind === "auth") throw err;
      last = err;
    }
  }
  throw last ?? new AgentError("model", "Kullanılabilir Gemini modeli yok.");
}

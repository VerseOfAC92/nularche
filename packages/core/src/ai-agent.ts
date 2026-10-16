// Nularche AI otomatik modu: Nularche AI isteğini, kullanıcının kendi (ücretsiz) Gemini API anahtarıyla
// arka planda işler. Gemini, notları aşağıdaki araçlarla okur ve düzenler; her düzenlemeden önce geri
// alma kopyası alınır ve sonuç, isteğin cevabı olarak Nularche AI penceresinde görünür.

import { AiActivity, type AiRequest } from "./ai-activity.ts";
import { NodeError, NodeStore, SHADOW, type NodeMeta } from "./node-store.ts";

// Testlerde sahte bir Gemini sunucusu kullanılabilir.
const API = process.env.NULARCHE_GEMINI_API || "https://generativelanguage.googleapis.com/v1beta";
export const AUTO_CLIENT = "nularche-auto (Gemini)";

type Fetch = typeof fetch;

export class AgentError extends Error {
  readonly kind: "auth" | "quota" | "network" | "model" | "other";
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
  if (res.status === 404) throw new AgentError("model", `Gemini modeli bulunamadı: ${msg}`);
  throw new AgentError("other", `Gemini hatası (${res.status}): ${msg}`);
}

interface GeminiModel {
  name: string;
  supportedGenerationMethods?: string[];
}

/** Anahtarla kullanılabilen modeller arasından en uygun kararlı Flash modelini seçer. */
export function pickGeminiModel(models: GeminiModel[]): string | null {
  const usable = models
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""))
    .filter((n) => /^gemini-/.test(n) && !/(preview|exp|tts|image|live|embedding|audio|learnlm|thinking|computer)/.test(n));
  const version = (n: string) => Number(/gemini-(\d+(?:\.\d+)?)/.exec(n)?.[1] ?? 0);
  const rank = (n: string) => (/flash-lite/.test(n) ? 1 : /flash/.test(n) ? 2 : /pro/.test(n) ? 0 : -1);
  const best = usable.filter((n) => rank(n) >= 1 && !/-\d{3}$/.test(n)).sort((a, b) => rank(b) - rank(a) || version(b) - version(a));
  return best[0] ?? usable.sort((a, b) => version(b) - version(a))[0] ?? null;
}

/** Anahtarı doğrular ve kullanılacak modeli döndürür. */
export async function checkGeminiKey(apiKey: string, fetchImpl: Fetch = fetch): Promise<string> {
  const data = await call(fetchImpl, apiKey, "models?pageSize=200");
  const model = pickGeminiModel(data.models ?? []);
  if (!model) throw new AgentError("model", "Bu anahtarla kullanılabilen bir Gemini modeli bulunamadı.");
  return model;
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
  "İş bitince araç çağırmadan, kullanıcıya Türkçe, kısa ve net bir cevap yaz: ne yaptığını ya da sorunun cevabını. Bu cevap Nularche AI penceresinde gösterilir.",
].join("\n");

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
      return { ...summary(n), revision: n.revision, body: n.body };
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
  model: string;
  fetchImpl?: Fetch;
  maxSteps?: number;
}

/** İsteği Gemini ile işler; isteği tamamlanmış (ya da başarısız) olarak işaretleyip döndürür. */
export async function runGeminiAgent(o: AgentOptions): Promise<AiRequest> {
  const fetchImpl = o.fetchImpl ?? fetch;
  const req = await o.activity.takeRequest(o.requestId, AUTO_CLIENT);
  if (!req) throw new NodeError("not_found", "İstek bulunamadı");
  try {
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

    const contents: any[] = [{ role: "user", parts: [{ text: intro.join("\n\n") }] }];
    for (let step = 0; step < (o.maxSteps ?? 12); step++) {
      const data = await call(fetchImpl, o.apiKey, `models/${encodeURIComponent(o.model)}:generateContent`, {
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents,
        tools: [{ functionDeclarations: TOOLS }],
        generationConfig: { temperature: 0.3 },
      });
      const content = data?.candidates?.[0]?.content;
      const parts: any[] = content?.parts ?? [];
      const calls = parts.filter((p) => p.functionCall);
      if (calls.length === 0) {
        const text = parts
          .filter((p) => typeof p.text === "string" && !p.thought)
          .map((p) => p.text)
          .join("")
          .trim();
        const reason = data?.candidates?.[0]?.finishReason;
        if (!text) throw new AgentError("other", reason ? `Gemini cevap üretmedi (${reason}).` : "Gemini boş cevap döndürdü.");
        return o.activity.completeRequest(req.id, text);
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
  } catch (err) {
    const message = err instanceof AgentError || err instanceof NodeError ? err.message : `Beklenmeyen hata: ${(err as Error).message ?? err}`;
    return o.activity.completeRequest(req.id, message, true);
  }
}

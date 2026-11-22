// Nularche AI otomatik modu (Gemini API anahtarı): masaüstü (Electron IPC) ve web sürümü aynı kodu kullanır.
// Anahtarın nerede saklandığı (masaüstünde işletim sisteminin anahtar zinciri, web'de yalnızca sekmenin belleği) ve
// ayarların (model listesi, açık/kapalı) nerede tutulduğu platforma bırakılır. İstekler sırayla işlenir; her istek
// Origin'deki Nularche AI kaydına (AiActivity) cevabını yazar. Gemini aracı core/ai-agent.ts'tedir.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { AiActivity } from "../../core/src/ai-activity.ts";
import { AgentError, checkGeminiKey, runGeminiAgent, transcribeAudio } from "../../core/src/ai-agent.ts";
import { NodeStore } from "../../core/src/node-store.ts";

export interface AutoSettings {
  /** Otomatik mod: istekler kullanıcının Gemini API anahtarıyla arka planda işlenir. */
  autoMode?: boolean;
  /** En son cevap veren (tercih edilen) model. */
  geminiModel?: string;
  /** Anahtarla kullanılabilen modeller, deneme sırasıyla; ne zaman alındığı. */
  geminiModels?: string[];
  geminiModelsAt?: number;
}

export type AutoText = "ai.emptyKey" | "ai.noEncryption" | "ai.noOrigin" | "ai.keyMissingReply" | "ai.noKey" | "ai.badRequest" | "ai.audioTooLarge";

export interface AutoServiceContext {
  originRoot(): string | null;
  /** Anahtarın saklandığı yer; `available` false ise (ör. anahtar zinciri yok) anahtar kaydedilmez. */
  key: { read(): Promise<string | null>; write(key: string): Promise<void>; remove(): Promise<void>; available(): boolean };
  settings(): AutoSettings;
  save(patch: AutoSettings): Promise<void>;
  text(key: AutoText): string;
  /** Arayüzün dili: hata iletileri bu dilde döner. */
  lang(): "tr" | "en";
  /** Gemini API kökü (testlerde sahte sunucu). */
  api?: string;
}

/** Ses kaydı uzantıları ve Gemini'ye bildirilen türleri. */
const AUDIO_MIME: Record<string, string> = {
  ".webm": "audio/webm",
  ".m4a": "audio/mp4",
  ".mp4": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
};

export type AutoService = ReturnType<typeof createAutoService>;

export function createAutoService(ctx: AutoServiceContext) {
  /** Hata iletisi arayüzün dilinde (Gemini hataları koduyla çevrilir). */
  const describe = (err: unknown) => (err instanceof AgentError ? err.text(ctx.lang()) : err instanceof Error ? err.message : String(err));
  /** Model listesi: önce en son çalışan model, sonra diğerleri; liste eski ya da yoksa yenilenir. */
  async function modelOrder(key: string): Promise<string[]> {
    const st = ctx.settings();
    let models = st.geminiModels ?? [];
    if (!models.length || Date.now() - (st.geminiModelsAt ?? 0) > 24 * 3600_000) {
      try {
        models = (await checkGeminiKey(key, fetch, ctx.api)).models;
        await ctx.save({ geminiModels: models, geminiModelsAt: Date.now() });
      } catch {
        // Liste alınamazsa elimizdekiyle devam edilir.
      }
    }
    const preferred = st.geminiModel;
    return preferred ? [preferred, ...models.filter((m) => m !== preferred)] : models;
  }

  // İstekler sırayla işlenir (aynı Node'a eşzamanlı düzenleme olmasın).
  let queue: Promise<unknown> = Promise.resolve();
  /** İşlenmekte olan isteklerin iptal tetikleyicileri. */
  const running = new Map<string, AbortController>();

  async function processRequest(requestId: string): Promise<{ ok: boolean; status?: string; error?: string }> {
    const root = ctx.originRoot();
    if (!root) return { ok: false, error: ctx.text("ai.noOrigin") };
    const activity = new AiActivity(root);
    const key = await ctx.key.read();
    if (!key) {
      // İstek askıda kalmasın: ne yapılması gerektiğini cevap olarak yaz.
      await activity.completeRequest(requestId, ctx.text("ai.keyMissingReply"), true).catch(() => undefined);
      return { ok: false, error: ctx.text("ai.noKey") };
    }
    const abort = new AbortController();
    running.set(requestId, abort);
    try {
      const { request, model } = await runGeminiAgent({
        store: new NodeStore(root),
        activity,
        requestId,
        apiKey: key,
        models: await modelOrder(key),
        signal: abort.signal,
        api: ctx.api,
      });
      if (model && model !== ctx.settings().geminiModel) await ctx.save({ geminiModel: model });
      return { ok: request.status === "done", status: request.status };
    } catch (err) {
      await activity.completeRequest(requestId, `${ctx.lang() === "en" ? "Unexpected error" : "Beklenmeyen hata"}: ${describe(err)}`, true).catch(() => undefined);
      return { ok: false, error: describe(err) };
    } finally {
      running.delete(requestId);
    }
  }

  const enqueue = (requestId: string) => {
    const run = queue.then(() => processRequest(requestId));
    queue = run.catch(() => undefined);
    return run;
  };

  return {
    async status() {
      return { enabled: !!ctx.settings().autoMode, hasKey: !!(await ctx.key.read()), model: ctx.settings().geminiModel ?? null, encryption: ctx.key.available() };
    },

    /** Anahtarı Gemini'de doğrular, saklar ve otomatik modu açar. */
    async setKey(key: unknown): Promise<{ ok: boolean; model?: string; error?: string }> {
      if (typeof key !== "string" || !key.trim()) return { ok: false, error: ctx.text("ai.emptyKey") };
      if (!ctx.key.available()) return { ok: false, error: ctx.text("ai.noEncryption") };
      try {
        const { model, models } = await checkGeminiKey(key.trim(), fetch, ctx.api);
        await ctx.key.write(key.trim());
        await ctx.save({ geminiModel: model, geminiModels: models, geminiModelsAt: Date.now(), autoMode: true });
        return { ok: true, model };
      } catch (err) {
        return { ok: false, error: describe(err) };
      }
    },

    async clear(): Promise<void> {
      await ctx.key.remove();
      await ctx.save({ autoMode: false, geminiModel: undefined });
    },

    async enable(enabled: unknown): Promise<void> {
      await ctx.save({ autoMode: !!enabled });
    },

    async run(requestId: unknown) {
      if (typeof requestId !== "string") return { ok: false, error: ctx.text("ai.badRequest") };
      return enqueue(requestId);
    },

    /** İptal: önce istek iptal olarak işaretlenir (sonradan gelen cevap yazılmaz), sonra süren Gemini çağrısı kesilir. */
    async cancel(requestId: unknown, reply: unknown): Promise<{ ok: boolean; error?: string }> {
      const root = ctx.originRoot();
      if (typeof requestId !== "string" || !root) return { ok: false, error: ctx.text("ai.badRequest") };
      try {
        await new AiActivity(root).cancelRequest(requestId, typeof reply === "string" && reply ? reply : "—");
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
      running.get(requestId)?.abort();
      return { ok: true };
    },

    async retry(requestId: unknown) {
      const root = ctx.originRoot();
      if (typeof requestId !== "string" || !root) return { ok: false, error: ctx.text("ai.badRequest") };
      try {
        await new AiActivity(root).retryRequest(requestId);
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
      return enqueue(requestId);
    },

    /** Ses kaydını yazıya dökme / özetleme (otomatik mod anahtarıyla, yalnızca kullanıcı isteyince). */
    async transcribe(rel: unknown, mode: unknown, language: unknown): Promise<{ ok: boolean; text?: string; error?: string; needsAuto?: boolean }> {
      const root = ctx.originRoot();
      if (!root || typeof rel !== "string") return { ok: false, error: ctx.text("ai.badRequest") };
      const key = await ctx.key.read();
      if (!key || !ctx.settings().autoMode) return { ok: false, needsAuto: true };
      let file: string;
      try {
        file = new NodeStore(root).abs(rel);
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
      const mime = AUDIO_MIME[path.extname(file).toLowerCase()];
      if (!mime) return { ok: false, error: ctx.text("ai.badRequest") };
      try {
        const data = new Uint8Array(await readFile(file));
        if (data.length > 18 * 1024 * 1024) return { ok: false, error: ctx.text("ai.audioTooLarge") };
        const { text, model } = await transcribeAudio({
          apiKey: key,
          models: await modelOrder(key),
          data,
          mime,
          mode: mode === "summary" ? "summary" : "transcript",
          language: language === "en" ? "en" : "tr",
          api: ctx.api,
        });
        if (model !== ctx.settings().geminiModel) await ctx.save({ geminiModel: model });
        return { ok: true, text };
      } catch (err) {
        return { ok: false, error: describe(err) };
      }
    },
  };
}

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { AiActivity, checkGeminiKey, NodeStore, pickGeminiModel, rankGeminiModels, runGeminiAgent } from "../src/index.ts";

let dir: string;
let store: NodeStore;
let ai: AiActivity;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "nlc-agent-"));
  store = new NodeStore(dir);
  ai = new AiActivity(dir);
});
afterEach(async () => rm(dir, { recursive: true, force: true }));

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("en uygun kararlı Flash modeli seçilir", () => {
  const m = (name: string) => ({ name: `models/${name}`, supportedGenerationMethods: ["generateContent"] });
  assert.equal(
    pickGeminiModel([
      m("gemini-3.6-flash"),
      m("gemini-3.8-flash"),
      m("gemini-3.5-flash-lite"),
      m("gemini-3.9-flash-preview"),
      m("gemini-3.8-flash-tts"),
      m("text-embedding-004"),
    ]),
    "gemini-3.8-flash",
  );
  assert.equal(pickGeminiModel([m("gemini-3.5-flash-lite")]), "gemini-3.5-flash-lite");
  assert.deepEqual(
    rankGeminiModels([m("gemini-3.1-flash-lite"), m("gemini-3.6-flash"), m("gemini-3.8-flash"), m("gemini-3.5-flash-lite"), m("gemini-2.5-pro")]),
    ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-pro"],
  );
  assert.equal(pickGeminiModel([{ name: "models/gemini-3.8-flash", supportedGenerationMethods: ["embedContent"] }]), null);
});

test("anahtar doğrulama hataları anlaşılır mesaja çevrilir", async () => {
  const bad = async () => json(400, { error: { message: "API key not valid. Please pass a valid API key." } });
  await assert.rejects(checkGeminiKey("x", bad as typeof fetch), /geçersiz/);
  const ok = async () => json(200, { models: [{ name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent"] }] });
  assert.deepEqual(await checkGeminiKey("x", ok as typeof fetch), { model: "gemini-3.8-flash", models: ["gemini-3.8-flash"] });
});

test("aracı Node'u araçlarla düzenler, cevabı yazar ve değişiklik geri alınabilir", async () => {
  const node = await store.create({ title: "Notlar", body: "dağnık metin" });
  const req = await ai.createRequest({
    provider: "gemini",
    label: "Düzelt",
    instruction: "Yazım hatalarını düzelt",
    nodeId: node.id,
    nodeTitle: node.title,
  });
  const sent: any[] = [];
  let step = 0;
  const fake = async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    sent.push({ url, body, key: (init.headers as Record<string, string>)["x-goog-api-key"] });
    step++;
    if (step === 1) {
      assert.match(body.contents[0].parts[0].text, /dağnık metin/);
      assert.match(body.contents[0].parts[0].text, new RegExp(node.revision));
      return json(200, {
        candidates: [
          {
            content: {
              role: "model",
              parts: [
                {
                  functionCall: { id: "c1", name: "update_node", args: { node: node.id, body: "dağınık metin", base_revision: node.revision } },
                  thoughtSignature: "imza",
                },
              ],
            },
          },
        ],
      });
    }
    // Model içeriği (imza dahil) ve araç sonucu geri gönderilmeli.
    assert.equal(body.contents[1].parts[0].thoughtSignature, "imza");
    assert.equal(body.contents[2].parts[0].functionResponse.id, "c1");
    assert.ok(body.contents[2].parts[0].functionResponse.response.result.revision);
    return json(200, {
      candidates: [{ content: { role: "model", parts: [{ text: "“dağnık” → “dağınık” olarak düzeltildi." }] }, finishReason: "STOP" }],
    });
  };
  const { request: done, model } = await runGeminiAgent({
    store,
    activity: ai,
    requestId: req.id,
    apiKey: "anahtar",
    models: ["gemini-3.8-flash"],
    fetchImpl: fake as typeof fetch,
  });
  assert.equal(model, "gemini-3.8-flash");
  assert.equal(done.status, "done");
  assert.match(done.reply!, /dağınık/);
  assert.equal(done.changes.length, 1);
  assert.equal(done.client, "Gemini · gemini-3.8-flash");
  assert.equal(sent[0].key, "anahtar");
  assert.match(sent[0].url, /models\/gemini-3\.8-flash:generateContent$/);
  assert.equal((await store.read(node.id)).body.trim(), "dağınık metin");
  await ai.undo(store, req.id);
  assert.equal((await store.read(node.id)).body.trim(), "dağnık metin");
});

test("yoğun model bir kez yeniden denenir, sonra eski modele geçilir ve cevap döner", async () => {
  const req = await ai.createRequest({ provider: "gemini", label: "x", instruction: "Merhaba de" });
  const calls: string[] = [];
  const fake = async (url: string) => {
    const model = /models\/([^:]+):/.exec(url)![1];
    calls.push(model);
    if (model === "gemini-3.8-flash") return json(503, { error: { message: "This model is currently experiencing high demand." } });
    if (model === "gemini-3.6-flash") return json(429, { error: { message: "Resource exhausted" } });
    return json(200, { candidates: [{ content: { role: "model", parts: [{ text: "Merhaba!" }] } }] });
  };
  const { request, model } = await runGeminiAgent({
    store,
    activity: ai,
    requestId: req.id,
    apiKey: "k",
    models: ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"],
    fetchImpl: fake as typeof fetch,
    retryDelayMs: 1,
  });
  assert.deepEqual(calls, ["gemini-3.8-flash", "gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"]);
  assert.equal(model, "gemini-3.5-flash-lite");
  assert.equal(request.status, "done");
  assert.equal(request.reply, "Merhaba!");
  assert.equal(request.client, "Gemini · gemini-3.5-flash-lite");
});

test("tüm modeller başarısızsa anlaşılır mesajla başarısız olur; tekrar denenebilir", async () => {
  const req = await ai.createRequest({ provider: "gemini", label: "x", instruction: "x" });
  const quota = async () => json(429, { error: { message: "Resource exhausted" } });
  const { request } = await runGeminiAgent({
    store,
    activity: ai,
    requestId: req.id,
    apiKey: "k",
    models: ["a", "b"],
    fetchImpl: quota as typeof fetch,
    retryDelayMs: 1,
  });
  assert.equal(request.status, "failed");
  assert.match(request.reply!, /kota/);
  assert.match(request.reply!, /a \(kota dolu\), b \(kota dolu\)/);
  const again = await ai.retryRequest(req.id);
  assert.equal(again.status, "pending");
  const ok = async () => json(200, { candidates: [{ content: { parts: [{ text: "tamam" }] } }] });
  assert.equal(
    (await runGeminiAgent({ store, activity: ai, requestId: req.id, apiKey: "k", models: ["a"], fetchImpl: ok as typeof fetch })).request.status,
    "done",
  );
});

test("geçersiz anahtarda diğer modeller denenmez", async () => {
  const req = await ai.createRequest({ provider: "gemini", label: "x", instruction: "x" });
  let n = 0;
  const bad = async () => (n++, json(400, { error: { message: "API key not valid." } }));
  const { request } = await runGeminiAgent({
    store,
    activity: ai,
    requestId: req.id,
    apiKey: "k",
    models: ["a", "b", "c"],
    fetchImpl: bad as typeof fetch,
  });
  assert.equal(n, 1);
  assert.match(request.reply!, /anahtar/);
});

test("cevap dili isteğin diline göre modele bildirilir; dil verilmemiş eski isteklerde Türkçe kalır", async () => {
  const systems: string[] = [];
  const fake = async (_url: string, init?: RequestInit) => {
    systems.push(JSON.parse(String(init?.body)).systemInstruction.parts[0].text);
    return json(200, { candidates: [{ content: { role: "model", parts: [{ text: "OK" }] } }] });
  };
  for (const language of ["en", undefined] as const) {
    const req = await ai.createRequest({ provider: "gemini", label: "x", instruction: "Say hi", language });
    assert.equal(req.language, language);
    await runGeminiAgent({ store, activity: ai, requestId: req.id, apiKey: "k", models: ["m"], fetchImpl: fake as typeof fetch });
  }
  assert.match(systems[0], /reply to the user in English/);
  assert.match(systems[1], /reply to the user in Turkish/);
});

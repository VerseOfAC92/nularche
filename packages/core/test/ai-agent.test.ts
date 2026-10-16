import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { AiActivity, checkGeminiKey, NodeStore, pickGeminiModel, runGeminiAgent } from "../src/index.ts";

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
  assert.equal(pickGeminiModel([{ name: "models/gemini-3.8-flash", supportedGenerationMethods: ["embedContent"] }]), null);
});

test("anahtar doğrulama hataları anlaşılır mesaja çevrilir", async () => {
  const bad = async () => json(400, { error: { message: "API key not valid. Please pass a valid API key." } });
  await assert.rejects(checkGeminiKey("x", bad as typeof fetch), /geçersiz/);
  const ok = async () => json(200, { models: [{ name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent"] }] });
  assert.equal(await checkGeminiKey("x", ok as typeof fetch), "gemini-3.8-flash");
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
  const done = await runGeminiAgent({
    store,
    activity: ai,
    requestId: req.id,
    apiKey: "anahtar",
    model: "gemini-3.8-flash",
    fetchImpl: fake as typeof fetch,
  });
  assert.equal(done.status, "done");
  assert.match(done.reply!, /dağınık/);
  assert.equal(done.changes.length, 1);
  assert.equal(done.client, "nularche-auto (Gemini)");
  assert.equal(sent[0].key, "anahtar");
  assert.match(sent[0].url, /models\/gemini-3\.8-flash:generateContent$/);
  assert.equal((await store.read(node.id)).body.trim(), "dağınık metin");
  await ai.undo(store, req.id);
  assert.equal((await store.read(node.id)).body.trim(), "dağnık metin");
});

test("kota hatasında istek başarısız olarak işaretlenir", async () => {
  const req = await ai.createRequest({ provider: "gemini", label: "x", instruction: "x" });
  const quota = async () => json(429, { error: { message: "Resource exhausted" } });
  const done = await runGeminiAgent({ store, activity: ai, requestId: req.id, apiKey: "k", model: "m", fetchImpl: quota as typeof fetch });
  assert.equal(done.status, "failed");
  assert.match(done.reply!, /kota/);
});

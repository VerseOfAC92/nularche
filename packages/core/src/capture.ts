// Akıllı yakalama (2.0): Shadow'a yazılan işaretli notlar hedef sayfaya yönlendirilir.
//   ::mosaic @roman Liman sahnesi    → "roman" Mosaic'ine yeni kart   (eş anlamlı: ::card, ::kart)
//   ::axis @roman Üçüncü perde       → Axis'e yeni satır               (::outline, ::taslak)
//   ::lore @dunya Ada Lovelace       → Lore'a yeni girdi (sonraki satırlar girdinin metni; ::wiki)
//   ::task @plan Editöre yaz         → nota yapılacak (- [ ] …)
// @kısaltma, kurallarda (Ayarlar → Akıllı yakalama) bir sayfaya eşlenir; eşleşme yoksa başlığı kısaltmaya uyan uygun
// sayfa, o da yoksa türün varsayılan hedefi kullanılır. Hedef bulunamazsa not Shadow'da kalır ve sonra "Taşı"
// (promote) ile gönderilebilir. Kurallar Origin'in `.nularche/capture.json` dosyasındadır.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { NodeError, type NodeDoc, type NodeMeta, type NodeStore } from "./node-store.ts";
import { isLockedBody } from "./note-text.ts";
import { newWritingId, parseWriting, serializeWriting } from "./writing.ts";

export type CaptureKind = "card" | "outline" | "wiki" | "task";
export const CAPTURE_KINDS: readonly CaptureKind[] = ["card", "outline", "wiki", "task"];

export interface CaptureRule {
  handle: string;
  kind: CaptureKind;
  /** Hedef sayfanın id'si. */
  target: string;
}

export interface CaptureConfig {
  /** Kapalıyken işaretli notlar da Shadow'da bekler (yalnızca elle taşınır). */
  autoRoute: boolean;
  rules: CaptureRule[];
  defaults: Partial<Record<CaptureKind, string>>;
}

export interface ParsedCapture {
  kind: CaptureKind;
  handle?: string;
  title: string;
  rest: string;
}

export interface CaptureResult {
  kind: CaptureKind;
  targetId: string;
  targetTitle: string;
  /** Wiki girdisi oluşturulduysa onun id'si. */
  createdId?: string;
}

const FILE = path.join(".nularche", "capture.json");
const isKind = (v: unknown): v is CaptureKind => typeof v === "string" && (CAPTURE_KINDS as readonly string[]).includes(v);
/** Kısaltma karşılaştırma anahtarı: büyük/küçük harf ve aksan duyarsız (`@bolum-bir` = "Bölüm Bir"). */
const handleKey = (h: string) =>
  h
    .trim()
    .replace(/^@/, "")
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[\s_]+/g, "-");

export async function readCaptureConfig(root: string): Promise<CaptureConfig> {
  try {
    const raw = JSON.parse(await readFile(path.join(root, FILE), "utf8")) as Record<string, unknown>;
    return normalizeConfig(raw);
  } catch {
    return { autoRoute: true, rules: [], defaults: {} };
  }
}

function normalizeConfig(raw: Record<string, unknown>): CaptureConfig {
  const rules = (Array.isArray(raw.rules) ? raw.rules : [])
    .map((r) => (r && typeof r === "object" ? (r as Record<string, unknown>) : {}))
    .filter((r) => typeof r.handle === "string" && handleKey(r.handle) && isKind(r.kind) && typeof r.target === "string" && r.target)
    .map((r) => ({ handle: handleKey(String(r.handle)).slice(0, 40), kind: r.kind as CaptureKind, target: String(r.target) }))
    .slice(0, 200);
  const d = raw.defaults && typeof raw.defaults === "object" ? (raw.defaults as Record<string, unknown>) : {};
  const defaults: Partial<Record<CaptureKind, string>> = {};
  for (const k of CAPTURE_KINDS) if (typeof d[k] === "string" && d[k]) defaults[k] = String(d[k]);
  return { autoRoute: raw.autoRoute !== false, rules, defaults };
}

export async function writeCaptureConfig(root: string, input: Record<string, unknown>): Promise<CaptureConfig> {
  const config = normalizeConfig(input);
  const file = path.join(root, FILE);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`);
  await rename(tmp, file);
  return config;
}

/** `::tür @kısaltma başlık` ile başlayan metni ayrıştırır; işaretsizse null. */
export function parseCapture(text: string): ParsedCapture | null {
  const m = /^\s*::(mosaic|card|kart|axis|outline|taslak|lore|wiki|task|görev|gorev)\b[ \t]*(?:@([\p{L}\p{N}_-]+))?[ \t]*(.*)(?:\n([\s\S]*))?$/iu.exec(text);
  if (!m) return null;
  const alias: Record<string, CaptureKind> = { mosaic: "card", kart: "card", axis: "outline", taslak: "outline", lore: "wiki", görev: "task", gorev: "task" };
  const word = m[1].toLocaleLowerCase("tr");
  const kind = (alias[word] ?? word) as CaptureKind;
  const title = m[3].trim();
  const rest = (m[4] ?? "").trim();
  if (!title && !rest) return null;
  return { kind, ...(m[2] ? { handle: handleKey(m[2]) } : {}), title: title || rest.split("\n")[0].trim(), rest: title ? rest : rest.split("\n").slice(1).join("\n").trim() };
}

/** Türün kabul ettiği hedef sayfa mı? */
function accepts(kind: CaptureKind, n: NodeMeta, all: NodeMeta[]): boolean {
  if (n.locked) return false;
  if (kind === "card") return n.layoutMode === "cards";
  if (kind === "outline") return n.layoutMode === "outline";
  if (kind === "wiki") {
    if (n.layoutMode === "wiki") return true;
    // Bir wiki'nin içindeki kategori ya da girdi de hedef olabilir (yeni girdi onun altına eklenir).
    for (let p = all.find((x) => x.id === n.parentNodeId); p; p = all.find((x) => x.id === p!.parentNodeId)) if (p.layoutMode === "wiki") return true;
    return false;
  }
  return n.layoutMode === "stream" && !n.database;
}

/** Yakalamanın hedefini bulur: kural, başlığı kısaltmaya uyan sayfa, sonra varsayılan. */
export function resolveCaptureTarget(config: CaptureConfig, parsed: ParsedCapture, all: NodeMeta[]): NodeMeta | null {
  const ok = (id: string | undefined) => {
    const n = id ? all.find((x) => x.id === id) : undefined;
    return n && accepts(parsed.kind, n, all) ? n : null;
  };
  if (parsed.handle) {
    const rule = config.rules.find((r) => r.kind === parsed.kind && r.handle === parsed.handle) ?? config.rules.find((r) => r.handle === parsed.handle);
    const byRule = rule ? ok(rule.target) : null;
    if (byRule) return byRule;
    const byTitle = all.find((n) => handleKey(n.title) === parsed.handle && accepts(parsed.kind, n, all));
    if (byTitle) return byTitle;
  }
  return ok(config.defaults[parsed.kind]);
}

/** Yakalamayı hedef sayfaya uygular. */
export async function applyCapture(store: NodeStore, parsed: ParsedCapture, targetRef: string): Promise<CaptureResult> {
  const all = await store.list();
  const target = await store.read(targetRef);
  if (!accepts(parsed.kind, target, all) || isLockedBody(target.body)) throw new NodeError("invalid", "Bu sayfa bu tür bir yakalamayı kabul etmiyor.");
  const base = { kind: parsed.kind, targetId: target.id, targetTitle: target.title };
  if (parsed.kind === "card") {
    const { data, broken } = parseWriting("cards", target.body);
    if (broken) throw new NodeError("invalid", "Kart destesinin verisi bozuk; önce düzeltin.");
    data.groups[0].cards.push({ id: newWritingId(), title: parsed.title, text: parsed.rest });
    await store.update(target.id, { body: serializeWriting("cards", target.body, data), baseRevision: target.revision });
    return base;
  }
  if (parsed.kind === "outline") {
    const { data, broken } = parseWriting("outline", target.body);
    if (broken) throw new NodeError("invalid", "Taslağın verisi bozuk; önce düzeltin.");
    data.rows.push({ id: newWritingId(), text: parsed.title, depth: 0, ...(parsed.rest ? { notes: parsed.rest } : {}) });
    await store.update(target.id, { body: serializeWriting("outline", target.body, data), baseRevision: target.revision });
    return base;
  }
  if (parsed.kind === "wiki") {
    const entry = await store.create({ title: parsed.title, parentNodeId: target.id, body: parsed.rest ? `${parsed.rest}\n` : "" });
    if (target.wikiFields?.length) await store.update(entry.id, { properties: Object.fromEntries(target.wikiFields.map((f) => [f, ""])) });
    return { ...base, createdId: entry.id };
  }
  const line = `- [ ] ${parsed.title}${parsed.rest ? `\n${parsed.rest.replace(/^/gm, "  ")}` : ""}`;
  await store.append(target.id, line, target.revision);
  return base;
}

/**
 * Hızlı yakalama: işaretli metin hedefine yönlendirilir (otomatik yönlendirme açıksa ve hedef bulunursa),
 * değilse Shadow'a yeni not olarak yazılır.
 */
export async function captureText(store: NodeStore, text: string, title?: string): Promise<{ routed: CaptureResult } | { node: NodeDoc }> {
  const parsed = parseCapture(text);
  if (parsed) {
    const config = await readCaptureConfig(store.root);
    const target = config.autoRoute ? resolveCaptureTarget(config, parsed, await store.list()) : null;
    if (target) return { routed: await applyCapture(store, parsed, target.id) };
  }
  return { node: await store.capture(text, title) };
}

/**
 * Shadow'daki bir notu hedefe taşır ("Taşı"/promote): `kind` verilmezse notun kendi `::` işareti kullanılır.
 * Not hedefe eklendikten sonra çöpe taşınır (geri getirilebilir).
 */
export async function promoteCapture(store: NodeStore, ref: string, input: { kind?: CaptureKind; target?: string } = {}): Promise<CaptureResult> {
  const note = await store.read(ref);
  if (note.archeId !== null) throw new NodeError("invalid", "Yalnızca Shadow'daki notlar taşınabilir.");
  if (note.locked || isLockedBody(note.body)) throw new NodeError("invalid", "Kilitli not taşınamaz.");
  const own = parseCapture(note.body);
  const kind = input.kind ?? own?.kind;
  if (!kind || !isKind(kind)) throw new NodeError("invalid", "Yakalama türü seçilmeli.");
  const parsed: ParsedCapture =
    own && own.kind === kind ? own : { kind, title: note.title, rest: note.body.replace(/^\s*#+\s*.*\n?/, (m) => (m.includes(note.title) ? "" : m)).trim() };
  let targetId = input.target;
  if (!targetId) {
    const config = await readCaptureConfig(store.root);
    targetId = resolveCaptureTarget(config, parsed, await store.list())?.id;
  }
  if (!targetId) throw new NodeError("not_found", "Hedef sayfa bulunamadı; bir hedef seçin.");
  const result = await applyCapture(store, parsed, targetId);
  await store.trash(note.id);
  return result;
}


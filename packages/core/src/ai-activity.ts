// Nularche AI etkinlik kaydı: kullanıcının Nularche AI penceresinden verdiği istekler, bağlanan
// yapay zekâ araçları ve yapay zekânın yaptığı değişikliklerin geri alınabilir anlık kopyaları.
// Veriler Origin içindeki gizli `.nularche/ai/` klasöründe tutulur (Node taramasına girmez) ve
// hem uygulama sunucusu hem de AI aracının başlattığı MCP sunucusu tarafından okunup yazılır.

import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProviderId } from "./ai-clients.ts";
import { parseNodeFile } from "./node-file.ts";
import { NodeError, type NodeDoc, type NodeStore } from "./node-store.ts";

export const AI_DIR = ".nularche/ai";
/** Node başına saklanan en fazla anlık kopya. */
const MAX_SNAPSHOTS_PER_NODE = 30;
/** Bir isteğin, AI tarafından alındıktan sonra değişiklikleri üstlenebileceği süre. */
const ACTIVE_WINDOW_MS = 30 * 60 * 1000;

export interface AiClientRecord {
  /** MCP istemcisinin kendini tanıttığı ad (ör. "claude-ai", "codex-mcp-client"). */
  name: string;
  version: string;
  provider: ProviderId | null;
  firstSeen: number;
  lastSeen: number;
}

export interface AiChange {
  nodeId: string;
  title: string;
  /** `.nularche/ai/history/` altındaki anlık kopya (değişiklikten önceki tam dosya). */
  snapshot: string;
  beforeRevision: string;
  afterRevision: string;
  at: number;
}

export type AiRequestStatus = "pending" | "received" | "done" | "failed";

export interface AiRequest {
  id: string;
  createdAt: number;
  provider: ProviderId | null;
  /** Kullanıcının seçtiği eylemin kısa adı (ör. "Özetle"). */
  label: string;
  instruction: string;
  nodeId?: string;
  nodeTitle?: string;
  /** Kullanıcının seçtiği metin (varsa). */
  selection?: string;
  status: AiRequestStatus;
  receivedAt?: number;
  completedAt?: number;
  client?: string;
  reply?: string;
  changes: AiChange[];
  undoneAt?: number;
}

/** MCP istemci adından sağlayıcıyı tahmin eder. */
export function providerFromClient(name: string): ProviderId | null {
  const n = name.toLowerCase();
  if (/claude|anthropic|local-agent-mode/.test(n)) return "claude";
  if (/codex|openai|chatgpt/.test(n)) return "chatgpt";
  if (/gemini|antigravity|agy|google/.test(n)) return "gemini";
  return null;
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(tmp, file);
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export class AiActivity {
  readonly dir: string;

  constructor(originRoot: string) {
    this.dir = path.join(originRoot, AI_DIR);
  }

  private requestFile(id: string): string {
    if (!/^[\w-]{1,64}$/.test(id)) throw new NodeError("invalid", `Geçersiz istek kimliği: ${id}`);
    return path.join(this.dir, "requests", `${id}.json`);
  }

  // --- Bağlanan istemciler ---------------------------------------------------------------------

  async recordClient(name: string, version = ""): Promise<AiClientRecord> {
    const file = path.join(this.dir, "clients.json");
    const all = (await readJson<Record<string, AiClientRecord>>(file)) ?? {};
    const now = Date.now();
    const rec: AiClientRecord = { name, version, provider: providerFromClient(name), firstSeen: all[name]?.firstSeen ?? now, lastSeen: now };
    all[name] = rec;
    await writeJsonAtomic(file, all);
    return rec;
  }

  async clients(): Promise<AiClientRecord[]> {
    const all = (await readJson<Record<string, AiClientRecord>>(path.join(this.dir, "clients.json"))) ?? {};
    return Object.values(all).sort((a, b) => b.lastSeen - a.lastSeen);
  }

  // --- İstekler --------------------------------------------------------------------------------

  async createRequest(input: {
    provider: ProviderId | null;
    label: string;
    instruction: string;
    nodeId?: string;
    nodeTitle?: string;
    selection?: string;
  }): Promise<AiRequest> {
    const label = input.label.trim().slice(0, 120);
    const instruction = input.instruction.trim().slice(0, 20_000);
    if (!instruction) throw new NodeError("invalid", "İstek boş olamaz");
    const req: AiRequest = {
      id: `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
      createdAt: Date.now(),
      provider: input.provider,
      label: label || instruction.slice(0, 60),
      instruction,
      nodeId: input.nodeId,
      nodeTitle: input.nodeTitle,
      selection: input.selection?.slice(0, 20_000) || undefined,
      status: "pending",
      changes: [],
    };
    await writeJsonAtomic(this.requestFile(req.id), req);
    return req;
  }

  async getRequest(id: string): Promise<AiRequest> {
    const req = await readJson<AiRequest>(this.requestFile(id));
    if (!req) throw new NodeError("not_found", `İstek bulunamadı: ${id}`);
    return req;
  }

  private async save(req: AiRequest): Promise<AiRequest> {
    await writeJsonAtomic(this.requestFile(req.id), req);
    return req;
  }

  async listRequests(limit = 50): Promise<AiRequest[]> {
    let names: string[] = [];
    try {
      names = (await readdir(path.join(this.dir, "requests"))).filter((n) => n.endsWith(".json"));
    } catch {
      return [];
    }
    const out: AiRequest[] = [];
    for (const n of names.sort().reverse().slice(0, limit)) {
      const r = await readJson<AiRequest>(path.join(this.dir, "requests", n));
      if (r) out.push(r);
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }

  /** AI isteği alır: verilen ya da en son bekleyen isteği "alındı" yapar. */
  async takeRequest(id: string | undefined, client: string | undefined): Promise<AiRequest | null> {
    let req: AiRequest | undefined;
    if (id) req = await this.getRequest(id);
    else req = (await this.listRequests(20)).find((r) => r.status === "pending");
    if (!req) return null;
    if (req.status === "pending") {
      req.status = "received";
      req.receivedAt = Date.now();
      req.client = client;
      await this.save(req);
    }
    return req;
  }

  async completeRequest(id: string, reply: string, failed = false, client?: string): Promise<AiRequest> {
    const req = await this.getRequest(id);
    req.status = failed ? "failed" : "done";
    if (client) req.client = client;
    req.completedAt = Date.now();
    req.reply = reply.slice(0, 50_000);
    return this.save(req);
  }

  /**
   * Sohbet geçmişini temizler: sonuçlanmış istekler `archive/` klasörüne taşınır (silinmez), işlenmekte
   * olan istekler yerinde kalır. Notlara ve geri alma kopyalarına dokunulmaz.
   */
  async clearHistory(): Promise<{ archived: number; kept: number }> {
    const reqDir = path.join(this.dir, "requests");
    const archive = path.join(this.dir, "archive", new Date().toISOString().replace(/[:.]/g, "-"));
    let archived = 0;
    let kept = 0;
    let names: string[] = [];
    try {
      names = (await readdir(reqDir)).filter((n) => n.endsWith(".json"));
    } catch {
      return { archived, kept };
    }
    const now = Date.now();
    for (const n of names) {
      const r = await readJson<AiRequest>(path.join(reqDir, n));
      const busy = r && (r.status === "received" || (r.status === "pending" && now - r.createdAt < 60_000));
      if (busy) {
        kept++;
        continue;
      }
      await mkdir(archive, { recursive: true });
      await rename(path.join(reqDir, n), path.join(archive, n));
      archived++;
    }
    return { archived, kept };
  }

  /** Başarısız ya da takılı kalmış bir isteği yeniden işlenmek üzere bekleyen duruma döndürür. */
  async retryRequest(id: string): Promise<AiRequest> {
    const req = await this.getRequest(id);
    if (req.status === "done") throw new NodeError("invalid", "Tamamlanmış istek yeniden denenemez");
    req.status = "pending";
    delete req.reply;
    delete req.completedAt;
    delete req.receivedAt;
    return this.save(req);
  }

  /** Değişiklikleri üstlenecek etkin istek: en son alınmış ve henüz tamamlanmamış (ya da yeni tamamlanmış) istek. */
  async activeRequest(): Promise<AiRequest | null> {
    const now = Date.now();
    return (
      (await this.listRequests(20)).find(
        (r) =>
          (r.status === "received" && now - (r.receivedAt ?? 0) < ACTIVE_WINDOW_MS) || (r.status === "done" && now - (r.completedAt ?? 0) < 60_000),
      ) ?? null
    );
  }

  // --- Anlık kopyalar ve geri alma ----------------------------------------------------------------

  /** Değişiklikten önceki tam dosyayı saklar; anlık kopyanın göreli yolunu döndürür. */
  async snapshot(nodeId: string, rawText: string): Promise<string> {
    const dir = path.join(this.dir, "history", nodeId.replace(/[^\w-]/g, "_"));
    await mkdir(dir, { recursive: true });
    const name = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 6)}.md`;
    await writeFile(path.join(dir, name), rawText);
    const existing = (await readdir(dir)).sort();
    for (const old of existing.slice(0, Math.max(0, existing.length - MAX_SNAPSHOTS_PER_NODE))) await rm(path.join(dir, old), { force: true });
    return path.relative(this.dir, path.join(dir, name)).split(path.sep).join("/");
  }

  /** AI'ın bir Node'a yaptığı değişikliği verilen isteğe ya da etkin isteğe (varsa) bağlar. */
  async recordChange(change: AiChange, requestId?: string): Promise<AiRequest | null> {
    const req = requestId ? await this.getRequest(requestId) : await this.activeRequest();
    if (!req) return null;
    req.changes.push(change);
    return this.save(req);
  }

  /**
   * AI düzenlemesi: önce geri alma için anlık kopya alır, düzenlemeyi yapar ve değişikliği isteğe bağlar.
   * MCP sunucusu (resmi AI uygulamaları) ve Nularche'nin otomatik modu aynı yolu kullanır.
   */
  async editWithSnapshot(store: NodeStore, ref: string, edit: (before: NodeDoc) => Promise<NodeDoc>, requestId?: string): Promise<NodeDoc> {
    const before = await store.read(ref);
    const snapshot = await this.snapshot(before.id, (await store.readRaw(before.path)).toString("utf8"));
    const after = await edit(before);
    if (after.revision !== before.revision) {
      await this.recordChange(
        { nodeId: after.id, title: after.title, snapshot, beforeRevision: before.revision, afterRevision: after.revision, at: Date.now() },
        requestId,
      ).catch(() => undefined);
    }
    return after;
  }

  /**
   * İsteğin değişikliklerini geri alır (en sondan başa). Node o zamandan beri yeniden değiştiyse
   * o Node atlanır ve raporda belirtilir.
   */
  async undo(store: NodeStore, id: string): Promise<{ restored: string[]; skipped: string[] }> {
    const req = await this.getRequest(id);
    const restored: string[] = [];
    const skipped: string[] = [];
    // Aynı Node'a birden çok değişiklik yapıldıysa: ilk değişiklikten önceki kopyaya dön; güncellik
    // denetimi son değişikliğin revision'ıyla yapılır.
    const byNode = new Map<string, { first: AiChange; last: AiChange }>();
    for (const c of req.changes) {
      const e = byNode.get(c.nodeId);
      if (e) e.last = c;
      else byNode.set(c.nodeId, { first: c, last: c });
    }
    for (const { first, last } of byNode.values()) {
      try {
        const current = await store.read(first.nodeId);
        if (current.revision !== last.afterRevision) {
          skipped.push(last.title);
          continue;
        }
        const snap = parseNodeFile(await readFile(path.join(this.dir, first.snapshot), "utf8"));
        const title = typeof snap.frontmatter.title === "string" ? snap.frontmatter.title : undefined;
        await store.update(first.nodeId, { body: snap.body, title, baseRevision: last.afterRevision });
        restored.push(title ?? last.title);
      } catch {
        skipped.push(last.title);
      }
    }
    req.undoneAt = Date.now();
    await this.save(req);
    return { restored, skipped };
  }
}

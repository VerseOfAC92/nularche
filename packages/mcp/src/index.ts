#!/usr/bin/env node
// Nularche MCP sunucusu (stdio). Claude Desktop / Claude Code bu sunucu üzerinden
// Origin'deki Node'ları listeler, okur, arar ve düzenler. Uygulamanın kendisinde AI yoktur.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { AiActivity, NodeError, NodeStore, resolveOriginDir, SHADOW, type NodeDoc, type NodeMeta } from "../../core/src/index.ts";

const store = new NodeStore(resolveOriginDir());
await store.ensureRoot();
const activity = new AiActivity(store.root);
let clientName = "";

const server = new McpServer(
  { name: "nularche", version: "0.2.0" },
  {
    instructions:
      "Kullanıcının Nularche not uygulamasındaki yerel Markdown notları. Terimler: Origin = not kasası; Arche = kökteki ana Node " +
      "(proje/alan); Node = sayfa; Shadow = henüz bir Arche'ye bağlanmamış ham notların gelen kutusu. " +
      "Düzenlemeden önce read_node ile Node'u okuyun ve dönen revision değerini update_node/append_to_node çağrısına base_revision olarak verin; " +
      "çakışma hatası alırsanız yeniden okuyun. Node'lar arası bağlantılar göreli Markdown bağlantılarıdır (ör. [Plan](../Plan.md)). " +
      "Kalıcı silme yoktur; trash_node çöp klasörüne taşır. " +
      "Kullanıcı Nularche AI penceresinden istek gönderdiğinde önce get_nularche_request ile isteği al, işi yap, " +
      "sonra complete_nularche_request ile kullanıcıya kısa bir Türkçe cevap/özet yaz; bu cevap Nularche'de görünür.",
  },
);

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return { content: [{ type: "text", text: JSON.stringify(await fn()) }] };
  } catch (err) {
    if (err instanceof NodeError) {
      return { content: [{ type: "text", text: JSON.stringify({ error: err.code, message: err.message, ...err.details }) }], isError: true };
    }
    throw err;
  }
}

// Hangi yapay zekâ aracının bağlandığını kaydet (Nularche "✓ Bağlandı" bilgisini buradan gösterir).
server.server.oninitialized = () => {
  const info = server.server.getClientVersion();
  clientName = info?.name ?? "bilinmeyen";
  void activity.recordClient(clientName, info?.version ?? "").catch(() => undefined);
};

/** AI düzenlemesi: önce geri alma için anlık kopya al, sonra değişikliği etkin Nularche AI isteğine bağla. */
async function editWithSnapshot(ref: string, edit: (before: NodeDoc) => Promise<NodeDoc>): Promise<NodeDoc> {
  const before = await store.read(ref);
  const snapshot = await activity.snapshot(before.id, (await store.readRaw(before.path)).toString("utf8"));
  const after = await edit(before);
  if (after.revision !== before.revision) {
    await activity
      .recordChange({
        nodeId: after.id,
        title: after.title,
        snapshot,
        beforeRevision: before.revision,
        afterRevision: after.revision,
        at: Date.now(),
      })
      .catch(() => undefined);
  }
  return after;
}

const iso = (ms: number) => new Date(ms).toISOString();
const summary = (m: NodeMeta) => ({
  id: m.id,
  title: m.title,
  path: m.path,
  parent_node_id: m.parentNodeId,
  arche_id: m.archeId,
  updated_at: iso(m.updatedAt),
});

const nodeRef = z.string().describe("Node id'si veya Origin yolu (ör. 'Projeler/Toplanti' ya da 'Projeler/Toplanti.md')");
const parentRef = z
  .string()
  .describe("Üst Node id'si; kökte yeni Arche için 'root', gelen kutusu için 'shadow'")
  .transform((v) => (v === "root" ? null : v === "shadow" ? SHADOW : v));

server.registerTool(
  "list_nodes",
  {
    title: "Node'ları listele",
    description:
      "Node'ların başlık, yol ve id'lerini listeler (içerik döndürmez). parent_node_id ile bir Node'un alt Node'ları, 'root' ile Arche'ler (kök Node'lar).",
    inputSchema: {
      parent_node_id: z.string().optional().describe("Üst Node id'si; Arche'ler için 'root'. Boşsa tüm Node'lar."),
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(500).default(100),
    },
    annotations: { readOnlyHint: true },
  },
  ({ parent_node_id, offset, limit }) =>
    run(async () => {
      let all = await store.list();
      if (parent_node_id === "root") all = all.filter((m) => m.archeId === m.id);
      else if (parent_node_id !== undefined) all = all.filter((m) => m.parentNodeId === parent_node_id);
      return { total: all.length, offset, nodes: all.slice(offset, offset + limit).map(summary) };
    }),
);

server.registerTool(
  "read_node",
  {
    title: "Node'u oku",
    description: "Bir Node'un Markdown içeriğini ve düzenleme için gereken revision değerini döndürür.",
    inputSchema: { node: nodeRef },
    annotations: { readOnlyHint: true },
  },
  ({ node }) =>
    run(async () => {
      const n = await store.read(node);
      return { ...summary(n), created_at: iso(n.createdAt), layout_mode: n.layoutMode, revision: n.revision, body: n.body };
    }),
);

server.registerTool(
  "search_nodes",
  {
    title: "Node'larda ara",
    description: "Başlık ve içerikte tam metin arama (tüm kelimeler eşleşmeli, Türkçe büyük/küçük harfe duyarsız). Kısa parçacıklar döndürür.",
    inputSchema: { query: z.string().min(1), limit: z.number().int().min(1).max(50).default(10) },
    annotations: { readOnlyHint: true },
  },
  ({ query, limit }) => run(async () => ({ results: await store.search(query, limit) })),
);

server.registerTool(
  "create_node",
  {
    title: "Node oluştur",
    description:
      "Yeni bir Node oluşturur. parent_node_id: üst Node, 'root' (yeni Arche) ya da 'shadow' (gelen kutusu). Boşsa gelen kutusuna yazılır.",
    inputSchema: {
      title: z.string().min(1),
      body: z.string().default("").describe("Markdown içerik"),
      parent_node_id: parentRef.optional(),
    },
  },
  ({ title, body, parent_node_id }) =>
    run(async () => {
      const n = await store.create({ title, body, parentNodeId: parent_node_id === undefined ? SHADOW : parent_node_id });
      return { ...summary(n), revision: n.revision };
    }),
);

server.registerTool(
  "update_node",
  {
    title: "Node'u güncelle",
    description:
      "Node'un içeriğini tamamen değiştirir ve/veya başlığını yeniler. base_revision (read_node'dan) verilmesi önerilir; " +
      "Node bu arada değiştiyse 'conflict' hatası döner ve değişiklik yazılmaz.",
    inputSchema: {
      node: nodeRef,
      body: z.string().optional().describe("Yeni tam Markdown içerik"),
      title: z.string().optional(),
      base_revision: z.string().optional(),
    },
    annotations: { destructiveHint: true, idempotentHint: true },
  },
  ({ node, body, title, base_revision }) =>
    run(async () => {
      const n = await editWithSnapshot(node, () => store.update(node, { body, title, baseRevision: base_revision }));
      return { ...summary(n), revision: n.revision };
    }),
);

server.registerTool(
  "append_to_node",
  {
    title: "Node'a ekle",
    description: "Node'un sonuna yeni bir paragraf/Markdown bloğu ekler.",
    inputSchema: { node: nodeRef, text: z.string().min(1), base_revision: z.string().optional() },
  },
  ({ node, text, base_revision }) =>
    run(async () => {
      const n = await editWithSnapshot(node, () => store.append(node, text, base_revision));
      return { ...summary(n), revision: n.revision };
    }),
);

server.registerTool(
  "move_node",
  {
    title: "Node'u taşı",
    description:
      "Node'u (alt Node'larıyla) başka bir Node'un altına, köke ('root', Arche olur) ya da gelen kutusuna ('shadow') taşır. Bağlantılar otomatik güncellenir.",
    inputSchema: { node: nodeRef, new_parent_node_id: parentRef },
  },
  ({ node, new_parent_node_id }) => run(async () => summary(await store.move(node, new_parent_node_id))),
);

server.registerTool(
  "trash_node",
  {
    title: "Node'u çöpe taşı",
    description: "Node'u ve alt Node'larını Origin içindeki .trash klasörüne taşır (kalıcı silme değildir).",
    inputSchema: { node: nodeRef },
    annotations: { destructiveHint: true },
  },
  ({ node }) => run(() => store.trash(node)),
);

server.registerTool(
  "capture_to_shadow",
  {
    title: "Shadow'a yakala",
    description: "Ham bir notu hızlıca Shadow gelen kutusuna yazar. Başlık verilmezse ilk satırdan üretilir.",
    inputSchema: { text: z.string().min(1), title: z.string().optional() },
  },
  ({ text, title }) =>
    run(async () => {
      const n = await store.capture(text, title);
      return { ...summary(n), revision: n.revision };
    }),
);

server.registerTool(
  "list_shadow",
  {
    title: "Shadow'u listele",
    description:
      "Gelen kutusundaki ham notları (inbox) ve hiçbir Node ile bağlantısı olmayan Node'ları (unlinked) listeler; düzenleme ve bağlantı önerileri için kullanın.",
    inputSchema: { limit: z.number().int().min(1).max(200).default(50) },
    annotations: { readOnlyHint: true },
  },
  ({ limit }) =>
    run(async () => {
      const view = await store.shadow();
      return { inbox: view.inbox.slice(0, limit).map(summary), unlinked: view.unlinked.slice(0, limit).map(summary) };
    }),
);

server.registerTool(
  "get_backlinks",
  {
    title: "Geri bağlantılar",
    description: "Bu Node'a bağlantı veren Node'ları listeler.",
    inputSchema: { node: nodeRef },
    annotations: { readOnlyHint: true },
  },
  ({ node }) => run(async () => ({ backlinks: (await store.backlinks(node)).map(summary) })),
);

server.registerTool(
  "get_nularche_request",
  {
    title: "Nularche AI isteğini al",
    description:
      "Kullanıcının Nularche AI penceresinden gönderdiği isteği getirir (request_id verilmezse en son bekleyen istek). " +
      "İstek talimatı, ilgili Node'un id/başlık/içeriği/revision'ı ve varsa kullanıcının seçtiği metni içerir. İşi yaptıktan sonra complete_nularche_request çağır.",
    inputSchema: { request_id: z.string().optional() },
  },
  ({ request_id }) =>
    run(async () => {
      const req = await activity.takeRequest(request_id, clientName || undefined);
      if (!req) return { request: null, message: "Bekleyen Nularche AI isteği yok." };
      let node: Record<string, unknown> | null = null;
      if (req.nodeId) {
        try {
          const n = await store.read(req.nodeId);
          node = { ...summary(n), revision: n.revision, body: n.body };
        } catch {
          node = null;
        }
      }
      return {
        request: { id: req.id, label: req.label, instruction: req.instruction, selection: req.selection ?? null, created_at: iso(req.createdAt) },
        node,
        next: "İşi read_node/update_node gibi araçlarla yap (update_node'a base_revision ver), sonra complete_nularche_request ile kısa bir cevap yaz.",
      };
    }),
);

server.registerTool(
  "complete_nularche_request",
  {
    title: "Nularche AI isteğini tamamla",
    description:
      "Nularche AI isteğini tamamlandı (ya da başarısız) olarak işaretler ve kullanıcıya gösterilecek kısa cevabı yazar. Soru yanıtıysa cevabın tamamını buraya yaz.",
    inputSchema: {
      request_id: z.string(),
      reply: z.string().min(1).describe("Kullanıcıya gösterilecek cevap/özet (Markdown)"),
      failed: z.boolean().default(false),
    },
  },
  ({ request_id, reply, failed }) =>
    run(async () => {
      const req = await activity.completeRequest(request_id, reply, failed);
      return { id: req.id, status: req.status, changes: req.changes.length };
    }),
);

await server.connect(new StdioServerTransport());

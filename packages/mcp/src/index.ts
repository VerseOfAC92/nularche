#!/usr/bin/env node
// Nularche MCP sunucusu (stdio). Claude Desktop / Claude Code bu sunucu üzerinden
// Origin'deki Node'ları listeler, okur, arar ve düzenler. Uygulamanın kendisinde AI yoktur.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  addProperty,
  addRow,
  AiActivity,
  createDatabase,
  describeRows,
  FILTER_OPS,
  loadDatabase,
  NodeError,
  NodeStore,
  OPTION_COLORS,
  parseDatabase,
  PROPERTY_TYPES,
  removeProperty,
  REPLY_LANGUAGE_NAME,
  resolveOriginDir,
  resolveProperty,
  ROLLUP_FUNCTIONS,
  saveSchema,
  setRowValues,
  SHADOW,
  slugId,
  TITLE_PROP,
  updateProperty,
  type Database,
  type NodeDoc,
  type NodeMeta,
} from "../../core/src/index.ts";

const store = new NodeStore(resolveOriginDir());
await store.ensureRoot();
const activity = new AiActivity(store.root);
let clientName = "";

const server = new McpServer(
  { name: "nularche", version: "1.5.0" },
  {
    instructions:
      "Kullanıcının Nularche not uygulamasındaki yerel Markdown notları. Terimler: Origin = not kasası; Arche = kökteki ana Node " +
      "(proje/alan); Node = sayfa; Shadow = henüz bir Arche'ye bağlanmamış ham notların gelen kutusu. " +
      "Düzenlemeden önce read_node ile Node'u okuyun ve dönen revision değerini update_node/append_to_node çağrısına base_revision olarak verin; " +
      "çakışma hatası alırsanız yeniden okuyun. Node'lar arası bağlantılar göreli Markdown bağlantılarıdır (ör. [Plan](../Plan.md)). " +
      "Kalıcı silme yoktur; trash_node çöp klasörüne taşır (kullanıcı uygulamadaki Çöp bölümünden geri getirebilir). " +
      "Veritabanları (tablo/pano/takvim): satırları alt Node'lardır; query_database, add_database_row, set_row_properties, update_database_schema ile çalışın. " +
      "Şablondan sayfa oluşturmak ya da sayfayı alt sayfalarıyla kopyalamak için duplicate_node kullanın. " +
      "Notlardaki #etiketler için list_tags ve search_nodes(tag) kullanın. Notlar Obsidian uyumludur: [[wiki]] bağlantıları ve frontmatter özellikleri (update_node properties) okunur; bağlantılar için get_links. Kilitli (parolalı) notlar okunamaz ve değiştirilemez. " +
      "Kullanıcı Nularche AI penceresinden istek gönderdiğinde önce get_nularche_request ile isteği al, işi yap, " +
      "sonra complete_nularche_request ile kullanıcıya kısa bir cevap/özet yaz (isteğin reply_language dilinde); bu cevap Nularche'de görünür.",
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

/** AI düzenlemesi: geri alma kopyası alınır ve değişiklik etkin Nularche AI isteğine bağlanır. */
const editWithSnapshot = (ref: string, edit: (before: NodeDoc) => Promise<NodeDoc>) => activity.editWithSnapshot(store, ref, edit);

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
      if (n.locked) return { ...summary(n), locked: true, body: "", message: "Bu not kullanıcı tarafından parola ile kilitlenmiş; içeriği okunamaz ve değiştirilemez." };
      const props = Object.keys(n.properties).length ? { properties: n.properties } : {};
      return { ...summary(n), created_at: iso(n.createdAt), layout_mode: n.layoutMode, revision: n.revision, tags: n.tags, ...props, body: n.body };
    }),
);

server.registerTool(
  "search_nodes",
  {
    title: "Node'larda ara",
    description:
      "Başlık ve içerikte tam metin arama (tüm kelimeler eşleşmeli, Türkçe büyük/küçük harfe duyarsız). Kısa parçacıklar döndürür. " +
      "tag verilirse yalnızca o #etiketi (ve alt etiketlerini) taşıyan Node'lar döner; sorgu boş bırakılabilir.",
    inputSchema: {
      query: z.string().default(""),
      tag: z.string().optional().describe("Etiket adı, # olmadan (ör. 'toplantı' ya da 'proje/nularche')"),
      limit: z.number().int().min(1).max(50).default(10),
    },
    annotations: { readOnlyHint: true },
  },
  ({ query, tag, limit }) =>
    run(async () => {
      if (!tag) return { results: query.trim() ? await store.search(query, limit) : [] };
      const key = tag.replace(/^#/, "").toLocaleLowerCase("tr");
      const tagged = (await store.list()).filter((m) => m.tags.some((t) => t.toLocaleLowerCase("tr") === key || t.toLocaleLowerCase("tr").startsWith(`${key}/`)));
      const ids = query.trim() ? new Set((await store.search(query, 500)).map((h) => h.id)) : null;
      return { results: tagged.filter((m) => !ids || ids.has(m.id)).slice(0, limit).map((m) => ({ ...summary(m), tags: m.tags, snippet: m.excerpt.slice(0, 160) })) };
    }),
);

server.registerTool(
  "list_tags",
  {
    title: "Etiketleri listele",
    description: "Notlarda kullanılan tüm #etiketleri ve her birinin kaç Node'da geçtiğini döndürür. Bir etiketteki Node'lar için search_nodes'a tag verin.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  () => run(async () => ({ tags: await store.tags() })),
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
      properties: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Frontmatter özellikleri (Obsidian uyumlu, ör. aliases, tags, status); null değer özelliği kaldırır. Verilmeyenler değişmez."),
      base_revision: z.string().optional(),
    },
    annotations: { destructiveHint: true, idempotentHint: true },
  },
  ({ node, body, title, properties, base_revision }) =>
    run(async () => {
      const n = await editWithSnapshot(node, () => store.update(node, { body, title, properties, baseRevision: base_revision }));
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

// --- Veritabanları -----------------------------------------------------------------------------------

const propertyInput = z.object({
  name: z.string().min(1),
  type: z.enum(PROPERTY_TYPES),
  options: z.array(z.string()).optional().describe("select / multi_select / status seçenek adları"),
  target_database_id: z.string().optional().describe("relation: hedef veritabanı Node id'si"),
  relation: z.string().optional().describe("rollup: bu veritabanındaki relation özelliğinin adı"),
  target_property: z.string().optional().describe("rollup: hedef veritabanındaki özelliğin adı"),
  function: z.enum(ROLLUP_FUNCTIONS).optional().describe("rollup işlevi"),
  expression: z.string().optional().describe('formula: ör. prop("Fiyat") * prop("Adet"), if(prop("Bitti"), "✓", "")'),
});

function withProperty(db: Database, input: z.infer<typeof propertyInput>): Database {
  const rel = input.relation ? resolveProperty(db, input.relation) : null;
  return addProperty(db, {
    name: input.name,
    type: input.type,
    ...(input.options
      ? { options: input.options.map((name, i) => ({ id: slugId(name), name, color: OPTION_COLORS[i % OPTION_COLORS.length] })) }
      : {}),
    ...(input.target_database_id ? { target: input.target_database_id } : {}),
    ...(rel && rel !== TITLE_PROP ? { relation: rel.id } : {}),
    ...(input.function ? { fn: input.function } : {}),
    ...(input.expression !== undefined ? { expression: input.expression } : {}),
  }).db;
}

/** Seçenek adlarını şemadaki biçime çevirmek için ayrıştırıcıdan geçirir (kimlik ve renk atanır). */
const normalize = (db: Database) => parseDatabase(JSON.parse(JSON.stringify(db)));

const schemaSummary = (db: Database) => ({
  properties: [
    { name: "title", type: "title" },
    ...db.properties.map((p) => ({
      name: p.name,
      type: p.type,
      ...(p.options ? { options: p.options.map((o) => o.name) } : {}),
      ...(p.target ? { target_database_id: p.target } : {}),
      ...(p.expression ? { expression: p.expression } : {}),
      ...(p.fn ? { function: p.fn } : {}),
    })),
  ],
  views: db.views.map((v) => ({ name: v.name, type: v.type })),
});

server.registerTool(
  "create_database",
  {
    title: "Veritabanı oluştur",
    description:
      "Notion tarzı bir veritabanı (tablo/pano/takvim…) oluşturur. Veritabanı bir Node'dur; satırları onun alt Node'larıdır. " +
      "Her satırın bir başlığı (title) ve tanımlanan özellikleri vardır. Varsayılan bir tablo görünümü eklenir.",
    inputSchema: {
      title: z.string().min(1),
      parent_node_id: parentRef.optional().describe("Üst Node id'si, 'root' ya da 'shadow' (varsayılan: root)"),
      properties: z.array(propertyInput).default([]),
      description: z.string().default("").describe("Veritabanı sayfasının Markdown açıklaması"),
    },
  },
  ({ title, parent_node_id, properties, description }) =>
    run(async () => {
      let db: Database = parseDatabase({});
      for (const p of properties) db = withProperty(db, p);
      db = normalize(db);
      const n = await createDatabase(store, { title, parentNodeId: parent_node_id ?? null, db, body: description });
      return { ...summary(n), revision: n.revision, schema: schemaSummary(db) };
    }),
);

server.registerTool(
  "query_database",
  {
    title: "Veritabanını sorgula",
    description:
      "Veritabanının şemasını ve satırlarını (okunur değerlerle) döndürür. view verilmezse ilk görünümün filtre/sıralaması kullanılır; " +
      "filters/sorts verilirse onlar geçerli olur. Filtre/sıralamada özellik adı ya da 'title' kullanılır.",
    inputSchema: {
      database: nodeRef,
      view: z.string().optional().describe("Görünüm adı"),
      filters: z
        .array(z.object({ property: z.string(), op: z.enum(FILTER_OPS), value: z.union([z.string(), z.number(), z.boolean()]).optional() }))
        .optional(),
      match: z.enum(["all", "any"]).optional(),
      sorts: z.array(z.object({ property: z.string(), direction: z.enum(["asc", "desc"]).default("asc") })).optional(),
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(500).default(100),
    },
    annotations: { readOnlyHint: true },
  },
  ({ database, view, filters, match, sorts, offset, limit }) =>
    run(async () => {
      const loaded = await loadDatabase(store, database);
      const idOf = (ref: string) => {
        const p = resolveProperty(loaded.db, ref);
        if (!p) throw new NodeError("invalid", `Bilinmeyen özellik: ${ref}`);
        return p === TITLE_PROP ? TITLE_PROP : p.id;
      };
      const optionId = (ref: string, v: unknown) => {
        const p = resolveProperty(loaded.db, ref);
        return p && p !== TITLE_PROP && p.options && typeof v === "string" ? (p.options.find((o) => o.name.toLocaleLowerCase("tr") === v.toLocaleLowerCase("tr"))?.id ?? v) : v;
      };
      const { view: used, rows } = describeRows(loaded, {
        view,
        match,
        filters: filters?.map((f) => ({ prop: idOf(f.property), op: f.op, value: optionId(f.property, f.value) as string })),
        sorts: sorts?.map((s) => ({ prop: idOf(s.property), dir: s.direction })),
      });
      return {
        database: { ...summary(loaded.node), revision: loaded.node.revision },
        schema: schemaSummary(loaded.db),
        view: used.name,
        total: rows.length,
        offset,
        rows: rows.slice(offset, offset + limit),
      };
    }),
);

server.registerTool(
  "add_database_row",
  {
    title: "Veritabanına satır ekle",
    description:
      "Veritabanına yeni satır (alt Node) ekler. values: özellik adı → değer. Seçimlerde seçenek adı (yoksa eklenir), çoklu seçimde dizi, " +
      "tarihte 2026-10-17 (ya da {start, end}), onay kutusunda true/false, ilişkide satır id dizisi verilir.",
    inputSchema: {
      database: nodeRef,
      title: z.string().min(1),
      values: z.record(z.string(), z.unknown()).default({}),
      body: z.string().default("").describe("Satır sayfasının Markdown içeriği"),
    },
  },
  ({ database, title, values, body }) =>
    run(async () => {
      const n = await addRow(store, database, { title, values, body });
      return { ...summary(n), revision: n.revision };
    }),
);

server.registerTool(
  "set_row_properties",
  {
    title: "Satır özelliklerini değiştir",
    description: "Bir veritabanı satırının özellik değerlerini değiştirir (verilmeyenler korunur; null değeri temizler). 'title' başlığı değiştirir.",
    inputSchema: { row: nodeRef, values: z.record(z.string(), z.unknown()), base_revision: z.string().optional() },
    annotations: { idempotentHint: true },
  },
  ({ row, values, base_revision }) =>
    run(async () => {
      const n = await editWithSnapshot(row, () => setRowValues(store, row, values, base_revision));
      return { ...summary(n), revision: n.revision, props: n.props ?? {} };
    }),
);

server.registerTool(
  "update_database_schema",
  {
    title: "Veritabanı şemasını değiştir",
    description:
      "Özellik ekler, yeniden adlandırır, formülünü değiştirir ya da kaldırır. Kaldırılan özelliğin satırlardaki değerleri silinmez (yeniden eklenirse görünür).",
    inputSchema: {
      database: nodeRef,
      add: z.array(propertyInput).default([]),
      rename: z.array(z.object({ from: z.string(), to: z.string().min(1) })).default([]),
      set_expression: z.array(z.object({ property: z.string(), expression: z.string() })).default([]),
      remove: z.array(z.string()).default([]),
      base_revision: z.string().optional(),
    },
    annotations: { destructiveHint: true },
  },
  ({ database, add, rename, set_expression, remove, base_revision }) =>
    run(async () => {
      const loaded = await loadDatabase(store, database);
      let db = loaded.db;
      const find = (ref: string) => {
        const p = resolveProperty(db, ref);
        if (!p || p === TITLE_PROP) throw new NodeError("invalid", `Bilinmeyen özellik: ${ref}`);
        return p;
      };
      for (const r of rename) db = updateProperty(db, find(r.from).id, { name: r.to });
      for (const e of set_expression) db = updateProperty(db, find(e.property).id, { expression: e.expression });
      for (const r of remove) db = removeProperty(db, find(r).id);
      for (const p of add) db = withProperty(db, p);
      db = normalize(db);
      const n = await editWithSnapshot(loaded.node.id, () => saveSchema(store, loaded.node.id, db, base_revision));
      return { ...summary(n), revision: n.revision, schema: schemaSummary(db) };
    }),
);

server.registerTool(
  "duplicate_node",
  {
    title: "Node'u çoğalt / şablondan oluştur",
    description:
      "Node'u alt Node'larıyla birlikte kopyalar (şablondan yeni sayfa oluşturmak için de kullanılır). Kopyalar arasındaki bağlantılar ve ilişkiler kopyalara yönlenir.",
    inputSchema: { node: nodeRef, parent_node_id: parentRef.optional().describe("Kopyanın üst Node'u (boşsa kaynakla aynı yer)"), title: z.string().optional() },
  },
  ({ node, parent_node_id, title }) => run(async () => summary(await store.duplicate(node, { parentNodeId: parent_node_id, title }))),
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
  "get_links",
  {
    title: "Bağlantılar",
    description:
      "Bir Node'un giden bağlantılarını (Markdown ve [[wiki]] bağlantıları), var olmayan wiki hedeflerini ve başlığını ya da " +
      "takma adını bağlantı vermeden anan Node'ları döndürür. Geri bağlantılar için get_backlinks.",
    inputSchema: { node: nodeRef },
    annotations: { readOnlyHint: true },
  },
  ({ node }) =>
    run(async () => {
      const out = await store.outgoing(node);
      return { outgoing: out.linked.map(summary), unresolved: out.unresolved, unlinked_mentions: await store.unlinkedMentions(node) };
    }),
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
        request: {
          id: req.id,
          label: req.label,
          instruction: req.instruction,
          selection: req.selection ?? null,
          reply_language: req.language ?? "tr",
          created_at: iso(req.createdAt),
        },
        node,
        next:
          "İşi read_node/update_node gibi araçlarla yap (update_node'a base_revision ver), sonra complete_nularche_request ile kısa bir cevap yaz. " +
          `Write the reply in ${REPLY_LANGUAGE_NAME[req.language ?? "tr"]}.`,
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

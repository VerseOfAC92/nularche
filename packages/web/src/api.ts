// Yerel sunucunun JSON API istemcisi. Tipler core/src/node-store.ts ile aynı sözleşmeyi izler.

export type LayoutMode = "stream" | "canvas";

export interface PageFields {
  layout?: LayoutMode;
  icon?: string;
  cover?: string;
  order?: number;
  favorite?: boolean;
  template?: boolean;
  publish?: boolean;
  props?: Record<string, unknown>;
  database?: Record<string, unknown>;
  pinned?: boolean;
  locked?: boolean;
  font?: string;
  fontSize?: number;
  lightBg?: boolean;
  sortChecked?: boolean;
}

export type PageFieldPatch = { [K in keyof PageFields]?: PageFields[K] | null };

export interface NodeMeta extends PageFields {
  id: string;
  title: string;
  path: string;
  parentNodeId: string | null;
  archeId: string | null;
  layoutMode: LayoutMode;
  createdAt: number;
  updatedAt: number;
  revision: string;
  tags: string[];
  excerpt: string;
  image: string | null;
  todos: number;
  done: number;
  attachments: number;
  words: number;
  /** Frontmatter `aliases` (Obsidian uyumlu takma adlar). */
  aliases: string[];
}

export interface NodeDoc extends NodeMeta {
  body: string;
  /** Kullanıcının frontmatter özellikleri. */
  properties: Record<string, unknown>;
}

export interface LinkGraph {
  nodes: { id: string; title: string; path: string; tags: string[]; archeId: string | null }[];
  links: { source: string; target: string }[];
  unresolved: { source: string; name: string }[];
}

export interface MentionHit {
  id: string;
  title: string;
  snippet: string;
}

export interface SearchHit {
  id: string;
  title: string;
  path: string;
  snippet: string;
}

export interface TrashEntry {
  entry: string;
  nodeId: string | null;
  title: string;
  originalPath: string | null;
  trashedAt: number;
  childCount: number;
}

export type AiRequestStatus = "pending" | "received" | "done" | "failed";

export interface AiChange {
  nodeId: string;
  title: string;
  snapshot: string;
  beforeRevision: string;
  afterRevision: string;
  at: number;
}

export interface AiRequest {
  id: string;
  createdAt: number;
  provider: "claude" | "chatgpt" | "gemini" | null;
  label: string;
  instruction: string;
  nodeId?: string;
  nodeTitle?: string;
  selection?: string;
  status: AiRequestStatus;
  receivedAt?: number;
  completedAt?: number;
  client?: string;
  reply?: string;
  changes: AiChange[];
  undoneAt?: number;
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface AttachmentInfo {
  path: string;
  name: string;
  size: number;
  modifiedAt: number;
  kind: "image" | "audio" | "video" | "drawing" | "pdf" | "file";
  refs: { id: string; title: string }[];
}

export interface ImportResult {
  created: { id: string; title: string }[];
  skipped: string[];
  attachments: number;
}

export interface ShadowView {
  inbox: NodeMeta[];
  unlinked: NodeMeta[];
}

/** Üst hedef: Node id'si, kök (Arche) için null, gelen kutusu için "shadow". */
export type ParentTarget = string | null;
export const SHADOW = "shadow";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(method: string, url: string, body?: unknown, raw?: BodyInit): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? "error", data.message ?? res.statusText);
  return data as T;
}

const enc = encodeURIComponent;

export const api = {
  origin: () => request<{ name: string; path: string }>("GET", "/api/origin"),
  list: () => request<{ nodes: NodeMeta[] }>("GET", "/api/nodes").then((r) => r.nodes),
  read: (id: string) => request<NodeDoc>("GET", `/api/nodes/${enc(id)}`),
  create: (title: string, parentNodeId: ParentTarget, body?: string, fields?: PageFields) =>
    request<NodeDoc>("POST", "/api/nodes", { title, parentNodeId, body, fields }),
  update: (id: string, patch: { body?: string; title?: string; baseRevision?: string; fields?: PageFieldPatch; properties?: Record<string, unknown> }) =>
    request<NodeDoc>("PUT", `/api/nodes/${enc(id)}`, patch),
  duplicate: (id: string, input: { parentNodeId?: ParentTarget; title?: string; fields?: PageFields } = {}) =>
    request<NodeDoc>("POST", `/api/nodes/${enc(id)}/duplicate`, input),
  move: (id: string, parentNodeId: ParentTarget) => request<NodeDoc>("POST", `/api/nodes/${enc(id)}/move`, { parentNodeId }),
  reorder: (parentNodeId: ParentTarget, ids: string[]) => request<{ nodes: NodeMeta[] }>("POST", "/api/reorder", { parentNodeId, ids }),
  trash: (id: string) => request<unknown>("DELETE", `/api/nodes/${enc(id)}`),
  backlinks: (id: string) => request<{ nodes: NodeMeta[] }>("GET", `/api/nodes/${enc(id)}/backlinks`).then((r) => r.nodes),
  search: (q: string) => request<{ results: SearchHit[] }>("GET", `/api/search?q=${enc(q)}`).then((r) => r.results),
  shadow: () => request<ShadowView>("GET", "/api/shadow"),
  trashList: () => request<{ entries: TrashEntry[] }>("GET", "/api/trash").then((r) => r.entries),
  restore: (entry: string) => request<NodeDoc>("POST", `/api/trash/${enc(entry)}/restore`),
  deleteTrash: (entry: string) => request<unknown>("DELETE", `/api/trash/${enc(entry)}`),
  emptyTrash: () => request<{ deleted: number }>("DELETE", "/api/trash"),
  capture: (text: string, title?: string) => request<NodeDoc>("POST", "/api/capture", { text, title }),
  aiState: () =>
    request<{ clients: { name: string; provider: string | null; firstSeen: number; lastSeen: number }[]; requests: AiRequest[] }>("GET", "/api/ai"),
  aiRequest: (input: { provider: string | null; label: string; instruction: string; nodeId?: string; nodeTitle?: string; selection?: string; language?: string }) =>
    request<AiRequest>("POST", "/api/ai/requests", input),
  aiClear: () => request<{ archived: number; kept: number }>("POST", "/api/ai/clear"),
  aiUndo: (id: string) => request<{ restored: string[]; skipped: string[] }>("POST", `/api/ai/requests/${enc(id)}/undo`),
  tags: () => request<{ tags: TagCount[] }>("GET", "/api/tags").then((r) => r.tags),
  renameTag: (from: string, to: string) => request<{ changed: number }>("POST", `/api/tags/${enc(from)}/rename`, { to }),
  attachments: () => request<{ attachments: AttachmentInfo[] }>("GET", "/api/attachments").then((r) => r.attachments),
  renameAttachment: (path: string, name: string) => request<{ path: string }>("POST", "/api/attachments/_/rename", { path, name }),
  prefs: () => request<Record<string, unknown>>("GET", "/api/prefs"),
  setPrefs: (patch: Record<string, unknown>) => request<Record<string, unknown>>("PUT", "/api/prefs", patch),
  importFiles: (files: { path: string; data: string }[], parentNodeId?: ParentTarget) =>
    request<ImportResult>("POST", "/api/import", { files, parentNodeId }),
  outgoing: (id: string) => request<{ linked: NodeMeta[]; unresolved: string[] }>("GET", `/api/nodes/${enc(id)}/outgoing`),
  mentions: (id: string) => request<{ mentions: MentionHit[] }>("GET", `/api/nodes/${enc(id)}/mentions`).then((r) => r.mentions),
  linkMention: (targetId: string, sourceId: string) => request<NodeDoc>("POST", `/api/nodes/${enc(targetId)}/link-mention`, { source: sourceId }),
  merge: (sourceId: string, intoId: string) => request<NodeDoc>("POST", `/api/nodes/${enc(sourceId)}/merge`, { into: intoId }),
  history: (id: string) => request<{ entries: { at: number; size: number }[] }>("GET", `/api/nodes/${enc(id)}/history`).then((r) => r.entries),
  historyBody: (id: string, at: number) => request<{ body: string }>("GET", `/api/nodes/${enc(id)}/history?at=${at}`).then((r) => r.body),
  restoreHistory: (id: string, at: number, baseRevision?: string) => request<NodeDoc>("POST", `/api/nodes/${enc(id)}/restore`, { at, baseRevision }),
  graph: () => request<LinkGraph>("GET", "/api/graph"),
  snippets: () => request<{ snippets: { name: string; css: string }[] }>("GET", "/api/snippets").then((r) => r.snippets),
  upload: (file: File) => request<{ path: string }>("POST", `/api/attachments?name=${enc(file.name)}`, undefined, file),
};

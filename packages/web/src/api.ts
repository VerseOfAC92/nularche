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
}

export interface NodeDoc extends NodeMeta {
  body: string;
}

export interface SearchHit {
  id: string;
  title: string;
  path: string;
  snippet: string;
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
  update: (id: string, patch: { body?: string; title?: string; baseRevision?: string; fields?: PageFieldPatch }) =>
    request<NodeDoc>("PUT", `/api/nodes/${enc(id)}`, patch),
  move: (id: string, parentNodeId: ParentTarget) => request<NodeDoc>("POST", `/api/nodes/${enc(id)}/move`, { parentNodeId }),
  reorder: (parentNodeId: ParentTarget, ids: string[]) => request<{ nodes: NodeMeta[] }>("POST", "/api/reorder", { parentNodeId, ids }),
  trash: (id: string) => request<unknown>("DELETE", `/api/nodes/${enc(id)}`),
  backlinks: (id: string) => request<{ nodes: NodeMeta[] }>("GET", `/api/nodes/${enc(id)}/backlinks`).then((r) => r.nodes),
  search: (q: string) => request<{ results: SearchHit[] }>("GET", `/api/search?q=${enc(q)}`).then((r) => r.results),
  shadow: () => request<ShadowView>("GET", "/api/shadow"),
  capture: (text: string, title?: string) => request<NodeDoc>("POST", "/api/capture", { text, title }),
  aiState: () =>
    request<{ clients: { name: string; provider: string | null; firstSeen: number; lastSeen: number }[]; requests: AiRequest[] }>("GET", "/api/ai"),
  aiRequest: (input: { provider: string | null; label: string; instruction: string; nodeId?: string; nodeTitle?: string; selection?: string }) =>
    request<AiRequest>("POST", "/api/ai/requests", input),
  aiClear: () => request<{ archived: number; kept: number }>("POST", "/api/ai/clear"),
  aiUndo: (id: string) => request<{ restored: string[]; skipped: string[] }>("POST", `/api/ai/requests/${enc(id)}/undo`),
  upload: (file: File) => request<{ path: string }>("POST", `/api/attachments?name=${enc(file.name)}`, undefined, file),
};

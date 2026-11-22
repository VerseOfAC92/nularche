// Yerel sunucunun JSON API istemcisi. Tipler core/src/node-store.ts ile aynı sözleşmeyi izler.

import { describeError } from "../../core/src/errors.ts";
import { cryptaApi, reveal } from "./crypta.ts";
import { getLang } from "./i18n/index.ts";

export type LayoutMode = "stream" | "canvas" | "manuscript" | "outline" | "cards" | "wiki" | "whiteboard";

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
  wordGoal?: number;
  wikiFields?: string[];
  noMentions?: boolean;
  titleRich?: string;
  /** Şifreli Arche'nin anahtar parametreleri (bkz. lock.ts). */
  archeLock?: { salt: string; iter: number; check: string; hint?: string; v?: 2 };
  /** Crypta zarfı (tam şifreli Arche'deki notun şifreli başlığı, alanları ve ağaç yeri); yalnızca crypta.ts açar. */
  sealed?: string;
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
  /** Frontmatter `aliases` (takma adlar). */
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
  cancelled?: boolean;
  readOnly?: boolean;
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

export interface HistoryEntry {
  at: number;
  size: number;
  label?: string;
}

export interface CommentAnchor {
  text: string;
  prefix?: string;
  suffix?: string;
}

export interface NoteComment {
  id: string;
  anchor: CommentAnchor;
  body: string;
  author?: string;
  createdAt: number;
  updatedAt: number;
  resolved?: boolean;
  replies: { id: string; body: string; author?: string; createdAt: number }[];
}

export interface WikiEntry {
  id: string;
  title: string;
  path: string;
  parentNodeId: string | null;
  depth: number;
  category: boolean;
  aliases: string[];
  icon?: string;
  excerpt: string;
  properties: Record<string, unknown>;
  wikiFields?: string[];
  noMentions?: boolean;
  updatedAt: number;
}

export interface WikiMention {
  id: string;
  title: string;
  count: number;
  snippet: string;
}

export interface WikiTerm {
  id: string;
  title: string;
  path: string;
  names: string[];
}

export interface CompiledManuscript {
  id: string;
  title: string;
  markdown: string;
  words: number;
  wordGoal?: number;
  sections: { id: string; title: string; words: number; parts: { id?: string; title: string; path: string; words: number; missing?: "not_found" | "locked" }[] }[];
}

export type CaptureKind = "card" | "outline" | "wiki" | "task";
export interface CaptureConfig {
  autoRoute: boolean;
  rules: { handle: string; kind: CaptureKind; target: string }[];
  defaults: Partial<Record<CaptureKind, string>>;
}
export interface CaptureResult {
  kind: CaptureKind;
  targetId: string;
  targetTitle: string;
  createdId?: string;
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
  /** Sunucunun hata neden kodu ve yer tutucuları: metin arayüzün dilinde buradan kurulur (errorMessage). */
  readonly reason?: string;
  readonly vars?: Record<string, string | number>;
  constructor(status: number, code: string, message: string, reason?: string, vars?: Record<string, string | number>) {
    super(message);
    this.status = status;
    this.code = code;
    this.reason = reason;
    this.vars = vars;
  }
}

/** Sunucunun hata cevabından istemci hatası kurar. */
export function apiError(
  status: number,
  data: { error?: string; message?: string; reason?: string; vars?: Record<string, string | number> } | null,
  fallback: string,
): ApiError {
  return new ApiError(status, data?.error ?? "error", data?.message ?? fallback, data?.reason, data?.vars);
}

/** Kullanıcıya gösterilecek hata metni, arayüzün dilinde. */
export function errorMessage(err: unknown): string {
  return describeError(err, getLang());
}

async function request<T>(method: string, url: string, body?: unknown, raw?: BodyInit): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw apiError(res.status, data, res.statusText);
  return data as T;
}

const enc = encodeURIComponent;

export interface SnapshotSummary {
  id: string;
  at: number;
  label?: string;
  auto: boolean;
  files: number;
  bytes: number;
  skipped: number;
  added: number;
  changed: number;
  removed: number;
}

export interface SnapshotFile {
  path: string;
  status: "same" | "changed" | "deleted" | "added";
  size: number;
}

const rawApi = {
  snapshots: () => request<{ snapshots: SnapshotSummary[]; encrypted: boolean }>("GET", "/api/snapshots"),
  createSnapshot: (label: string) => request<SnapshotSummary>("POST", "/api/snapshots", { label }),
  snapshotFiles: (id: string) => request<{ files: SnapshotFile[] }>("GET", `/api/snapshots/${enc(id)}/files`).then((r) => r.files),
  snapshotFile: (id: string, path: string) => request<{ path: string; text: string | null; size: number }>("GET", `/api/snapshots/${enc(id)}/file?path=${enc(path)}`),
  restoreSnapshot: (id: string, paths?: string[], beforeLabel?: string) =>
    request<{ restored: number; removed: number; before: string | null }>("POST", `/api/snapshots/${enc(id)}/restore`, { paths, beforeLabel }),
  renameSnapshot: (id: string, label: string | null) => request<SnapshotSummary>("POST", `/api/snapshots/${enc(id)}/rename`, { label }),
  deleteSnapshot: (id: string) => request<unknown>("DELETE", `/api/snapshots/${enc(id)}`),
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
  capture: (text: string, title?: string) => request<NodeDoc | { routed: CaptureResult }>("POST", "/api/capture", { text, title }),
  captureConfig: () => request<CaptureConfig>("GET", "/api/capture-config"),
  setCaptureConfig: (config: CaptureConfig) => request<CaptureConfig>("PUT", "/api/capture-config", config),
  promote: (id: string, input: { kind?: CaptureKind; target?: string }) => request<CaptureResult>("POST", `/api/nodes/${enc(id)}/promote`, input),
  manuscript: (id: string) => request<CompiledManuscript>("GET", `/api/nodes/${enc(id)}/manuscript`),
  comments: (id: string) => request<{ comments: NoteComment[] }>("GET", `/api/nodes/${enc(id)}/comments`).then((r) => r.comments),
  addComment: (id: string, anchor: CommentAnchor, body: string) => request<NoteComment>("POST", `/api/nodes/${enc(id)}/comments`, { anchor, body }),
  updateComment: (id: string, commentId: string, patch: { body?: string; resolved?: boolean }) => request<NoteComment>("POST", `/api/nodes/${enc(id)}/comments`, { action: "update", commentId, ...patch }),
  replyComment: (id: string, commentId: string, body: string) => request<NoteComment>("POST", `/api/nodes/${enc(id)}/comments`, { action: "reply", commentId, body }),
  deleteComment: (id: string, commentId: string) => request<unknown>("POST", `/api/nodes/${enc(id)}/comments`, { action: "delete", commentId }),
  commentCounts: () => request<{ counts: Record<string, number> }>("GET", "/api/comments").then((r) => r.counts),
  checkpoint: (id: string, label: string) => request<HistoryEntry>("POST", `/api/nodes/${enc(id)}/checkpoint`, { label }),
  deleteHistory: (id: string, at: number) => request<unknown>("POST", `/api/nodes/${enc(id)}/history-delete`, { at }),
  wiki: (id: string) => request<{ entries: WikiEntry[] }>("GET", `/api/nodes/${enc(id)}/wiki`).then((r) => r.entries),
  wikiMentions: (id: string) => request<{ mentions: WikiMention[] }>("GET", `/api/nodes/${enc(id)}/wiki-mentions`).then((r) => r.mentions),
  wikiTerms: () => request<{ terms: WikiTerm[] }>("GET", "/api/wiki-terms").then((r) => r.terms),
  aiState: () =>
    request<{ clients: { name: string; provider: string | null; firstSeen: number; lastSeen: number }[]; requests: AiRequest[] }>("GET", "/api/ai"),
  aiRequest: (input: { provider: string | null; label: string; instruction: string; nodeId?: string; nodeTitle?: string; selection?: string; language?: string; readOnly?: boolean }) =>
    request<AiRequest>("POST", "/api/ai/requests", input),
  aiClear: () => request<{ archived: number; kept: number }>("POST", "/api/ai/clear"),
  aiCancel: (id: string, reply: string) => request<AiRequest>("POST", `/api/ai/requests/${enc(id)}/cancel`, { reply }),
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
  history: (id: string) => request<{ entries: HistoryEntry[] }>("GET", `/api/nodes/${enc(id)}/history`).then((r) => r.entries),
  historyBody: (id: string, at: number) => request<{ body: string }>("GET", `/api/nodes/${enc(id)}/history?at=${at}`).then((r) => r.body),
  restoreHistory: (id: string, at: number, baseRevision?: string) => request<NodeDoc>("POST", `/api/nodes/${enc(id)}/restore`, { at, baseRevision }),
  graph: () => request<LinkGraph>("GET", "/api/graph"),
  snippets: () => request<{ snippets: { name: string; css: string }[] }>("GET", "/api/snippets").then((r) => r.snippets),
  upload: (file: File) => request<{ path: string }>("POST", `/api/attachments?name=${enc(file.name)}`, undefined, file),
  sealLayout: (archeId: string) => request<{ moved: number }>("POST", `/api/nodes/${enc(archeId)}/seal-layout`),
};

/** Sunucuya giden ham işlemler (Crypta zarfları açılmadan); yalnızca crypta.ts ve şifreleme akışları kullanır. */
export const rawNodeApi = rawApi;

// Bütün cevaplar Crypta'dan geçer: tam şifreli Arche'nin notları Arche açıksa gerçek başlıklarıyla, kapalıysa yer
// tutucuyla görünür. Not yazan işlemler zarfa çevrilir (bkz. crypta.ts).
const revealed = Object.fromEntries(
  Object.entries(rawApi).map(([name, fn]) => [name, (...args: unknown[]) => (fn as (...a: unknown[]) => Promise<unknown>)(...args).then(reveal)]),
) as unknown as typeof rawApi;

export const api: typeof rawApi = { ...revealed, ...cryptaApi(rawApi) } as typeof rawApi;

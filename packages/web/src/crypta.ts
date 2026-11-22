// Crypta tam şifreleme (archeLock.v 2): şifreli Arche'deki notların başlığı, sayfa alanları, özellikleri ve ağaçtaki
// yeri Arche'nin anahtarıyla şifreli bir zarfta (`sealed` alanı) durur. Sunucu zarfı açamaz: mühürlü notu "Crypta"
// başlığıyla, rastgele dosya adıyla ve Arche klasöründe düz olarak tutar (core/src/node-store.ts). Bu modül zarfın
// arayüzdeki tek sahibidir: API cevaplarındaki mühürlü notları Arche açıksa çözer (kapalıysa yer tutucu gösterir),
// yazmaları zarfa çevirir ve Arche'yi mühürler (şifreleme, eski şifreli Arche'leri yükseltme, şifreyi kaldırma).

import { isLockedBody } from "../../core/src/note-text.ts";
import type { NodeDoc, NodeMeta, PageFieldPatch, PageFields, ParentTarget } from "./api.ts";
import { t } from "./i18n/index.ts";
import { envelopeArche, isArcheUnlocked, onLockChange, openEnvelope, openWithSession, sealEnvelope, sealForArche } from "./lock.ts";

/** Sunucunun mühürlü nota verdiği başlık (core/src/node-store.ts SEALED_TITLE). */
const SEALED_TITLE = "Crypta";
/** Mühürlü dosyada açık kalan alanlar; geri kalan her şey zarftadır. */
const PLAIN_FIELDS = new Set(["locked", "sealed", "archeLock"]);

/** Zarfın içeriği. */
export interface Envelope {
  title: string;
  /** Ağaçtaki üst Node; Arche'nin kökü için null. */
  parentNodeId: string | null;
  fields: Record<string, unknown>;
  properties: Record<string, unknown>;
}

type Patch = { body?: string; title?: string; baseRevision?: string; fields?: PageFieldPatch; properties?: Record<string, unknown> };

/** Sarılan ham API (api.ts); döngüsel içe aktarma olmasın diye yapısal tip. */
export interface RawApi {
  list(): Promise<NodeMeta[]>;
  read(id: string): Promise<NodeDoc>;
  create(title: string, parentNodeId: ParentTarget, body?: string, fields?: PageFields): Promise<NodeDoc>;
  update(id: string, patch: Patch): Promise<NodeDoc>;
  move(id: string, parentNodeId: ParentTarget): Promise<NodeDoc>;
  reorder(parentNodeId: ParentTarget, ids: string[]): Promise<{ nodes: NodeMeta[] }>;
  duplicate(id: string, input?: { parentNodeId?: ParentTarget; title?: string; fields?: PageFields }): Promise<NodeDoc>;
  trash(id: string): Promise<unknown>;
  sealLayout(archeId: string): Promise<{ moved: number }>;
}

/** Açılmış zarflar (zarf metni → içerik); her yazmada yeni IV olduğundan zarf metni sürüm kimliği gibidir. */
const opened = new Map<string, Envelope>();
/** Bilinen mühürlü notlar: id → zarf metni ve çözülmüş başlık (arama, grafik gibi cevaplardaki başlıklar için). */
const known = new Map<string, { sealed: string; title?: string }>();

// Arche kapanınca (ya da açılınca) çözülmüş zarflar ve başlıklar bellekten silinir.
onLockChange(() => {
  opened.clear();
  for (const k of known.values()) delete k.title;
});

async function open(sealed: string): Promise<Envelope | null> {
  // Önbellek de kilide bağlıdır: Arche kapalıyken daha önce açılmış zarf bile çözülmez.
  const owner = envelopeArche(sealed);
  if (!owner || !isArcheUnlocked(owner)) return null;
  const hit = opened.get(sealed);
  if (hit) return hit;
  const v = (await openEnvelope(sealed)) as Envelope | null;
  if (!v || typeof v.title !== "string") return null;
  const env: Envelope = {
    title: v.title,
    parentNodeId: typeof v.parentNodeId === "string" ? v.parentNodeId : null,
    fields: v.fields && typeof v.fields === "object" ? v.fields : {},
    properties: v.properties && typeof v.properties === "object" ? v.properties : {},
  };
  if (opened.size > 5000) opened.clear();
  opened.set(sealed, env);
  return env;
}

const aliasesOf = (props: Record<string, unknown>): string[] => {
  const v = props.aliases;
  const items = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  return items.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean);
};

/** Mühürlü notun arayüzdeki hâli: Arche açıksa gerçek başlık, alanlar ve ağaç yeri; kapalıysa yer tutucu. */
async function revealOne<T extends NodeMeta>(m: T): Promise<T & { cryptaLocked?: true }> {
  if (!m.sealed) return m;
  const env = await open(m.sealed);
  const owner = envelopeArche(m.sealed);
  if (!env) {
    known.set(m.id, { sealed: m.sealed });
    return { ...m, title: t(m.id === m.archeId ? "crypta.lockedArche" : "crypta.lockedNote"), cryptaLocked: true };
  }
  known.set(m.id, { sealed: m.sealed, title: env.title });
  // Ağaç yeri zarftadır, ama yalnızca not kendi Arche'sinde duruyorsa; başka yere taşınmış mühürlü notun yeri
  // klasör düzeninden bilinir.
  const home = m.archeId !== null && owner === m.archeId;
  const parent = m.id === m.archeId ? null : home ? (env.parentNodeId ?? m.archeId) : m.parentNodeId;
  const fields = env.fields as PageFields;
  const out = {
    ...m,
    ...fields,
    title: env.title,
    parentNodeId: parent,
    layoutMode: fields.layout ?? "stream",
    aliases: aliasesOf(env.properties),
  } as T;
  if ("body" in m) (out as unknown as NodeDoc).properties = env.properties;
  return out;
}

/** Bir API cevabındaki bütün Node'ları çözer (liste, tek not, arama sonucu, grafik…). */
export async function reveal<T>(value: T): Promise<T> {
  const walk = async (v: unknown): Promise<unknown> => {
    if (Array.isArray(v)) return Promise.all(v.map(walk));
    if (!v || typeof v !== "object") return v;
    const o = v as Record<string, unknown>;
    if (typeof o.id === "string" && typeof o.sealed === "string" && typeof o.title === "string") return revealOne(o as unknown as NodeMeta);
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(o)) out[k] = await walk(x);
    // Zarfı taşımayan özetlerde (arama, grafik, geri bağlantılar) başlık bilinen zarftan gelir.
    if (typeof out.id === "string" && typeof out.title === "string" && known.has(out.id)) {
      const k = known.get(out.id)!;
      out.title = k.title ?? t("crypta.lockedNote");
    }
    return out;
  };
  return (await walk(value)) as T;
}

/** Liste: kapalı şifreli Arche'nin notları gizlenir (yalnızca Arche'nin kendisi yer tutucuyla görünür). */
async function revealList(nodes: NodeMeta[]): Promise<NodeMeta[]> {
  const out = await reveal(nodes);
  const ids = new Set(out.map((n) => n.id));
  return out
    .filter((n) => !((n as { cryptaLocked?: true }).cryptaLocked && n.id !== n.archeId && n.sealed && envelopeArche(n.sealed) === n.archeId))
    .map((n) => (n.parentNodeId && !ids.has(n.parentNodeId) ? { ...n, parentNodeId: n.archeId === n.id ? null : n.archeId } : n));
}

/** Tam şifreli Arche'nin kökü (Arche tam şifreli değilse null). */
function fullArche(nodes: NodeMeta[], archeId: string | null): NodeMeta | null {
  const root = archeId ? nodes.find((n) => n.id === archeId) : undefined;
  return root && root.archeLock?.v === 2 ? root : null;
}

function splitFields(fields: PageFieldPatch | PageFields | undefined): { plain: Record<string, unknown>; inner: Record<string, unknown> } {
  const plain: Record<string, unknown> = {};
  const inner: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields ?? {})) (PLAIN_FIELDS.has(k) ? plain : inner)[k] = v;
  return { plain, inner };
}

function lockedError(): Error {
  return Object.assign(new Error(t("crypta.lockedArche")), { reason: "crypta_locked", vars: {} });
}

/**
 * Şifreli Arche'nin henüz mühürlenmemiş notlarını (eski şifreli Arche, dışarıdan eklenen ya da taşınan notlar, yapay
 * zekâ araçlarının oluşturduğu notlar) mühürler, sonra dosya düzenini mühürletir. Arche açık olmalı.
 */
export async function sealArche(raw: RawApi, archeId: string, onProgress?: (done: number, total: number) => void): Promise<number> {
  if (!isArcheUnlocked(archeId)) throw lockedError();
  const nodes = await raw.list();
  const todo = nodes.filter((n) => n.archeId === archeId && !n.sealed);
  for (const [i, m] of todo.entries()) {
    const doc = await raw.read(m.id);
    const { plain, inner } = splitFields(pageFieldsOf(doc));
    const env: Envelope = {
      title: doc.title,
      parentNodeId: doc.id === archeId ? null : doc.parentNodeId,
      fields: inner,
      properties: doc.properties ?? {},
    };
    const sealed = await sealEnvelope(archeId, env);
    if (!sealed) throw lockedError();
    // Kendi parolasıyla kilitli gövde olduğu gibi kalır; açık gövde Arche'nin anahtarıyla şifrelenir.
    const body = isLockedBody(doc.body) ? undefined : await sealForArche(archeId, doc.body, t("lock.notice"));
    await raw.update(doc.id, {
      ...(body ? { body } : {}),
      fields: { ...(plain as PageFieldPatch), locked: true, sealed },
      baseRevision: doc.revision,
    });
    onProgress?.(i + 1, todo.length);
  }
  await raw.sealLayout(archeId);
  return todo.length;
}

/** Node'un sayfa alanları (NodeMeta'nın türetilmiş alanları olmadan). */
function pageFieldsOf(doc: NodeDoc): PageFields {
  const keys: (keyof PageFields)[] = [
    "layout",
    "icon",
    "cover",
    "order",
    "favorite",
    "template",
    "publish",
    "props",
    "database",
    "pinned",
    "locked",
    "font",
    "fontSize",
    "lightBg",
    "sortChecked",
    "wordGoal",
    "wikiFields",
    "noMentions",
    "titleRich",
    "archeLock",
  ];
  const out: Record<string, unknown> = {};
  for (const k of keys) if (doc[k] !== undefined) out[k] = doc[k];
  return out as PageFields;
}

/**
 * Tam şifreli Arche'nin şifrelemesini kaldırır: zarflar açılır, başlıklar ve alanlar açık yazılır, ağaç klasörlere
 * geri kurulur, gövdeler çözülür. Arche'nin anahtarıyla şifreli olup başka yere taşınmış notlar da çözülür.
 */
export async function unsealArche(raw: RawApi, archeId: string, onProgress?: (done: number, total: number) => void): Promise<{ done: number; skipped: number }> {
  if (!isArcheUnlocked(archeId)) throw lockedError();
  const nodes = await raw.list();
  const mine = nodes.filter((n) => (n.sealed && envelopeArche(n.sealed) === archeId) || (n.locked && n.archeId === archeId) || n.id === archeId);
  // Önce bütün zarflar okunur: ağaç, zarflar açıldıktan sonra yalnızca buradan bilinir.
  const envs = new Map<string, Envelope>();
  for (const n of mine) if (n.sealed) {
    const env = await open(n.sealed);
    if (env) envs.set(n.id, env);
  }
  let done = 0;
  let skipped = 0;
  const order = [...mine].sort((a, b) => (a.id === archeId ? -1 : b.id === archeId ? 1 : 0));
  for (const [i, m] of order.entries()) {
    const doc = await raw.read(m.id);
    const env = envs.get(m.id);
    const ownBody = isLockedBody(doc.body) ? await openWithSession(doc.id, doc.body) : doc.body;
    if (ownBody === null && !env) {
      skipped++;
      continue;
    }
    const fields: PageFieldPatch = { ...((env?.fields ?? {}) as PageFieldPatch), sealed: null };
    if (ownBody !== null) fields.locked = null;
    await raw.update(doc.id, {
      ...(ownBody !== null && ownBody !== doc.body ? { body: ownBody } : {}),
      ...(env ? { title: env.title, properties: env.properties } : {}),
      fields,
      baseRevision: doc.revision,
    });
    if (ownBody === null) skipped++;
    else done++;
    onProgress?.(i + 1, order.length);
  }
  // Ağacı klasörlere geri kur: üst notlar önce.
  const placed = new Set<string>([archeId]);
  const pending = [...envs.entries()].filter(([id, env]) => id !== archeId && env.parentNodeId && env.parentNodeId !== archeId);
  for (let guard = 0; pending.length && guard < 10_000; guard++) {
    const i = pending.findIndex(([, env]) => placed.has(env.parentNodeId!) || !envs.has(env.parentNodeId!));
    const [id, env] = pending.splice(i < 0 ? 0 : i, 1)[0];
    if (nodes.some((n) => n.id === env.parentNodeId)) await raw.move(id, env.parentNodeId).catch(() => undefined);
    placed.add(id);
  }
  for (const id of envs.keys()) placed.add(id);
  if (!skipped) await raw.update(archeId, { fields: { archeLock: null } });
  return { done, skipped };
}

/** api.ts'deki ham işlemleri Crypta'ya göre sarar. */
export function cryptaApi(raw: RawApi) {
  /** Güncel zarf: yazmadan önce her zaman sunucudan okunur (başka sekme ya da cihaz değiştirmiş olabilir). */
  const sealedOf = async (id: string): Promise<{ sealed: string; doc: NodeDoc } | null> => {
    const doc = await raw.read(id);
    return doc.sealed ? { sealed: doc.sealed, doc } : null;
  };

  const update = async (id: string, patch: Patch): Promise<NodeDoc> => {
    const s = patch.fields?.sealed === null ? null : await sealedOf(id);
    if (!s) return reveal(await raw.update(id, patch));
    const env = await open(s.sealed);
    const owner = envelopeArche(s.sealed);
    if (!env || !owner) throw lockedError();
    const { plain, inner } = splitFields(patch.fields);
    const next: Envelope = { ...env, fields: { ...env.fields }, properties: { ...env.properties } };
    if (patch.title?.trim()) next.title = patch.title.trim();
    for (const [k, v] of Object.entries(inner)) if (v === null || v === undefined) delete next.fields[k];
    else next.fields[k] = v;
    for (const [k, v] of Object.entries(patch.properties ?? {})) if (v === null || v === undefined) delete next.properties[k];
    else next.properties[k] = v;
    const sealed = await sealEnvelope(owner, next);
    if (!sealed) throw lockedError();
    const saved = await raw.update(id, {
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      ...(patch.baseRevision ? { baseRevision: patch.baseRevision } : {}),
      fields: { ...(plain as PageFieldPatch), sealed },
    });
    return reveal(saved);
  };

  /** Hedefin bulunduğu tam şifreli Arche (yoksa null); Arche kapalıysa hata. */
  const targetArche = async (parent: ParentTarget): Promise<NodeMeta | null> => {
    if (!parent || parent === "shadow") return null;
    const nodes = await raw.list();
    const p = nodes.find((n) => n.id === parent);
    const root = fullArche(nodes, p?.archeId ?? null);
    if (root && !isArcheUnlocked(root.id)) throw lockedError();
    return root;
  };

  const create = async (title: string, parentNodeId: ParentTarget, body?: string, fields?: PageFields): Promise<NodeDoc> => {
    const root = await targetArche(parentNodeId);
    if (!root) return reveal(await raw.create(title, parentNodeId, body, fields));
    const { plain, inner } = splitFields(fields);
    const sealed = await sealEnvelope(root.id, { title, parentNodeId, fields: inner, properties: {} } satisfies Envelope);
    const sealedBody = await sealForArche(root.id, body ?? "", t("lock.notice"));
    if (!sealed || !sealedBody) throw lockedError();
    return reveal(await raw.create(SEALED_TITLE, parentNodeId, sealedBody, { ...(plain as PageFields), locked: true, sealed }));
  };

  /** Mühürlü not ve zarftaki ağaca göre alt notları (kendisi dahil, üstten alta). */
  const subtree = async (id: string): Promise<NodeMeta[]> => {
    const nodes = await revealList(await raw.list());
    const out: NodeMeta[] = [];
    const walk = (nid: string) => {
      const n = nodes.find((x) => x.id === nid);
      if (!n) return;
      out.push(n);
      for (const c of nodes) if (c.parentNodeId === nid && c.id !== nid) walk(c.id);
    };
    walk(id);
    return out;
  };

  const move = async (id: string, parentNodeId: ParentTarget): Promise<NodeDoc> => {
    const s = await sealedOf(id);
    const root = await targetArche(parentNodeId);
    if (s) {
      const owner = envelopeArche(s.sealed);
      if (root && owner === root.id) {
        // Kendi Arche'si içinde taşıma: yalnızca zarftaki üst not değişir.
        const tree = await subtree(id);
        if (tree.some((n) => n.id === parentNodeId)) throw Object.assign(new Error("move_into_self"), { reason: "move_into_self", vars: {} });
        // Başka bir yere taşınmış mühürlü not Arche'sine dönüyorsa önce dosyası Arche klasörüne gelir.
        if (s.doc.archeId !== root.id) await raw.move(id, parentNodeId);
        const fresh = await sealedOf(id);
        const env = fresh ? await open(fresh.sealed) : null;
        if (!env) throw lockedError();
        const sealed = await sealEnvelope(owner, { ...env, parentNodeId } satisfies Envelope);
        if (!sealed) throw lockedError();
        return reveal(await raw.update(id, { fields: { sealed } }));
      }
      return reveal(await raw.move(id, parentNodeId));
    }
    const moved = await raw.move(id, parentNodeId);
    if (root) {
      await sealArche(raw, root.id);
      return reveal(await raw.read(id));
    }
    return reveal(moved);
  };

  return {
    list: async () => revealList(await raw.list()),
    read: async (id: string) => reveal(await raw.read(id)),
    create,
    update,
    move,
    reorder: async (parentNodeId: ParentTarget, ids: string[]) => {
      const root = await targetArche(parentNodeId);
      if (!root) return reveal(await raw.reorder(parentNodeId, ids));
      for (const [index, id] of ids.entries()) {
        await move(id, parentNodeId);
        await update(id, { fields: { order: index } });
      }
      return { nodes: (await revealList(await raw.list())).filter((n) => n.parentNodeId === parentNodeId) };
    },
    duplicate: async (id: string, input: { parentNodeId?: ParentTarget; title?: string; fields?: PageFields } = {}) => {
      const s = await sealedOf(id);
      if (!s) return reveal(await raw.duplicate(id, input));
      // Mühürlü kaynak: kopyalar arayüzde zarfıyla oluşturulur (sunucu zarfı açamaz).
      const tree = await subtree(id);
      const idMap = new Map<string, string>();
      let first: NodeDoc | null = null;
      for (const n of tree) {
        const src = await reveal(await raw.read(n.id));
        const isRoot = n.id === id;
        const parent = isRoot ? (input.parentNodeId === undefined ? src.parentNodeId : input.parentNodeId) : idMap.get(n.parentNodeId!)!;
        const { template: _t, ...rest } = pageFieldsOf(src);
        const fields = { ...rest, ...(isRoot ? input.fields : {}) };
        delete fields.locked;
        delete (fields as { sealed?: string }).sealed;
        const body = isLockedBody(src.body) ? ((await openWithSession(src.id, src.body)) ?? "") : src.body;
        const copy = await create(isRoot ? input.title?.trim() || src.title : src.title, parent, body, fields);
        if (Object.keys(src.properties ?? {}).length) await update(copy.id, { properties: src.properties });
        idMap.set(n.id, copy.id);
        first ??= copy;
      }
      return reveal(await raw.read(first!.id));
    },
    trash: async (id: string) => {
      const s = await sealedOf(id);
      if (!s) return raw.trash(id);
      // Mühürlü notun alt notları zarftaki ağaçtadır: önce onlar çöpe gider.
      const tree = await subtree(id);
      for (const n of tree.reverse()) await raw.trash(n.id);
      return { id };
    },
  };
}

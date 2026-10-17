// Nularche arşivleri (RFC-001 §3.2):
//   .nla  Nularche Archive   – Origin'in tamamının ya da bir şablon setinin yedeği
//   .nlc  Nularche Container – tek bir Node'un (alt Node'ları ve ekleriyle) taşınabilir paketi
// İkisi de ZIP'tir: `manifest.json`, `nodes/` altında Node'lar (Markdown, klasör yapısı korunur)
// ve `Attachments/` altında başvurulan ekler. Bağlantılar arşiv düzenine göre görelidir; içe aktarırken
// hedef konuma göre yeniden yazılır. `.narc` uzantısı bilerek kullanılmaz.

import { randomUUID } from "node:crypto";
import path from "node:path";
import { unzipSync, zipSync, type Zippable } from "fflate";
import { extractLinks, rewriteLinks } from "./links.ts";
import { parseNodeFile, serializeNodeFile, type Frontmatter } from "./node-file.ts";
import { childDirOf, isFolderNote } from "./layout.ts";
import { ATTACHMENTS_DIR, LEGACY_ATTACHMENTS_DIR, NodeError, NodeStore, SHADOW, SHADOW_DIR, type NodeMeta } from "./node-store.ts";

export const ARCHIVE_FORMAT = "nularche-archive";
export const ARCHIVE_VERSION = 1;
export const ARCHIVE_MIME = { nla: "application/vnd.nularche.archive", nlc: "application/vnd.nularche.document" } as const;
export type ArchiveKind = "nla" | "nlc";

export interface ArchiveManifest {
  format: typeof ARCHIVE_FORMAT;
  version: number;
  kind: ArchiveKind;
  app: "Nularche";
  createdAt: string;
  /** Arşivdeki kök Node yolları (`nodes/` altında). */
  roots: string[];
  nodeCount: number;
  attachmentCount: number;
}

// Sıkıştırma bombalarına karşı sınırlar.
const MAX_ENTRIES = 50_000;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;


/**
 * Node'ları arşivler. `rootId` verilirse yalnızca o Node ve alt Node'ları (.nlc), verilmezse
 * Shadow dahil tüm Origin (.nla) paketlenir.
 */
export async function exportArchive(
  store: NodeStore,
  options: { rootId?: string; kind: ArchiveKind },
): Promise<{ data: Uint8Array; manifest: ArchiveManifest }> {
  const all = await store.list();
  let selected: NodeMeta[];
  let base = ""; // arşivde kırpılacak ortak dizin öneki
  if (options.rootId) {
    const root = all.find((n) => n.id === options.rootId || n.path === options.rootId);
    if (!root) throw new NodeError("not_found", `Node bulunamadı: ${options.rootId}`);
    const dir = childDirOf(root.path);
    selected = all.filter((n) => n.id === root.id || n.path.startsWith(`${dir}/`));
    const container = isFolderNote(root.path) ? path.posix.dirname(path.posix.dirname(root.path)) : path.posix.dirname(root.path);
    base = container === "." ? "" : `${container}/`;
  } else {
    selected = all;
  }

  const moved = new Map<string, string>();
  for (const n of selected) moved.set(n.path, `nodes/${n.path.slice(base.length)}`);

  const files: Zippable = {};
  const attachments = new Set<string>();
  for (const n of selected) {
    const raw = (await store.readRaw(n.path)).toString("utf8");
    const { frontmatter, body } = parseNodeFile(raw);
    for (const link of extractLinks(n.path, body)) {
      if (link.target.startsWith(`${ATTACHMENTS_DIR}/`) && !attachments.has(link.target) && (await store.pathExists(link.target))) {
        attachments.add(link.target);
        moved.set(link.target, link.target);
      }
    }
    const cover = typeof frontmatter.cover === "string" ? frontmatter.cover : "";
    const coverTarget =
      cover && !/^[a-z]+:|^gradient-/i.test(cover) ? path.posix.normalize(path.posix.join(path.posix.dirname(n.path), cover)) : null;
    if (coverTarget?.startsWith(`${ATTACHMENTS_DIR}/`) && (await store.pathExists(coverTarget))) attachments.add(coverTarget);
    const archivePath = moved.get(n.path)!;
    const newBody = rewriteLinks(body, n.path, archivePath, moved);
    const fm: Frontmatter = {
      id: n.id,
      title: n.title,
      created: new Date(n.createdAt).toISOString(),
      updated: new Date(n.updatedAt).toISOString(),
      ...frontmatter,
    };
    if (coverTarget?.startsWith(`${ATTACHMENTS_DIR}/`)) fm.cover = path.posix.relative(path.posix.dirname(archivePath), coverTarget);
    files[archivePath] = new TextEncoder().encode(serializeNodeFile(fm, newBody));
  }
  for (const a of attachments) files[a] = new Uint8Array(await store.readRaw(a));

  const roots = selected
    .filter((n) => !selected.some((p) => p.id !== n.id && n.path.startsWith(`${childDirOf(p.path)}/`)))
    .map((n) => moved.get(n.path)!);
  const manifest: ArchiveManifest = {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    kind: options.kind,
    app: "Nularche",
    createdAt: new Date().toISOString(),
    roots,
    nodeCount: selected.length,
    attachmentCount: attachments.size,
  };
  files["manifest.json"] = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
  return { data: zipSync(files, { level: 6 }), manifest };
}

export interface ImportResult {
  manifest: ArchiveManifest;
  imported: number;
  /** İçe aktarılan kök Node'ların id'leri. */
  rootIds: string[];
  attachments: number;
}

function safeEntry(name: string): boolean {
  if (!name || name.includes("\0") || name.includes("\\") || name.startsWith("/")) return false;
  return name.split("/").every((seg) => seg !== ".." && seg !== "." && !seg.startsWith("."));
}

/**
 * Arşivi içe aktarır. Varsayılan hedef Shadow gelen kutusudur; mevcut Node'lara dokunulmaz.
 * Çakışan adlar numaralandırılır, Origin'de zaten bulunan id'ler yenilenir.
 */
export async function importArchive(store: NodeStore, data: Uint8Array, options: { parentNodeId?: string | null } = {}): Promise<ImportResult> {
  let entries: Record<string, Uint8Array>;
  let count = 0;
  let total = 0;
  try {
    entries = unzipSync(data, {
      filter: (file) => {
        count++;
        total += file.originalSize;
        if (count > MAX_ENTRIES || total > MAX_TOTAL_BYTES) throw new NodeError("invalid", "Arşiv çok büyük");
        return !file.name.endsWith("/");
      },
    });
  } catch (err) {
    if (err instanceof NodeError) throw err;
    throw new NodeError("invalid", "Geçerli bir Nularche arşivi değil (ZIP okunamadı)");
  }
  let manifest: ArchiveManifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(entries["manifest.json"]));
  } catch {
    throw new NodeError("invalid", "Arşivde manifest.json yok ya da bozuk");
  }
  if (manifest?.format !== ARCHIVE_FORMAT || typeof manifest.version !== "number")
    throw new NodeError("invalid", "Geçerli bir Nularche arşivi değil");
  if (manifest.version > ARCHIVE_VERSION)
    throw new NodeError("invalid", `Bu arşiv daha yeni bir Nularche sürümüyle oluşturulmuş (biçim ${manifest.version})`);

  // Hedef dizin
  const parent = options.parentNodeId === undefined ? SHADOW : options.parentNodeId;
  let targetDir = "";
  if (parent === SHADOW) targetDir = SHADOW_DIR;
  else if (parent) targetDir = childDirOf((await store.read(parent)).path);
  const prefix = targetDir ? `${targetDir}/` : "";

  const existingIds = new Set((await store.list()).map((n) => n.id));
  const nodeEntries = Object.keys(entries)
    .filter((n) => n.startsWith("nodes/") && n.toLowerCase().endsWith(".md") && safeEntry(n))
    .sort();
  if (nodeEntries.length === 0) throw new NodeError("invalid", "Arşivde Node yok");

  // Kök adlarını çakışmasız seç; alt yollar kökle birlikte taşınır. Arşivin Shadow'undaki
  // notlar hedef Origin'in Shadow'una (gelen kutusu olarak kalarak) eklenir.
  const moved = new Map<string, string>();
  const rootRename = new Map<string, string>(); // "dizin|kök adı" → hedef yol öneki
  for (const entry of nodeEntries) {
    let rel = entry.slice("nodes/".length);
    let dir = prefix;
    if (rel.startsWith(`${SHADOW_DIR}/`)) {
      rel = rel.slice(SHADOW_DIR.length + 1);
      dir = `${SHADOW_DIR}/`;
    }
    const top = rel.split("/")[0].replace(/\.md$/i, "");
    const key = `${dir}|${top}`;
    if (!rootRename.has(key)) {
      let name = top;
      for (let i = 2; (await store.pathExists(`${dir}${name}.md`)) || (await store.pathExists(`${dir}${name}`)); i++) name = `${top} ${i}`;
      rootRename.set(key, `${dir}${name}`);
    }
    const renamed = rootRename.get(key)!;
    let rest = rel.slice(top.length);
    // Kökün klasör notu (`kök/kök.md`) yeni adla birlikte yeniden adlandırılır.
    if (rest === `/${top}.md`) rest = `/${path.posix.basename(renamed)}.md`;
    moved.set(entry, `${renamed}${rest}`);
  }
  let attachments = 0;
  for (const entry of Object.keys(entries)) {
    // Eski sürümlerin arşivlerinde ekler `ekler/` altındadır.
    if (!(entry.startsWith(`${ATTACHMENTS_DIR}/`) || entry.startsWith(`${LEGACY_ATTACHMENTS_DIR}/`)) || !safeEntry(entry)) continue;
    moved.set(entry, await store.saveAttachment(path.posix.basename(entry), entries[entry]));
    attachments++;
  }

  const rootIds: string[] = [];
  const rootSet = new Set(manifest.roots ?? []);
  for (const entry of nodeEntries) {
    const target = moved.get(entry)!;
    const { frontmatter, body } = parseNodeFile(new TextDecoder().decode(entries[entry]));
    let id = typeof frontmatter.id === "string" ? frontmatter.id : randomUUID();
    if (existingIds.has(id)) id = randomUUID();
    existingIds.add(id);
    const fm: Frontmatter = { ...frontmatter, id };
    if (typeof fm.cover === "string" && !/^[a-z]+:|^gradient-/i.test(fm.cover)) {
      const coverArchive = path.posix.normalize(path.posix.join(path.posix.dirname(entry), fm.cover));
      const coverTarget = moved.get(coverArchive);
      if (coverTarget) fm.cover = path.posix.relative(path.posix.dirname(target), coverTarget);
      else delete fm.cover;
    }
    await store.writeNew(target, serializeNodeFile(fm, rewriteLinks(body, entry, target, moved)));
    const relEntry = entry.slice("nodes/".length).replace(new RegExp(`^${SHADOW_DIR}/`), "");
    if (rootSet.has(entry) || !relEntry.includes("/")) rootIds.push(id);
  }
  // Eski düzende paketlenmiş arşivler klasör notuna çevrilir.
  await store.normalizeLayout();
  return { manifest, imported: nodeEntries.length, rootIds: [...new Set(rootIds)], attachments };
}

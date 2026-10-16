// Node deposu: bir Origin klasöründeki Markdown dosyalarının tek sahibi.
// Sunucu ve MCP sunucusu Node'lara yalnızca bu modül üzerinden erişir.
//
// Nularche ortak dili:
//   Origin  – kök veri kasası (bu klasör)
//   Arche   – Origin kökündeki Node'lar (ana sütunlar/projeler)
//   Node    – her sayfa; bir `.md` dosyası. `a/b.md` Node'unun alt Node'ları `a/b/` klasöründedir
//   Shadow  – `Shadow/` klasöründeki henüz bir Arche'ye bağlanmamış ham notlar (gelen kutusu)
// Kimlik (id) frontmatter'da saklanır ve yeniden adlandırma/taşımada değişmez.
// Ekler Origin kökündeki `ekler/` klasörüne yazılır.

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractLinks, rewriteLinks } from "./links.ts";
import { parseNodeFile, revisionOf, serializeNodeFile, slugify, type Frontmatter } from "./node-file.ts";

export { parseNodeFile, revisionOf, serializeNodeFile, slugify } from "./node-file.ts";

export type NodeErrorCode = "not_found" | "conflict" | "invalid";

export class NodeError extends Error {
  readonly code: NodeErrorCode;
  readonly details?: Record<string, unknown>;
  constructor(code: NodeErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "NodeError";
    this.code = code;
    this.details = details;
  }
}

export type LayoutMode = "stream" | "canvas";

/** Frontmatter'da tutulan, uygulamanın anlamlandırdığı isteğe bağlı Node alanları. */
export interface PageFields {
  /** `canvas`: serbest tuval (OneNote benzeri); yoksa dikey akış (stream). */
  layout?: LayoutMode;
  /** Emoji ikon. */
  icon?: string;
  /** Kapak: renk/gradyan adı, http(s) URL'si ya da göreli resim yolu. */
  cover?: string;
  /** Kardeşler arasında elle sıralama. */
  order?: number;
  favorite?: boolean;
  template?: boolean;
  publish?: boolean;
  /** Veritabanı satırının özellik değerleri. */
  props?: Record<string, unknown>;
  /** Veritabanı sayfasının şeması ve görünümleri. */
  database?: Record<string, unknown>;
}

export const PAGE_FIELD_KEYS = ["layout", "icon", "cover", "order", "favorite", "template", "publish", "props", "database"] as const;
export type PageFieldKey = (typeof PAGE_FIELD_KEYS)[number];
export type PageFieldPatch = { [K in PageFieldKey]?: PageFields[K] | null };

export interface NodeMeta extends PageFields {
  id: string;
  title: string;
  /** Origin'e göre POSIX yolu, ör. `Projeler/Toplanti.md`. */
  path: string;
  /** Üst Node'un id'si; Arche'ler ve Shadow'daki kök notlar için null. */
  parentNodeId: string | null;
  /** Bağlı olduğu Arche (kök ata) id'si; Shadow'daki Node'lar için null. Arche'nin kendisi için kendi id'si. */
  archeId: string | null;
  layoutMode: LayoutMode;
  /** Unix zamanı (ms). */
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
  score: number;
  snippet: string;
}

export const TRASH_DIR = ".trash";
export const ATTACHMENTS_DIR = "ekler";
export const SHADOW_DIR = "Shadow";
/** `move` ve `create` için Shadow hedefi. */
export const SHADOW = "shadow";

export interface ShadowView {
  /** `Shadow/` gelen kutusundaki ham notlar. */
  inbox: NodeMeta[];
  /** Hiçbir Node'a bağlantı vermeyen ve bağlantı almayan, Arche olmayan Node'lar. */
  unlinked: NodeMeta[];
}

function asString(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (v instanceof Date) return v.toISOString();
  return undefined;
}

function pageFields(fm: Frontmatter): PageFields {
  const out: PageFields = {};
  if (fm.layout === "canvas") out.layout = "canvas";
  if (typeof fm.icon === "string" && fm.icon) out.icon = fm.icon;
  if (typeof fm.cover === "string" && fm.cover) out.cover = fm.cover;
  if (typeof fm.order === "number" && Number.isFinite(fm.order)) out.order = fm.order;
  if (fm.favorite === true) out.favorite = true;
  if (fm.template === true) out.template = true;
  if (fm.publish === true) out.publish = true;
  if (fm.props && typeof fm.props === "object" && !Array.isArray(fm.props)) out.props = fm.props as Record<string, unknown>;
  if (fm.database && typeof fm.database === "object" && !Array.isArray(fm.database)) out.database = fm.database as Record<string, unknown>;
  return out;
}

/** Frontmatter'ında id olmayan (dışarıdan eklenmiş) dosyalar için yoldan türetilen kararlı id. */
function derivedId(seed: string): string {
  const h = createHash("sha256").update(`nularche:${seed}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const iso = (ms: number) => new Date(ms).toISOString();

/** Uygulamanın yazacağı frontmatter: diskteki değerler korunur, eksik kimlik alanları bellekteki meta'dan tamamlanır. */
function completeFrontmatter(fm: Frontmatter, meta: Pick<NodeMeta, "id" | "title" | "createdAt" | "updatedAt">): Frontmatter {
  return { id: meta.id, title: meta.title, created: iso(meta.createdAt), updated: iso(meta.updatedAt), ...fm };
}

/** Taranmayan klasörler (gizli klasörler zaten atlanır). */
const IGNORED_DIRS = new Set(["node_modules"]);

function lowerTr(s: string): string {
  return s.toLocaleLowerCase("tr");
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function childDirOf(notePath: string): string {
  return notePath.slice(0, -3);
}

interface CacheEntry {
  mtimeMs: number;
  size: number;
  meta: Omit<NodeMeta, "parentNodeId" | "archeId">;
  body: string;
  frontmatter: Frontmatter;
}

interface Loaded {
  meta: NodeMeta;
  body: string;
  frontmatter: Frontmatter;
}

export class NodeStore {
  readonly root: string;
  /** Mutlak yol → son okunan içerik; mtime/boyut değişmedikçe dosya yeniden okunmaz. */
  private cache = new Map<string, CacheEntry>();

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  /** Vault'a göre bir yolu mutlak yola çevirir; vault dışına ve gizli klasörlere çıkışı reddeder. */
  abs(relPath: string): string {
    if (typeof relPath !== "string" || relPath === "" || path.isAbsolute(relPath) || relPath.includes("\0")) {
      throw new NodeError("invalid", `Geçersiz yol: ${relPath}`);
    }
    const resolved = path.resolve(this.root, relPath);
    const rel = path.relative(this.root, resolved);
    if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new NodeError("invalid", `Yol vault dışında: ${relPath}`);
    }
    if (rel.split(path.sep).some((seg) => seg.startsWith("."))) {
      throw new NodeError("invalid", `Gizli yol kullanılamaz: ${relPath}`);
    }
    return resolved;
  }

  private async atomicWrite(absPath: string, content: string | Uint8Array): Promise<void> {
    await mkdir(path.dirname(absPath), { recursive: true });
    const tmp = path.join(path.dirname(absPath), `.${path.basename(absPath)}.${randomUUID()}.tmp`);
    await writeFile(tmp, content);
    await rename(tmp, absPath);
  }

  private async collectFiles(dir: string, out: string[]): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (dir === this.root && entry.name === ATTACHMENTS_DIR) continue;
        if (IGNORED_DIRS.has(entry.name)) continue;
        await this.collectFiles(full, out);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) out.push(full);
    }
  }

  /**
   * Dosyayı okur. Okuma asla dosyayı değiştirmez: frontmatter'ı eksik (dışarıdan eklenmiş) dosyaların
   * id/başlık/tarihleri bellekte türetilir ve ancak Node uygulamada düzenlendiğinde dosyaya yazılır.
   */
  private async loadFile(absPath: string): Promise<CacheEntry> {
    const st = await stat(absPath);
    const cached = this.cache.get(absPath);
    if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) return cached;
    const text = await readFile(absPath, "utf8");
    const parsed = parseNodeFile(text);
    const fm = parsed.frontmatter;
    const rel = toPosix(path.relative(this.root, absPath));
    const id = asString(fm.id) || derivedId(rel);
    const title = asString(fm.title) || path.basename(absPath, path.extname(absPath));
    const created = asString(fm.created);
    const updated = asString(fm.updated);
    const entry: CacheEntry = {
      mtimeMs: st.mtimeMs,
      size: st.size,
      frontmatter: fm,
      body: parsed.body,
      meta: {
        id,
        title,
        path: rel,
        createdAt: (created && Date.parse(created)) || st.birthtimeMs,
        updatedAt: (updated && Date.parse(updated)) || st.mtimeMs,
        revision: revisionOf(text),
        layoutMode: fm.layout === "canvas" ? "canvas" : "stream",
        ...pageFields(fm),
      },
    };
    this.cache.set(absPath, entry);
    return entry;
  }

  private async loadAll(): Promise<Map<string, Loaded>> {
    const files: string[] = [];
    await this.collectFiles(this.root, files);
    const live = new Set(files);
    for (const key of this.cache.keys()) if (!live.has(key)) this.cache.delete(key);
    const byPath = new Map<string, CacheEntry>();
    for (const file of files) {
      try {
        const loaded = await this.loadFile(file);
        byPath.set(loaded.meta.path, loaded);
      } catch (err) {
        // Tarama sırasında silinen/taşınan dosya: atla.
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    }
    const byId = new Map<string, Loaded>();
    for (const entry of byPath.values()) {
      const { body, frontmatter } = entry;
      let { meta } = entry;
      // Kopyalanmış dosyada çakışan id: dosyaya dokunmadan ikinciye yoldan türetilmiş id ver;
      // Node düzenlendiğinde bu id frontmatter'a yazılır.
      if (byId.has(meta.id)) meta = { ...meta, id: derivedId(`dup:${meta.path}`) };
      const dir = path.posix.dirname(meta.path);
      const parent = dir === "." || dir === SHADOW_DIR ? undefined : byPath.get(`${dir}.md`);
      const top = meta.path.split("/")[0];
      const inShadow = top === SHADOW_DIR && meta.path.includes("/");
      const arche = inShadow ? undefined : byPath.get(top.endsWith(".md") ? top : `${top}.md`);
      byId.set(meta.id, { meta: { ...meta, parentNodeId: parent?.meta.id ?? null, archeId: arche?.meta.id ?? null }, body, frontmatter });
    }
    return byId;
  }

  private sortSiblings(a: NodeMeta, b: NodeMeta): number {
    const oa = a.order ?? Number.POSITIVE_INFINITY;
    const ob = b.order ?? Number.POSITIVE_INFINITY;
    if (oa !== ob) return oa - ob;
    return a.title.localeCompare(b.title, "tr");
  }

  async list(options: { parentNodeId?: string | null } = {}): Promise<NodeMeta[]> {
    const all = [...(await this.loadAll()).values()].map((n) => n.meta);
    const filtered = options.parentNodeId === undefined ? all : all.filter((m) => m.parentNodeId === options.parentNodeId);
    return filtered.sort((a, b) => (a.parentNodeId === b.parentNodeId ? this.sortSiblings(a, b) : a.path.localeCompare(b.path, "tr")));
  }

  /** id veya vault yoluyla (".md" uzantısı isteğe bağlı) notu bulur. */
  private async find(ref: string, all?: Map<string, Loaded>): Promise<Loaded> {
    all ??= await this.loadAll();
    const byId = all.get(ref);
    if (byId) return byId;
    const wanted = toPosix(ref.toLowerCase().endsWith(".md") ? ref : `${ref}.md`);
    for (const n of all.values()) if (n.meta.path === wanted) return n;
    throw new NodeError("not_found", `Node bulunamadı: ${ref}`);
  }

  async read(ref: string): Promise<NodeDoc> {
    const { meta, body } = await this.find(ref);
    return { ...meta, body };
  }

  private async exists(rel: string): Promise<boolean> {
    try {
      await stat(this.abs(rel));
      return true;
    } catch {
      return false;
    }
  }

  private async uniquePath(dirRel: string, title: string, except?: string): Promise<string> {
    const slug = slugify(title);
    for (let i = 1; ; i++) {
      const name = i === 1 ? `${slug}.md` : `${slug} ${i}.md`;
      const rel = dirRel ? `${dirRel}/${name}` : name;
      if (rel === except) return rel;
      if (!dirRel && [ATTACHMENTS_DIR, SHADOW_DIR.toLowerCase()].includes(name.slice(0, -3).toLowerCase())) continue;
      if (!(await this.exists(rel)) && !(await this.exists(rel.slice(0, -3)))) return rel;
    }
  }

  /** `parentNodeId`: üst Node id'si, kök (yeni Arche) için null, gelen kutusu için `SHADOW`. */
  async create(input: { title: string; parentNodeId?: string | null; body?: string; fields?: PageFields }): Promise<NodeDoc> {
    const title = input.title?.trim();
    if (!title) throw new NodeError("invalid", "Başlık boş olamaz");
    let dirRel = "";
    if (input.parentNodeId === SHADOW) dirRel = SHADOW_DIR;
    else if (input.parentNodeId) dirRel = childDirOf((await this.find(input.parentNodeId)).meta.path);
    const rel = await this.uniquePath(dirRel, title);
    const now = new Date().toISOString();
    const fields = Object.fromEntries(
      Object.entries(input.fields ?? {}).filter(([k, v]) => (PAGE_FIELD_KEYS as readonly string[]).includes(k) && v != null),
    );
    const text = serializeNodeFile({ id: randomUUID(), title, created: now, updated: now, ...fields }, input.body ?? "");
    await this.atomicWrite(this.abs(rel), text);
    return this.read(rel);
  }

  private checkRevision(current: NodeMeta, baseRevision: string | undefined): void {
    if (baseRevision !== undefined && baseRevision !== current.revision) {
      throw new NodeError("conflict", "Node siz okuduktan sonra değişmiş; yeniden okuyup tekrar deneyin.", {
        currentRevision: current.revision,
        baseRevision,
      });
    }
  }

  /**
   * Notu (ve alt sayfa klasörünü) taşır; taşınan notlardaki ve onlara bağlantı veren
   * diğer notlardaki göreli bağlantıları yeniden yazar.
   */
  private async moveTree(fromRel: string, toRel: string): Promise<void> {
    if (fromRel === toRel) return;
    const all = await this.loadAll();
    const fromDir = childDirOf(fromRel);
    const moved = new Map<string, string>();
    for (const n of all.values()) {
      if (n.meta.path === fromRel) moved.set(fromRel, toRel);
      else if (n.meta.path.startsWith(`${fromDir}/`)) moved.set(n.meta.path, `${childDirOf(toRel)}/${n.meta.path.slice(fromDir.length + 1)}`);
    }
    await mkdir(path.dirname(this.abs(toRel)), { recursive: true });
    await rename(this.abs(fromRel), this.abs(toRel));
    if (await this.exists(fromDir)) await rename(this.abs(fromDir), this.abs(childDirOf(toRel)));

    for (const n of all.values()) {
      const oldPath = n.meta.path;
      const newPath = moved.get(oldPath) ?? oldPath;
      const links = extractLinks(oldPath, n.body);
      if (newPath === oldPath && !links.some((l) => moved.has(l.target))) continue;
      if (newPath !== oldPath && links.length === 0) continue;
      const body = rewriteLinks(n.body, oldPath, newPath, moved);
      if (body === n.body) continue;
      const abs = this.abs(newPath);
      const fm = parseNodeFile(await readFile(abs, "utf8")).frontmatter;
      await this.atomicWrite(abs, serializeNodeFile(completeFrontmatter(fm, n.meta), body));
    }
  }

  async update(ref: string, input: { body?: string; title?: string; baseRevision?: string; fields?: PageFieldPatch }): Promise<NodeDoc> {
    const current = await this.find(ref);
    this.checkRevision(current.meta, input.baseRevision);
    const title = input.title?.trim() || current.meta.title;
    let rel = current.meta.path;
    if (title !== current.meta.title) {
      const dir = path.posix.dirname(rel);
      const target = await this.uniquePath(dir === "." ? "" : dir, title, slugify(current.meta.title) === slugify(title) ? rel : undefined);
      await this.moveTree(rel, target);
      rel = target;
    }
    const abs = this.abs(rel);
    const parsed = parseNodeFile(await readFile(abs, "utf8"));
    const fm: Frontmatter = {
      ...completeFrontmatter(parsed.frontmatter, current.meta),
      id: current.meta.id,
      title,
      updated: new Date().toISOString(),
    };
    for (const [key, value] of Object.entries(input.fields ?? {})) {
      if (!(PAGE_FIELD_KEYS as readonly string[]).includes(key)) throw new NodeError("invalid", `Bilinmeyen alan: ${key}`);
      if (value === null || value === undefined) delete fm[key];
      else fm[key] = value;
    }
    // Başlık değişince bağlantılar yeniden yazılmış olabilir; gövde verilmediyse diskteki güncel gövdeyi koru.
    await this.atomicWrite(abs, serializeNodeFile(fm, input.body ?? parsed.body));
    return this.read(current.meta.id);
  }

  async append(ref: string, text: string, baseRevision?: string): Promise<NodeDoc> {
    const current = await this.find(ref);
    this.checkRevision(current.meta, baseRevision);
    const sep = current.body.trim() === "" ? "" : current.body.endsWith("\n\n") ? "" : current.body.endsWith("\n") ? "\n" : "\n\n";
    return this.update(current.meta.id, { body: `${current.body}${sep}${text}` });
  }

  /** `newParentNodeId`: üst Node id'si, kök (Arche yapmak) için null, gelen kutusu için `SHADOW`. */
  async move(ref: string, newParentNodeId: string | null): Promise<NodeDoc> {
    const all = await this.loadAll();
    const current = await this.find(ref, all);
    let dirRel = "";
    if (newParentNodeId === SHADOW) {
      dirRel = SHADOW_DIR;
    } else if (newParentNodeId) {
      const parent = await this.find(newParentNodeId, all);
      const childDir = childDirOf(current.meta.path);
      if (parent.meta.id === current.meta.id || parent.meta.path.startsWith(`${childDir}/`)) {
        throw new NodeError("invalid", "Bir Node kendi altına taşınamaz");
      }
      dirRel = childDirOf(parent.meta.path);
    }
    const currentDir = path.posix.dirname(current.meta.path);
    if ((currentDir === "." ? "" : currentDir) === dirRel) return this.read(current.meta.id);
    const target = await this.uniquePath(dirRel, current.meta.title);
    await this.moveTree(current.meta.path, target);
    return this.read(current.meta.id);
  }

  /** Kardeş sırasını belirler: `ids` sırasıyla `parentNodeId` altına taşır ve `order` alanını yazar. */
  async reorder(parentNodeId: string | null, ids: string[]): Promise<NodeMeta[]> {
    for (const [index, id] of ids.entries()) {
      const note = await this.move(id, parentNodeId);
      if (note.order !== index) await this.update(id, { fields: { order: index } });
    }
    return this.list({ parentNodeId });
  }

  /** Kalıcı silme yok: notu (ve alt sayfalarını) `.trash/` altına taşır. */
  async trash(ref: string): Promise<{ id: string; trashedTo: string }> {
    const current = await this.find(ref);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const destDir = path.join(this.root, TRASH_DIR, stamp);
    await mkdir(destDir, { recursive: true });
    const name = path.posix.basename(current.meta.path);
    await rename(this.abs(current.meta.path), path.join(destDir, name));
    if (await this.exists(childDirOf(current.meta.path))) {
      await rename(this.abs(childDirOf(current.meta.path)), path.join(destDir, name.slice(0, -3)));
    }
    return { id: current.meta.id, trashedTo: toPosix(path.relative(this.root, path.join(destDir, name))) };
  }

  /** Bu nota bağlantı veren notlar. */
  async backlinks(ref: string): Promise<NodeMeta[]> {
    const all = await this.loadAll();
    const target = (await this.find(ref, all)).meta;
    const out: NodeMeta[] = [];
    for (const n of all.values()) {
      if (n.meta.id === target.id) continue;
      if (extractLinks(n.meta.path, n.body).some((l) => l.target === target.path)) out.push(n.meta);
    }
    return out.sort((a, b) => a.title.localeCompare(b.title, "tr"));
  }

  /** Gelen kutusu ve bağlantısız Node'lar. */
  async shadow(): Promise<ShadowView> {
    const all = await this.loadAll();
    const linked = new Set<string>();
    const byPath = new Map([...all.values()].map((n) => [n.meta.path, n.meta.id]));
    for (const n of all.values()) {
      const targets = extractLinks(n.meta.path, n.body)
        .map((l) => byPath.get(l.target))
        .filter((id): id is string => !!id && id !== n.meta.id);
      if (targets.length) linked.add(n.meta.id);
      for (const t of targets) linked.add(t);
    }
    const metas = [...all.values()].map((n) => n.meta);
    const byRecent = (a: NodeMeta, b: NodeMeta) => b.updatedAt - a.updatedAt;
    return {
      inbox: metas.filter((m) => m.archeId === null).sort(byRecent),
      unlinked: metas.filter((m) => m.archeId !== null && m.archeId !== m.id && !linked.has(m.id)).sort(byRecent),
    };
  }

  /** Hızlı yakalama: metni Shadow gelen kutusuna yeni bir Node olarak yazar. */
  async capture(text: string, title?: string): Promise<NodeDoc> {
    const firstLine = text
      .trim()
      .split("\n")[0]
      .replace(/^#+\s*/, "")
      .trim();
    const name = title?.trim() || (firstLine ? firstLine.slice(0, 60) : `Yakalama ${new Date().toLocaleString("tr-TR")}`);
    return this.create({ title: name, parentNodeId: SHADOW, body: text });
  }

  /** Eki `ekler/` klasörüne benzersiz adla yazar ve vault yolunu döndürür. */
  async saveAttachment(fileName: string, data: Uint8Array): Promise<string> {
    const ext = path
      .extname(fileName)
      .toLowerCase()
      .replace(/[^.a-z0-9]/g, "")
      .slice(0, 10);
    const base = slugify(path.basename(fileName, path.extname(fileName)))
      .replace(/ /g, "-")
      .slice(0, 60);
    for (let i = 1; ; i++) {
      const rel = `${ATTACHMENTS_DIR}/${i === 1 ? base : `${base}-${i}`}${ext}`;
      if (!(await this.exists(rel))) {
        await this.atomicWrite(this.abs(rel), data);
        return rel;
      }
    }
  }

  async search(query: string, limit = 20): Promise<SearchHit[]> {
    const terms = lowerTr(query).split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];
    const hits: SearchHit[] = [];
    for (const { meta, body } of (await this.loadAll()).values()) {
      const title = lowerTr(meta.title);
      const text = lowerTr(body);
      let score = 0;
      let ok = true;
      for (const term of terms) {
        const inTitle = title.includes(term);
        const count = text.split(term).length - 1;
        if (!inTitle && count === 0) {
          ok = false;
          break;
        }
        score += (inTitle ? 10 : 0) + Math.min(count, 10);
      }
      if (!ok) continue;
      const first = Math.max(0, text.indexOf(terms[0]));
      const start = Math.max(0, first - 60);
      const snippet = body
        .slice(start, start + 160)
        .replace(/\s+/g, " ")
        .trim();
      hits.push({ id: meta.id, title: meta.title, path: meta.path, score, snippet: (start > 0 ? "…" : "") + snippet });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /** Ham dosya okuma (arşiv dışa aktarımı için). */
  async readRaw(rel: string): Promise<Buffer> {
    return readFile(this.abs(rel));
  }

  /** Ham dosya yazma (arşiv içe aktarımı için); var olan dosyanın üzerine yazmaz. */
  async writeNew(rel: string, data: string | Uint8Array): Promise<void> {
    if (await this.exists(rel)) throw new NodeError("conflict", `Dosya zaten var: ${rel}`);
    await this.atomicWrite(this.abs(rel), data);
  }

  async pathExists(rel: string): Promise<boolean> {
    return this.exists(rel);
  }

  async ensureRoot(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }
}

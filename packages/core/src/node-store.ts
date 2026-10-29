// Node deposu: bir Origin klasöründeki Markdown dosyalarının tek sahibi.
// Sunucu ve MCP sunucusu Node'lara yalnızca bu modül üzerinden erişir.
//
// Nularche ortak dili:
//   Origin  – kök veri kasası (bu klasör)
//   Arche   – Origin kökündeki Node'lar (ana sütunlar/projeler)
//   Node    – her sayfa; bir `.md` dosyası. Alt Node'u olan Node klasör notudur: `a/b/b.md`, alt Node'ları `a/b/` içinde (layout.ts)
//   Shadow  – `Shadow/` klasöründeki henüz bir Arche'ye bağlanmamış ham notlar (gelen kutusu)
// Kimlik (id) frontmatter'da saklanır ve yeniden adlandırma/taşımada değişmez.
// Ekler Origin kökündeki `Attachments/` klasörüne yazılır.

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { childDirOf, containerDirOf, isFolderNote, notePathFor, ownerPathsOf, unitNameOf } from "./layout.ts";
import { extractLinks, relativeLink, resolveLink, rewriteLinks } from "./links.ts";
import { parseNodeFile, revisionOf, serializeNodeFile, slugify, type Frontmatter } from "./node-file.ts";
import { bodyFacts, fillTemplate, isLockedBody, plainText, renameTagInBody, tagKey } from "./note-text.ts";
import { extractWikiLinks, wikiResolver } from "./wikilinks.ts";
import { canvasFiles, rewriteCanvasFiles } from "./canvas.ts";

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
  /** Not listelerinde en üstte gösterilir. */
  pinned?: boolean;
  /** Gövde parola ile şifrelidir (bkz. note-text.ts). */
  locked?: boolean;
  /** Sayfanın yazı tipi: `serif`, `sans`, `mono` ya da bir yazı tipi ailesinin adı. */
  font?: string;
  /** Sayfanın yazı boyutu (px). */
  fontSize?: number;
  /** Koyu temada bu not açık zeminde gösterilir. */
  lightBg?: boolean;
  /** İşaretlenen yapılacaklar listenin sonuna taşınır. */
  sortChecked?: boolean;
}

export const PAGE_FIELD_KEYS = [
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
] as const;
export type PageFieldKey = (typeof PAGE_FIELD_KEYS)[number];

/** Kullanıcı özelliği olarak düzenlenemeyen frontmatter anahtarları (kimlik ve uygulama alanları). */
const RESERVED_KEYS = new Set<string>(["id", "title", "created", "updated", ...PAGE_FIELD_KEYS]);

/** Frontmatter'daki kullanıcı özellikleri (Obsidian "Properties"): uygulamanın kendi alanları dışındaki anahtarlar. */
export function userProperties(fm: Frontmatter): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fm).filter(([k]) => !RESERVED_KEYS.has(k)));
}

/** Tek değer ya da liste olarak yazılmış metin özelliğini listeye çevirir (`aliases: Plan` ya da `aliases: [Plan, P]`). */
function stringList(v: unknown): string[] {
  const items = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  return items.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean);
}

/** Dosya geçmişi: aynı nottan iki anlık görüntü arasında en az bu kadar süre geçer. */
const HISTORY_INTERVAL_MS = 5 * 60_000;
/** Not başına saklanan en fazla anlık görüntü. */
const HISTORY_LIMIT = 60;
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
  /** Gövdedeki #etiketler. */
  tags: string[];
  /** Gövdenin düz metin başlangıcı (kilitli notlarda boş). */
  excerpt: string;
  /** Gövdedeki ilk görselin Origin yolu. */
  image: string | null;
  /** Yapılacak sayısı ve işaretli olanlar. */
  todos: number;
  done: number;
  /** Ek (resim, dosya, ses, çizim) sayısı. */
  attachments: number;
  words: number;
  /** Frontmatter'daki `aliases` (Obsidian uyumlu takma adlar); wiki bağlantıları ve hızlı geçişte kullanılır. */
  aliases: string[];
}

export interface NodeDoc extends NodeMeta {
  body: string;
  /** Kullanıcının frontmatter özellikleri (uygulamanın kendi alanları hariç). */
  properties: Record<string, unknown>;
}

/** Bağlantı grafiği: Node'lar, aralarındaki bağlantılar ve var olmayan hedeflere giden wiki bağlantıları. */
export interface LinkGraph {
  nodes: { id: string; title: string; path: string; tags: string[]; archeId: string | null }[];
  links: { source: string; target: string }[];
  unresolved: { source: string; name: string }[];
}

/** Bir notun giden bağlantıları: çözülenler ve çözülemeyen wiki hedefleri. */
export interface OutgoingLinks {
  linked: NodeMeta[];
  unresolved: string[];
}

/** Notun başlığını ya da takma adını bağlantısız olarak anan başka bir not. */
export interface MentionHit {
  id: string;
  title: string;
  snippet: string;
}

/** Dosya geçmişindeki bir anlık görüntü. */
export interface HistoryEntry {
  /** Anlık görüntünün zamanı (ms); kimlik olarak da kullanılır. */
  at: number;
  size: number;
}

/** `Attachments/` klasöründeki bir dosya ve ona bağlantı veren Node'lar. */
export interface AttachmentInfo {
  path: string;
  name: string;
  size: number;
  modifiedAt: number;
  kind: "image" | "audio" | "video" | "drawing" | "pdf" | "file";
  refs: { id: string; title: string }[];
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface SearchHit {
  id: string;
  title: string;
  path: string;
  score: number;
  snippet: string;
}

export const TRASH_DIR = ".trash";
export const ATTACHMENTS_DIR = "Attachments";
/** Eski sürümlerin ek klasörü; açılışta ATTACHMENTS_DIR'e taşınır ve bağlantılar güncellenir. */
export const LEGACY_ATTACHMENTS_DIR = "ekler";
export const SHADOW_DIR = "Shadow";
/** `move` ve `create` için Shadow hedefi. */
export const SHADOW = "shadow";

/** Çöpteki bir öğe: `.trash/<zaman>/` klasörü (Node dosyası, alt Node klasörü ve konum kaydı). */
export interface TrashEntry {
  /** Çöp klasörünün adı (zaman damgası); geri getirme ve silmede kimlik olarak kullanılır. */
  entry: string;
  nodeId: string | null;
  title: string;
  /** Silinmeden önceki yolu; eski sürümlerin çöpe attıklarında bilinmez (null). */
  originalPath: string | null;
  trashedAt: number;
  /** Birlikte çöpe giden alt Node sayısı. */
  childCount: number;
}

const TRASH_META = ".nularche-trash.json";

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
  if (fm.pinned === true) out.pinned = true;
  if (fm.locked === true) out.locked = true;
  if (typeof fm.font === "string" && fm.font) out.font = fm.font;
  if (typeof fm.fontSize === "number" && fm.fontSize >= 8 && fm.fontSize <= 48) out.fontSize = fm.fontSize;
  if (fm.lightBg === true) out.lightBg = true;
  if (fm.sortChecked === true) out.sortChecked = true;
  return out;
}

/** Gövde etiketleri ve frontmatter `tags` alanı (tekrarsız, ilk yazılış biçimiyle). */
function mergeTags(body: string[], front: string[]): string[] {
  const seen = new Map<string, string>();
  for (const t of [...body, ...front]) if (t && !seen.has(tagKey(t))) seen.set(tagKey(t), t);
  return [...seen.values()];
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

/** Kapak göreli bir dosya yoluysa (renk ya da URL değilse) not ya da hedef taşınınca yeni göreli yolu verir. */
function rewriteCover(cover: string | undefined, oldPath: string, newPath: string, moved: Map<string, string>): string | undefined {
  if (!cover || /^[a-z]+:|^gradient-/i.test(cover)) return cover;
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(oldPath), cover));
  const next = moved.get(target) ?? target;
  if (next === target && newPath === oldPath) return cover;
  return path.posix.relative(path.posix.dirname(newPath), next);
}

/** Taranmayan klasörler (gizli klasörler zaten atlanır). */
const IGNORED_DIRS = new Set(["node_modules"]);

/** Kod ve bağlantı içindeki metni maskeler (anılış ararken bağlantı metni sayılmasın). Uzunluk korunur. */
function maskLinks(body: string): string {
  return body
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, (m) => m.replace(/[^\n]/g, " "))
    .replace(/`[^`\n]+`|!?\[[^\]]*\]\([^)]*\)|!?\[\[[^\]]*\]\]|^---\n[\s\S]*?\n---/gm, (m) => m.replace(/[^\n]/g, " "));
}

/** Metinde adlardan birinin kelime sınırlarıyla geçtiği ilk konum (Türkçe büyük/küçük harf duyarsız); yoksa -1. */
function findMention(text: string, names: string[]): number {
  const lower = text.toLocaleLowerCase("tr");
  let best = -1;
  for (const name of names) {
    const n = name.toLocaleLowerCase("tr");
    for (let i = lower.indexOf(n); i >= 0; i = lower.indexOf(n, i + 1)) {
      const before = lower[i - 1];
      const after = lower[i + n.length];
      if ((!before || !/[\p{L}\p{N}_]/u.test(before)) && (!after || !/[\p{L}\p{N}_]/u.test(after))) {
        if (best < 0 || i < best) best = i;
        break;
      }
    }
  }
  return best;
}

function lowerTr(s: string): string {
  return s.toLocaleLowerCase("tr");
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
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
    const facts = bodyFacts(parsed.body);
    const image = facts.image ? resolveLink(rel, facts.image) : null;
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
        tags: mergeTags(facts.tags, stringList(fm.tags).map((t) => t.replace(/^#/, ""))),
        excerpt: facts.excerpt,
        image,
        todos: facts.todos,
        done: facts.done,
        attachments: facts.attachments,
        words: facts.words,
        aliases: stringList(fm.aliases),
        ...pageFields(fm),
        ...(facts.locked ? { locked: true } : {}),
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
      const dir = containerDirOf(meta.path);
      const owner = (d: string) => ownerPathsOf(d).map((p) => byPath.get(p)).find((e) => e && e.meta.path !== meta.path);
      const parent = dir === "" || dir === SHADOW_DIR ? undefined : owner(dir);
      const top = meta.path.split("/")[0];
      const inShadow = top === SHADOW_DIR && meta.path.includes("/");
      const arche = inShadow
        ? undefined
        : top.endsWith(".md") && !meta.path.includes("/")
          ? entry
          : ownerPathsOf(top).map((p) => byPath.get(p)).find(Boolean);
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
    // Klasör notları klasör yoluyla da bulunur ("Projeler" → "Projeler/Projeler.md").
    const folderNote = ref.toLowerCase().endsWith(".md") ? null : `${toPosix(ref)}/${path.posix.basename(toPosix(ref))}.md`;
    for (const n of all.values()) if (n.meta.path === wanted || n.meta.path === folderNote) return n;
    throw new NodeError("not_found", `Node bulunamadı: ${ref}`);
  }

  async read(ref: string): Promise<NodeDoc> {
    const { meta, body, frontmatter } = await this.find(ref);
    return { ...meta, body, properties: userProperties(frontmatter) };
  }

  private async exists(rel: string): Promise<boolean> {
    try {
      await stat(this.abs(rel));
      return true;
    } catch {
      return false;
    }
  }

  /** Klasörde boş bir Node adı (hem `ad.md` hem `ad/` boş olmalı). `except`: Node'un şu anki adı (kendisiyle çakışmaz). */
  private async uniqueName(dirRel: string, title: string, except?: string): Promise<string> {
    const slug = slugify(title);
    for (let i = 1; ; i++) {
      const name = i === 1 ? slug : `${slug} ${i}`;
      if (except !== undefined && name.toLowerCase() === except.toLowerCase()) return name;
      if (!dirRel && [ATTACHMENTS_DIR, SHADOW_DIR].some((d) => d.toLowerCase() === name.toLowerCase())) continue;
      const base = dirRel ? `${dirRel}/${name}` : name;
      if (!(await this.exists(`${base}.md`)) && !(await this.exists(base))) return name;
    }
  }

  /** Alt Node eklenecek Node'u klasör notuna çevirir (`a/b.md` → `a/b/b.md`) ve alt klasörünü döndürür. */
  private async ensureChildDir(parent: Loaded): Promise<string> {
    const p = parent.meta.path;
    if (isFolderNote(p) || (await this.exists(p.slice(0, -3)))) {
      if (!isFolderNote(p)) await this.relocate(p, containerDirOf(p), parent.meta.title, unitNameOf(p));
      return childDirOf((await this.find(parent.meta.id)).meta.path);
    }
    const target = notePathFor(containerDirOf(p), unitNameOf(p), true);
    await this.renameAndRewrite([[p, target]], new Map([[p, target]]));
    return childDirOf(target);
  }

  /** `parentNodeId`: üst Node id'si, kök (yeni Arche) için null, gelen kutusu için `SHADOW`. */
  async create(input: { title: string; parentNodeId?: string | null; body?: string; fields?: PageFields }): Promise<NodeDoc> {
    const title = input.title?.trim();
    if (!title) throw new NodeError("invalid", "Başlık boş olamaz");
    let dirRel = "";
    if (input.parentNodeId === SHADOW) dirRel = SHADOW_DIR;
    else if (input.parentNodeId) dirRel = await this.ensureChildDir(await this.find(input.parentNodeId));
    const rel = notePathFor(dirRel, await this.uniqueName(dirRel, title), false);
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
   * Node'u (alt Node'larıyla) `dirRel` klasörüne `title`'a uygun adla taşır/yeniden adlandırır; yeni yolu döndürür.
   * Alt Node'u olan Node klasör notu olarak taşınır (eski düzendeki `ad.md` + `ad/` de klasör notuna çevrilir).
   * Taşınan ve onlara bağlantı veren notlardaki göreli bağlantılar yeniden yazılır.
   */
  private async relocate(fromRel: string, dirRel: string, title: string, keepName?: string): Promise<string> {
    const folder = isFolderNote(fromRel);
    const legacyDir = folder ? null : fromRel.slice(0, -3);
    const hasLegacyChildren = legacyDir !== null && (await this.exists(legacyDir));
    const currentName = unitNameOf(fromRel);
    const sameDir = containerDirOf(fromRel) === dirRel;
    const name = keepName ?? (await this.uniqueName(dirRel, title, sameDir ? currentName : undefined));
    const asFolder = folder || hasLegacyChildren;
    const toRel = notePathFor(dirRel, name, asFolder);
    if (toRel === fromRel) return fromRel;
    const toDir = dirRel ? `${dirRel}/${name}` : name;
    const all = await this.loadAll();
    const moved = new Map<string, string>();
    const renames: [string, string][] = [];
    if (folder) {
      const fromDir = path.posix.dirname(fromRel);
      for (const n of all.values()) if (n.meta.path.startsWith(`${fromDir}/`)) moved.set(n.meta.path, `${toDir}/${n.meta.path.slice(fromDir.length + 1)}`);
      moved.set(fromRel, toRel);
      if (fromDir !== toDir) renames.push([fromDir, toDir]);
      if (currentName !== name) renames.push([`${toDir}/${currentName}.md`, toRel]);
    } else if (hasLegacyChildren) {
      for (const n of all.values()) if (n.meta.path.startsWith(`${legacyDir}/`)) moved.set(n.meta.path, `${toDir}/${n.meta.path.slice(legacyDir!.length + 1)}`);
      moved.set(fromRel, toRel);
      if (legacyDir !== toDir) renames.push([legacyDir!, toDir]);
      renames.push([fromRel, toRel]);
    } else {
      moved.set(fromRel, toRel);
      renames.push([fromRel, toRel]);
    }
    await this.renameAndRewrite(renames, moved, all);
    return toRel;
  }

  /** Dosya/klasör yeniden adlandırmalarını uygular, sonra `moved` (eski → yeni Node yolu) ile bağlantıları yeniden yazar. */
  private async renameAndRewrite(renames: [string, string][], moved: Map<string, string>, all?: Map<string, Loaded>): Promise<void> {
    all ??= await this.loadAll();
    for (const [from, to] of renames) {
      if (from.toLowerCase() !== to.toLowerCase() && (await this.exists(to))) throw new NodeError("conflict", `Hedef zaten var: ${to}`);
      await mkdir(path.dirname(this.abs(to)), { recursive: true });
      await rename(this.abs(from), this.abs(to));
    }
    for (const n of all.values()) {
      const oldPath = n.meta.path;
      const newPath = moved.get(oldPath) ?? oldPath;
      const cover = rewriteCover(n.meta.cover, oldPath, newPath, moved);
      const links = extractLinks(oldPath, n.body);
      const cards = n.meta.layoutMode === "canvas" ? canvasFiles(n.body) : [];
      if (cover === n.meta.cover && newPath === oldPath && !links.some((l) => moved.has(l.target)) && !cards.some((f) => moved.has(f))) continue;
      let body = links.length ? rewriteLinks(n.body, oldPath, newPath, moved) : n.body;
      if (cards.length) body = rewriteCanvasFiles(body, moved);
      if (body === n.body && cover === n.meta.cover) continue;
      const abs = this.abs(newPath);
      const text = await readFile(abs, "utf8");
      const parsed = parseNodeFile(text);
      const hasFrontmatter = /^---\r?\n/.test(text);
      const fm = cover === n.meta.cover ? parsed.frontmatter : { ...parsed.frontmatter, cover };
      await this.atomicWrite(abs, hasFrontmatter ? serializeNodeFile(fm, body) : body);
    }
  }

  async update(
    ref: string,
    input: { body?: string; title?: string; baseRevision?: string; fields?: PageFieldPatch; properties?: Record<string, unknown> },
  ): Promise<NodeDoc> {
    const current = await this.find(ref);
    this.checkRevision(current.meta, input.baseRevision);
    for (const key of Object.keys(input.properties ?? {})) {
      if (RESERVED_KEYS.has(key) || !/^[^\s:#][^:#\n]{0,63}$/u.test(key)) throw new NodeError("invalid", `Bu özellik adı kullanılamaz: ${key}`);
    }
    const title = input.title?.trim() || current.meta.title;
    let rel = current.meta.path;
    if (title !== current.meta.title) rel = await this.relocate(rel, containerDirOf(rel), title);
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
    for (const [key, value] of Object.entries(input.properties ?? {})) {
      if (value === null || value === undefined) delete fm[key];
      else fm[key] = value;
    }
    const before = await readFile(abs, "utf8");
    if (input.body !== undefined && input.body !== parsed.body) await this.snapshot(current.meta.id, before);
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
      const ownDir = childDirOf(current.meta.path);
      if (parent.meta.id === current.meta.id || parent.meta.path.startsWith(`${ownDir}/`)) {
        throw new NodeError("invalid", "Bir Node kendi altına taşınamaz");
      }
      if (current.meta.parentNodeId === parent.meta.id) return this.read(current.meta.id);
      dirRel = await this.ensureChildDir(parent);
    }
    const fresh = await this.find(current.meta.id);
    if (containerDirOf(fresh.meta.path) === dirRel) return this.read(current.meta.id);
    await this.relocate(fresh.meta.path, dirRel, fresh.meta.title);
    return this.read(current.meta.id);
  }

  /**
   * Node'u alt Node'larıyla birlikte çoğaltır (şablondan sayfa oluşturma, "Çoğalt"). Kopyalar yeni id alır;
   * kopyalanan Node'lar arasındaki bağlantılar ve ilişki (relation) değerleri kopyalara yönlendirilir.
   * `title` verilirse kök kopyanın başlığı olur; `template` alanı kopyaya taşınmaz.
   */
  async duplicate(ref: string, input: { parentNodeId?: string | null; title?: string; fields?: PageFields } = {}): Promise<NodeDoc> {
    const all = await this.loadAll();
    const root = await this.find(ref, all);
    const nodes = [...all.values()];
    const subtree: Loaded[] = [];
    const walk = (id: string) => {
      for (const n of nodes) if (n.meta.parentNodeId === id) (subtree.push(n), walk(n.meta.id));
    };
    walk(root.meta.id);
    const parent = input.parentNodeId === undefined ? (root.meta.archeId === null && root.meta.parentNodeId === null ? SHADOW : root.meta.parentNodeId) : input.parentNodeId;
    const idMap = new Map<string, string>();
    const pathMap = new Map<string, string>();
    const copyFields = (n: Loaded, extra?: PageFields): PageFields => {
      const { template: _t, ...rest } = pageFields(n.frontmatter);
      return { ...rest, ...extra };
    };
    const created: { src: Loaded; copy: NodeDoc }[] = [];
    const rootCopy = await this.create({
      title: input.title?.trim() || root.meta.title,
      parentNodeId: parent,
      fields: copyFields(root, input.fields),
    });
    idMap.set(root.meta.id, rootCopy.id);
    created.push({ src: root, copy: rootCopy });
    for (const n of subtree) {
      const copy = await this.create({ title: n.meta.title, parentNodeId: idMap.get(n.meta.parentNodeId!)!, fields: copyFields(n) });
      idMap.set(n.meta.id, copy.id);
      created.push({ src: n, copy });
    }
    // Alt Node eklenince üst Node'lar klasör notuna geçmiş olabilir: güncel yolları oku.
    for (const c of created) {
      c.copy = await this.read(c.copy.id);
      pathMap.set(c.src.meta.path, c.copy.path);
    }
    const remap = (v: unknown): unknown =>
      Array.isArray(v) ? v.map((x) => (typeof x === "string" && idMap.has(x) ? idMap.get(x) : x)) : typeof v === "string" && idMap.has(v) ? idMap.get(v) : v;
    // Şablondan oluşturulurken {{title}}, {{date}}, {{time}} değişkenleri doldurulur.
    const now = new Date();
    for (const { src, copy } of created) {
      let body = rewriteLinks(src.body, src.meta.path, copy.path, pathMap);
      if (root.meta.template) body = fillTemplate(body, { title: copy.title, now });
      const fields: PageFieldPatch = {};
      if (src.meta.props) fields.props = Object.fromEntries(Object.entries(src.meta.props).map(([k, v]) => [k, remap(v)]));
      if (src.meta.cover) fields.cover = rewriteCover(src.meta.cover, src.meta.path, copy.path, pathMap) ?? null;
      if (src.meta.database) {
        // İlişki hedefi kopyalanan bir veritabanıysa kopyaya yönlendir.
        const db = JSON.parse(JSON.stringify(src.meta.database)) as { properties?: { target?: string }[] };
        for (const p of db.properties ?? []) if (p.target && idMap.has(p.target)) p.target = idMap.get(p.target);
        fields.database = db;
      }
      // Kullanıcı özellikleri de kopyalanır (şablondaki metin değerlerindeki değişkenler doldurularak).
      const props = userProperties(src.frontmatter);
      const properties = root.meta.template
        ? Object.fromEntries(Object.entries(props).map(([k, v]) => [k, typeof v === "string" ? fillTemplate(v, { title: copy.title, now }) : v]))
        : props;
      if (body || Object.keys(fields).length || Object.keys(properties).length) await this.update(copy.id, { body, fields, properties });
    }
    return this.read(rootCopy.id);
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
    // Aynı milisaniyede birden çok silme olursa her biri kendi klasörünü alır.
    let destDir = path.join(this.root, TRASH_DIR, stamp);
    for (let i = 2; await stat(destDir).then(() => true, () => false); i++) destDir = path.join(this.root, TRASH_DIR, `${stamp}-${i}`);
    await mkdir(destDir, { recursive: true });
    const name = path.posix.basename(current.meta.path);
    if (isFolderNote(current.meta.path)) {
      // Klasör notu: klasörüyle birlikte (`ad/ad.md` ve alt Node'lar) çöpe gider.
      await rename(this.abs(path.posix.dirname(current.meta.path)), path.join(destDir, unitNameOf(current.meta.path)));
    } else {
      await rename(this.abs(current.meta.path), path.join(destDir, name));
      if (await this.exists(childDirOf(current.meta.path))) {
        await rename(this.abs(childDirOf(current.meta.path)), path.join(destDir, name.slice(0, -3)));
      }
    }
    // Geri getirme için eski konum kaydedilir.
    await writeFile(
      path.join(destDir, TRASH_META),
      JSON.stringify({ id: current.meta.id, title: current.meta.title, path: current.meta.path, trashedAt: Date.now() }, null, 2),
    );
    return { id: current.meta.id, trashedTo: toPosix(path.relative(this.root, destDir)) };
  }

  private trashDir(entry: string): string {
    if (!/^[\w.-]+$/.test(entry) || entry.startsWith(".")) throw new NodeError("invalid", `Geçersiz çöp öğesi: ${entry}`);
    return path.join(this.root, TRASH_DIR, entry);
  }

  private async readTrashEntry(entry: string): Promise<(TrashEntry & { file: string }) | null> {
    const dir = this.trashDir(entry);
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return null;
    }
    let file = names.find((n) => n.toLowerCase().endsWith(".md") && !n.startsWith("."));
    if (!file) {
      // Klasör notu biçimi: `ad/ad.md`
      for (const n of names) if (!n.startsWith(".") && (await stat(path.join(dir, n, `${n}.md`)).then(() => true, () => false))) file = `${n}/${n}.md`;
    }
    if (!file) return null;
    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(await readFile(path.join(dir, TRASH_META), "utf8"));
    } catch {
      // Eski sürümde çöpe atılmış: konum bilinmiyor.
    }
    const fm = parseNodeFile(await readFile(path.join(dir, file), "utf8")).frontmatter;
    const countMd = async (d: string): Promise<number> => {
      let n = 0;
      try {
        for (const e of await readdir(d, { withFileTypes: true })) {
          if (e.name.startsWith(".")) continue;
          if (e.isDirectory()) n += await countMd(path.join(d, e.name));
          else if (e.name.toLowerCase().endsWith(".md")) n++;
        }
      } catch {
        // alt klasör yok
      }
      return n;
    };
    const stampMs = Date.parse(entry.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z(-\d+)?$/, "T$1:$2:$3.$4Z"));
    return {
      entry,
      file,
      nodeId: typeof meta.id === "string" ? meta.id : (asString(fm.id) ?? null),
      title: (typeof meta.title === "string" && meta.title) || asString(fm.title) || path.posix.basename(file, ".md"),
      originalPath: typeof meta.path === "string" ? meta.path : null,
      trashedAt: typeof meta.trashedAt === "number" ? meta.trashedAt : Number.isFinite(stampMs) ? stampMs : 0,
      childCount: file.includes("/") ? (await countMd(path.join(dir, path.posix.dirname(file)))) - 1 : await countMd(path.join(dir, file.slice(0, -3))),
    };
  }

  /** Çöpteki öğeler, en son silinen önce. */
  async listTrash(): Promise<TrashEntry[]> {
    let entries: string[];
    try {
      entries = (await readdir(path.join(this.root, TRASH_DIR), { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }
    const out: TrashEntry[] = [];
    for (const e of entries) {
      if (e.startsWith(".")) continue;
      const item = await this.readTrashEntry(e);
      if (item) {
        const { file: _file, ...rest } = item;
        out.push(rest);
      }
    }
    return out.sort((a, b) => b.trashedAt - a.trashedAt);
  }

  /**
   * Çöpteki Node'u (alt Node'larıyla) geri getirir: eski yerine (üst Node hâlâ varsa), değilse Shadow'a.
   * Aynı adda bir Node varsa ad sonuna numara eklenir.
   */
  async restoreTrash(entry: string): Promise<NodeDoc> {
    const item = await this.readTrashEntry(entry);
    if (!item) throw new NodeError("not_found", `Çöpte bulunamadı: ${entry}`);
    const dir = this.trashDir(entry);
    let targetDir = SHADOW_DIR;
    if (item.originalPath) {
      const parentDir = containerDirOf(item.originalPath);
      if (parentDir === "") targetDir = "";
      else {
        // Üst Node hâlâ varsa onun altına; gerekirse üst Node klasör notuna çevrilir.
        const parent = (await this.loadAll().then((all) => [...all.values()])).find((n) => ownerPathsOf(parentDir).includes(n.meta.path));
        if (parent) targetDir = await this.ensureChildDir(parent);
      }
    }
    const folderForm = item.file.includes("/");
    const srcName = path.posix.basename(item.file, ".md");
    const srcChildren = folderForm ? path.join(dir, path.posix.dirname(item.file)) : path.join(dir, srcName);
    const hasChildren = folderForm || (await stat(srcChildren).then(() => true, () => false));
    const free = async (n: string) => !(await this.exists(notePathFor(targetDir, n, false))) && !(await this.exists(targetDir ? `${targetDir}/${n}` : n));
    const name = (await free(srcName)) ? srcName : await this.uniqueName(targetDir, item.title);
    const target = notePathFor(targetDir, name, hasChildren);
    const unitDir = targetDir ? `${targetDir}/${name}` : name;
    await mkdir(path.dirname(this.abs(unitDir)), { recursive: true });
    if (folderForm) {
      await rename(srcChildren, this.abs(unitDir));
      if (srcName !== name) await rename(this.abs(`${unitDir}/${srcName}.md`), this.abs(target));
    } else {
      if (hasChildren) await rename(srcChildren, this.abs(unitDir));
      await rename(path.join(dir, item.file), this.abs(target));
    }
    await rm(dir, { recursive: true, force: true });
    return this.read(target);
  }

  /** Çöpteki öğeyi kalıcı olarak siler (yalnızca kullanıcı arayüzden açıkça isterse). */
  async deleteTrash(entry: string): Promise<void> {
    if (!(await this.readTrashEntry(entry))) throw new NodeError("not_found", `Çöpte bulunamadı: ${entry}`);
    await rm(this.trashDir(entry), { recursive: true, force: true });
  }

  /** Bu nota bağlantı veren notlar. */
  async backlinks(ref: string): Promise<NodeMeta[]> {
    const all = await this.loadAll();
    const target = (await this.find(ref, all)).meta;
    const out: NodeMeta[] = [];
    const resolve = this.resolver(all);
    for (const n of all.values()) {
      if (n.meta.id === target.id) continue;
      if (this.targetsOf(n, resolve).includes(target.path)) out.push(n.meta);
    }
    return out.sort((a, b) => a.title.localeCompare(b.title, "tr"));
  }

  private resolver(all: Map<string, Loaded>): (name: string) => string | null {
    return wikiResolver([...all.values()].map((n) => ({ path: n.meta.path, title: n.meta.title, aliases: n.meta.aliases })));
  }

  /** Notun bağlantı verdiği vault yolları: göreli Markdown bağlantıları ve çözülen wiki bağlantıları. */
  private targetsOf(n: Loaded, resolve: (name: string) => string | null): string[] {
    if (n.meta.locked) return [];
    if (n.meta.layoutMode === "canvas") return [...new Set(canvasFiles(n.body))];
    const md = extractLinks(n.meta.path, n.body).map((l) => l.target);
    const wiki = extractWikiLinks(n.body)
      .map((l) => (l.target ? resolve(l.target) : n.meta.path))
      .filter((p): p is string => !!p);
    return [...new Set([...md, ...wiki])];
  }

  /** Bağlantı grafiği (Obsidian "Graph view"). Kilitli notların bağlantıları sayılmaz. */
  async graph(): Promise<LinkGraph> {
    const all = await this.loadAll();
    const resolve = this.resolver(all);
    const idByPath = new Map([...all.values()].map((n) => [n.meta.path, n.meta.id]));
    const links: LinkGraph["links"] = [];
    const unresolved: LinkGraph["unresolved"] = [];
    for (const n of all.values()) {
      for (const p of this.targetsOf(n, resolve)) {
        const id = idByPath.get(p);
        if (id && id !== n.meta.id) links.push({ source: n.meta.id, target: id });
      }
      if (n.meta.locked || n.meta.layoutMode === "canvas") continue;
      for (const w of extractWikiLinks(n.body)) if (w.target && !resolve(w.target) && !/\.[a-z0-9]{2,4}$/i.test(w.target)) unresolved.push({ source: n.meta.id, name: w.target });
    }
    const nodes = [...all.values()].map(({ meta }) => ({ id: meta.id, title: meta.title, path: meta.path, tags: meta.tags, archeId: meta.archeId }));
    return { nodes, links, unresolved };
  }

  /** Notun giden bağlantıları (Obsidian "Outgoing links"). */
  async outgoing(ref: string): Promise<OutgoingLinks> {
    const all = await this.loadAll();
    const n = await this.find(ref, all);
    const resolve = this.resolver(all);
    const byPath = new Map([...all.values()].map((x) => [x.meta.path, x.meta]));
    const linked = this.targetsOf(n, resolve)
      .map((p) => byPath.get(p))
      .filter((m): m is NodeMeta => !!m && m.id !== n.meta.id);
    const unresolved = n.meta.locked ? [] : [...new Set(extractWikiLinks(n.body).filter((w) => w.target && !resolve(w.target)).map((w) => w.target))];
    return { linked, unresolved };
  }

  /** Bu notun başlığını ya da takma adını anan ama bağlantı vermeyen notlar (Obsidian "Unlinked mentions"). */
  async unlinkedMentions(ref: string): Promise<MentionHit[]> {
    const all = await this.loadAll();
    const target = await this.find(ref, all);
    const resolve = this.resolver(all);
    const names = [target.meta.title, ...target.meta.aliases].filter((x) => x.trim().length >= 3);
    if (!names.length) return [];
    const out: MentionHit[] = [];
    for (const n of all.values()) {
      if (n.meta.id === target.meta.id || n.meta.locked || n.meta.layoutMode === "canvas") continue;
      if (this.targetsOf(n, resolve).includes(target.meta.path)) continue;
      const text = plainText(n.body);
      const at = findMention(text, names);
      if (at < 0) continue;
      const start = Math.max(0, at - 50);
      out.push({ id: n.meta.id, title: n.meta.title, snippet: (start ? "…" : "") + text.slice(start, at + 110).replace(/\s+/g, " ").trim() });
    }
    return out.sort((a, b) => a.title.localeCompare(b.title, "tr"));
  }

  /** `sourceRef` notunda bu notun ilk bağlantısız anılışını göreli bağlantıya çevirir. */
  async linkMention(sourceRef: string, targetRef: string): Promise<NodeDoc> {
    const all = await this.loadAll();
    const source = await this.find(sourceRef, all);
    const target = await this.find(targetRef, all);
    const names = [target.meta.title, ...target.meta.aliases].filter((x) => x.trim().length >= 3);
    const masked = maskLinks(source.body);
    const at = findMention(masked, names);
    if (at < 0) throw new NodeError("not_found", "Bağlantısız anılış bulunamadı.");
    const name = names.find((x) => masked.slice(at, at + x.length).toLocaleLowerCase("tr") === x.toLocaleLowerCase("tr"))!;
    const shown = source.body.slice(at, at + name.length);
    const href = relativeLink(source.meta.path, target.meta.path);
    return this.update(source.meta.id, { body: `${source.body.slice(0, at)}[${shown}](${href})${source.body.slice(at + name.length)}` });
  }

  /**
   * `sourceRef` notunu `targetRef` notunun sonuna ekler, kaynağa giden bağlantıları hedefe yönlendirir ve kaynağı
   * çöpe taşır (Obsidian "Note composer: merge"). Alt sayfası olan ya da kilitli notlar birleştirilmez.
   */
  async merge(sourceRef: string, targetRef: string): Promise<NodeDoc> {
    const all = await this.loadAll();
    const source = await this.find(sourceRef, all);
    const target = await this.find(targetRef, all);
    if (source.meta.id === target.meta.id) throw new NodeError("invalid", "Bir not kendisiyle birleştirilemez.");
    if (source.meta.locked || target.meta.locked) throw new NodeError("invalid", "Kilitli notlar birleştirilemez.");
    if ([...all.values()].some((n) => n.meta.parentNodeId === source.meta.id)) throw new NodeError("invalid", "Alt sayfası olan bir not birleştirilemez.");
    // Kaynaktaki göreli bağlantılar hedefin konumuna göre yeniden yazılır.
    const moved = rewriteLinks(source.body, source.meta.path, target.meta.path, new Map());
    const sep = target.body.trim() === "" ? "" : target.body.endsWith("\n") ? "\n" : "\n\n";
    await this.update(target.meta.id, { body: `${target.body}${sep}${moved}` });
    const redirect = new Map([[source.meta.path, target.meta.path]]);
    const latest = await this.loadAll();
    const resolve = this.resolver(latest);
    for (const n of latest.values()) {
      if (n.meta.id === source.meta.id || n.meta.locked) continue;
      let body = rewriteLinks(n.body, n.meta.path, n.meta.path, redirect);
      // [[Kaynak#başlık|ad]] → [[Hedef#başlık|ad]] (sondan başa: indeksler kaymasın)
      for (const w of extractWikiLinks(body).reverse()) {
        if (!w.target || resolve(w.target) !== source.meta.path) continue;
        const next = `${w.embed ? "!" : ""}[[${target.meta.title}${w.heading ? `#${w.heading}` : ""}${w.alias ? `|${w.alias}` : ""}]]`;
        body = body.slice(0, w.index) + next + body.slice(w.index + w.raw.length);
      }
      if (body !== n.body) await this.update(n.meta.id, { body });
    }
    await this.trash(source.meta.id);
    return this.read(target.meta.id);
  }

  // ---------------------------------------------------------------- Dosya geçmişi (Obsidian "File recovery")

  private historyDir(id: string): string {
    if (!/^[\w-]{1,64}$/.test(id)) throw new NodeError("invalid", `Geçersiz id: ${id}`);
    return path.join(this.root, ".nularche", "history", id);
  }

  /** Değişmeden önceki dosyayı saklar; aynı not için en fazla beş dakikada bir. Gizli klasör Node taramasına girmez. */
  private async snapshot(id: string, text: string): Promise<void> {
    const dir = this.historyDir(id);
    const entries = await this.history(id).catch(() => []);
    if (entries[0] && Date.now() - entries[0].at < HISTORY_INTERVAL_MS) return;
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${Date.now()}.md`), text);
    for (const old of entries.slice(HISTORY_LIMIT - 1)) await rm(path.join(dir, `${old.at}.md`), { force: true });
  }

  /** Notun anlık görüntüleri (en yeni önce). */
  async history(ref: string): Promise<HistoryEntry[]> {
    const id = /^[\w-]{1,64}$/.test(ref) ? ref : (await this.find(ref)).meta.id;
    let files: string[];
    try {
      files = await readdir(this.historyDir(id));
    } catch {
      return [];
    }
    const out: HistoryEntry[] = [];
    for (const f of files) {
      const at = Number(/^(\d+)\.md$/.exec(f)?.[1]);
      if (!at) continue;
      out.push({ at, size: (await stat(path.join(this.historyDir(id), f))).size });
    }
    return out.sort((a, b) => b.at - a.at);
  }

  /** Anlık görüntünün gövdesi. */
  async historyBody(ref: string, at: number): Promise<string> {
    const { meta } = await this.find(ref);
    if (!Number.isSafeInteger(at)) throw new NodeError("invalid", "Geçersiz zaman.");
    try {
      return parseNodeFile(await readFile(path.join(this.historyDir(meta.id), `${at}.md`), "utf8")).body;
    } catch {
      throw new NodeError("not_found", "Anlık görüntü bulunamadı.");
    }
  }

  /** Notun gövdesini anlık görüntüdeki haline döndürür (şimdiki hali de geçmişe eklenir). */
  async restoreHistory(ref: string, at: number, baseRevision?: string): Promise<NodeDoc> {
    const body = await this.historyBody(ref, at);
    const { meta } = await this.find(ref);
    this.checkRevision(meta, baseRevision);
    await this.snapshot(meta.id, await readFile(this.abs(meta.path), "utf8")).catch(() => undefined);
    return this.update(meta.id, { body });
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

  /** Eki `Attachments/` klasörüne benzersiz adla yazar ve vault yolunu döndürür. */
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
      const tagHit = terms.every((t) => t.startsWith("#") && meta.tags.some((g) => tagKey(g) === t.slice(1) || tagKey(g).startsWith(`${t.slice(1)}/`)));
      if (meta.locked && !terms.every((t) => lowerTr(meta.title).includes(t))) continue;
      if (tagHit) {
        hits.push({ id: meta.id, title: meta.title, path: meta.path, score: 20, snippet: meta.excerpt.slice(0, 160) });
        continue;
      }
      const title = lowerTr(meta.title);
      const text = meta.locked ? "" : lowerTr(body);
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
      const snippet = (meta.locked ? "" : body)
        .slice(start, start + 160)
        .replace(/\s+/g, " ")
        .trim();
      hits.push({ id: meta.id, title: meta.title, path: meta.path, score, snippet: (start > 0 ? "…" : "") + snippet });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /** Tüm etiketler ve kaç Node'da geçtikleri (alfabetik). */
  async tags(): Promise<TagCount[]> {
    const counts = new Map<string, TagCount>();
    for (const { meta } of (await this.loadAll()).values()) {
      for (const tag of meta.tags) {
        const key = tagKey(tag);
        const entry = counts.get(key) ?? { tag, count: 0 };
        entry.count++;
        counts.set(key, entry);
      }
    }
    return [...counts.values()].sort((a, b) => a.tag.localeCompare(b.tag, "tr"));
  }

  /** `#from` etiketini (ve alt etiketlerini) tüm Node'larda `#to` olarak yeniden adlandırır; değişen Node sayısını döndürür. */
  async renameTag(from: string, to: string): Promise<number> {
    const clean = (s: string) => s.trim().replace(/^#/, "");
    const a = clean(from);
    const b = clean(to);
    if (!a || !b || !/^[\p{L}\p{N}_][\p{L}\p{N}_/-]*$/u.test(b)) throw new NodeError("invalid", `Geçersiz etiket: ${to}`);
    let changed = 0;
    for (const n of (await this.loadAll()).values()) {
      if (!n.meta.tags.some((t) => tagKey(t) === tagKey(a) || tagKey(t).startsWith(`${tagKey(a)}/`))) continue;
      const body = renameTagInBody(n.body, a, b);
      const front = stringList(n.frontmatter.tags);
      const renamed = front.map((t) => {
        const bare = t.replace(/^#/, "");
        return tagKey(bare) === tagKey(a) ? b : tagKey(bare).startsWith(`${tagKey(a)}/`) ? `${b}${bare.slice(a.length)}` : t;
      });
      const frontChanged = renamed.some((t, i) => t !== front[i]);
      if (body === n.body && !frontChanged) continue;
      await this.update(n.meta.id, { body, ...(frontChanged ? { properties: { tags: renamed } } : {}) });
      changed++;
    }
    return changed;
  }

  /** `Attachments/` klasöründeki dosyalar (en yeni önce) ve her birine bağlantı veren Node'lar. */
  async listAttachments(): Promise<AttachmentInfo[]> {
    const files: string[] = [];
    const walk = async (rel: string) => {
      let entries;
      try {
        entries = await readdir(this.abs(rel), { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name.startsWith(".")) continue;
        if (e.isDirectory()) await walk(`${rel}/${e.name}`);
        else if (e.isFile()) files.push(`${rel}/${e.name}`);
      }
    };
    await walk(ATTACHMENTS_DIR);
    const refs = new Map<string, { id: string; title: string }[]>();
    const drawings = new Set<string>();
    for (const n of (await this.loadAll()).values()) {
      if (n.meta.locked) continue;
      for (const l of extractLinks(n.meta.path, n.body)) {
        const list = refs.get(l.target) ?? [];
        if (!list.some((r) => r.id === n.meta.id)) list.push({ id: n.meta.id, title: n.meta.title });
        refs.set(l.target, list);
      }
      for (const m of n.body.matchAll(/^@\[drawing\]\(([^)\s]+)\)/gm)) {
        const target = resolveLink(n.meta.path, m[1]);
        if (target) drawings.add(target);
      }
      if (n.meta.cover) {
        const target = resolveLink(n.meta.path, n.meta.cover);
        if (target) {
          const list = refs.get(target) ?? [];
          if (!list.some((r) => r.id === n.meta.id)) list.push({ id: n.meta.id, title: n.meta.title });
          refs.set(target, list);
        }
      }
    }
    const out: AttachmentInfo[] = [];
    for (const rel of files) {
      const st = await stat(this.abs(rel)).catch(() => null);
      if (!st) continue;
      const ext = path.posix.extname(rel).toLowerCase();
      const kind: AttachmentInfo["kind"] = drawings.has(rel)
        ? "drawing"
        : /^\.(png|jpe?g|gif|webp|avif|svg|heic|bmp)$/.test(ext)
          ? "image"
          : /^\.(webm|m4a|mp3|wav|ogg|oga|aac|flac)$/.test(ext)
            ? "audio"
            : /^\.(mp4|mov|m4v)$/.test(ext)
              ? "video"
              : ext === ".pdf"
                ? "pdf"
                : "file";
      out.push({ path: rel, name: path.posix.basename(rel), size: st.size, modifiedAt: st.mtimeMs, kind, refs: refs.get(rel) ?? [] });
    }
    return out.sort((a, b) => b.modifiedAt - a.modifiedAt);
  }

  /** Bir eki yeniden adlandırır (uzantı korunur); bağlantı veren Node'lar ve kapaklar güncellenir. Yeni yolu döndürür. */
  async renameAttachment(rel: string, newName: string): Promise<string> {
    if (!rel.startsWith(`${ATTACHMENTS_DIR}/`) || !(await this.exists(rel))) throw new NodeError("not_found", `Ek bulunamadı: ${rel}`);
    const ext = path.posix.extname(rel);
    const base = slugify(newName.replace(new RegExp(`${ext.replace(".", "\\.")}$`, "i"), "")).slice(0, 80);
    if (!base) throw new NodeError("invalid", "Ad boş olamaz");
    const dir = path.posix.dirname(rel);
    let target = `${dir}/${base}${ext}`;
    if (target === rel) return rel;
    for (let i = 2; await this.exists(target); i++) target = `${dir}/${base} ${i}${ext}`;
    await this.renameAndRewrite([[rel, target]], new Map([[rel, target]]));
    return target;
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
    await this.migrateLegacyAttachments();
    await this.normalizeLayout();
  }

  /**
   * Eski düzeni (`ad.md` + yanında `ad/` klasörü) klasör notuna çevirir (`ad/ad.md`); bağlantılar güncellenir.
   * Klasörde zaten `ad/ad.md` varsa o çift olduğu gibi bırakılır (her iki biçim de okunur).
   */
  async normalizeLayout(): Promise<number> {
    const all = await this.loadAll();
    const renames: [string, string][] = [];
    const moved = new Map<string, string>();
    for (const { meta } of all.values()) {
      const p = meta.path;
      if (isFolderNote(p)) continue;
      const dir = p.slice(0, -3);
      const target = `${dir}/${path.posix.basename(dir)}.md`;
      if (!(await stat(this.abs(dir)).then((st) => st.isDirectory(), () => false)) || (await this.exists(target))) continue;
      renames.push([p, target]);
      moved.set(p, target);
    }
    if (renames.length) await this.renameAndRewrite(renames, moved, all);
    return renames.length;
  }

  /**
   * Eski `ekler/` klasörünü `Attachments/` klasörüne taşır ve notlardaki bağlantıları (kapaklar dahil) yeni yola çevirir.
   * `ekler.md` adlı bir Node varsa klasör o Node'un alt klasörüdür; dokunulmaz.
   */
  private async migrateLegacyAttachments(): Promise<void> {
    const legacy = LEGACY_ATTACHMENTS_DIR;
    const isDir = await stat(this.abs(legacy)).then((st) => st.isDirectory(), () => false);
    if (!isDir || (await this.exists(`${legacy}.md`))) return;
    const moved = new Map<string, string>();
    const files: string[] = [];
    const walk = async (rel: string) => {
      for (const e of await readdir(this.abs(rel), { withFileTypes: true })) {
        if (e.isDirectory()) await walk(`${rel}/${e.name}`);
        else if (!e.name.startsWith(".")) files.push(`${rel}/${e.name}`);
      }
    };
    await walk(legacy);
    for (const from of files) {
      let to = `${ATTACHMENTS_DIR}${from.slice(legacy.length)}`;
      const ext = path.posix.extname(to);
      for (let i = 2; await this.exists(to); i++) to = `${ATTACHMENTS_DIR}${from.slice(legacy.length, from.length - ext.length)}-${i}${ext}`;
      await mkdir(path.dirname(this.abs(to)), { recursive: true });
      await rename(this.abs(from), this.abs(to));
      moved.set(from, to);
    }
    await rm(this.abs(legacy), { recursive: true, force: true }).catch(() => undefined);
    if (moved.size === 0) return;
    for (const { meta } of (await this.loadAll()).values()) {
      const abs = this.abs(meta.path);
      const text = await readFile(abs, "utf8");
      const hasFrontmatter = /^---\r?\n/.test(text);
      const parsed = parseNodeFile(text);
      const body = rewriteLinks(parsed.body, meta.path, meta.path, moved);
      const fm = { ...parsed.frontmatter };
      if (typeof fm.cover === "string") fm.cover = rewriteCover(fm.cover, meta.path, meta.path, moved);
      if (body === parsed.body && fm.cover === parsed.frontmatter.cover) continue;
      await this.atomicWrite(abs, hasFrontmatter ? serializeNodeFile(fm, body) : body);
    }
  }
}

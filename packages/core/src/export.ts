// Dışa aktarma ve yayınlama: Node'ları Markdown arşivi (.zip), tek dosya HTML ya da statik web sitesi olarak üretir.
// Hiçbir yere yükleme yapmaz; üretilen dosyaları kullanıcı kaydeder (ör. GitHub Pages'e kendisi koyar).

import path from "node:path";
import { zipSync, type Zippable } from "fflate";
import { Marked, type Tokens } from "marked";
import {
  cellValue,
  computeContext,
  displayText,
  parseDatabase,
  queryRows,
  toRow,
  type ComputeContext,
  type Database,
} from "./database.ts";
import { extractLinks, resolveLink } from "./links.ts";
import { ATTACHMENTS_DIR, NodeError, type NodeMeta, type NodeStore } from "./node-store.ts";

const { posix } = path;
const GRADIENTS: Record<string, string> = {
  "gradient-1": "linear-gradient(135deg,#00a8b5,#005f66)",
  "gradient-2": "linear-gradient(135deg,#2f81f7,#a371f7)",
  "gradient-3": "linear-gradient(135deg,#f0883e,#f85149)",
  "gradient-4": "linear-gradient(135deg,#3fb950,#00a8b5)",
  "gradient-5": "linear-gradient(135deg,#d29922,#f0883e)",
  "gradient-6": "linear-gradient(135deg,#484f58,#161b22)",
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const encodePath = (p: string) => p.split("/").map(encodeURIComponent).join("/");
const htmlPathOf = (notePath: string) => notePath.replace(/\.md$/i, ".html");
const relHref = (fromFile: string, toFile: string) => encodePath(posix.relative(posix.dirname(fromFile), toFile) || posix.basename(toFile));

/** Sayfa içeriği bağlantılarının nasıl yazılacağı: Node bağlantıları, ekler ve gömülü veritabanları. */
interface RenderTarget {
  /** Bir Node yolu için href (dışa aktarılmayan Node'lar için null: bağlantı düz metne döner). */
  nodeHref: (notePath: string) => string | null;
  /** Bir ek (Attachments/…) için Origin'e göre yol ya da data: URI (yol ise sayfaya göre göreli yazılır). */
  assetHref: (assetPath: string) => string;
}

interface RenderContext {
  all: NodeMeta[];
  byPath: Map<string, NodeMeta>;
  ctx: ComputeContext;
  lang: "tr" | "en";
}

const LABELS = {
  tr: { title: "Ad", contents: "İçindekiler", made: "Nularche ile oluşturuldu", empty: "Boş", rows: "kayıt", subpages: "Alt sayfalar" },
  en: { title: "Name", contents: "Contents", made: "Made with Nularche", empty: "Empty", rows: "records", subpages: "Subpages" },
};

/** Veritabanını (görünümün filtre/sıralamasıyla) HTML tablosu olarak verir. */
function databaseTable(dbNode: NodeMeta, viewId: string | undefined, rc: RenderContext, t: RenderTarget, fromFile: string): string {
  const db: Database = parseDatabase(dbNode.database);
  const view = db.views.find((v) => v.id === viewId) ?? db.views[0];
  const rows = queryRows(db, rc.all.filter((n) => n.parentNodeId === dbNode.id && !n.template).map(toRow), view, rc.ctx);
  const props = db.properties.filter((p) => !view.hidden.includes(p.id));
  const head = [`<th>${esc(LABELS[rc.lang].title)}</th>`, ...props.map((p) => `<th>${esc(p.name)}</th>`)].join("");
  const body = rows
    .map((r) => {
      const meta = rc.all.find((n) => n.id === r.id)!;
      const href = t.nodeHref(meta.path);
      const title = `${r.icon ? `${esc(r.icon)} ` : ""}${esc(r.title)}`;
      const cells = props.map((p) => `<td>${esc(displayText(p, cellValue(db, r, p.id, rc.ctx)))}</td>`).join("");
      return `<tr><td class="t">${href ? `<a href="${relHref(fromFile, href)}">${title}</a>` : title}</td>${cells}</tr>`;
    })
    .join("");
  return `<div class="db"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table><p class="muted">${rows.length} ${LABELS[rc.lang].rows}</p></div>`;
}

/** Veritabanı satırının özelliklerini tablo olarak verir. */
function rowProperties(row: NodeMeta, rc: RenderContext): string {
  const parent = rc.all.find((n) => n.id === row.parentNodeId);
  if (!parent?.database) return "";
  const db = parseDatabase(parent.database);
  const r = toRow(row);
  const items = db.properties
    .map((p) => [p.name, displayText(p, cellValue(db, r, p.id, rc.ctx))] as const)
    .filter(([, v]) => v !== "")
    .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`)
    .join("");
  return items ? `<table class="props">${items}</table>` : "";
}

/** Bir Node'un Markdown gövdesini HTML'e çevirir (Nularche'ye özgü bloklar dahil). */
export function renderBody(node: NodeMeta, body: string, rc: RenderContext, t: RenderTarget, fromFile: string): string {
  const embeds: string[] = [];
  let md = body
    // Gömülü veritabanı ve YouTube satırları önce yer tutuculara çevrilir.
    .replace(/^@\[database\]\(([^)\s]+)\)[ \t]*$/gm, (_m, url: string) => {
      const target = resolveLink(node.path, url);
      const view = /#view=([^&\s]+)/.exec(url)?.[1];
      const dbNode = target ? rc.byPath.get(target) : undefined;
      embeds.push(dbNode?.database ? `<h3 class="db-title">${esc(dbNode.icon ?? "▦")} ${esc(dbNode.title)}</h3>${databaseTable(dbNode, view ? decodeURIComponent(view) : undefined, rc, t, fromFile)}` : "");
      return `\n<div data-embed="${embeds.length - 1}"></div>\n`;
    })
    .replace(/^@\[youtube\]\(([^)\s]+)\)[ \t]*$/gm, (_m, url: string) => {
      const id = /(?:v=|youtu\.be\/|embed\/)([\w-]{6,})/.exec(url)?.[1];
      embeds.push(
        id
          ? `<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${esc(id)}" allowfullscreen loading="lazy"></iframe></div>`
          : `<p><a href="${esc(url)}">${esc(url)}</a></p>`,
      );
      return `\n<div data-embed="${embeds.length - 1}"></div>\n`;
    });
  // GitHub uyarıları (> [!NOTE]) callout kutusu olur.
  md = md.replace(/^> \[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*$/gim, (_m, k: string) => `> <span class="callout-mark" data-kind="${k.toLowerCase()}"></span>`);
  const marked = new Marked({ gfm: true });
  marked.use({
    walkTokens(token) {
      if (token.type !== "link" && token.type !== "image") return;
      const tk = token as Tokens.Link | Tokens.Image;
      const target = resolveLink(node.path, tk.href);
      if (!target) return;
      if (target.toLowerCase().endsWith(".md")) {
        const href = t.nodeHref(target);
        tk.href = href ? relHref(fromFile, href) : "";
      } else if (target.startsWith(`${ATTACHMENTS_DIR}/`)) {
        tk.href = assetUrl(t, target, fromFile);
      }
    },
    renderer: {
      link(tk) {
        const text = this.parser.parseInline(tk.tokens);
        return tk.href ? `<a href="${esc(tk.href)}">${text}</a>` : `<span class="dead-link">${text}</span>`;
      },
    },
  });
  let html = marked.parse(md, { async: false }) as string;
  html = html
    .replace(/<blockquote>\s*<p><span class="callout-mark" data-kind="(\w+)"><\/span>\s*/g, '<blockquote class="callout callout-$1"><p>')
    .replace(/<div data-embed="(\d+)"><\/div>/g, (_m, i: string) => embeds[Number(i)] ?? "");
  return html;
}

const STYLE = `:root{--bg:#ffffff;--fg:#1f2328;--muted:#59636e;--line:#d8dee4;--soft:#f6f8fa;--accent:#007f89;--note:#2f81f7;--tip:#3fb950;--important:#a371f7;--warning:#d29922;--caution:#f85149}
@media (prefers-color-scheme:dark){:root{--bg:#0b0d10;--fg:#e6edf3;--muted:#8b949e;--line:#262f3a;--soft:#12161b;--accent:#00a8b5}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;display:flex;min-height:100vh}
a{color:var(--accent)}aside{width:260px;flex:none;border-right:1px solid var(--line);padding:20px 12px;background:var(--soft);position:sticky;top:0;height:100vh;overflow:auto;font-size:14px}
aside .brand{font-weight:700;margin:0 8px 12px;display:block;color:var(--fg);text-decoration:none}aside ul{list-style:none;margin:0;padding-left:12px}aside>ul{padding-left:0}aside li a{display:block;padding:3px 8px;border-radius:6px;color:var(--fg);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}aside li a:hover,aside li a.on{background:rgba(127,127,127,.15)}
main{flex:1;min-width:0}.cover{height:200px;background-size:cover;background-position:center}.page{max-width:860px;margin:0 auto;padding:40px 32px 80px}.page.wide{max-width:1180px}
.crumbs{font-size:13px;color:var(--muted);margin-bottom:12px}.crumbs a{color:var(--muted)}.icon{font-size:56px;line-height:1}h1{font-size:40px;line-height:1.2;margin:12px 0 20px;overflow-wrap:anywhere}
pre{background:var(--soft);border:1px solid var(--line);border-radius:8px;padding:12px;overflow:auto}code{font-family:"JetBrains Mono",ui-monospace,Menlo,monospace;font-size:.9em}img{max-width:100%;border-radius:6px}
blockquote{margin:0;padding:4px 16px;border-left:3px solid var(--line);color:var(--muted)}.callout{border-left-width:4px;background:var(--soft);border-radius:6px;color:var(--fg)}.callout-note{border-color:var(--note)}.callout-tip{border-color:var(--tip)}.callout-important{border-color:var(--important)}.callout-warning{border-color:var(--warning)}.callout-caution{border-color:var(--caution)}
table{border-collapse:collapse;width:100%;font-size:14px;margin:8px 0}th,td{border:1px solid var(--line);padding:6px 10px;text-align:left;vertical-align:top}thead th{background:var(--soft)}.db{overflow-x:auto}.db td.t{font-weight:500}table.props th{width:200px;color:var(--muted);font-weight:500;background:none}table.props{width:auto;min-width:50%}
.muted{color:var(--muted);font-size:13px}.dead-link{text-decoration:underline dotted}details{border:1px solid var(--line);border-radius:8px;padding:6px 12px;margin:8px 0}summary{cursor:pointer;font-weight:500}
.video{position:relative;padding-top:56.25%}.video iframe{position:absolute;inset:0;width:100%;height:100%;border:0;border-radius:8px}.subpages{margin-top:32px;border-top:1px solid var(--line);padding-top:12px}
footer{margin-top:48px;color:var(--muted);font-size:12px}ul.contains-task-list{list-style:none;padding-left:4px}
@media (max-width:760px){body{display:block}aside{position:static;width:auto;height:auto;border-right:0;border-bottom:1px solid var(--line)}.page{padding:24px 16px 60px}h1{font-size:30px}}`;

function assetUrl(t: RenderTarget, assetPath: string, fromFile: string): string {
  const href = t.assetHref(assetPath);
  return href.startsWith("data:") || href === "" ? href : relHref(fromFile, href);
}

function coverHtml(node: NodeMeta, t: RenderTarget, fromFile: string): string {
  if (!node.cover) return "";
  if (GRADIENTS[node.cover]) return `<div class="cover" style="background:${GRADIENTS[node.cover]}"></div>`;
  if (/^https?:/.test(node.cover)) return `<div class="cover" style="background-image:url('${esc(node.cover)}')"></div>`;
  const target = posix.normalize(posix.join(posix.dirname(node.path), node.cover));
  return target.startsWith(`${ATTACHMENTS_DIR}/`) ? `<div class="cover" style="background-image:url('${esc(assetUrl(t, target, fromFile))}')"></div>` : "";
}

function page(opts: { lang: string; title: string; css: string; nav?: string; main: string }): string {
  return `<!doctype html>
<html lang="${opts.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Nularche">
<title>${esc(opts.title)}</title>
${opts.css}
</head>
<body>
${opts.nav ?? ""}<main>${opts.main}</main>
</body>
</html>
`;
}

async function contextFor(store: NodeStore, lang: "tr" | "en"): Promise<RenderContext> {
  const all = await store.list();
  return { all, byPath: new Map(all.map((n) => [n.path, n])), ctx: computeContext(all), lang };
}

function descendants(all: NodeMeta[], id: string): NodeMeta[] {
  const out: NodeMeta[] = [];
  const walk = (pid: string) => {
    for (const n of all) if (n.parentNodeId === pid) (out.push(n), walk(n.id));
  };
  walk(id);
  return out;
}

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
};

/** Tek bir sayfayı, resimleri gömülü (data: URI), stil dahil tek bir HTML dosyası olarak üretir. */
export async function exportPageHtml(store: NodeStore, ref: string, lang: "tr" | "en" = "tr"): Promise<{ name: string; html: string }> {
  const rc = await contextFor(store, lang);
  const node = await store.read(ref);
  const assets = new Map<string, string>();
  for (const l of extractLinks(node.path, node.body)) {
    if (!l.target.startsWith(`${ATTACHMENTS_DIR}/`) || !(await store.pathExists(l.target))) continue;
    const mime = MIME[posix.extname(l.target).toLowerCase()];
    if (mime && mime.startsWith("image/")) assets.set(l.target, `data:${mime};base64,${(await store.readRaw(l.target)).toString("base64")}`);
  }
  const coverTarget = node.cover && !GRADIENTS[node.cover] && !/^https?:/.test(node.cover) ? posix.normalize(posix.join(posix.dirname(node.path), node.cover)) : null;
  if (coverTarget?.startsWith(`${ATTACHMENTS_DIR}/`) && (await store.pathExists(coverTarget))) {
    const mime = MIME[posix.extname(coverTarget).toLowerCase()] ?? "image/png";
    assets.set(coverTarget, `data:${mime};base64,${(await store.readRaw(coverTarget)).toString("base64")}`);
  }
  const target: RenderTarget = { nodeHref: () => null, assetHref: (p) => assets.get(p) ?? "" };
  const file = posix.basename(htmlPathOf(node.path));
  const main = `${coverHtml(node, target, file)}<article class="page${node.database ? " wide" : ""}">${node.icon ? `<div class="icon">${esc(node.icon)}</div>` : ""}<h1>${esc(node.title)}</h1>${rowProperties(node, rc)}${node.database ? databaseTable(node, undefined, rc, target, file) : ""}${renderBody(node, node.body, rc, target, file)}<footer>${LABELS[lang].made}</footer></article>`;
  return { name: `${node.title.replace(/[\\/:*?"<>|]/g, "-")}.html`, html: page({ lang, title: node.title, css: `<style>${STYLE}</style>`, main }) };
}

/** Sayfayı alt sayfaları ve başvurduğu eklerle birlikte, Origin'deki göreli yolları koruyarak Markdown .zip olarak verir. */
export async function exportMarkdownZip(store: NodeStore, ref: string): Promise<{ name: string; data: Uint8Array; count: number }> {
  const all = await store.list();
  const root = await store.read(ref);
  const nodes = [root, ...descendants(all, root.id)];
  const files: Zippable = {};
  const assets = new Set<string>();
  for (const n of nodes) {
    const raw = await store.readRaw(n.path);
    files[n.path] = new Uint8Array(raw);
    for (const l of extractLinks(n.path, raw.toString("utf8"))) if (l.target.startsWith(`${ATTACHMENTS_DIR}/`)) assets.add(l.target);
    if (n.cover && !GRADIENTS[n.cover] && !/^https?:/.test(n.cover)) assets.add(posix.normalize(posix.join(posix.dirname(n.path), n.cover)));
  }
  for (const a of assets) if (a.startsWith(`${ATTACHMENTS_DIR}/`) && (await store.pathExists(a))) files[a] = new Uint8Array(await store.readRaw(a));
  return { name: `${root.title.replace(/[\\/:*?"<>|]/g, "-")}.zip`, data: zipSync(files), count: nodes.length };
}

/**
 * Statik web sitesi üretir: her sayfa için bir HTML dosyası, gezinme menüsü, stil ve ekler.
 * `rootId` verilirse o sayfa ve alt sayfaları; verilmezse "Web'de yayınla" (publish) işaretli sayfalar ve alt sayfaları.
 * Yayınlanmayan sayfalara verilen bağlantılar düz metne çevrilir (gizli sayfalar sızmaz).
 */
export async function exportSite(
  store: NodeStore,
  options: { rootId?: string; siteTitle?: string; lang?: "tr" | "en" } = {},
): Promise<{ files: Record<string, Uint8Array>; pages: number }> {
  const lang = options.lang ?? "tr";
  const rc = await contextFor(store, lang);
  let roots: NodeMeta[];
  if (options.rootId) {
    const r = rc.all.find((n) => n.id === options.rootId || n.path === options.rootId);
    if (!r) throw new NodeError("not_found", `Node bulunamadı: ${options.rootId}`);
    roots = [r];
  } else {
    const published = rc.all.filter((n) => n.publish && !n.template);
    roots = published.filter((n) => !published.some((p) => p.id !== n.id && descendants(rc.all, p.id).some((d) => d.id === n.id)));
  }
  if (roots.length === 0) throw new NodeError("invalid", lang === "tr" ? "Yayınlanacak sayfa yok: bir sayfanın ⋯ menüsünden “Web'de yayınla”yı açın." : "Nothing to publish: turn on “Publish to web” in a page's ⋯ menu.");
  const selected = new Map<string, NodeMeta>();
  for (const r of roots) for (const n of [r, ...descendants(rc.all, r.id)]) if (!n.template) selected.set(n.id, n);
  const pagePaths = new Map([...selected.values()].map((n) => [n.path, htmlPathOf(n.path)]));
  const assets = new Set<string>();
  const target: RenderTarget = {
    nodeHref: (p) => pagePaths.get(p) ?? null,
    assetHref: (p) => (assets.add(p), p),
  };
  const files: Record<string, Uint8Array> = {};
  const enc = new TextEncoder();
  const siteTitle = options.siteTitle || (roots.length === 1 ? roots[0].title : "Nularche");
  const isDbRow = (n: NodeMeta) => !!rc.all.find((p) => p.id === n.parentNodeId)?.database;

  const navFor = (current: NodeMeta | null, fromFile: string) => {
    const item = (n: NodeMeta): string => {
      const kids = rc.all.filter((c) => c.parentNodeId === n.id && selected.has(c.id) && !isDbRow(c));
      const href = relHref(fromFile, pagePaths.get(n.path)!);
      return `<li><a href="${href}"${current?.id === n.id ? ' class="on"' : ""}>${n.icon ? `${esc(n.icon)} ` : ""}${esc(n.title)}</a>${kids.length ? `<ul>${kids.map(item).join("")}</ul>` : ""}</li>`;
    };
    return `<aside><a class="brand" href="${relHref(fromFile, "index.html")}">${esc(siteTitle)}</a><ul>${roots.map(item).join("")}</ul></aside>\n`;
  };

  for (const n of selected.values()) {
    const file = pagePaths.get(n.path)!;
    const body = (await store.read(n.id)).body;
    const crumbs: string[] = [];
    let cur = rc.all.find((p) => p.id === n.parentNodeId);
    while (cur && selected.has(cur.id)) {
      crumbs.unshift(`<a href="${relHref(file, pagePaths.get(cur.path)!)}">${esc(cur.title)}</a>`);
      cur = rc.all.find((p) => p.id === cur!.parentNodeId);
    }
    const kids = rc.all.filter((c) => c.parentNodeId === n.id && selected.has(c.id) && !n.database);
    const linkedInBody = new Set(extractLinks(n.path, body).map((l) => l.target));
    const unlinked = kids.filter((k) => !linkedInBody.has(k.path) && !k.database);
    const subpages = unlinked.length
      ? `<nav class="subpages"><p class="muted">${LABELS[lang].subpages}</p><ul>${unlinked.map((k) => `<li><a href="${relHref(file, pagePaths.get(k.path)!)}">${k.icon ? `${esc(k.icon)} ` : ""}${esc(k.title)}</a></li>`).join("")}</ul></nav>`
      : "";
    const main =
      `${coverHtml(n, target, file)}<article class="page${n.database ? " wide" : ""}">` +
      (crumbs.length ? `<div class="crumbs">${crumbs.join(" / ")}</div>` : "") +
      `${n.icon ? `<div class="icon">${esc(n.icon)}</div>` : ""}<h1>${esc(n.title)}</h1>${rowProperties(n, rc)}` +
      `${n.database ? databaseTable(n, undefined, rc, target, file) : ""}${renderBody(n, body, rc, target, file)}${subpages}<footer>${LABELS[lang].made}</footer></article>`;
    files[file] = enc.encode(page({ lang, title: `${n.title} · ${siteTitle}`, css: `<link rel="stylesheet" href="${relHref(file, "style.css")}">`, nav: navFor(n, file), main }));
  }
  // Giriş sayfası: tek kök varsa ona yönlendirir, değilse içindekiler listesi.
  const index =
    roots.length === 1
      ? `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=${encodePath(pagePaths.get(roots[0].path)!)}"><title>${esc(siteTitle)}</title><a href="${encodePath(pagePaths.get(roots[0].path)!)}">${esc(roots[0].title)}</a>`
      : page({
          lang,
          title: siteTitle,
          css: `<link rel="stylesheet" href="style.css">`,
          nav: navFor(null, "index.html"),
          main: `<article class="page"><h1>${esc(siteTitle)}</h1><h3>${LABELS[lang].contents}</h3><ul>${roots.map((r) => `<li><a href="${encodePath(pagePaths.get(r.path)!)}">${r.icon ? `${esc(r.icon)} ` : ""}${esc(r.title)}</a></li>`).join("")}</ul><footer>${LABELS[lang].made}</footer></article>`,
        });
  files["index.html"] = enc.encode(index);
  files["style.css"] = enc.encode(STYLE);
  files[".nojekyll"] = new Uint8Array(); // GitHub Pages: dosyaları olduğu gibi sun
  for (const a of assets) if (a.startsWith(`${ATTACHMENTS_DIR}/`) && (await store.pathExists(a))) files[a] = new Uint8Array(await store.readRaw(a));
  return { files, pages: selected.size };
}

export const zipFiles = (files: Record<string, Uint8Array>) => zipSync(files);

// Gömmeleri açma (dışa aktarma ve yayınlama için): `![[Not]]`, `![[Not#Başlık]]` ve `![[Not#^blok]]` yerine
// gömülen içerik yazılır. Kilitli notlar gömülmez; iç içe gömmeler en fazla üç düzey açılır, döngüler kırılır.
// Görsel gömmeleri (`![[resim.png]]`) olduğu gibi kalır (exportableMarkdown onları görsel bağlantısına çevirir).


import { findBlock, headingSection, stripBlockIds } from "./blocks.ts";
import { rewriteLinks } from "./links.ts";
import type { NodeStore } from "./node-store.ts";
import { isLockedBody, maskCode } from "./note-text.ts";
import { wikiResolver } from "./wikilinks.ts";

const EMBED_RE = /!\[\[([^\]\n|#]*)(?:#([^\]\n|]*))?(?:\|[^\]\n]*)?\]\]/g;
const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
const MAX_DEPTH = 3;

export async function expandEmbeds(store: NodeStore, body: string, fromPath: string, seen: Set<string> = new Set(), depth = 0): Promise<string> {
  if (depth >= MAX_DEPTH || !body.includes("![[")) return body;
  const all = await store.list();
  const resolve = wikiResolver(all.map((n) => ({ path: n.path, title: n.title, aliases: n.aliases })));
  const byPath = new Map(all.map((n) => [n.path, n]));
  const masked = maskCode(body);
  let out = "";
  let last = 0;
  for (const m of masked.matchAll(EMBED_RE)) {
    const target = m[1].trim();
    const anchor = m[2]?.trim() || null;
    if (IMAGE.test(target)) continue;
    const p = target ? resolve(target) : fromPath;
    const meta = p ? byPath.get(p) : undefined;
    if (!meta) continue;
    const key = `${meta.id}#${anchor ?? ""}`;
    let text = "";
    if (!meta.locked && !seen.has(key)) {
      const doc = await store.read(meta.id);
      if (!isLockedBody(doc.body)) {
        const part = anchor?.startsWith("^") ? findBlock(doc.body, anchor.slice(1)) : anchor ? headingSection(doc.body, anchor) : doc.body;
        if (part !== null) {
          const next = new Set(seen).add(key);
          const inner = await expandEmbeds(store, part, doc.path, next, depth + 1);
          text = rewriteLinks(stripBlockIds(inner).trim(), doc.path, fromPath, new Map());
        }
      }
    }
    out += body.slice(last, m.index) + text;
    last = m.index! + m[0].length;
  }
  return out + body.slice(last);
}


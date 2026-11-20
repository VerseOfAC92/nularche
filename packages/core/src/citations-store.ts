// Origin'in kaynakçası: ayarlardaki `.bib` / CSL-JSON dosyalarını okur (değişmeyen dosyalar önbellekten) ve dışa
// aktarmada atıfları biçimlendirir. Biçimlendirme kuralları citations.ts içindedir.

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { BIBLIOGRAPHY_MARKER, CITATION_STYLES, parseBibtex, parseCslJson, renderCitations, type CitationLang, type CitationStyle, type CslItem, type Library, type LibraryProblem } from "./citations.ts";
import { readPrefs } from "./prefs.ts";


export interface CitationSettings {
  /** Origin'e göre kaynak dosyaları (`.bib` ya da `.json`). */
  files: string[];
  style: CitationStyle;
}

export async function citationSettings(root: string): Promise<CitationSettings> {
  const prefs = await readPrefs(root);
  const raw = prefs.citationFiles;
  const files = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string" && !!x.trim()) : typeof raw === "string" && raw ? [raw] : [];
  const style = CITATION_STYLES.includes(prefs.citationStyle as CitationStyle) ? (prefs.citationStyle as CitationStyle) : "apa";
  return { files, style };
}

const cache = new Map<string, { mtimeMs: number; size: number; items: CslItem[]; problems: string[] }>();

function insideOrigin(root: string, rel: string): string | null {
  const clean = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!clean || clean.split("/").some((s) => s === "..")) return null;
  const abs = path.join(root, ...clean.split("/"));
  return abs.startsWith(path.resolve(root) + path.sep) ? abs : null;
}

/** Ayarlardaki kaynak dosyalarını okur (değişmeyen dosyalar önbellekten). */
export async function loadLibrary(root: string, files?: string[]): Promise<Library> {
  const list = files ?? (await citationSettings(root)).files;
  const items = new Map<string, CslItem>();
  const problems: LibraryProblem[] = [];
  for (const rel of list) {
    const abs = insideOrigin(root, rel);
    if (!abs) {
      problems.push({ file: rel, message: "Origin dışındaki dosya okunmaz." });
      continue;
    }
    try {
      const st = await stat(abs);
      let hit = cache.get(abs);
      if (!hit || hit.mtimeMs !== st.mtimeMs || hit.size !== st.size) {
        const text = await readFile(abs, "utf8");
        const parsed = /\.json$/i.test(abs) ? parseCslJson(text) : parseBibtex(text);
        hit = { mtimeMs: st.mtimeMs, size: st.size, ...parsed };
        cache.set(abs, hit);
      }
      for (const it of hit.items) if (!items.has(it.id)) items.set(it.id, it);
      for (const p of hit.problems) problems.push({ file: rel, message: p });
    } catch (e) {
      problems.push({ file: rel, message: (e as NodeJS.ErrnoException).code === "ENOENT" ? "Dosya bulunamadı." : (e as Error).message });
    }
  }
  return { items, sources: list, problems };
}

/** Dışa aktarma için: Origin'in kaynakçası ve stiliyle atıfları biçimlendirir (kaynak dosyası yoksa gövde aynen). */
export async function applyCitations(root: string, body: string, lang: CitationLang): Promise<string> {
  if (!body.includes("@")) return body.replace(BIBLIOGRAPHY_MARKER, "");
  const settings = await citationSettings(root);
  if (!settings.files.length) return body;
  const lib = await loadLibrary(root, settings.files);
  return renderCitations(body, lib.items, settings.style, lang).markdown;
}

/** Origin'deki kaynakça olabilecek dosyalar (`.bib`, `.json`), gizli klasörler hariç; en fazla 200. */
export async function findLibraryFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, rel: string) => {
    if (out.length >= 200) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(path.join(dir, e.name), r);
      else if (/\.(bib|json)$/i.test(e.name)) out.push(r);
    }
  };
  await walk(root, "");
  return out.sort();
}

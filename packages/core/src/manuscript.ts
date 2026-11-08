// Manuskript derleme: manuskript sayfasındaki bölümleri (notları) sırasıyla tek bir Markdown metninde birleştirir.
// Dışa aktarma (DOCX, RTF, HTML, metin) ve MCP aracı bu derlemeyi kullanır. Notlar değiştirilmez.

import { rewriteLinks } from "./links.ts";
import { countWords, exportableMarkdown, isLockedBody, plainText } from "./note-text.ts";
import { NodeError, type NodeStore } from "./node-store.ts";
import { parseWriting, type ManuscriptData } from "./writing.ts";

export interface CompiledPart {
  path: string;
  title: string;
  /** Not bulunamadı (silinmiş/taşınmış) ya da kilitli olduğu için derlemeye girmedi. */
  missing?: "not_found" | "locked";
  words: number;
  id?: string;
}

export interface CompiledSection {
  id: string;
  title: string;
  parts: CompiledPart[];
  words: number;
}

export interface CompiledManuscript {
  id: string;
  title: string;
  markdown: string;
  sections: CompiledSection[];
  words: number;
  wordGoal?: number;
  data: ManuscriptData;
}

/** Notun ilk satırı başlığıyla aynı bir başlıksa (`# Başlık`) derlemede iki kez yazılmasın. */
function dropLeadingTitle(body: string, title: string): string {
  const m = /^\s*#{1,6}\s+(.+?)\s*\n/.exec(body);
  return m && m[1].trim().toLocaleLowerCase("tr") === title.trim().toLocaleLowerCase("tr") ? body.slice(m[0].length) : body;
}

export async function compileManuscript(store: NodeStore, ref: string): Promise<CompiledManuscript> {
  const ms = await store.read(ref);
  if (ms.layoutMode !== "manuscript") throw new NodeError("invalid", "Bu sayfa bir manuskript değil.");
  const { data } = parseWriting("manuscript", ms.body);
  const all = await store.list();
  const byPath = new Map(all.map((n) => [n.path, n]));
  const sections: CompiledSection[] = [];
  const chunks: string[] = [];
  const named = data.sections.filter((s) => s.title.trim()).length;
  for (const section of data.sections) {
    const parts: CompiledPart[] = [];
    const texts: string[] = [];
    for (const item of section.items) {
      const meta = byPath.get(item.file);
      if (!meta) {
        parts.push({ path: item.file, title: item.file.split("/").pop()!.replace(/\.md$/, ""), missing: "not_found", words: 0 });
        continue;
      }
      const doc = await store.read(meta.id);
      if (doc.locked || isLockedBody(doc.body)) {
        parts.push({ id: doc.id, path: doc.path, title: doc.title, missing: "locked", words: 0 });
        continue;
      }
      const body = rewriteLinks(dropLeadingTitle(exportableMarkdown(doc.body), doc.title).trim(), doc.path, ms.path, new Map());
      const words = countWords(plainText(body));
      parts.push({ id: doc.id, path: doc.path, title: doc.title, words });
      const level = data.options.sectionTitles && named ? "##" : "#";
      texts.push(`${data.options.fileTitles ? `${level} ${doc.title}\n\n` : ""}${body}`);
    }
    const words = parts.reduce((n, p) => n + p.words, 0);
    sections.push({ id: section.id, title: section.title, parts, words });
    if (!texts.length) continue;
    const sep = data.options.separator.trim() ? `\n\n${data.options.separator.trim()}\n\n` : "\n\n";
    chunks.push(`${data.options.sectionTitles && section.title.trim() ? `# ${section.title.trim()}\n\n` : ""}${texts.join(sep)}`);
  }
  const markdown = chunks.join("\n\n").trim() + "\n";
  return {
    id: ms.id,
    title: ms.title,
    markdown,
    sections,
    words: sections.reduce((n, s) => n + s.words, 0),
    ...(ms.wordGoal ? { wordGoal: ms.wordGoal } : {}),
    data,
  };
}

/** Dışa aktarılacak gövde: manuskriptlerde derlenmiş metin, diğer sayfalarda notun kendisi. */
export async function exportBodyOf(store: NodeStore, node: { id: string; layoutMode: string; body: string }): Promise<string> {
  return node.layoutMode === "manuscript" ? (await compileManuscript(store, node.id)).markdown : node.body;
}

// Arayüzde kaynakça: Origin'in kaynak dosyalarındaki kayıtlar (sunucudan) ve seçili stile göre atıf etiketleri.
// Editördeki atıf çipleri, `[@` önerileri ve Ayarlar → Yazma → Kaynakça bunu kullanır. Biçim kuralları
// core/src/citations.ts içindedir (dışa aktarmayla aynı çıktı).

import { useSyncExternalStore } from "react";
import { formatCluster, formatEntry, parseCluster, yearOf, type CitationStyle, type CslItem } from "../../core/src/citations.ts";
import { getLang } from "./i18n/index.ts";

export interface CitationState {
  style: CitationStyle;
  files: string[];
  items: Map<string, CslItem>;
  problems: { file: string; message: string }[];
  available: string[];
}

let state: CitationState = { style: "apa", files: [], items: new Map(), problems: [], available: [] };
let version = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function reloadCitations(): Promise<void> {
  inflight ??= fetch("/api/citations")
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { style: CitationStyle; files: string[]; items: CslItem[]; problems: CitationState["problems"]; available: string[] } | null) => {
      if (!d) return;
      state = { style: d.style, files: d.files, items: new Map(d.items.map((i) => [i.id, i])), problems: d.problems, available: d.available };
      version++;
      listeners.forEach((l) => l());
    })
    .catch(() => undefined)
    .finally(() => (inflight = null));
  return inflight;
}

export function useCitations(): CitationState {
  useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => version,
  );
  return state;
}

export const citationState = () => state;

const lang = () => (getLang() === "en" ? "en" : "tr");

/** Atıf kümesinin (ör. `[@a, s. 3]`) metin içi görünümü ve kaynakça satırları (ipucu için). */
export function citeLabel(raw: string): { text: string; title: string; missing: string[] } {
  const refs = parseCluster(raw.replace(/^\[|\]$/g, ""));
  if (!refs) return { text: raw, title: "", missing: [] };
  const numbers = new Map<string, number>();
  // IEEE'de numara notun içindeki sıraya bağlıdır; editörde yalnızca anahtar sırası gösterilir.
  const text = formatCluster(refs, state.items, { style: state.style, lang: lang(), numbers });
  const missing = refs.filter((r) => !state.items.has(r.key)).map((r) => r.key);
  const title = refs
    .map((r) => {
      const it = state.items.get(r.key);
      return it ? formatEntry(it, state.style === "ieee" ? "apa" : state.style, lang()).replace(/\*/g, "") : `@${r.key}: ?`;
    })
    .join("\n");
  return { text, title, missing };
}

/** `[@` önerileri: anahtar, yazar, başlık ya da yıla göre. */
export function searchLibrary(query: string, limit = 30): CslItem[] {
  const q = query.toLocaleLowerCase("tr");
  const out: CslItem[] = [];
  for (const it of state.items.values()) {
    const hay = `${it.id} ${(it.author ?? []).map((a) => a.literal ?? `${a.family ?? ""} ${a.given ?? ""}`).join(" ")} ${it.title ?? ""} ${yearOf(it) ?? ""}`.toLocaleLowerCase("tr");
    if (!q || hay.includes(q)) out.push(it);
    if (out.length >= limit) break;
  }
  return out;
}

export function shortAuthor(it: CslItem): string {
  const a = it.author?.[0] ?? it.editor?.[0];
  const name = a ? (a.literal ?? a.family ?? a.given ?? "") : "";
  const more = (it.author?.length ?? 0) > 1 ? " +" : "";
  return `${name}${more}${yearOf(it) ? ` (${yearOf(it)})` : ""}`;
}

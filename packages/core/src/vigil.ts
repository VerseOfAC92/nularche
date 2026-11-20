// Vigil: zamanlanmış otomasyonlar. Her gün, hafta ya da ay belirli bir saatte ya Nularche AI'a bir iş verilir
// (ör. "geçen haftanın notlarını özetle") ya da Nularche'nin kendisi bir özet notu yazar (değişen ve yeni notlar,
// açık görevler, Mnemos kartları). Tanımlar Origin'in tercihlerinde (`vigils`) durur ve eşitlenir; son çalışma
// zamanı da orada tutulduğundan aynı Origin'i kullanan iki bilgisayar aynı işi iki kez yapmaz. Uygulama kapalıyken
// kaçırılan çalışma, uygulama açılınca bir kez yapılır.

import { relativeLink } from "./links.ts";
import { Mnemos } from "./mnemos.ts";
import { SHADOW, type NodeMeta, type NodeStore } from "./node-store.ts";
export * from "./vigil-schedule.ts";

// ------------------------------------------------------------------ yerel özet notu

const fmtDay = (t: number, lang: "tr" | "en") => new Date(t).toLocaleDateString(lang === "tr" ? "tr-TR" : "en-GB", { day: "numeric", month: "long", year: "numeric" });

/**
 * Son `days` günün özetini yeni bir not olarak yazar (Shadow'a ya da verilen notun altına) ve notu döndürür:
 * yeni notlar, güncellenen notlar (Arche'lere göre), açık görevleri olan notlar ve Mnemos'ta bekleyen kartlar.
 */
export async function writeDigest(store: NodeStore, options: { days: number; title: string; parentId?: string | null; lang: "tr" | "en"; now?: number }) {
  const now = options.now ?? Date.now();
  const since = now - Math.max(1, Math.min(366, options.days)) * 86_400_000;
  const all = (await store.list()).filter((n) => !n.template && !n.database);
  const byId = new Map(all.map((n) => [n.id, n]));
  const L =
    options.lang === "tr"
      ? { period: "Dönem", fresh: "Yeni notlar", changed: "Güncellenen notlar", tasks: "Açık görevleri olan notlar", cards: "Mnemos", cardsLine: "Tekrarı gelen {due} kart, {new} yeni kart.", none: "Bu dönemde değişiklik yok.", words: "kelime" }
      : { period: "Period", fresh: "New notes", changed: "Updated notes", tasks: "Notes with open tasks", cards: "Mnemos", cardsLine: "{due} cards due, {new} new cards.", none: "No changes in this period.", words: "words" };
  const parent = options.parentId && byId.has(options.parentId) ? options.parentId : SHADOW;
  const note = await store.create({ title: options.title, parentNodeId: parent });
  const link = (n: NodeMeta) => `[${n.title.replace(/[[\]]/g, "")}](${relativeLink(note.path, n.path)})`;
  const arche = (n: NodeMeta) => (n.archeId && n.archeId !== n.id ? byId.get(n.archeId)?.title : n.archeId === null ? "Shadow" : null);
  const fresh = all.filter((n) => n.id !== note.id && n.createdAt >= since).sort((a, b) => b.createdAt - a.createdAt);
  const changed = all.filter((n) => n.id !== note.id && n.createdAt < since && n.updatedAt >= since).sort((a, b) => b.updatedAt - a.updatedAt);
  const groups = new Map<string, NodeMeta[]>();
  for (const n of changed) groups.set(arche(n) ?? n.title, [...(groups.get(arche(n) ?? n.title) ?? []), n]);
  const lines: string[] = [`${L.period}: ${fmtDay(since, options.lang)} – ${fmtDay(now, options.lang)}`, ""];
  if (!fresh.length && !changed.length) lines.push(L.none, "");
  if (fresh.length) lines.push(`## ${L.fresh} (${fresh.length})`, "", ...fresh.slice(0, 100).map((n) => `- ${link(n)}${arche(n) ? ` · ${arche(n)}` : ""}${n.words ? ` · ${n.words} ${L.words}` : ""}`), "");
  if (changed.length) {
    lines.push(`## ${L.changed} (${changed.length})`, "");
    for (const [g, list] of groups) lines.push(`**${g}**`, "", ...list.slice(0, 50).map((n) => `- ${link(n)}`), "");
  }
  const withTasks = all.filter((n) => n.todos - n.done > 0 && !n.locked).sort((a, b) => b.todos - b.done - (a.todos - a.done));
  if (withTasks.length) lines.push(`## ${L.tasks}`, "", ...withTasks.slice(0, 20).map((n) => `- ${link(n)} — ${n.todos - n.done}`), "");
  try {
    const q = await new Mnemos(store).queue({ newPerDay: 1_000_000, now });
    if (q.counts.total) lines.push(`## ${L.cards}`, "", L.cardsLine.replace("{due}", String(q.counts.due)).replace("{new}", String(q.counts.new)), "");
  } catch {
    // kartlar okunamadı: özet yine yazılır
  }
  return store.update(note.id, { body: `${lines.join("\n").trim()}\n`, fields: { icon: "🕯️" } });
}

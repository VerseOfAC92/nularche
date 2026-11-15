// Markdown gövdesini üst düzey bloklara (boş satırla ayrılan paragraf, başlık, liste, kod bloğu…) böler ve
// bloklardan yeniden kurar. Nularche AI uzun notları baştan yazmak yerine blokları numarasıyla yeniden sıralar;
// böylece içerik kelimesi kelimesine korunur ve modelin üretmesi gereken metin küçük kalır.

/** Kod blokları (``` ya da ~~~) içindeki boş satırlar bloğu bölmez. */
export function splitBlocks(body: string): string[] {
  const blocks: string[] = [];
  let cur: string[] = [];
  let fence: string | null = null;
  for (const line of body.replace(/\r\n?/g, "\n").split("\n")) {
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (m) {
      if (!fence) fence = m[1];
      else if (m[1][0] === fence[0] && m[1].length >= fence.length && line.trim() === m[1]) fence = null;
    }
    if (!fence && line.trim() === "" && !m) {
      if (cur.length) blocks.push(cur.join("\n"));
      cur = [];
    } else cur.push(line);
  }
  if (cur.length) blocks.push(cur.join("\n"));
  return blocks;
}

export type BlockItem = { block: number } | { text: string };

/**
 * Bloklardan yeni gövde kurar. Her blok en fazla bir kez kullanılır; kullanılmayan her blok `drop` içinde
 * açıkça listelenmelidir (içerik sessizce kaybolmasın). Hata durumunda neyin yanlış olduğunu anlatan metin döner.
 */
export function rearrangeBlocks(blocks: string[], items: BlockItem[], drop: number[] = []): { body: string } | { error: string } {
  const used = new Set<number>();
  const out: string[] = [];
  for (const it of items) {
    if ("block" in it && typeof it.block === "number") {
      const i = it.block;
      if (!Number.isInteger(i) || i < 0 || i >= blocks.length) return { error: `Geçersiz blok numarası: ${i} (0–${blocks.length - 1})` };
      if (used.has(i)) return { error: `Blok ${i} birden fazla kez kullanıldı` };
      used.add(i);
      out.push(blocks[i]);
    } else if ("text" in it && typeof it.text === "string" && it.text.trim()) out.push(it.text.trim());
  }
  const dropped = new Set(drop.filter((i) => Number.isInteger(i)));
  const missing = blocks.map((_, i) => i).filter((i) => !used.has(i) && !dropped.has(i));
  if (missing.length) {
    const list = missing.length > 40 ? `${missing.slice(0, 40).join(", ")} … (+${missing.length - 40})` : missing.join(", ");
    return { error: `Şu bloklar yerleştirilmedi: ${list}. Her bloğu items içinde kullan ya da silinmesi istendiyse drop içine yaz.` };
  }
  return { body: out.join("\n\n") + "\n" };
}

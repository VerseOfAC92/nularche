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

// ------------------------------------------------------------------ Blok kimlikleri ve blok bağlantıları
//
// Bir paragrafın ya da liste maddesinin satır sonuna yazılan ` ^kimlik` o bloğu adlandırır; başka notlar
// `[[Not#^kimlik]]` ile bağlanır, `![[Not#^kimlik]]` ile gömer. Kimlik dosyada düz metin olarak durur (Markdown
// uyumlu), arayüzde soluk gösterilir, dışa aktarmada atılır.

/** Satır sonundaki blok kimliği: boşluk + `^` + 2–40 harf, rakam ya da tire. */
export const BLOCK_ID_AT_END = /[ \t]\^([A-Za-z0-9][A-Za-z0-9-]{1,39})[ \t]*$/;
const BLOCK_ID_LINES = /[ \t]\^[A-Za-z0-9][A-Za-z0-9-]{1,39}[ \t]*$/gm;

export function isBlockId(s: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9-]{1,39}$/.test(s);
}

/** Yeni, kısa ve okunur bir blok kimliği (6 karakter). */
export function newBlockId(): string {
  const abc = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => abc[b % abc.length]).join("");
}

/** Gövdedeki blok kimliklerini atar (kod blokları korunur). */
export function stripBlockIds(body: string): string {
  const masked = body.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, (m) => m.replace(/[^\n]/g, "\u0000"));
  let out = "";
  let last = 0;
  for (const m of masked.matchAll(BLOCK_ID_LINES)) {
    out += body.slice(last, m.index);
    last = m.index! + m[0].length;
  }
  return out + body.slice(last);
}

/**
 * Kimliği verilen bloğun metni (kimlik atılmış). Kimlik bir liste maddesinin satırındaysa yalnızca o madde (alt
 * maddeleriyle), paragraftaysa paragrafın tamamı döner. Bulunamazsa null.
 */
export function findBlock(body: string, id: string): string | null {
  if (!isBlockId(id)) return null;
  const blocks = splitBlocks(body);
  for (const block of blocks) {
    if (/^\s{0,3}(`{3,}|~{3,})/.test(block)) continue; // kod bloğu
    const lines = block.split("\n");
    const at = lines.findIndex((l) => BLOCK_ID_AT_END.exec(l)?.[1] === id);
    if (at < 0) continue;
    const item = /^(\s*)(?:[-*+]|\d+[.)])\s/.exec(lines[at]);
    if (item) {
      // Liste maddesi: maddenin satırı ve daha içeriden başlayan alt satırları.
      const indent = item[1].length;
      const out = [lines[at]];
      for (const l of lines.slice(at + 1)) {
        if (l.trim() && (/^(\s*)/.exec(l)![1].length <= indent)) break;
        out.push(l);
      }
      return stripBlockIds(out.join("\n").replace(/^\s+/, (s) => s.slice(indent)));
    }
    return stripBlockIds(block);
  }
  return null;
}

/** Markdown'dan bir başlığın bölümü (bir sonraki aynı ya da üst düzey başlığa kadar), başlık satırıyla birlikte. */
export function headingSection(md: string, heading: string): string | null {
  const lines = md.split("\n");
  const key = heading.trim().toLocaleLowerCase("tr");
  const start = lines.findIndex((l) => /^#{1,6}\s/.test(l) && l.replace(/^#+\s*/, "").trim().toLocaleLowerCase("tr") === key);
  if (start < 0) return null;
  const level = /^#+/.exec(lines[start])![0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i]) && /^#+/.exec(lines[i])![0].length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

// Hariç tutulan dosyalar (Obsidian "Excluded files"): hızlı geçiş, arama sonuçları ve grafikte gösterilmez.
// Kural ya bir yol önekidir (`Arşiv/`) ya da eğik çizgilerle yazılmış düzenli ifade (`/taslak-.*/`).

export function isExcluded(path: string, rules: string[]): boolean {
  for (const rule of rules) {
    const r = rule.trim();
    if (!r) continue;
    const re = /^\/(.+)\/([a-z]*)$/.exec(r);
    if (re) {
      try {
        if (new RegExp(re[1], re[2].replace(/[^imsu]/g, "")).test(path)) return true;
      } catch {
        // geçersiz ifade: yok say
      }
    } else if (path.toLocaleLowerCase("tr").startsWith(r.replace(/^\/+/, "").toLocaleLowerCase("tr"))) return true;
  }
  return false;
}

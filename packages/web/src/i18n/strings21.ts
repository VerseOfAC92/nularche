// Sürüm 3: yazma ve araştırma (okunabilirlik, blok bağlantıları, kaynakça, PDF okuyucu) metinleri. strings.ts
// sözlüğüne katılır; her iki dili de yazın.

export const STRINGS_21 = {
  "read.label": { tr: "Okunabilirlik {n} ({level})", en: "Readability {n} ({level})" },
  "read.veryEasy": { tr: "çok kolay", en: "very easy" },
  "read.easy": { tr: "kolay", en: "easy" },
  "read.medium": { tr: "orta", en: "medium" },
  "read.hard": { tr: "zor", en: "hard" },
  "read.veryHard": { tr: "çok zor", en: "very hard" },
  "read.tipTr": {
    tr: "Ateşman okunabilirlik formülü (0–100, yüksek = kolay). Cümle başına {wps} kelime, kelime başına {spw} hece.",
    en: "Ateşman readability formula for Turkish (0–100, higher = easier). {wps} words per sentence, {spw} syllables per word.",
  },
  "read.tipEn": {
    tr: "Flesch okuma kolaylığı (İngilizce, 0–100, yüksek = kolay). Cümle başına {wps} kelime, kelime başına {spw} hece.",
    en: "Flesch reading ease (0–100, higher = easier). {wps} words per sentence, {spw} syllables per word.",
  },
  "blk.copyLink": { tr: "Blok bağlantısını kopyala", en: "Copy block link" },
  "blk.copyEmbed": { tr: "Blok gömmesini kopyala", en: "Copy block embed" },
  "blk.linkCopied": { tr: "Bağlantı kopyalandı: {ref}", en: "Link copied: {ref}" },
  "blk.embedCopied": { tr: "Gömme kopyalandı: {ref} — başka bir nota yapıştırın.", en: "Embed copied: {ref} — paste it into another note." },
  "blk.noBlock": { tr: "Bağlantı için imleci bir paragrafa, maddeye ya da başlığa koyun.", en: "Put the cursor in a paragraph, list item or heading to link it." },
  "cite.title": { tr: "Canon — kaynakça ve atıflar", en: "Canon — bibliography and citations" },
  "cite.hint": {
    tr: "Kaynak yönetimi programınızdan dışa aktardığınız BibTeX (.bib) ya da CSL-JSON dosyasını seçin. Notlarda [@ yazınca kaynaklar önerilir; [@anahtar, s. 12] sayfa, [-@anahtar] yazarsız atıf, [@a; @b] birden çok kaynak demektir. Dışa aktarmada atıflar seçtiğiniz stille yazılır ve sona kaynakça eklenir; yerini {{kaynakça}} (ya da {{bibliography}}) satırıyla belirleyebilirsiniz.",
    en: "Choose a BibTeX (.bib) or CSL-JSON file exported from your reference manager. Type [@ in a note to get suggestions; [@key, p. 12] adds a page, [-@key] omits the author, [@a; @b] cites several sources. On export, citations are written in your chosen style and a bibliography is added at the end; put a {{bibliography}} line to choose where.",
  },
  "cite.count": { tr: "{n} kaynak yüklü.", en: "{n} sources loaded." },
  "cite.none": { tr: "Henüz kaynak dosyası seçilmedi.", en: "No source file chosen yet." },
  "cite.pick": { tr: "Origin'den dosya seç…", en: "Choose a file from the Origin…" },
  "cite.import": { tr: "Dosya içe aktar", en: "Import a file" },
  "cite.imported": { tr: "\"{name}\" kaynakçaya eklendi.", en: "\"{name}\" added to the bibliography." },
  "cite.remove": { tr: "Kaynakçadan çıkar", en: "Remove from bibliography" },
  "cite.style": { tr: "Atıf stili", en: "Citation style" },
  "cite.group": { tr: "Kaynaklar", en: "Sources" },
  "cite.setup": { tr: "Kaynakça dosyası ekle…", en: "Add a bibliography file…" },
  "cite.setupHint": { tr: "Ayarlar → Yazma → Canon", en: "Settings → Writing → Canon" },
  "cite.edit": { tr: "Atıfı düzenleyin (silmek için boş bırakın):", en: "Edit the citation (leave empty to delete):" },
  "cite.missing": { tr: "Kaynakçada yok: {keys}", en: "Not in the bibliography: {keys}" },
} as const;

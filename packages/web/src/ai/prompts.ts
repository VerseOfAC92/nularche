// Nularche AI hazır eylemleri ve AI aracına yapıştırılan istem metni.

export interface AiAction {
  label: string;
  icon: string;
  instruction: string;
}

export const AI_ACTIONS: AiAction[] = [
  { label: "Düzelt", icon: "✓", instruction: "Yazım, dilbilgisi ve noktalama hatalarını düzelt; anlamı, tonu ve Markdown biçimlendirmesini koru." },
  {
    label: "Özetle",
    icon: "≡",
    instruction: "Node'un en üstüne “## Özet” başlığı altında 3–5 maddelik kısa bir özet ekle; geri kalan içeriği değiştirme.",
  },
  {
    label: "Genişlet",
    icon: "↕",
    instruction: "Notları açık, düzenli ve daha ayrıntılı bir metne dönüştür; uygun başlıklar ve listeler kullan, bilgi uydurma.",
  },
  {
    label: "Yapılacaklar",
    icon: "☑",
    instruction: "Eylem maddelerini bul ve Node'un sonuna “## Yapılacaklar” başlığı altında “- [ ]” onay kutusu listesi olarak ekle.",
  },
  {
    label: "Bağla",
    icon: "↗",
    instruction:
      "search_nodes ile bu Node'un konularıyla ilgili diğer Node'ları bul; metinde uygun yerlere bu Node'un konumuna göre göreli Markdown bağlantıları ekle (ör. [Başlık](../Klasor/Baslik.md)). Uydurma bağlantı ekleme.",
  },
  { label: "İngilizce", icon: "EN", instruction: "Node'un tamamını İngilizceye çevir; Markdown yapısını koru." },
  { label: "Türkçe", icon: "TR", instruction: "Node'un tamamını Türkçeye çevir; Markdown yapısını koru." },
];

export const PROVIDER_LABEL: Record<string, string> = { claude: "Claude", chatgpt: "ChatGPT", gemini: "Gemini" };

/** AI aracına yapıştırılacak istem: AI, ayrıntıları get_nularche_request ile Nularche'den alır. */
export function requestPrompt(req: { id: string; label: string; instruction: string; nodeTitle?: string; selection?: string }): string {
  const lines = [
    `Nularche AI isteği (id: ${req.id}). “nularche” MCP araçlarını kullan:`,
    `1. get_nularche_request ile isteği al (request_id: ${req.id}).`,
    `2. İsteği yerine getir. Bir Node'u değiştireceksen update_node'a read_node/get_nularche_request'ten aldığın revision'ı base_revision olarak ver.`,
    `3. complete_nularche_request ile kullanıcıya kısa bir Türkçe cevap yaz (soru ise cevabın tamamını).`,
    "",
    `İstek: ${req.label === req.instruction ? req.instruction : `${req.label}: ${req.instruction}`}`,
  ];
  if (req.nodeTitle) lines.push(`Node: “${req.nodeTitle}”`);
  if (req.selection) lines.push(`Kullanıcının seçtiği metin üzerinde çalış (ayrıntı istekte).`);
  return lines.join("\n");
}

// "Claude'da düzenle" menüsü: seçilen eyleme göre hazır bir istem oluşturur, panoya kopyalar
// ve (masaüstünde) Claude Desktop'ı açar. Düzenlemeyi Claude, "nularche" MCP sunucusu üzerinden
// kullanıcının kendi Claude aboneliğiyle yapar; uygulama AI'ya doğrudan bağlanmaz.

import { useEffect, useRef, useState } from "react";
import { copyText, desktop } from "./desktop.ts";

const ACTIONS: { label: string; instruction: string }[] = [
  {
    label: "Yazım ve dilbilgisini düzelt",
    instruction: "Yazım, dilbilgisi ve noktalama hatalarını düzelt; anlamı, tonu ve Markdown biçimlendirmesini koru.",
  },
  { label: "Özetle", instruction: "Node'un en üstüne “## Özet” başlığı altında 3–5 maddelik kısa bir özet ekle; geri kalan içeriği değiştirme." },
  {
    label: "Düzenle ve genişlet",
    instruction: "Notları açık, düzenli ve daha ayrıntılı bir metne dönüştür; uygun başlıklar ve listeler kullan, bilgi uydurma.",
  },
  {
    label: "Yapılacakları çıkar",
    instruction: "Eylem maddelerini bul ve Node'un sonuna “## Yapılacaklar” başlığı altında “- [ ]” onay kutusu listesi olarak ekle.",
  },
  {
    label: "İlgili Node'lara bağla",
    instruction:
      "search_nodes ile bu Node'un konularıyla ilgili diğer Node'ları bul; metinde uygun yerlere bu Node'un konumuna göre göreli Markdown bağlantıları ekle (ör. [Başlık](../Klasor/Baslik.md)). Uydurma bağlantı ekleme.",
  },
  { label: "İngilizceye çevir", instruction: "Node'un tamamını İngilizceye çevir; Markdown yapısını koru." },
  { label: "Türkçeye çevir", instruction: "Node'un tamamını Türkçeye çevir; Markdown yapısını koru." },
];

export function buildPrompt(node: { id: string; title: string }, instruction: string): string {
  return [
    `“nularche” MCP sunucusundaki “${node.title}” Node'u ile çalış (id: ${node.id}).`,
    `1. read_node ile Node'u oku.`,
    `2. ${instruction}`,
    `3. Sonucu update_node ile, read_node'dan aldığın revision değerini base_revision olarak vererek kaydet.`,
    `4. Neleri değiştirdiğini kısaca özetle.`,
  ].join("\n");
}

export function ClaudeMenu({ node, onToast }: { node: { id: string; title: string }; onToast: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    addEventListener("mousedown", onDown);
    return () => removeEventListener("mousedown", onDown);
  }, [open]);

  async function send(instruction: string) {
    setOpen(false);
    const prompt = buildPrompt(node, instruction);
    if (desktop) {
      const { opened } = await desktop.openClaude(prompt);
      onToast(
        opened
          ? "İstem panoya kopyalandı. Claude'da yeni sohbete yapıştırın (⌘V / Ctrl+V)."
          : "İstem panoya kopyalandı. Claude Desktop'ı açıp yapıştırın.",
      );
    } else {
      await copyText(prompt);
      onToast("İstem panoya kopyalandı. Claude Desktop veya Claude Code'a yapıştırın.");
    }
  }

  return (
    <div className="claude-menu" ref={ref}>
      <button className="claude-btn" onClick={() => setOpen((o) => !o)} title="Bu Node'u Claude ile düzenle">
        ✳ Claude'da düzenle ▾
      </button>
      {open && (
        <div className="menu-pop">
          {ACTIONS.map((a) => (
            <button key={a.label} onClick={() => send(a.instruction)}>
              {a.label}
            </button>
          ))}
          <form
            className="custom-prompt"
            onSubmit={(e) => {
              e.preventDefault();
              if (custom.trim()) send(custom.trim());
            }}
          >
            <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Kendi isteğiniz… (Enter)" />
          </form>
          <p className="menu-note">Claude bu Node'u “nularche” MCP bağlantısıyla, kendi Claude hesabınızda düzenler. Bağlantı: Ayarlar.</p>
        </div>
      )}
    </div>
  );
}

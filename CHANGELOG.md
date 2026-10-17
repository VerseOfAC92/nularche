# Değişiklik günlüğü

## 0.2.0: ilk herkese açık sürüm

### Veritabanları, şablonlar, yayınlama
- Veritabanları: tablo, pano, liste, galeri, takvim ve zaman çizelgesi görünümleri; filtre (hepsi/herhangi biri), sıralama, gruplama, sütun genişliği, özellik gizleme, arama, CSV dışa aktarma.
- Özellik tipleri: metin, sayı, seçim, çoklu seçim, durum, tarih (aralık), onay kutusu, URL, e-posta, telefon, ilişki, toplama (rollup), formül, oluşturulma/güncellenme zamanı. Güvenli formül dili (kod çalıştırmaz).
- Satır sayfasında özellik paneli; sayfaya gömülü veritabanı (`/` → Veritabanı, `@[database](…)`); “Veritabanına dönüştür”.
- Şablonlar: 8 hazır şablon (Toplantı, Proje, Okuma listesi, Görev panosu, Alışkanlık, Kişiler/CRM, Günlük, Haftalık plan), kendi şablonlarınız, veritabanı satır şablonları, “Çoğalt”.
- Günlük not: Bugün düğmesi ve ⇧⌘D.
- Dışa aktarma: Markdown (.zip), tek dosya HTML (resimler gömülü), PDF; “Web'de yayınla” işaretli sayfalardan statik web sitesi (GitHub Pages'e hazır).
- MCP: `create_database`, `query_database`, `add_database_row`, `set_row_properties`, `update_database_schema`, `duplicate_node`.

### Düzen ve çöp
- Çöp bölümü: silinen notlar alt sayfalarıyla listelenir; eski yerine geri getirme, kalıcı silme, çöpü boşaltma.
- Alt sayfası olan not artık kendi klasöründe durur (`Proje/Proje.md`); eski düzen ilk açılışta otomatik çevrilir, bağlantılar ve kapaklar güncellenir.
- Ek klasörü `Attachments` (eski `ekler` otomatik taşınır). Taşınan notların göreli kapak yolları da güncellenir.
- Arayüz dili (Türkçe / English), sistem temasını izleyen görünüm, sürüklenebilir Nularche AI penceresi.

- Nularche kimliği: ad, simge, `io.nularche.app`, koyu öncelikli tasarım tokenları; Origin / Arche / Node / Shard / Shadow ortak dili.
- Masaüstü uygulaması: macOS (Apple Silicon ve Intel), Windows, Linux.
- Blok editörü: `/` komutları, tablo, açılır blok, callout, kod renklendirme, resim/dosya ekleri, YouTube, vurgu, metin rengi, blok sürükleme.
- `[[` ile Node bağlantıları, geri bağlantılar; taşıma ve yeniden adlandırmada otomatik bağlantı güncelleme.
- Shadow gelen kutusu, hızlı yakalama (⌘N), bağlantısız Node'lar listesi.
- Kenar çubuğunda sürükle-bırak ile taşıma ve sıralama; favoriler; ikon ve kapak.
- `.nlc` / `.nla` arşivleri, PDF dışa aktarma, `nularche://open` ve `nularche://capture` derin bağlantıları.
- Yapay zekâ seçimi: Claude (Claude Desktop/Code), ChatGPT (ChatGPT masaüstü + Codex), Gemini (Google Antigravity). Kendi üyelikle giriş, tek tıkla bağlantı, bağlantının otomatik algılanması ve “✓ Bağlandı” bildirimi.
- Nularche AI: sağ altta küçültülebilir pencere; hazır eylemler, serbest istek, seçili metin bağlamı, canlı ilerleme, AI cevabı ve geri alma.
- İlk açılış sihirbazı (Hoş geldiniz → Yapay zekâ → Hazır).
- `nularche` MCP sunucusu: 13 araç (Nularche AI istekleri dahil), her AI düzenlemesinden önce geri alma kopyası.
- Güvenlik: okumada dosya değiştirmeme, yerel sunucuda Host/Origin denetimi, Origin dışına yol erişiminin engellenmesi.

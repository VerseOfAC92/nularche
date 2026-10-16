<p align="center">
  <img src="packages/web/public/logo.png" width="128" alt="Nularche" />
</p>

<h1 align="center">Nularche</h1>
<p align="center"><code>/ˈnʌl.ɑːrk/</code> · <em>nul-ark</em></p>
<p align="center">Yerel, Markdown tabanlı kişisel bilgi yönetimi (PKM) ve düşünce mimarisi aracı.<br/>Notlarınız sizde kalır; Claude ile düzenlemek için kendi Claude aboneliğinizi kullanırsınız.</p>

<p align="center">
  <a href="https://github.com/VerseOfAC92/nularche/releases/latest">İndir</a> ·
  <a href="#yapay-zekâ-ile-kullanım-claude-chatgpt-gemini">Yapay zekâ</a> ·
  <a href="#geliştirme">Geliştirme</a> ·
  <a href="#english">English</a>
</p>

---

**Nularche** adı iki kavramdan gelir: **Null** (sıfır noktası, arındırılmış başlangıç) ve **Arche** (ilk prensip, kök). Uygulama bilgiyi yalnızca klasör hiyerarşisinde değil, birbirine bağlı Node'lardan oluşan bir ağ olarak ele alır.

## Özellikler

- **Notion benzeri blok editörü:** `/` komutları, başlıklar, listeler, yapılacaklar, tablolar, açılır bloklar, callout'lar, sözdizimi renklendirmeli kod, resim ve dosya ekleri, YouTube, vurgu ve metin rengi.
- **Sürükle-bırak:** blokları tutamaçla, Node'ları kenar çubuğunda taşıyın ve sıralayın.
- **Bağlantılı Node'lar:** `[[` ile başka bir Node'a bağlanın. Altta geri bağlantılar görünür. Yeniden adlandırma ve taşımada bağlantılar otomatik güncellenir.
- **Shadow gelen kutusu:** hızlı not yakalama (⌘N) ve henüz hiçbir yere bağlanmamış fikirlerin listesi.
- **Sayfa görünümü:** ikon, kapak, favoriler, ⌘K arama, otomatik kaydetme.
- **Düz dosya:** her Node bir `.md` dosyasıdır. Obsidian, VS Code ya da GitHub'da da okunur; Time Machine, iCloud ya da git ile yedeklenir.
- **Arşivler:**
  - `.nlc` (Nularche Container): tek bir Node'u ekleriyle taşır.
  - `.nla` (Nularche Archive): tüm Origin'in yedeği.
- **Diğer:** PDF dışa aktarma, `nularche://` derin bağlantıları, koyu öncelikli tasarım (açık tema da var).
- **Yapay zekâ (Claude, ChatGPT, Gemini):** kendi üyeliğinizle giriş yaptığınız resmi AI uygulaması, MCP üzerinden Node'larınızı okuyup düzenler. İstekler sağ alttaki **Nularche AI** penceresinden verilir; cevaplar ve geri alma da orada görünür.

### Ortak dil

| Terim | Anlamı |
| --- | --- |
| **Origin** | Ana veri kasanız: tüm Node'ların bulunduğu klasör. |
| **Arche** | Origin kökündeki ana alanlar ve projeler. |
| **Node** | Her bir sayfa ya da çalışma yüzeyi. |
| **Shard** | Bir Node'u oluşturan bloklar (metin, kod, tablo, görsel…). |
| **Shadow** | Henüz bir Arche'ye bağlanmamış ham notlar ve bağlantısız fikirler. |
| **Lattice** | Node'lar arası bağlantı grafiği *(yakında)*. |

## Kurulum

[Releases](https://github.com/VerseOfAC92/nularche/releases/latest) sayfasından sisteminize uygun dosyayı indirin. Mac'inizin işlemcisini  → *Bu Mac Hakkında* bölümünden görebilirsiniz ("Apple M…" yazıyorsa Apple Silicon):

| Sistem | Dosya |
| --- | --- |
| macOS (Apple Silicon: M1–M5) | `Nularche-x.y.z-macOS-AppleSilicon.dmg` |
| macOS (Intel) | `Nularche-x.y.z-macOS-Intel.dmg` |
| Windows (x64 / ARM64) | `Nularche-x.y.z-win-x64.exe` / `…-win-arm64.exe` |
| Linux | `.AppImage` veya `.deb` |

> **İmzasız uygulama uyarısı.** Nularche henüz Apple ve Microsoft tarafından imzalanmıyor. Bu yüzden ilk açılışta işletim sistemi uyarı verir.
>
> - **macOS:** DMG'deki Nularche'yi **Uygulamalar** klasörüne sürükleyin, sonra sağ tık → **Aç** deyin. macOS 15 ve sonrasında *Sistem Ayarları → Gizlilik ve Güvenlik → Yine de Aç* adımını kullanın. Alternatif olarak Terminal'de:
>
>   ```bash
>   xattr -dr com.apple.quarantine /Applications/Nularche.app
>   ```
>
> - **Windows:** SmartScreen uyarısında **Ek bilgi → Yine de çalıştır** seçin.
> - **Linux (AppImage):** dosyayı çalıştırılabilir yapın:
>
>   ```bash
>   chmod +x Nularche-*.AppImage
>   ```

İlk açılışta Origin klasörünüz sorulur; varsayılanı `~/Documents/Nularche`.

## Yapay zekâ ile kullanım (Claude, ChatGPT, Gemini)

Nularche'nin içinde yapay zekâ yoktur ve hiçbir AI hesabına, oturumuna ya da API anahtarına dokunmaz. Seçtiğiniz yapay zekânın **resmi uygulamasına kendi üyeliğinizle** giriş yaparsınız; Nularche o uygulamaya yerel bir **MCP bağlantısı** kurar.

| Yapay zekâ | Resmi araç | Bağlantı dosyası |
| --- | --- | --- |
| **Claude** | Claude Desktop, Claude Code | `claude_desktop_config.json`, `~/.claude.json` |
| **ChatGPT** | ChatGPT masaüstü uygulaması, Codex CLI / IDE | `~/.codex/config.toml` (hepsi bu dosyayı paylaşır) |
| **Gemini** | Google Antigravity CLI (`agy`) | `~/.gemini/config/mcp_config.json` |

1. **Ayarlar → Yapay zekâ** bölümünde (ilk açılışta sihirbaz da gelir) Claude, ChatGPT ya da Gemini'yi seçin.
2. **Aç / İndir** ile resmi uygulamayı açın ve kendi hesabınızla giriş yapın.
3. **Bağla**'ya basın. Nularche, aracın yapılandırmasına yalnızca `nularche` girdisini ekler ve önce yedek alır. Claude Desktop açıksa izninizle kapatılıp yeniden açılır.
4. Yapay zekâ aracı Nularche'ye ilk bağlandığında Nularche öne gelir ve **“✓ … bağlandı”** der.

### Nularche AI

Sağ alttaki **Nularche AI** penceresi her zaman elinizin altındadır:

1. Hazır eylemlerden birini seçin (düzelt, özetle, genişlet, yapılacaklar, ilgili Node'lara bağla, çevir) ya da ne istediğinizi yazın. Seçili metin de bağlam olarak gönderilebilir.
2. Nularche bağlı yapay zekâ uygulamasını açar ve kısa istemi panoya koyar. Bir kez yapıştırıp (⌘V) gönderin.
3. Yapay zekâ isteği `nularche` araçlarıyla alır, Node'larınızda çalışır ve cevabını yazar.
4. İlerleme ("çalışıyor… tamamlandı"), cevap, değişen Node'lar ve **Geri al** düğmesi Nularche AI penceresinde görünür.

> Resmi AI uygulamaları dışarıdan otomatik komut almaya izin vermediği için her istekte bir kez yapıştırıp göndermeniz gerekir. Geri kalan her şey Nularche içinde akar.

MCP araçları:

| Araç | Ne yapar |
| --- | --- |
| `list_nodes`, `read_node`, `search_nodes` | Listeleme, okuma (`revision` ile), tam metin arama |
| `create_node`, `update_node`, `append_to_node` | Oluşturma ve düzenleme; `base_revision` ile çakışma koruması, her düzenlemeden önce geri alma kopyası |
| `move_node`, `trash_node` | Taşıma (bağlantılar güncellenir), çöpe taşıma |
| `capture_to_shadow`, `list_shadow`, `get_backlinks` | Shadow ve bağlantılar |
| `get_nularche_request`, `complete_nularche_request` | Nularche AI isteklerini alma ve cevaplama |

## Derin bağlantılar

| Bağlantı | Ne yapar |
| --- | --- |
| `nularche://open?node=<id>` | Node'u açar. `origin=<id>` ile Origin de denetlenir. |
| `nularche://capture?text=<metin>&title=<başlık>` | Shadow'a hızlı not ekler. |

## Dosya biçimi

```
Origin/
  Proje.md                ← Arche
  Proje/
    Plan.md               ← Proje'nin alt Node'u
  Shadow/
    Ham fikir.md          ← gelen kutusu
  ekler/
    sema.png              ← ekler
  .nularche/origin.json   ← Origin kimliği
  .trash/                 ← çöp kutusu
```

Her Node, YAML frontmatter (`id`, `title`, `created`, `updated`, isteğe bağlı `icon`, `cover`, `favorite`…) ve Markdown gövdeden oluşur.

Bağlantılar notun konumuna göre görelidir, ör. `[Plan](Proje/Plan.md)`. Markdown karşılığı olmayan bloklar başka araçlarda da okunabilir biçimde saklanır:

| Blok | Markdown biçimi |
| --- | --- |
| Callout | `> [!NOTE]` |
| Açılır blok | `<details>` |
| Vurgu | `==metin==` |
| YouTube | `@[youtube](url)` |

Nularche, Origin'deki dosyaları yalnızca okuduğunda hiç değiştirmez. Dışarıdan eklenmiş bir `.md` dosyasına kimlik bilgisi, ancak o Node'u uygulamada düzenlediğinizde yazılır.

## Geliştirme

Gereksinim: Node.js 24 (`.nvmrc`).

```bash
npm ci
npm test              # çekirdek + editör testleri
npm run typecheck
npm run mcp:smoke     # MCP sunucusunu gerçek bir MCP istemcisiyle dener
npm run e2e           # masaüstü uygulamasında uçtan uca test (sahte ev klasörüyle)
npm run connect -- codex          # kaynak koddan çalışırken bir AI aracına bağlan
npm run build && npm start        # tarayıcı sürümü: http://localhost:5178
npm run desktop                   # masaüstü uygulamasını kaynaktan çalıştır
npm run dist:mac                  # yerel paket (release/ altında)
```

| Paket | Görevi |
| --- | --- |
| `packages/core` | Origin'in tek sahibi: Node okuma/yazma, bağlantılar, Shadow, arama, arşivler, AI bağlantıları ve Nularche AI kaydı. |
| `packages/server` | Yerel HTTP API (yalnızca `127.0.0.1`), canlı değişiklik bildirimi, ek dosyaları. |
| `packages/web` | React + TipTap arayüzü. |
| `packages/mcp` | stdio MCP sunucusu. |
| `packages/desktop` | Electron kabuğu, derin bağlantılar, arşiv içe/dışa aktarma. |

TypeScript dosyaları Node 24'ün yerleşik tip ayıklamasıyla derlemesiz çalışır. Masaüstü paketi için esbuild, arayüz için Vite kullanılır. Sürümler `v*` etiketiyle GitHub Actions üzerinde macOS (arm64 ve x64), Windows ve Linux için derlenir.

## Yol haritası

- **Lattice:** bağlantı grafiği (görüş alanı sanallaştırmalı).
- **Canvas modu:** OneNote benzeri serbest tuval; her kutu kendi içinde bir blok akışı.
- **Veritabanları:** tablo, pano, takvim ve galeri görünümleri.
- **Şablonlar ve Notion içe aktarma** (Markdown & CSV dışa aktarımı).
- **Yayınlama:** HTML dışa aktarma, statik site.
- `nlc` komut satırı aracı; winget, Homebrew ve Flathub paketleri.

## Lisans

[MIT](LICENSE) © 2026 VerseOfAC92

---

## English

**Nularche** (/ˈnʌl.ɑːrk/) is a local-first, Markdown-based personal knowledge manager inspired by Notion and OneNote.

- **Storage:** your notes (Nodes) live as plain `.md` files in a folder you own (your Origin).
- **Editing:** a block editor with slash commands, tables, toggles, callouts, attachments and drag-and-drop.
- **Connections:** Nodes link to each other with `[[`, and backlinks are shown under each Node. The Shadow inbox collects unfiled ideas.
- **AI:** Nularche contains no AI and never touches your AI credentials. Pick Claude, ChatGPT or Gemini under *Settings → AI* and sign in to that provider's official app with your own subscription.
  - Nularche registers its local **MCP server** with that app: Claude Desktop/Code, the ChatGPT desktop app/Codex, or Google Antigravity.
  - It detects automatically when the app connects.
  - Requests go through the floating **Nularche AI** panel, which shows progress, the AI's reply and an undo button.

Download the latest build for macOS (Apple Silicon / Intel), Windows or Linux from [Releases](https://github.com/VerseOfAC92/nularche/releases/latest). Builds are not code-signed yet, so see the warnings above.

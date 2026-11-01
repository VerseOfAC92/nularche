# Changelog

## 1.5.0

Everyday note-taking features from Apple Notes, distraction-free writing from a focused writer app and the linked-notes
workflow of Obsidian. Notes stay plain Markdown; existing 1.0 notes and notes written in Obsidian open unchanged.

### Focused writing
- Focus mode (⇧⌘F): full screen, hidden sidebar and toolbars, bars that appear on mouse movement, optional typewriter
  scrolling and current-paragraph highlight.
- Writing backgrounds: ten landscapes drawn for Nularche, ten colour palettes, a custom colour or your own picture; in
  focus mode or on every page. Lines keep following the window width as before; a fixed line width is optional.
- Word, character and reading-time counter (also for the selection); font and size per page (⌘T, ⌥⌘= / ⌥⌘−).
- Link dialog (⌘L) with address checking; ⌘/Ctrl-click opens external links.

### Organising
- `#tags` (with `/` sub-tags): sidebar list, tag pages, renaming across all notes, `#tag` search.
- Smart folders (tags, dates, checklists, attachments, Arche, pinned, locked); convert an Arche to a smart folder.
- Pinned notes; All notes, Recent notes, tag, smart folder and Arche lists as list or gallery, sorted by date edited,
  date created or title, grouped by date, with an optional note count.
- Attachments browser with type filters, renaming (links updated) and "show in note".

### Writing and formatting
- Paragraph styles, alignment, indent, right-to-left paragraphs, superscript/subscript, dashed lists, case
  transformations, copy/paste style, paste and match style, collapsible sections.
- Find and replace with Turkish-aware matching.
- Checklists: check/uncheck all, move checked to bottom (once or automatically per note), delete checked.
- Math results for lines ending in `=`, with variables; suggest (Tab) or insert automatically.
- Audio recordings with optional Gemini transcription or summary (Automatic mode); drawings; read aloud.

### Security, import and export
- Password-locked notes (AES-256-GCM, PBKDF2-SHA-256 in the app; the file holds only ciphertext); hidden from search,
  export and AI; "Close all locked notes".
- Import Markdown, text, HTML and RTF files or folders into Shadow, copying referenced images; Copy/Paste as Markdown.
- Export as Word (.docx), RTF and plain text; Print; open a note in its own window; Keep on top; light background for a
  single note.

### App
- New Format and View menus built from the same command list as the shortcuts; the shortcuts list shows every new
  shortcut.
- UI preferences (backgrounds, list views, smart folders, recent notes) are stored with the Origin in
  `.nularche/ui.json`.
- MCP: new `list_tags` tool, `search_nodes` accepts `tag`; locked notes cannot be read or changed by AI tools.
- macOS: microphone usage description for audio notes.

### Linked notes (from Obsidian)
- `[[Wiki links]]`, `[[Note#Heading|alias]]` and `![[embeds]]` (notes, sections and images); links resolve by title,
  file name, path or alias, and a link to a missing note creates it. Backlinks, graph and MCP count them.
- Properties: typed front matter fields (text, list, number, checkbox, date) at the top of a note; `aliases` and front
  matter `tags` work as in Obsidian.
- Command palette (⇧⌘P), quick switcher (⌘O) with create, back/forward (⌥⌘← / ⌥⌘→), random note, unique note,
  previous/next daily note, reading view (⌥⌘E), slides, copy file path, show in Finder/file manager.
- Graph view and local graph; side panel (⇧⌘O) with outline, backlinks, outgoing links, unlinked mentions (one-click
  linking) and file history with preview and restore.
- Canvas pages in the JSON Canvas format (text, note, link and group cards, arrows, colours); cards count as links and
  follow renamed notes.
- LaTeX (KaTeX), Mermaid diagrams, footnotes, `%%comments%%` (left out of exports and publishing), every Obsidian
  callout type with title and fold marker, move line/list item (⌥↑ / ⌥↓), clear formatting (⌘\\).
- Note composer: merge notes (Markdown and wiki links are redirected), extract the selection or a heading section.
- Settings: custom hotkeys for every command, CSS snippets (`.nularche/snippets/`), accent colour, readable line length,
  default view, properties visible/hidden, new note location, startup page, auto-pair, excluded files.
- Tabs (⌥⌘T, ⌥⌘W, Ctrl+Tab; ⌘↩ in the quick switcher) and saved workspaces; choose what opens at startup (last page,
  today's note or home).
- Page preview: ⌘/Ctrl-hover a link (plain hover in reading view, the side panel and backlinks).
- Templates fill in `{{title}}`, `{{date}}`, `{{time}}` and formats like `{{date:DD.MM.YYYY}}`, copy their properties,
  and can be inserted into the current note.
- Auto-pair brackets and quotes (optional).
- MCP: new `get_links` tool; `update_node` accepts `properties`; `read_node` returns properties.

### Calendar sync (Google and Apple)
- Sync a database's dated rows both ways with Google Calendar, Apple Calendar (iCloud) or both: rows with a date
  become events and events become rows; titles and dates follow changes in either direction, and when both sides
  changed the latest edit wins. An event's description becomes the new row's note.
- Connect accounts in Settings → Calendar sync: Google through an OAuth client you create in Google Cloud (sign-in in
  the browser, PKCE), Apple through iCloud CalDAV with an app-specific password. Account details are encrypted with the
  system credential store on this computer; the sync map is kept in `.nularche/calendar.json` in the Origin.
- Choose the calendar and date property from the new **Calendar** button in a database's toolbar. Nularche syncs every
  5 minutes and on **Sync now**.
- Deleting a row deletes its event; an event deleted in the calendar moves its row to the trash. Recurring events and
  locked notes are not synced. If the sync map is lost, events created by Nularche are matched again instead of
  duplicated.

### Fixes
- Removing a cover (also from the new “Remove cover” page menu item), icon, font or light background now clears it
  on screen right away instead of showing the old value until the note is reopened.
- English interface: correct singular/plural counts (“1 note”), translated table and link dialog texts.
- Table header rows stay readable on writing backgrounds.
- Notes written in Obsidian are no longer damaged when edited: `[[links]]`, footnotes, LaTeX backslashes and
  Obsidian callouts used to be escaped on save, and one-word footnote definitions were dropped.
- Renaming tags and attachments, and inserting a YouTube video, work in the desktop app (they relied on a browser
  prompt that Electron doesn't provide).
- Closing a picker no longer blanks the window on newer Chromium versions.

## 1.0.0

First public release.

### Notes and structure
- Notes are plain Markdown files in your **Origin** folder; a page with sub-pages lives in its own folder (`Project/Project.md`) and attachments in `Attachments/`.
- Arche (top-level areas), unlimited nested pages, Shadow inbox, daily note, favourites, icons and covers.
- Trash with restore to the original place (or Shadow) and delete forever.
- `[[` page links, backlinks, and automatic link and cover updates when pages move or are renamed.

### Databases and templates
- Table, Board, List, Gallery, Calendar and Timeline views; filters, sorting, grouping, search, column widths, hidden properties, CSV export.
- 15 property types including status, date ranges, relation, rollup and a safe formula language.
- Inline databases (`/` → Database), row property panel, "Turn into database".
- Eight ready-made templates, user templates, database row templates and page duplication.

### Editor, export and AI
- Pages use the full window width: note lines grow and shrink as you resize the window.
- Block editor with `/` commands, tables, toggles, callouts, code highlighting, images, files and YouTube.
- Export to Markdown (.zip), self-contained HTML and PDF; static website from pages marked "Publish to web"; `.nla` / `.nlc` archives.
- Nularche AI window (draggable): Automatic mode with a free Gemini key and model fallback, or Subscription mode with Claude, ChatGPT or Gemini through their official apps; one-click undo.
- `nularche` MCP server with 19 tools, including databases and `duplicate_node`.

### App
- Easier first launch for the unsigned builds: the macOS DMG window shows the drag-to-Applications arrow and the one-time "Open Anyway" step (with a *READ ME FIRST* file, English and Turkish); the README and release notes put the no-prompt terminal installer first.
- Installer file names have no version number, so `releases/latest/download/…` links always work.
- Installers for macOS (Apple Silicon and Intel), Windows (x64 and x86) and Linux (.deb); each one is installed and smoke-tested on its own OS in CI.
- English and Turkish interface, theme that follows the system, keyboard shortcuts shown for your operating system (`⌘/` or `Ctrl+/`).
- Terminal install scripts (`install.sh`, `install.ps1`) and build-from-source scripts.

## Earlier development notes (Turkish)

### 0.2.0: ilk herkese açık sürüm

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

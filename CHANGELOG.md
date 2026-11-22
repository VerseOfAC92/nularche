# Changelog

## 3.0.0

Stronger protection for your notes, research and writing tools, and knowledge that works for you. Every new part has
its own Nularche name, explained in the Nularche language window and the README glossary.

### Security
- **Crypta:** encrypt every note in an Arche with one password (AES-256-GCM, PBKDF2-SHA256 600,000 rounds); unlocked
  once per session; new notes inside are sealed automatically; only key parameters and a check value are stored.
- **Custos:** open locked notes and Crypta Arches close after inactivity (1–60 min, default 5), on sleep and on screen
  lock.
- **Strata:** content-addressed, incremental snapshots of the whole Origin every 15 minutes (when changed) and on
  demand, AES-256-GCM encrypted with a key kept in the OS keychain (requested only when first needed). Per-file and full
  restore, with a snapshot taken before every restore; thinned automatically, named snapshots kept. Never synced.
  Locking a note purges its unencrypted versions from every snapshot.
- The local server requires a per-launch secret sent only by Nularche's own windows; a strict Content Security Policy,
  `nosniff` and `no-referrer`; allow-list sanitising of raw HTML and link schemes in the app (DOMPurify) and in
  exported and published pages.

### Research and writing
- **Fontes:** BibTeX and CSL-JSON libraries, Pandoc-style `[@key, p. 12; -@other]` citations with `[@` suggestions,
  styled chips in the editor and in embeds, and formatted citations plus a bibliography on HTML, Word, RTF, site and
  Codex export (`{{bibliography}}` places it). Styles: APA 7, Chicago author-date, MLA 9, IEEE.
- **Lectio:** PDF reader (pdf.js) with lazy page rendering, five highlight colours, comments, copy-as-quote and export
  to a note whose quotes link back to the page; annotations in `.nularche/annotations/` sync with Drive and follow a
  renamed PDF.
- **Tessera:** `^id` block ids, `[[Note#^id]]` links that scroll to the block (headings too), `![[Note#^id]]` embeds,
  copy block link/embed from the context menu and palette; exports and the site expand note, heading and block embeds.
- **Claritas:** readability score next to the word count (Ateşman for Turkish, Flesch for English).

### Using what you know
- **Speculum:** live ```query blocks with tag, Arche, text, property and relative-date conditions, sorting, limits and
  list / table / count / task views that refresh as notes change.
- **Anamnesis:** flashcards from `Q :: A` and two-way `Term ::: Definition` lines, FSRS-5 scheduling, decks by Arche,
  daily new-card limit, progress, and cards from encrypted notes while they are unlocked; review state in
  `.nularche/anamnesis.json` (synced, no card text stored).
- **Vigil:** daily, weekly or monthly automations that send a task to Nularche AI or write a digest note; results in an
  Atrium card, runs on the Calendar, one catch-up run after the app was closed, no double runs across computers.

### Fixes
- A new build no longer waits at launch for a macOS keychain prompt: the session secret is sent as a header instead of
  a cookie, and the snapshot key is read lazily.
- Linked notes reopen without asking for the password again while their key is still open this session.

## 2.5.0

Tabula, a whiteboard that sits over your writing background; a sidebar that hides completely; a richer Atrium; and
Nularche AI requests that can no longer hang, can be cancelled, and never edit notes unless you ask. Plus
**Nularche Font**, Nularche's own handwriting typeface, Archipelagos that group Arches, and smart folders in the Atrium.
A Calendar page shows Google and Apple calendars with full event details without creating notes, notes can sync through
Google Drive (optionally end-to-end encrypted), titles take formatting, and the interface got a careful visual pass.

### Calendar
- New Calendar page (sidebar, ⇧⌘K): month, week (hour grid, now line, all-day row) and agenda views of the local
  Nularche calendar, the Google and Apple (iCloud) calendars turned on in Settings, and every database with a date
  property; each source can be shown or hidden.
- Calendars turned on in Settings → Calendar are shown, not imported: no Arche, database or notes are created. Events
  are cached in `.nularche/calendar-events.json` (one year back, two years ahead, refreshed every 5 minutes) and
  changes made on the Calendar page are written straight to the calendar. Database ↔ calendar sync stays available
  from the database's Calendar button.
- Event details: time, alerts, location, meeting link (Teams, Zoom, Meet, Webex) with an Open button, organiser,
  attendees with their replies, and notes with clickable links, read from Google and iCloud. New events take location,
  link, alert and notes; editing writes only the changed fields, so attendees and other details are kept. Recurring
  events are view-only.
- Calendars linked by an earlier 2.5 build inside an automatic "Calendars" Arche become shown calendars; that Arche
  moves to Trash when it only held them.
- Fixed: Settings → Calendar showed an error when a synced database had been deleted; such links are now removed.

### Storage and Google Drive
- No system dialog before the window opens: the Origin is prepared in `Documents/Nularche` and the first-run wizard
  has a Storage step (this computer or Google Drive), also in Settings → Notes and Origin.
- Google Drive connects with one click using the built-in Nularche client and the `drive.file` scope (only the Nularche
  folder it creates). The Origin stays the working copy and syncs both ways (on change, every minute and before quit);
  another computer that connects gets everything. Google Calendar connects with one click too.
- Only user content syncs: notes, attachments, `ui.json`, Marginalia, Epochs and snippets. Automatic history, Nularche AI
  records and the calendar cache stay local; copies of them already in Drive are deleted for good. Epochs move to
  `.nularche/epochs` (migrated on start). `ui.json` is merged key by key between computers.
- Locking a note deletes its unencrypted history, Epochs and AI undo copies; in Drive the old file is deleted for good
  (with its revision history) and the encrypted note is uploaded as a new file. Plaintext left in the history of
  already locked notes is removed on start.
- Optional end-to-end encryption (AES-256-GCM, PBKDF2-SHA256 600k; file names are HMACs). Other computers ask for the
  passphrase once.
- Two-way safety: a suddenly empty local folder or a mass deletion pauses sync instead of deleting from Drive, with
  "Restore from Drive" or "Yes, delete from Drive too"; "Download again from Drive" restores at any time. Edits in two
  places keep a "conflict" copy. Sync stops if the Drive folder disappears.
- `PRIVACY.md` describes what Nularche does with Google data.

### Writing and editing
- Titles take bold, italic, underline, strike, highlight and colour (selection bar and right-click). The plain title
  still names the file; the formatting is stored in the `titleRich` field.
- Right-click shows Nularche's options (formatting, links, Marginalia; Tabula shape options; sidebar open, add and
  move) together with the system's (spelling, Look Up, cut, copy, paste, Share, Services).
- Tab indents in notes and nests list items; Shift-Tab outdents; tables keep Tab for moving between cells. Tab no
  longer moves focus to Nularche AI.
- Default text size in Settings → Writing.
- Table column widths set by dragging are saved in an invisible comment before the table
  (`<!-- nularche-table widths=… -->`) and restored when the note opens.
- The writing hint only shows in an empty note (not in table cells, new lines or under database views); right-clicking
  a selection no longer opens the format bar as well.

### Look
- One set of line icons (Tabler Icons, MIT) replaces emoji and symbols in menus, toolbars, panels, dialogs, callouts and
  empty states; icons given to notes are unchanged.
- Menus and dialogs over a background use solid frosted glass; controls, spacing, alignment and focus states were
  tidied across the app. Tabula's shape library has a Diagram shapes / Pictures switch with one scrolling category row,
  and its format panel closes with one click on the board.
- Fixed: the Aura volume slider overflowed its menu; board JSON appeared in search snippets.

### Nularche Font
- Nularche's own handwriting typeface, bundled with the app (WOFF2, works offline) and listed first among the
  included fonts: choose it as the writing font, as a note's font, or for Tabula text, sticky notes and shapes.
  Every glyph is drawn after the author's own handwriting sample; it covers the Turkish alphabet (with â î û), digits and
  – — … “ ” ‘ ’ « » { } < > ^ ~ | ° $ € ₺ • · ×.

### Tabula (whiteboard)
- New page type (`layout: whiteboard`, JSON block in the note; images are Origin files): pen, pencil, marker,
  highlighter (pressure-sensitive with a stylus) and object eraser; sticky notes, text boxes, tables, images (insert,
  paste or drag in) and cards that link to notes.
- Over 130 diagram shapes in eight groups (basic, arrows, flowchart, process/BPMN, UML and software, network and IT,
  callouts, symbols) and about 4,800 icons from Tabler Icons (MIT) in thirteen groups, outline or filled, with search in
  English and common Turkish words.
- Lines, arrows and elbow or curved connectors with six end styles and labels; drag from the dots around a shape to
  connect it, and connections follow when shapes move.
- Move, resize, rotate, alignment guides, snap to grid, group, lock, layer order, align and distribute, flip, duplicate,
  copy and paste, undo and redo; fill, stroke, dash, opacity, shadow and every font available for notes.
- Transparent board over the writing background (or a solid colour), dot/grid/line backgrounds, PNG and SVG export.
  Free text and ink get a soft outline so they stay readable over busy backgrounds. Works at every window size: the
  toolbar wraps and the format panel can be collapsed.
- Available from New Writing Project, the Atrium, the `/` menu, File → New Writing Project and the vocabulary.

### Window and Atrium
- The sidebar hides completely (button next to the window buttons, or ⌥⌘B); hovering the button shows it as a panel
  tinted by the background, which hides again when the pointer leaves. Menus opened from it stay fully visible.
- Archipelago: group Arches in the sidebar (⁂ next to *Arches*). Add Arches from their ⁂ menu or by dragging,
  reorder inside a group, collapse, rename or remove a group (its Arches stay); **+** creates an Arche in the group.
  Groups are stored in the Origin's settings and never move files. A Node dragged onto a group becomes an Arche in it.
- Atrium: a Smart folders card with note counts and a New smart folder button; Tabula boards, open tasks with progress, the Shadow inbox, an Origin summary with your most used tags, and a
  note to rediscover each day.
- With a background, the Atrium cards and the cards and lists on other pages are frosted glass too.
- Fixed: the frosted-glass blur never rendered in the desktop app (the CSS build kept only `-webkit-backdrop-filter`).
- Fixed: settings changed just before quitting or reloading (such as a renamed group or a collapsed section) could be
  lost; pending settings are now written when the window closes.
- Fixed: the `/` menu covered the line being typed near the bottom of the window; it now opens above the line.

### Nularche AI
- Every Gemini call has a time limit and each request an overall deadline, so a request that gets no answer fails
  with a message instead of waiting forever and blocking the ones behind it.
- Long notes (over 20,000 characters) are shown to Gemini as numbered blocks and reorganised with a new
  `rearrange_node` tool that moves blocks unchanged instead of rewriting the whole note.
- Requests can be cancelled while waiting or working; a request left “working” after a restart can be cleared.
- Notes are only changed when the request asks for a change: questions, summaries and analysis are answered without
  editing, and the *Reply only* switch removes every editing tool. MCP clients get the same rule.
- The full text of each request is shown, and the input box grows as you type.

### Settings
- About lists Tabula, the Atrium and the new look, and credits the open-source components.

## 2.0.0

A writing studio for long-form work. Notes stay plain Markdown; the new page types keep their structure in a JSON block
inside the note (like canvas pages), and 1.x notes open unchanged. Every part has a Nularche name (Atrium, Codex, Axis,
Mosaic, Lore, Marginalia, Epoch, Diptych, Clepsydra, Aura, Sigil, Rite, Conduit, Ark), explained on a new *Vocabulary*
step of the first-run wizard, on the empty-Origin welcome screen and in the *Nularche Vocabulary* window.

### Writing projects
- Codex (manuscript) pages: notes ordered in sections, total word count and goal, compiled reading view, export of the compiled
  text (DOCX, PDF, RTF, TXT, HTML) with options for section names, note titles and separators.
- Axis (outline) pages: hierarchical rows with classic numbering, keyboard editing, folding, colour labels, done marks, row
  notes, linked notes; a Codex can follow an Axis and show unwritten rows as planned pages with their beats.
- Mosaic (corkboard) pages: grouped index cards with drag and drop, colour labels, search, sizes, multi-select, link or turn into a
  note.
- Lore (story bible) pages: entries and categories from sub-pages, quick facts from properties, field templates per category, mention
  detection in all notes (dotted underline, ⌘-click to open) and "Mentioned in" counts.
- File references in these pages count as links and follow moved or renamed notes.

### Reviewing
- Marginalia: comments anchored to passages, stored in `.nularche/comments/` without touching the Markdown file; replies, resolve,
  edit, delete, detached-comment detection; comments tab in the side panel.
- Epochs: named checkpoints (kept until deleted, 30 per note) and line-by-line comparison of any version with the current text.
- Diptych: split view with swap, focus and close.

### Writing experience
- Atrium: home page with daily goal, streak, seven-day chart, writing projects, recent and pinned notes and quick
  capture.
- Word goals per page, Clepsydra writing timer, Aura typewriter sounds with margin bell and four ambiences (all synthesised locally).
- Six bundled open-licence fonts and a default writing font; high-contrast theme.

### Finding things
- Sidebar entries for Atrium, New Writing Project and the Nularche vocabulary; a studio toolbar on every note
  (Marginalia, Epoch, Diptych, Clepsydra, Aura); Marginalia in the selection bubble; a Writing studio group in the `/`
  menu; Clepsydra and Aura in focus mode. Tooltips explain each Nularche name.
- Collapsible sidebar (‹‹ next to the logo or ⌥⌘B): a narrow strip with the logo, every menu item and each Arche's
  icon (◈ when it has none), with names on hover; the choice is remembered.
- Settings → About now explains what Nularche is and does, lists its main features and gives the support address
  (verseofac@gmail.com).
- Backgrounds fill the whole window: the sidebar, side panel and title bar turn into frosted glass over the chosen
  landscape, palette, colour or image, with readable text on dark and light backgrounds. Without a background they follow the app theme instead of the system theme. macOS gets a title bar drawn by Nularche; on Windows and Linux
  the native title bar and menus switch to dark or light to match.
- Settings reorganised into searchable categories (Appearance, Writing, Aura and Focus, Automation, Notes and Origin,
  Shortcuts, Publishing, Calendar, AI, About) with grouped cards.

### Automation and safety
- Sigils (text shortcuts) with template variables; Rites (custom commands) in the command palette with hotkeys; import/export as JSON.
- Conduit (smart capture) with `::mosaic`, `::axis`, `::lore`, `::task` (aliases `::card`, `::outline`, `::wiki`) and `@handle` rules (`.nularche/capture.json`), and
  "Send to…" for Shadow notes.
- Ark: automatic `.nla` backups to a chosen folder (desktop), with interval and retention.
- MCP: `get_manuscript`, `add_to_writing_project`, `list_wiki_entries`, `get_wiki_mentions`, `list_comments`,
  `add_comment`, `create_checkpoint`; `capture_to_shadow` follows smart-capture rules.

## 1.5.0

Everyday note-taking features from Apple Notes, distraction-free writing from a focused writer app and the linked-notes
workflow of linked notes. Notes stay plain Markdown; existing 1.0 notes and notes from other Markdown apps open unchanged.

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

### Linked notes
- `[[Wiki links]]`, `[[Note#Heading|alias]]` and `![[embeds]]` (notes, sections and images); links resolve by title,
  file name, path or alias, and a link to a missing note creates it. Backlinks, graph and MCP count them.
- Properties: typed front matter fields (text, list, number, checkbox, date) at the top of a note; `aliases` and front
  matter `tags` are understood.
- Command palette (⇧⌘P), quick switcher (⌘O) with create, back/forward (⌥⌘← / ⌥⌘→), random note, unique note,
  previous/next daily note, reading view (⌥⌘E), slides, copy file path, show in Finder/file manager.
- Graph view and local graph; side panel (⇧⌘O) with outline, backlinks, outgoing links, unlinked mentions (one-click
  linking) and file history with preview and restore.
- Canvas pages in the JSON Canvas format (text, note, link and group cards, arrows, colours); cards count as links and
  follow renamed notes.
- LaTeX (KaTeX), Mermaid diagrams, footnotes, `%%comments%%` (left out of exports and publishing), every common
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
- Notes written in other Markdown apps are no longer damaged when edited: `[[links]]`, footnotes, LaTeX backslashes and
  callouts used to be escaped on save, and one-word footnote definitions were dropped.
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

## Earlier development notes

### 0.2.0: first public release

### Databases, templates, publishing
- Databases: table, board, list, gallery, calendar and timeline views; filters (all/any), sorting, grouping, column width, hidden properties, search, CSV export.
- Property types: text, number, select, multi-select, status, date (range), checkbox, URL, email, phone, relation, rollup, formula, created/updated time. A safe formula language (it never runs code).
- A property panel on row pages; databases embedded in a page (`/` → Database, `@[database](…)`); "Turn into database".
- Templates: 8 built-in templates (Meeting, Project, Reading list, Task board, Habit, Contacts/CRM, Journal, Weekly plan), your own templates, database row templates, "Duplicate".
- Daily note: the Today button and ⇧⌘D.
- Export: Markdown (.zip), single-file HTML (images embedded), PDF; a static website from pages marked "Publish to web" (ready for GitHub Pages).
- MCP: `create_database`, `query_database`, `add_database_row`, `set_row_properties`, `update_database_schema`, `duplicate_node`.

### Layout and trash
- Trash: deleted notes are listed with their subpages; restore to the original place, delete permanently, empty the trash.
- A note with subpages now lives in its own folder (`Project/Project.md`); the old layout is converted on first launch, and links and covers are updated.
- The attachments folder is `Attachments` (the old `ekler` folder is moved automatically). Relative cover paths of moved notes are updated too.
- Interface language (Turkish / English), appearance that follows the system theme, a draggable Nularche AI window.

- Nularche identity: name, icon, `io.nularche.app`, dark-first design tokens; the shared Origin / Arche / Node / Shard / Shadow language.
- Desktop app: macOS (Apple Silicon and Intel), Windows, Linux.
- Block editor: `/` commands, tables, toggles, callouts, code highlighting, image and file attachments, YouTube, highlight, text colour, block dragging.
- Node links with `[[`, backlinks; links are updated automatically when notes are moved or renamed.
- The Shadow inbox, quick capture (⌘N), a list of unlinked Nodes.
- Drag and drop in the sidebar to move and reorder; favourites; icons and covers.
- `.nlc` / `.nla` archives, PDF export, `nularche://open` and `nularche://capture` deep links.
- Choice of AI: Claude (Claude Desktop/Code), ChatGPT (ChatGPT desktop + Codex), Gemini (Google Antigravity). Sign in with your own subscription, connect in one click, the connection is detected automatically with a "✓ Connected" notice.
- Nularche AI: a minimisable window at the bottom right; ready-made actions, free-form requests, the selected text as context, live progress, the AI's answer and undo.
- First-run wizard (Welcome → AI → Ready).
- The `nularche` MCP server: 13 tools (including Nularche AI requests), an undo copy before every AI edit.
- Security: reading never changes files, Host/Origin checks on the local server, no path access outside the Origin.

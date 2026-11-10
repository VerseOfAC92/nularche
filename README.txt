NULARCHE 2.0.0
Local-first, AI-native notes, databases and templates in plain Markdown.
https://github.com/VerseOfAC92/nularche   (full documentation with screenshots: README.md)

------------------------------------------------------------------------------
1. DOWNLOAD AND INSTALL
------------------------------------------------------------------------------
Download the installer for your system from
https://github.com/VerseOfAC92/nularche/releases/latest

  macOS, Apple Silicon (M1-M5) ... Nularche-macOS-AppleSilicon.dmg
  macOS, Intel ................... Nularche-macOS-Intel.dmg
  Windows 10/11, 64-bit .......... Nularche-Windows-x64-Setup.exe
  Windows 10/11, 32-bit .......... Nularche-Windows-x86-Setup.exe
  Linux, Debian/Ubuntu (amd64) ... Nularche-Linux-amd64.deb

macOS:   open the DMG and drag Nularche to Applications. The app is not yet notarised by Apple,
         so macOS 15+ shows '"Nularche.app" Not Opened'. Click Done (not Move to Bin), then
         RIGHT AWAY open System Settings > Privacy & Security > Security section and click
         "Open Anyway" (it only appears briefly after the warning). Or run once in Terminal:
         xattr -dr com.apple.quarantine /Applications/Nularche.app
         The terminal installer (section 2) avoids this step.
Windows: run the Setup file. If SmartScreen appears, click "More info" > "Run anyway".
         Nularche installs for your user only (no administrator rights needed).
Linux:   sudo apt install ./Nularche-Linux-amd64.deb   then run: nularche

------------------------------------------------------------------------------
2. INSTALL FROM THE TERMINAL (latest release)
------------------------------------------------------------------------------
macOS (Terminal) and Linux Debian/Ubuntu (Terminal):
  curl -fsSL https://raw.githubusercontent.com/VerseOfAC92/nularche/main/scripts/install/install.sh | bash

Windows (PowerShell):
  irm https://raw.githubusercontent.com/VerseOfAC92/nularche/main/scripts/install/install.ps1 | iex

The scripts pick the right build for your machine and install only Nularche.

------------------------------------------------------------------------------
3. INSTALL WITH GIT (build from source)
------------------------------------------------------------------------------
Requires git and Node.js 24 or newer (https://nodejs.org).

macOS / Linux (Terminal):
  git clone https://github.com/VerseOfAC92/nularche.git
  cd nularche
  ./scripts/install/build-from-source.sh

Windows (PowerShell):
  git clone https://github.com/VerseOfAC92/nularche.git
  cd nularche
  .\scripts\install\build-from-source.ps1

------------------------------------------------------------------------------
4. KEYBOARD SHORTCUTS            macOS            Windows / Linux
------------------------------------------------------------------------------
  Search                         Cmd+K            Ctrl+K
  Quick note (Shadow)            Cmd+N            Ctrl+N
  Today's daily note             Shift+Cmd+D      Ctrl+Shift+D
  Save now                       Cmd+S            Ctrl+S
  Settings                       Cmd+,            Ctrl+,
  All shortcuts                  Cmd+/            Ctrl+/
  Command menu / page link       /  and  [[       /  and  [[
  Focus mode                     Shift+Cmd+F      Ctrl+Shift+F
  Find / Find and replace        Cmd+F / Opt+Cmd+F  Ctrl+F / Ctrl+Alt+F
  Link / Font and size           Cmd+L / Cmd+T    Ctrl+L / Ctrl+T
  Print                          Cmd+P            Ctrl+P
  Command palette                Shift+Cmd+P      Ctrl+Shift+P
  Quick switcher                 Cmd+O            Ctrl+O
  Side panel                     Shift+Cmd+O      Ctrl+Shift+O
  Add property / Reading view    Cmd+; / Opt+Cmd+E  Ctrl+; / Ctrl+Alt+E
  Insert a math result           Tab              Tab

------------------------------------------------------------------------------
NEW IN 2.0.0
------------------------------------------------------------------------------
  Writing studio with its own vocabulary: Codex (manuscript: notes in order,
  compiled reading view, word goal, export to Word/PDF/RTF/text/HTML), Axis
  (outline a Codex can follow), Mosaic (corkboard of cards), Lore (story bible
  with quick facts and mention detection), Marginalia (comments, Opt+Cmd+M),
  Epoch (named versions with comparison, Opt+Cmd+S), Diptych (split view,
  Opt+Cmd+\), Atrium (home page with daily goal and streak), Clepsydra (timer,
  Opt+Cmd+P), Aura (typewriter sounds and ambience), six open-licence fonts,
  high contrast, Sigils (text shortcuts), Rites (custom commands), Conduit
  (::mosaic / ::axis / ::lore / ::task @handle) and Ark (automatic backups to a
  folder of your choice). Seven new MCP tools. The first-run wizard explains
  every name.

  The sidebar collapses to an icon strip (Opt+Cmd+B / Ctrl+Alt+B). Settings >
  About describes Nularche and gives the support address. A chosen background
  now fills the whole window: the sidebar, side panel and title bar become
  frosted glass over it; without one they follow the app theme.

------------------------------------------------------------------------------
NEW IN 1.5.0
------------------------------------------------------------------------------
  Focus mode with 10 landscapes and 10 colour palettes, word counter, page fonts,
  #tags, smart folders, pinned notes, list/gallery views sorted and grouped by date,
  attachments browser, find and replace, alignment, indent, right-to-left text,
  superscript/subscript, dashed lists, collapsible sections, checklist tools, math
  results, audio recordings (optional transcription), drawings, read aloud, password-
  locked notes, import (Markdown, text, HTML, RTF), Word/RTF/text export, print,
  separate note windows and Keep on Top.

  Linked notes: [[wiki links]] and embeds, properties, command palette (Shift+Cmd/Ctrl+P),
  quick switcher (Cmd/Ctrl+O), graph view, side panel with outline, backlinks, unlinked
  mentions and file history, canvas pages (JSON Canvas), LaTeX, Mermaid, footnotes,
  %%comments%%, note composer (merge/extract), reading view, slides, tabs and
  workspaces, page preview, template variables, custom hotkeys, CSS snippets and
  accent colour.

------------------------------------------------------------------------------
5. DEVELOPMENT
------------------------------------------------------------------------------
  npm ci              install dependencies
  npm test            run the tests
  npm run desktop     run the desktop app from source
  npm run dist:mac    build macOS DMGs (Apple Silicon and Intel)
  npm run dist:win    build Windows installers (x64 and x86)
  npm run dist:linux  build the Linux .deb

Licence: MIT (c) 2026 VerseOfAC92

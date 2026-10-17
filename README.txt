NULARCHE 1.0.0
Local-first, AI-native notes, databases and templates in plain Markdown.
https://github.com/VerseOfAC92/nularche   (full documentation with screenshots: README.md)

------------------------------------------------------------------------------
1. DOWNLOAD AND INSTALL
------------------------------------------------------------------------------
Download the installer for your system from
https://github.com/VerseOfAC92/nularche/releases/latest

  macOS, Apple Silicon (M1-M5) ... Nularche-1.0.0-macOS-AppleSilicon.dmg
  macOS, Intel ................... Nularche-1.0.0-macOS-Intel.dmg
  Windows 10/11, 64-bit .......... Nularche-1.0.0-Windows-x64-Setup.exe
  Windows 10/11, 32-bit .......... Nularche-1.0.0-Windows-x86-Setup.exe
  Linux, Debian/Ubuntu (amd64) ... Nularche-1.0.0-Linux-amd64.deb

macOS:   open the DMG and drag Nularche to Applications. The app is not yet notarised by Apple,
         so macOS 15+ shows '"Nularche.app" Not Opened'. Click Done (not Move to Bin), then
         System Settings > Privacy & Security > "Open Anyway" (once). Or run once in Terminal:
         xattr -dr com.apple.quarantine /Applications/Nularche.app
         The terminal installer (section 2) avoids this step.
Windows: run the Setup file. If SmartScreen appears, click "More info" > "Run anyway".
         Nularche installs for your user only (no administrator rights needed).
Linux:   sudo apt install ./Nularche-1.0.0-Linux-amd64.deb   then run: nularche

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

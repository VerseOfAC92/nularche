#!/usr/bin/env bash
# Nularche: clone, build and install from source (macOS or Debian/Ubuntu Linux).
#   git clone https://github.com/VerseOfAC92/nularche.git && cd nularche && ./scripts/install/build-from-source.sh
# Needs git and Node.js 24+ (with npm). It does not install them for you.
set -euo pipefail
say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }

cd "$(dirname "$0")/../.."
command -v node >/dev/null || fail "Node.js 24 or newer is required: https://nodejs.org (or use nvm: nvm install)."
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 24 ] || fail "Node.js 24 or newer is required (found $(node -v))."

say "Installing dependencies (npm ci)"
npm ci
say "Running tests"
npm test
say "Building the desktop app"
npm run build:desktop

case "$(uname -s)" in
  Darwin)
    if [ "$(uname -m)" = "arm64" ]; then ARCH=arm64; LABEL=AppleSilicon; else ARCH=x64; LABEL=Intel; fi
    node scripts/dist-mac.ts --only "$ARCH"
    DMG="$(ls release/Nularche-*-macOS-$LABEL.dmg | head -n1)"
    say "Installing $DMG to /Applications"
    MNT="$(hdiutil attach -nobrowse -readonly "$DMG" | tail -n1 | awk -F'\t' '{print $NF}')"
    rm -rf /Applications/Nularche.app 2>/dev/null || true
    ditto "$MNT/Nularche.app" /Applications/Nularche.app
    hdiutil detach "$MNT" -quiet || true
    open /Applications/Nularche.app
    ;;
  Linux)
    npx electron-builder --linux deb --x64 --publish never
    DEB="$(ls release/Nularche-*-Linux-amd64.deb | head -n1)"
    say "Installing $DEB (sudo apt install)"
    sudo apt-get install -y "./$DEB"
    say "Done. Run: nularche"
    ;;
  *) fail "Unsupported system. On Windows use build-from-source.ps1." ;;
esac

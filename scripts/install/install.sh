#!/usr/bin/env bash
# Nularche: install the latest release from GitHub (macOS or Debian/Ubuntu Linux).
#   curl -fsSL https://raw.githubusercontent.com/VerseOfAC92/nularche/main/scripts/install/install.sh | bash
# macOS: picks the Apple Silicon or Intel DMG for this Mac and copies Nularche.app to /Applications.
# Linux: downloads the .deb and installs it with apt (asks for your password via sudo).
# It installs nothing else.
set -euo pipefail

REPO="VerseOfAC92/nularche"
API="https://api.github.com/repos/$REPO/releases/latest"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }
command -v curl >/dev/null || fail "curl is required."

asset_url() { # $1 = file name suffix
  curl -fsSL "$API" | grep -o "\"browser_download_url\": *\"[^\"]*$1\"" | head -n1 | sed 's/.*"\(https[^"]*\)"/\1/'
}

case "$(uname -s)" in
  Darwin)
    if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = "1" ]; then SUFFIX="macOS-AppleSilicon.dmg"; else SUFFIX="macOS-Intel.dmg"; fi
    URL="$(asset_url "$SUFFIX")"; [ -n "$URL" ] || fail "Could not find $SUFFIX in the latest release."
    say "Downloading $(basename "$URL")"
    curl -fL --progress-bar "$URL" -o "$TMP/Nularche.dmg"
    say "Installing to /Applications"
    MNT="$(hdiutil attach -nobrowse -readonly "$TMP/Nularche.dmg" | tail -n1 | awk -F'\t' '{print $NF}')"
    if [ -d /Applications/Nularche.app ]; then rm -rf /Applications/Nularche.app 2>/dev/null || sudo rm -rf /Applications/Nularche.app; fi
    ditto "$MNT/Nularche.app" /Applications/Nularche.app 2>/dev/null || sudo ditto "$MNT/Nularche.app" /Applications/Nularche.app
    hdiutil detach "$MNT" -quiet || true
    # The app is not notarised by Apple; downloads made with curl are not quarantined, so it opens normally.
    xattr -dr com.apple.quarantine /Applications/Nularche.app 2>/dev/null || true
    say "Done. Opening Nularche…"
    open /Applications/Nularche.app
    ;;
  Linux)
    command -v apt-get >/dev/null || fail "This installer supports Debian/Ubuntu (apt). Download the .deb manually or build from source."
    [ "$(uname -m)" = "x86_64" ] || fail "Only x86_64 (amd64) Linux builds are published."
    URL="$(asset_url "Linux-amd64.deb")"; [ -n "$URL" ] || fail "Could not find the .deb in the latest release."
    say "Downloading $(basename "$URL")"
    curl -fL --progress-bar "$URL" -o "$TMP/nularche.deb"
    say "Installing (sudo apt install)"
    sudo apt-get install -y "$TMP/nularche.deb"
    say "Done. Start Nularche from your applications menu or run: nularche"
    ;;
  *) fail "Unsupported system. On Windows use install.ps1 (see README)." ;;
esac

#!/bin/bash
# Gets Central Production ready to run or pack: the website's /production/ page and the shared DAW into src/ (the same
# relative layout as the website: src/production, src/daw, src/fonts, src/brand), the shared files the apps use
# (license.js, pedals.js, libraries.js, community.js), and the main-process code it shares with Central Usage (the
# updater, the sound libraries, the Studio's sounds and low-delay player).
#   bash central-production/prepare.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/.." && pwd)"; PUB="$ROOT/server/public"
rm -rf "$HERE/src"; mkdir -p "$HERE/src"
cp -r "$PUB/production" "$PUB/daw" "$PUB/fonts" "$PUB/brand" "$HERE/src/"
cp "$PUB/favicon.svg" "$HERE/src/"
cp "$ROOT/js/license.js" "$ROOT/js/pedals.js" "$ROOT/js/libraries.js" "$ROOT/js/community.js" "$HERE/src/production/shared/"
cp "$ROOT/central-usage/updater.js" "$ROOT/central-usage/libraries.js" "$ROOT/central-usage/studio.js" "$HERE/"
V="$(sed -nE 's/^  "version": "([^"]+)".*/\1/p' "$HERE/package.json")"
sed -i -E "s/window.CP_VERSION = \"[0-9.]+\"/window.CP_VERSION = \"$V\"/" "$HERE/src/production/index.html"
echo "Central Production ready to pack ($V)"

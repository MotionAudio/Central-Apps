#!/bin/bash
# Gets Central Services ready to pack: the website's /services/ page into src/ (window.CS_APP, and the website's
# address - the SERVER set in js/license.js - as window.CS_SERVER), and the shared updater.
#   bash central-services/prepare.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/.." && pwd)"
rm -rf "$HERE/src"; mkdir -p "$HERE/src"
cp -r "$ROOT"/server/public/services/. "$HERE/src/"
cp "$ROOT/central-usage/updater.js" "$HERE/updater.js"
node "$ROOT/tools/services-app-page.js" "$HERE/src/index.html" "$ROOT/js/license.js"
echo "Central Services ready to pack ($(sed -nE 's/^  "version": "([^"]+)".*/\1/p' "$HERE/package.json"))"

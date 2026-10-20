#!/bin/bash
# Gets the phone / tablet projects of Central Services ready to build (ios: iPhone + iPad, android): the website's
# /services/ page into www/, marked as the app (window.CS_APP, and the website's address from js/license.js), then
# Capacitor's sync (copies www into the Xcode / Android project; pod install on a Mac).
#   bash central-services-mobile/prepare.sh ios|android
set -euo pipefail
PLATFORM="${1:-ios}"
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/.." && pwd)"
rm -rf "$HERE/www"; mkdir -p "$HERE/www"
cp -r "$ROOT"/server/public/services/. "$HERE/www/"
node "$ROOT/tools/services-app-page.js" "$HERE/www/index.html" "$ROOT/js/license.js"
node "$ROOT/tools/add-android-update.js" "$HERE/www" "Central Services" "$ROOT/central-services/package.json" '^central-services-(\d+\.\d+\.\d+)-android\.apk$'
cd "$HERE"
npm install --no-audit --no-fund
npx cap sync "$PLATFORM"

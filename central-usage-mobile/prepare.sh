#!/bin/bash
# Gets the phone and tablet apps of Central Usage ready to build - iPhone / iPad (ios) or Android (android):
# the start screen (www/: it finds the main admin's computer on the Wi-Fi and opens Central Usage from it), then
# Capacitor's sync (copies www into the Xcode / Android Studio project; pod install on a Mac).
#   bash central-usage-mobile/prepare.sh ios|android
set -euo pipefail
cd "$(dirname "$0")"
PLATFORM="${1:-ios}"
npm install --no-audit --no-fund
npx cap sync "$PLATFORM"

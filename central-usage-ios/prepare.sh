#!/bin/bash
# Gets the iPhone / iPad project ready to build: the start screen (www/), the Central Usage web app when it is
# bundled (central-usage/app/web -> www/web, for the day the app should work without the Central Control's copy),
# then Capacitor's sync (copies www into the Xcode project; pod install on a Mac).
set -euo pipefail
cd "$(dirname "$0")"
if [ -d ../central-usage/app/web ]; then rm -rf www/web; cp -r ../central-usage/app/web www/web; fi
npm install --no-audit --no-fund
npx cap sync ios

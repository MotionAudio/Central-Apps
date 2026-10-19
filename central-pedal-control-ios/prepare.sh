#!/bin/bash
# Gets the iPad project of Central Pedal Control ready to build: the Central Pedal app (the same files the Raspberry
# Pi runs) into www/, marked as the editor (window.CP_CONTROL - it uploads to a Central Pedal instead of being one),
# then Capacitor's sync (copies www into the Xcode project; pod install on a Mac).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/.." && pwd)"
rm -rf "$HERE/www"; mkdir -p "$HERE/www"
cd "$ROOT"
cp -r index.html css js fonts cues "$HERE/www/"
python3 - "$HERE/www/index.html" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding="utf-8").read()
s = s.replace("<head>", "<head>\n  <script>window.CP_CONTROL = true;</script>", 1).replace("<title>Central Pedal</title>", "<title>Central Pedal Control</title>", 1)
open(p, "w", encoding="utf-8").write(s)
PY
cd "$HERE"
npm install --no-audit --no-fund
npx cap sync ios

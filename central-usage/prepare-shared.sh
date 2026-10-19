#!/bin/bash
# Copies the files Central Usage shares with Central Control into this folder before a build (or `npm start`):
#   app/shared/   the Instrument page (instrument.js, pedals.js, plugin-ports.js, pad-pedal.css), the parts (notation.js, parts.js, parts.css)
#                 and the license key setup (license.js)
#   native/       the instrument host (instrument_host.py + instrument-plugins.json)
# and builds the native helpers (the audio engine cu-mixer, the NDI sender cu-ndi, the instrument rig cu-rig).
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/.." && pwd)"
mkdir -p "$HERE/app/shared" "$HERE/app/fonts"
cp "$ROOT/js/instrument.js" "$ROOT/js/pedals.js" "$ROOT/js/plugin-ports.js" "$ROOT/js/notation.js" "$ROOT/js/parts.js" "$ROOT/js/lyrics-ai.js" "$ROOT/js/license.js" "$HERE/app/shared/"
cp "$ROOT/css/pad-pedal.css" "$ROOT/css/parts.css" "$HERE/app/shared/"
cp "$ROOT/instrument_host.py" "$ROOT/instrument-plugins.json" "$HERE/native/"
[ -f "$HERE/app/fonts/fonts.css" ] || cp "$ROOT/fonts/"* "$HERE/app/fonts/" 2>/dev/null || true
[ -n "${CU_SKIP_NATIVE:-}" ] || make -C "$HERE/native" >/dev/null   # (CI builds the native helpers in their own job: CU_SKIP_NATIVE=1)
[ -n "${CU_SKIP_NATIVE:-}" ] || make -C "$HERE/native/video" >/dev/null 2>&1 || echo "cu-video (the Video tab helper) was not built here"
echo "shared files copied, native helpers built"

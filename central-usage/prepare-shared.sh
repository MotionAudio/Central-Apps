#!/bin/bash
# Copies the files Central Usage shares with Central Control into this folder before a build (or `npm start`):
#   app/shared/   the Instrument page (instrument.js, pedals.js, plugin-ports.js, pad-pedal.css)
#   native/       the instrument host (instrument_host.py + instrument-plugins.json)
# and builds the native helpers (the audio engine cu-mixer and the NDI sender cu-ndi).
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/.." && pwd)"
mkdir -p "$HERE/app/shared" "$HERE/app/fonts"
cp "$ROOT/js/instrument.js" "$ROOT/js/pedals.js" "$ROOT/js/plugin-ports.js" "$HERE/app/shared/"
cp "$ROOT/css/pad-pedal.css" "$HERE/app/shared/"
cp "$ROOT/instrument_host.py" "$ROOT/instrument-plugins.json" "$HERE/native/"
[ -f "$HERE/app/fonts/fonts.css" ] || cp "$ROOT/fonts/"* "$HERE/app/fonts/" 2>/dev/null || true
make -C "$HERE/native" >/dev/null
echo "shared files copied, native helpers built"

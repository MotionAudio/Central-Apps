#!/bin/bash
# Copies the Central Pedal app (the same files the Raspberry Pi runs) into central-control-desktop/src,
# which electron-builder packs into the PC app; and, when they have been built, the built-in instrument rig
# (central-usage/native/build/cu-rig + rig-map.json -> native/) and its sounds (-> sounds/).
# The bundled driver for Windows / macOS (driver-dist/) comes from tools/build-driver.sh.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; DESK="$ROOT/central-control-desktop"; DST="$DESK/src"
rm -rf "$DST"; mkdir -p "$DST"
cd "$ROOT"
cp -r index.html css js companion cues fonts hardware.json instrument-plugins.json instrument_host.py native_rig.py pedal-driver.py sources.py "$DST/"
# Central Usage for phones / tablets, served at http://<this PC>:8080/cu/ like on the Pi
mkdir -p "$DST/central-usage/build" && cp -r central-usage/app "$DST/central-usage/" && cp central-usage/build/icon.png "$DST/central-usage/build/" && rm -rf "$DST/central-usage/app/shared"
mkdir -p "$DESK/native" "$DESK/sounds" "$DESK/driver-dist"
for f in cu-rig cu-rig.exe rig-map.json; do [ -f "central-usage/native/build/$f" ] && cp "central-usage/native/build/$f" "$DESK/native/"; done
if ls central-usage/native/sounds/*.sf2 >/dev/null 2>&1; then cp central-usage/native/sounds/*.sf2 central-usage/native/sounds/*.txt "$DESK/sounds/" 2>/dev/null || true; fi
echo "app copied into $DST$( [ -n "$(ls "$DESK/native" 2>/dev/null)" ] && echo " (+ instrument rig)")"

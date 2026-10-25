#!/bin/bash
# Copies the Central Pedal app (the same files the Raspberry Pi runs) into central-usage/player-src, which
# electron-builder packs into Central Control as resources/player - the main admin's player window (player.js).
# The driver for it, bundled with PyInstaller (no Python needed): bash tools/build-driver.sh central-usage/driver-dist
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; DST="$ROOT/central-usage/player-src"
rm -rf "$DST"; mkdir -p "$DST"
cd "$ROOT"
cp -r index.html css js companion cues fonts hardware.json instrument-plugins.json instrument_host.py native_rig.py libraries.py pedal-driver.py sources.py screens.json "$DST/"
[ -f starting.html ] && cp starting.html "$DST/"
mkdir -p "$ROOT/central-usage/driver-dist"
echo "player app copied into $DST"

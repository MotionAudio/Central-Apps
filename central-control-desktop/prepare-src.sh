#!/bin/bash
# Copies the Central Control app (the same files the Raspberry Pi runs) into central-control-desktop/src,
# which electron-builder packs into the PC app.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; DST="$ROOT/central-control-desktop/src"
rm -rf "$DST"; mkdir -p "$DST"
cd "$ROOT"
cp -r index.html css js companion cues fonts hardware.json instrument-plugins.json instrument_host.py pedal-driver.py sources.py "$DST/"
echo "app copied into $DST"

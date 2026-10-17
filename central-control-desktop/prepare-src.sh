#!/bin/bash
# Copies the Central Control app (the same files the Raspberry Pi runs) into central-control-desktop/src,
# which electron-builder packs into the PC app.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; DST="$ROOT/central-control-desktop/src"
rm -rf "$DST"; mkdir -p "$DST"
cd "$ROOT"
cp -r index.html css js companion cues fonts hardware.json instrument-plugins.json instrument_host.py pedal-driver.py sources.py "$DST/"
# Central Usage for phones / tablets, served at http://<this PC>:8080/cu/ like on the Pi
mkdir -p "$DST/central-usage/build" && cp -r central-usage/app "$DST/central-usage/" && cp central-usage/build/icon.png "$DST/central-usage/build/" && rm -rf "$DST/central-usage/app/shared"
echo "app copied into $DST"

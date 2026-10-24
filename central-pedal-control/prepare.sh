#!/bin/bash
# Gets Central Pedal Control ready to pack: the Central Pedal app (the same files the Raspberry Pi runs) into src/,
# the shared updater, and the bundled driver (bash tools/build-driver.sh central-pedal-control/driver-dist on the Mac
# that builds it - or copy central-usage/driver-dist).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/.." && pwd)"
rm -rf "$HERE/src"; mkdir -p "$HERE/src"
cd "$ROOT"
cp -r index.html css js companion cues fonts hardware.json instrument-plugins.json instrument_host.py native_rig.py libraries.py pedal-driver.py sources.py screens.json "$HERE/src/"
[ -f starting.html ] && cp starting.html "$HERE/src/"
cp central-usage/updater.js "$HERE/updater.js"
if [ ! -d "$HERE/driver-dist/pedal-driver" ] && [ -d central-usage/driver-dist/pedal-driver ]; then rm -rf "$HERE/driver-dist"; cp -R central-usage/driver-dist "$HERE/driver-dist"; fi
mkdir -p "$HERE/driver-dist"
echo "Central Pedal Control ready to pack ($(sed -nE 's/^APP_VERSION = "([^"]+)".*/\1/p' pedal-driver.py))"

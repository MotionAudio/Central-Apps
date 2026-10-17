#!/bin/bash
# Bundles the Central Control driver (pedal-driver.py + sources.py + instrument_host.py + native_rig.py and the
# Python packages it uses) into one folder with PyInstaller, so Central Control on Windows / macOS needs no Python.
#   bash tools/build-driver.sh [out folder]         (default: central-control-desktop/driver-dist)
# Output: <out>/pedal-driver/pedal-driver[.exe] plus its files. Run on the system you build for.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-central-control-desktop/driver-dist}"
PY="${PYTHON:-$(command -v python3 || command -v python)}"
"$PY" -m pip install --quiet --disable-pip-version-check pyinstaller==6.11.1 websockets==13.1 gpiozero==2.0.1 pillow mido==1.3.3 python-rtmidi==1.5.8
WORK="$(mktemp -d)"
"$PY" -m PyInstaller --noconfirm --clean --onedir --name pedal-driver --distpath "$OUT" --workpath "$WORK/build" --specpath "$WORK" \
  --paths . --hidden-import instrument_host --hidden-import sources --hidden-import native_rig \
  --hidden-import mido.backends.rtmidi --hidden-import rtmidi --hidden-import gpiozero.pins.mock --collect-submodules websockets \
  --exclude-module tkinter --exclude-module numpy --exclude-module yaml pedal-driver.py
rm -rf "$WORK"
echo "driver bundled in $OUT/pedal-driver"

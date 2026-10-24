#!/usr/bin/env bash
# Central Pedal - builds the sound libraries (Central Keys, Central Instrument, Central Plugins, Central Pedals) the same
# way CI does (.github/workflows/libraries.yml), on this computer:
#   1. the VCSL SoundFonts (tools/sounds-vcsl.py - downloads about 1.5 GB of WAVs, one at a time, deleting each once used)
#   2. the cabinet / acoustic-body impulse responses (tools/make-irs.py - made here, nothing downloaded)
#   3. the zips, libraries-index.json and SHA256SUMS (tools/build-libraries.py)
#
#   tools/build-libraries.sh [out folder]          (default: dist/libraries)
# Environment: WORK (the cache and the built sounds, default build/libraries-work - keep it to rebuild quickly),
# LIBRARIES_BASE_URL (where the zips will be downloaded from; default the GitHub release "libraries"), ONLY (one library id).
# Needs python3 with numpy, git and the internet. The finished SoundFonts need about 350 MB, the zips about the same.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$HERE/dist/libraries}"
WORK="${WORK:-$HERE/build/libraries-work}"
BASE="${LIBRARIES_BASE_URL:-https://github.com/MotionAudio/central-apps/releases/download/libraries}"
mkdir -p "$OUT" "$WORK"
python3 -c 'import numpy' 2>/dev/null || { echo "needs numpy: pip install numpy (or apt install python3-numpy)"; exit 1; }

echo "1/3  VCSL sounds (CC0) -> $WORK/sounds"
python3 "$HERE/tools/sounds-vcsl.py" "$WORK/cache" "$WORK/sounds"
echo "2/3  impulse responses -> $WORK/irs"
python3 "$HERE/tools/make-irs.py" "$WORK/irs"
echo "3/3  zips -> $OUT"
python3 "$HERE/tools/build-libraries.py" --sounds "$WORK/sounds" --irs "$WORK/irs" --out "$OUT" --base-url "$BASE" ${ONLY:+--only "$ONLY"}
( cd "$OUT" && sha256sum -c SHA256SUMS >/dev/null ) && echo "    SHA256SUMS checked"
echo "Done: $OUT"

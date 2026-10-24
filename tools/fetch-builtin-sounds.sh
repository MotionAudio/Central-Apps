#!/bin/bash
# The keys sounds that come with Central Control and Central Pedal on Windows / macOS (the built-in rig):
# eleven free SoundFont banks from FreePats and the VSCO 2: CE orchestra, all CC0 (public domain). About 270 MB.
#   bash tools/fetch-builtin-sounds.sh <target folder>        (needs curl, and 7z or bsdtar)
set -euo pipefail
DEST="${1:?usage: fetch-builtin-sounds.sh <target folder>}"; mkdir -p "$DEST"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
BANKS=(
  "https://freepats.zenvoid.org/Piano/UprightPianoKW/UprightPianoKW-SF2-20220221.7z|Upright Piano KW.sf2"
  "https://freepats.zenvoid.org/Organ/DrawbarOrganEmulation/DrawbarOrganEmulation-SF2-20190712.tar.xz|Drawbar Organ.sf2"
  "https://github.com/freepats/synth-strings-1/releases/download/2020-05-28/SynthStrings1-SF2-20200528.7z|Synth Strings.sf2"
  "https://github.com/freepats/synth-pad-choir/releases/download/2020-05-16/SynthPadChoir-SF2-20200516.7z|Synth Pad Choir.sf2"
  "https://github.com/freepats/synth-bass-lead/releases/download/2020-05-22/SynthBassLead-SF2-20200522.7z|Synth Bass and Lead.sf2"
  "https://freepats.zenvoid.org/Piano/UprightPianoKW/UprightPianoKW-small-bright-SF2-20190703.7z|Upright Piano KW Bright.sf2"
  "https://github.com/freepats/fm-piano1/releases/download/2019-09-16/FM-Piano1-SF2-20190916.7z|FM Piano 1.sf2"
  "https://github.com/freepats/electric-bass-YR/releases/download/2019-09-30/FingerBassYR-SF2-20190930.7z|Finger Bass YR.sf2"
  "https://github.com/freepats/synth-brass-1/releases/download/2021-04-26/SynthBrass1-SF2-20210426.7z|Synth Brass 1.sf2"
  "https://freepats.zenvoid.org/OrchestralStrings/ConcertHarp/ConcertHarp-small-SF2-20200702.tar.xz|Concert Harp.sf2"
  "https://freepats.zenvoid.org/Ethnic/Kalimba/Kalimba-SF2-20190723.tar.xz|Kalimba.sf2"
)
for entry in "${BANKS[@]}"; do
  url="${entry%%|*}"; name="${entry#*|}"
  [ -s "$DEST/$name" ] && { echo "have $name"; continue; }
  f="$TMP/$(basename "$url")"; curl -fsSL --retry 3 -o "$f" "$url"
  x="$TMP/x-$RANDOM"; mkdir -p "$x"
  case "$f" in
    *.7z) if command -v 7z >/dev/null; then 7z x -y -o"$x" "$f" >/dev/null; else bsdtar -xf "$f" -C "$x"; fi ;;
    *) tar -xf "$f" -C "$x" ;;
  esac
  sf="$(find "$x" -iname '*.sf2' | head -1)"; [ -n "$sf" ] || { echo "no .sf2 in $url" >&2; exit 1; }
  mv "$sf" "$DEST/$name"; echo "got $name ($(du -h "$DEST/$name" | cut -f1))"
done
# the orchestra (strings, brass, woodwinds) from VS Chamber Orchestra 2: CE (CC0), made into SoundFonts by
# sounds-vsco.py (about 95 MB; BUILTIN_ORCHESTRA=0 leaves it out). Free in every app (tiers.txt), as Versilian asks.
ORCH=0
if [ "${BUILTIN_ORCHESTRA:-1}" != "0" ]; then
  HERE="$(cd "$(dirname "$0")/.." && pwd)"
  PY="$(command -v python3 || command -v python || true)"
  if [ -n "$PY" ]; then
    "$PY" -c "import numpy" 2>/dev/null || "$PY" -m pip install --quiet numpy 2>/dev/null || "$PY" -m pip install --quiet --user numpy 2>/dev/null || true
    if "$PY" -c "import numpy" 2>/dev/null && "$PY" "$HERE/sounds-vsco.py" "$TMP/vsco" "$DEST"; then
      ORCH=1
      { echo "# file prefix | plan | license | name"; for v in VSCO-Strings VSCO-Brass VSCO-Woodwinds; do echo "$v|instrument|CC0|${v/-/ }"; done; } > "$DEST/tiers.txt"
    else echo "(no orchestra: python3 with numpy is needed)"; fi
  fi
fi
cat > "$DEST/SOUNDS-LICENSE.txt" <<'TXT'
The keys sounds in this folder are from FreePats (https://freepats.zenvoid.org), released under CC0 1.0
(public domain): Upright Piano KW (+ Bright), FM Piano 1, Drawbar Organ Emulation, Synth Strings 1, Synth Pad Choir,
Synth Bass and Lead, Finger Bass YR, Synth Brass 1, Concert Harp, Kalimba.
Add your own .sf2 banks in the app's data folder (sounds/sf2).
TXT
if [ "$ORCH" = 1 ]; then cat >> "$DEST/SOUNDS-LICENSE.txt" <<'TXT'
VSCO Strings, VSCO Brass and VSCO Woodwinds are made from VS Chamber Orchestra 2: Community Edition by Versilian
Studios (https://github.com/sgossner/VSCO-2-CE), CC0 1.0 - recorded by Sam Gossner and Simon Dalzell, sample cutting
by Elan Hickler / Soundemote. They come free with the app; the samples are not sold on their own.
TXT
fi

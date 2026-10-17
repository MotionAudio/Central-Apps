#!/bin/bash
# The keys sounds that come with Central Usage and Central Control on Windows / macOS (the built-in rig):
# five free SoundFont banks from FreePats, all CC0 (public domain). About 93 MB.
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
cat > "$DEST/SOUNDS-LICENSE.txt" <<'TXT'
The keys sounds in this folder are from FreePats (https://freepats.zenvoid.org), released under CC0 1.0
(public domain): Upright Piano KW, Drawbar Organ Emulation, Synth Strings 1, Synth Pad Choir, Synth Bass and Lead.
Add your own .sf2 banks in the app's data folder (sounds/sf2).
TXT

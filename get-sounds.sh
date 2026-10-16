#!/bin/bash
# ==============================================================================
# Central Control - fetch the free keyboard sound banks (SoundFont .sf2) that the
# Instrument tab's "Piano & keys" uses. All are free: FreePats (CC0 / CC-BY) and
# the Salamander Grand Piano (CC-BY 3.0, Alexander Holm). Run by build-image.sh on
# your PC and by install-kiosk.sh on the Pi; needs curl and 7z (p7zip-full) or
# bsdtar. Already-downloaded banks are kept.
#
#   bash get-sounds.sh <target folder>          (default: ./sounds)
#   SMALL=1 bash get-sounds.sh                  skip the big Salamander grand (296 MB)
# ==============================================================================
set -uo pipefail
TARGET="${1:-$(cd "$(dirname "$0")" && pwd)/sounds}"
CACHE="${CACHE:-$TARGET/.downloads}"
mkdir -p "$TARGET" "$CACHE"
say() { printf '\n==> %s\n' "$*"; }

BANKS=(
  # url | license | short name
  "https://freepats.zenvoid.org/Piano/SalamanderGrandPiano/SalamanderGrandPiano-SF2-V3+20200602.tar.xz|CC-BY-3.0|Salamander Grand Piano"
  "https://freepats.zenvoid.org/Piano/YDP-GrandPiano/YDP-GrandPiano-SF2-20160804.tar.bz2|CC-BY-3.0|YDP Grand Piano"
  "https://freepats.zenvoid.org/Piano/UprightPianoKW/UprightPianoKW-SF2-20220221.7z|CC0|Upright Piano KW"
  "https://github.com/freepats/fm-piano1/releases/download/2019-09-16/FM-Piano1-SF2-20190916.7z|CC0|FM Piano 1"
  "https://github.com/freepats/fm-piano2/releases/download/2016-11-12/FM-Piano2-SF2-20161112.7z|CC0|FM Piano 2"
  "https://freepats.zenvoid.org/Organ/DrawbarOrganEmulation/DrawbarOrganEmulation-SF2-20190712.tar.xz|CC0|Drawbar Organ"
  "https://freepats.zenvoid.org/Organ/PercussiveOrganEmulation/PercussiveOrganEmulation-SF2-20190715.tar.xz|CC0|Percussive Organ"
  "https://freepats.zenvoid.org/Organ/RockOrganEmulation/RockOrganEmulation-SF2-20190715.tar.xz|CC0|Rock Organ"
  "https://freepats.zenvoid.org/Organ/ChurchOrganEmulation/ChurchOrganEmulation-SF2-20190924.tar.xz|CC0|Church Organ"
  "https://github.com/freepats/synth-pad-choir/releases/download/2020-05-16/SynthPadChoir-SF2-20200516.7z|CC0|Synth Pad Choir"
  "https://github.com/freepats/sweep-pad/releases/download/2019-08-13/SweepPad-SF2-20190813.7z|CC0|Sweep Pad"
  "https://github.com/freepats/new-age/releases/download/2019-07-30/NewAge-SF2-20190730.7z|CC0|New Age Pad"
  "https://github.com/freepats/synth-pad-bowed/releases/download/2019-07-19/SynthPadBowed-SF2-20190719.7z|CC0|Bowed Pad"
  "https://github.com/freepats/synth-strings-1/releases/download/2020-05-28/SynthStrings1-SF2-20200528.7z|CC0|Synth Strings 1"
  "https://github.com/freepats/synth-strings-2/releases/download/2020-05-28/SynthStrings2-SF2-20200528.7z|CC0|Synth Strings 2"
  "https://github.com/freepats/synth-bass-lead/releases/download/2020-05-22/SynthBassLead-SF2-20200522.7z|CC0|Synth Bass and Lead"
  "https://github.com/freepats/synth-fifths/releases/download/2020-05-19/SynthFifths-SF2-20200519.7z|CC0|Synth Fifths"
  "https://github.com/freepats/synth-square/releases/download/2020-05-12/SynthSquare-SF2-20200512.7z|CC0|Synth Lead Square"
  "https://github.com/freepats/synth-calliope/releases/download/2020-05-12/SynthCalliope-SF2-20200512.7z|CC0|Synth Lead Calliope"
  "https://github.com/freepats/tubular-bells1/releases/download/2024-11-30/TubularBells-SF2-20241130.7z|CC0|Tubular Bells"
)

extract() {  # extract <archive> <into>
  local f="$1" d="$2"
  case "$f" in
    *.7z) if command -v 7z >/dev/null; then 7z x -y -o"$d" "$f" >/dev/null; elif command -v 7zr >/dev/null; then 7zr x -y -o"$d" "$f" >/dev/null; elif command -v bsdtar >/dev/null; then bsdtar -xf "$f" -C "$d"; else return 2; fi ;;
    *.tar.xz|*.tar.bz2|*.tar.gz|*.tgz) tar -xf "$f" -C "$d" ;;
    *.zip) if command -v unzip >/dev/null; then unzip -oq "$f" -d "$d"; else bsdtar -xf "$f" -C "$d"; fi ;;
    *) return 2 ;;
  esac
}

ok=0; failed=()
for entry in "${BANKS[@]}"; do
  url="${entry%%|*}"; rest="${entry#*|}"; license="${rest%%|*}"; name="${rest#*|}"
  file="$CACHE/$(basename "$url")"
  slug="$(echo "$name" | tr -cd 'A-Za-z0-9 ' | tr ' ' '-')"
  if ls "$TARGET"/"$slug"*.sf2 >/dev/null 2>&1; then ok=$((ok+1)); continue; fi
  if [ "${SMALL:-0}" = "1" ] && [[ "$name" == "Salamander"* ]]; then continue; fi
  say "$name ($license)"
  if [ ! -s "$file" ]; then
    curl -L --fail --retry 3 --connect-timeout 20 -o "$file.part" "$url" && mv "$file.part" "$file" || { echo "    download failed - skipped"; failed+=("$name"); rm -f "$file.part"; continue; }
  fi
  tmp="$(mktemp -d)"
  if ! extract "$file" "$tmp"; then echo "    could not extract (install p7zip-full) - skipped"; failed+=("$name"); rm -rf "$tmp"; continue; fi
  n=0
  while IFS= read -r -d '' sf; do
    base="$(basename "$sf")"
    cp "$sf" "$TARGET/$slug - ${base%.*}.sf2"; n=$((n+1))
  done < <(find "$tmp" -iname '*.sf2' -print0)
  # keep the license / readme next to the bank
  while IFS= read -r -d '' lic; do cp "$lic" "$TARGET/$slug - $(basename "$lic")"; done < <(find "$tmp" -maxdepth 3 \( -iname 'license*' -o -iname 'readme*' -o -iname 'copying*' \) -print0)
  rm -rf "$tmp"
  if [ "$n" -gt 0 ]; then echo "    $n bank(s) ready"; ok=$((ok+1)); else echo "    no .sf2 inside - skipped"; failed+=("$name"); fi
done
echo
echo "Sound banks ready: $ok of ${#BANKS[@]} in $TARGET"
[ ${#failed[@]} -eq 0 ] || echo "Not fetched (no internet / blocked?): ${failed[*]}  - run this script again later, or add .sf2 files on the Instrument tab."
exit 0

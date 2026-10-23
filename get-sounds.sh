#!/bin/bash
# ==============================================================================
# Central Control - fetch the keys and instrument sound banks (SoundFont .sf2) the
# Instrument tab plays. All are free to use and to sell as part of a product: FreePats
# (CC0 / CC-BY), the Salamander Grand Piano (CC-BY 3.0, Alexander Holm) and the orchestra
# (strings, brass, woodwinds) built from VS Chamber Orchestra 2: CE (CC0, Versilian Studios)
# by sounds-vsco.py next to this script (needs python3-numpy). Each bank
# belongs to a plan (free, Central Keys or Central Instrument): the script writes
# tiers.txt (read by the instrument host) and CREDITS.txt (authors and licenses) next
# to the banks. Run by build-image.sh on your PC and by install-kiosk.sh on the Pi;
# needs curl and 7z (p7zip-full) or bsdtar. Already-downloaded banks are kept.
#
#   bash get-sounds.sh <target folder>          (default: ./sounds)
#   SMALL=1 bash get-sounds.sh                  skip the big banks (the Salamander grand, two guitars)
#   ONLY="Ukulele,Ocarina" bash get-sounds.sh   just these banks (by short name; "VSCO" = the orchestra)
#   NO_ORCHESTRA=1 bash get-sounds.sh           skip the orchestra (strings, brass, woodwinds: about 95 MB)
# ==============================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TARGET="${1:-$HERE/sounds}"
CACHE="${CACHE:-$TARGET/.downloads}"
mkdir -p "$TARGET" "$CACHE"
say() { printf '\n==> %s\n' "$*"; }

BANKS=(
  # url | license | short name | plan (free, keys or instrument) [| big: skipped with SMALL=1]
  "https://freepats.zenvoid.org/Piano/SalamanderGrandPiano/SalamanderGrandPiano-SF2-V3+20200602.tar.xz|CC-BY-3.0|Salamander Grand Piano|keys|big"
  "https://freepats.zenvoid.org/Piano/YDP-GrandPiano/YDP-GrandPiano-SF2-20160804.tar.bz2|CC-BY-3.0|YDP Grand Piano|keys"
  "https://freepats.zenvoid.org/Piano/UprightPianoKW/UprightPianoKW-SF2-20220221.7z|CC0|Upright Piano KW|free"
  "https://github.com/freepats/fm-piano1/releases/download/2019-09-16/FM-Piano1-SF2-20190916.7z|CC0|FM Piano 1|free"
  "https://github.com/freepats/fm-piano2/releases/download/2016-11-12/FM-Piano2-SF2-20161112.7z|CC0|FM Piano 2|keys"
  "https://freepats.zenvoid.org/Organ/DrawbarOrganEmulation/DrawbarOrganEmulation-SF2-20190712.tar.xz|CC0|Drawbar Organ|free"
  "https://freepats.zenvoid.org/Organ/PercussiveOrganEmulation/PercussiveOrganEmulation-SF2-20190715.tar.xz|CC0|Percussive Organ|keys"
  "https://freepats.zenvoid.org/Organ/RockOrganEmulation/RockOrganEmulation-SF2-20190715.tar.xz|CC0|Rock Organ|keys"
  "https://freepats.zenvoid.org/Organ/ChurchOrganEmulation/ChurchOrganEmulation-SF2-20190924.tar.xz|CC0|Church Organ|keys"
  "https://github.com/freepats/synth-pad-choir/releases/download/2020-05-16/SynthPadChoir-SF2-20200516.7z|CC0|Synth Pad Choir|keys"
  "https://github.com/freepats/sweep-pad/releases/download/2019-08-13/SweepPad-SF2-20190813.7z|CC0|Sweep Pad|keys"
  "https://github.com/freepats/new-age/releases/download/2019-07-30/NewAge-SF2-20190730.7z|CC0|New Age Pad|keys"
  "https://github.com/freepats/synth-pad-bowed/releases/download/2019-07-19/SynthPadBowed-SF2-20190719.7z|CC0|Bowed Pad|keys"
  "https://github.com/freepats/synth-strings-1/releases/download/2020-05-28/SynthStrings1-SF2-20200528.7z|CC0|Synth Strings 1|keys"
  "https://github.com/freepats/synth-strings-2/releases/download/2020-05-28/SynthStrings2-SF2-20200528.7z|CC0|Synth Strings 2|keys"
  "https://github.com/freepats/synth-bass-lead/releases/download/2020-05-22/SynthBassLead-SF2-20200522.7z|CC0|Synth Bass and Lead|keys"
  "https://github.com/freepats/synth-fifths/releases/download/2020-05-19/SynthFifths-SF2-20200519.7z|CC0|Synth Fifths|keys"
  "https://github.com/freepats/synth-square/releases/download/2020-05-12/SynthSquare-SF2-20200512.7z|CC0|Synth Lead Square|keys"
  "https://github.com/freepats/synth-calliope/releases/download/2020-05-12/SynthCalliope-SF2-20200512.7z|CC0|Synth Lead Calliope|keys"
  "https://github.com/freepats/tubular-bells1/releases/download/2024-11-30/TubularBells-SF2-20241130.7z|CC0|Tubular Bells|keys"
  # v8.1: more keys, basses, brass, mallets and winds (all CC0, FreePats)
  "https://github.com/freepats/old-piano-FB/releases/download/2020-04-01/PianoFB-SF2-20200401.7z|CC0|Old Piano FB|keys"
  "https://freepats.zenvoid.org/Piano/UprightPianoKW/UprightPianoKW-small-bright-SF2-20190703.7z|CC0|Upright Piano KW Bright|keys"
  "https://github.com/freepats/synth-brass-1/releases/download/2021-04-26/SynthBrass1-SF2-20210426.7z|CC0|Synth Brass 1|keys"
  "https://github.com/freepats/synth-brass-2/releases/download/2024-06-10/SynthBrass2-SF2-20240610.7z|CC0|Synth Brass 2|keys"
  "https://github.com/freepats/synth-bass-1/releases/download/2019-07-23/SynthBass1-SF2-20190723.7z|CC0|Synth Bass 1|keys"
  "https://github.com/freepats/synth-bass-2/releases/download/2021-04-05/SynthBass2-SF2-20210405.7z|CC0|Synth Bass 2|keys"
  "https://github.com/freepats/lately-bass/releases/download/2024-04-09/LatelyBass-SF2-20240409.7z|CC0|Lately Bass|keys"
  "https://github.com/freepats/electric-bass-YR/releases/download/2019-09-30/FingerBassYR-SF2-20190930.7z|CC0|Finger Bass YR|instrument"
  "https://github.com/freepats/electric-bass-YR/releases/download/2019-09-30/PickedBassYR-SF2-20190930.7z|CC0|Picked Bass YR|instrument"
  "https://freepats.zenvoid.org/OrchestralStrings/ConcertHarp/ConcertHarp-small-SF2-20200702.tar.xz|CC0|Concert Harp|instrument"
  "https://freepats.zenvoid.org/ChromaticPercussion/Glass/Glass-SF2-20191227.7z|CC0|Glass|keys"
  "https://github.com/freepats/hang-D-minor/releases/download/2022-03-30/Hang-D-minor-SF2-20220330.7z|CC0|Hang (D minor)|keys"
  "https://freepats.zenvoid.org/ChromaticPercussion/Xylophone1/Xylophone-MediumMallets-SF2-20200706.tar.xz|CC0|Xylophone|keys"
  "https://freepats.zenvoid.org/Ethnic/Kalimba/Kalimba-SF2-20190723.tar.xz|CC0|Kalimba|keys"
  "https://freepats.zenvoid.org/Reed/Clarinet1/Clarinet-SF2-20190818.tar.xz|CC0|Clarinet|instrument"
  "https://freepats.zenvoid.org/Reed/TenorSaxophone/TenorSaxophone-small-SF2-20200717.tar.bz2|CC0|Tenor Saxophone|instrument"
  "https://freepats.zenvoid.org/Wind/Recorder1/Recorder-SF2-20201205.7z|CC0|Recorder|instrument"
  # 9.5: guitars (electric clean / jazz / direct / distorted, nylon), ukulele, ocarina and two synth sets (all CC0, FreePats).
  # Real strings, cello, brass and woodwinds: the orchestra below (VSCO 2: CE); the General MIDI banks already on the
  # pedal (FluidR3 GM and MuseScore General, both MIT) have more, sorted into Central Instrument by the app.
  "https://github.com/freepats/electric-guitar-FSBS-clean/releases/download/2026-08-07/EGuitarFSBS-clean-bridge-small-SF2-20260807.7z|CC0|Electric Guitar Clean|instrument"
  "https://github.com/freepats/electric-guitar-FSBS-jazz/releases/download/2026-08-07/EGuitarFSBS-jazz-bridge-small-SF2-20260807.7z|CC0|Electric Guitar Jazz|instrument"
  "https://github.com/freepats/electric-guitar-FSBS-direct/releases/download/2022-09-11/EGuitarFSBS-direct-SF2-20220911.7z|CC0|Electric Guitar Direct|instrument|big"
  "https://github.com/freepats/electric-guitar-FSBS-dist2/releases/download/2022-09-11/EGuitarFSBS-dist2-SF2-20220911.7z|CC0|Electric Guitar Distorted|instrument|big"
  "https://freepats.zenvoid.org/Guitar/SpanishClassicalGuitar/SpanishClassicalGuitar-SF2-20190618.7z|CC0|Nylon Guitar|instrument"
  "https://github.com/freepats/ukulele1/releases/download/2026-08-11/Ukulele-SF2-20260811.7z|CC0|Ukulele|instrument"
  "https://github.com/freepats/ocarina1/releases/download/2024-10-02/Ocarina-SF2-20241002.7z|CC0|Ocarina|instrument"
  "https://github.com/freepats/synth-crystal/releases/download/2019-08-12/SynthCrystal-SF2-20190812.7z|CC0|Synth Crystal|keys"
  "https://github.com/freepats/synth-soundtrack/releases/download/20200521/SynthSoundtrack-SF2-20200521.7z|CC0|Synth Soundtrack|keys"
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

ok=0; failed=(); wanted=0
slug_of() { echo "$1" | tr -cd 'A-Za-z0-9 ' | tr ' ' '-'; }
for entry in "${BANKS[@]}"; do
  IFS='|' read -r url license name tier big <<< "$entry"
  file="$CACHE/$(basename "$url")"
  slug="$(slug_of "$name")"
  if [ -n "${ONLY:-}" ] && [[ ",$ONLY," != *",$name,"* ]]; then continue; fi
  if [ "${SMALL:-0}" = "1" ] && [ "$big" = "big" ]; then continue; fi
  wanted=$((wanted+1))
  if ls "$TARGET/$slug - "*.sf2 >/dev/null 2>&1; then ok=$((ok+1)); continue; fi
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

# ---- the orchestra: VS Chamber Orchestra 2: CE (SFZ + WAV, CC0) made into three SoundFonts here (looped, mono)
# Its readme asks that the samples not be sold on their own: they come free with every Central Pedal and app
# (VSCO_TIER below), never as part of a paid plan.
VSCO_TIER="${VSCO_TIER:-free}"
VSCO_BANKS=("VSCO Strings|VSCO-Strings" "VSCO Brass|VSCO-Brass" "VSCO Woodwinds|VSCO-Woodwinds")
if [ "${NO_ORCHESTRA:-0}" != "1" ] && { [ -z "${ONLY:-}" ] || [[ ",$ONLY," == *",VSCO,"* ]]; }; then
  wanted=$((wanted+3))
  if [ ! -f "$HERE/sounds-vsco.py" ]; then echo "    (sounds-vsco.py is missing - no orchestra)"; failed+=("VSCO orchestra")
  elif ! python3 -c "import numpy" 2>/dev/null; then echo "    (python3-numpy is missing - no orchestra: sudo apt install python3-numpy)"; failed+=("VSCO orchestra")
  else
    say "Orchestra: strings, brass, woodwinds (VS Chamber Orchestra 2: CE, CC0)"
    python3 "$HERE/sounds-vsco.py" "$CACHE/vsco" "$TARGET" || failed+=("VSCO orchestra")
    for v in "${VSCO_BANKS[@]}"; do ls "$TARGET/${v#*|} - "*.sf2 >/dev/null 2>&1 && ok=$((ok+1)); done
  fi
fi

# ---- tiers.txt (which plan opens each bank: the Pi's instrument host reads it) and CREDITS.txt (who made each one)
plan_name() { case "$1" in free) echo "free with every Central Pedal and app";; keys) echo "Central Keys";; instrument) echo "Central Instrument";; *) echo "$1";; esac; }
{
  echo "# file prefix | plan (free, keys, instrument) | license | name  - written by get-sounds.sh"
  for entry in "${BANKS[@]}"; do
    IFS='|' read -r url license name tier big <<< "$entry"; slug="$(slug_of "$name")"
    ls "$TARGET/$slug - "*.sf2 >/dev/null 2>&1 && echo "$slug|$tier|$license|$name"
  done
  for v in "${VSCO_BANKS[@]}"; do ls "$TARGET/${v#*|} - "*.sf2 >/dev/null 2>&1 && echo "${v#*|}|$VSCO_TIER|CC0|${v%%|*}"; done
} > "$TARGET/tiers.txt"
{
  echo "Central Pedal keys & instrument sounds - credits and licenses"
  echo "=============================================================="
  echo "Every bank below may be used, sold as part of a product and redistributed under its license."
  echo "CC0 = public domain dedication (no conditions). CC-BY-3.0 = credit the author (done here)."
  echo "The license / readme files each bank came with sit next to it (\"<bank> - readme.txt\")."
  echo
  for entry in "${BANKS[@]}"; do
    IFS='|' read -r url license name tier big <<< "$entry"; slug="$(slug_of "$name")"
    ls "$TARGET/$slug - "*.sf2 >/dev/null 2>&1 || continue
    echo "$name"
    echo "  License: $license    Plan: $(plan_name "$tier")"
    echo "  Source:  $url"
    case "$name" in
      "Salamander Grand Piano") echo "  Author:  Alexander Holm (Yamaha C5 samples), SoundFont by the FreePats project" ;;
      "YDP Grand Piano") echo "  Author:  Zenph Studios Yamaha Disklavier Pro multisamples for OLPC (Dr. Mikhail Krishtal and team, donated via Dr. Richard Boulanger / cSounds.com); SoundFont by roberto@zenvoid.org for FreePats" ;;
      *) echo "  Author:  FreePats project (freepats.zenvoid.org)" ;;
    esac
    echo
  done
  for v in "${VSCO_BANKS[@]}"; do
    ls "$TARGET/${v#*|} - "*.sf2 >/dev/null 2>&1 || continue
    echo "${v%%|*}"
    echo "  License: CC0 1.0    Plan: $(plan_name "$VSCO_TIER")"
    echo "  Source:  https://github.com/sgossner/VSCO-2-CE (VS Chamber Orchestra 2: Community Edition, SFZ)"
    echo "  Author:  Versilian Studios - recorded by Sam Gossner and Simon Dalzell, sample cutting by Elan Hickler / Soundemote."
    echo "           Made into a looped mono SoundFont for Central Pedal by sounds-vsco.py. Free with every Central Pedal"
    echo "           and app, as Versilian asks (the samples are not sold on their own)."
    echo
  done
  echo "General MIDI banks installed with the system (their sounds are sorted into Central Keys or Central Instrument):"
  echo "  FluidR3 GM (Debian package fluid-soundfont-gm) - MIT license, Frank Wen"
  echo "  MuseScore General (Debian package musescore-general-soundfont-small) - MIT license, S. Christian Collins"
} > "$TARGET/CREDITS.txt"

echo
echo "Sound banks ready: $ok of $wanted in $TARGET (credits: $TARGET/CREDITS.txt)"
[ ${#failed[@]} -eq 0 ] || echo "Not fetched (no internet / blocked?): ${failed[*]}  - run this script again later, or add .sf2 files on the Instrument tab."
exit 0

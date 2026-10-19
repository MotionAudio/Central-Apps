#!/bin/bash
# Central Control - make a release that the automatic update checks pick up.
#
#   bash make-release.sh 7.0.0                      # builds release/7.0.0/ with every file + SHA256SUMS
#   GITHUB_TOKEN=... bash make-release.sh 7.0.0 owner/repo   # ...and publishes it as GitHub release v7.0.0
#
# What goes in a release (names matter - the updaters look for them):
#   central-control-source.zip           the Raspberry Pi update (Settings → Software updates → Install)
#   central-usage-<v>-amd64.deb / -x86_64.AppImage / -win-x64.exe / -mac-arm64.dmg / -mac-x64.dmg   Central Control
#   CentralUsage-<v>-win-x64.exe / -mac-arm64.dmg / -mac-x64.dmg / .apk                              Central Usage
#   central-pedal-control-<v>-mac-arm64.dmg / -mac-x64.dmg                                          Central Pedal Control
# (GitHub Actions builds the Windows and Mac installers - .github/workflows/build.yml - and puts them in the
# dist folders before this runs; on a Linux PC this script packs whatever is there.)
#   SHA256SUMS                           checked before anything is installed
# Set the same owner/repo as "Update source" on the Pi (Settings → Software updates) and in Central Usage
# (Help → Check for updates…). A public repository needs no login to read.
set -euo pipefail
cd "$(dirname "$0")"
VER="${1:?usage: make-release.sh <version> [owner/repo]}"; REPO="${2:-}"
OUT="release/$VER"; rm -rf "$OUT"; mkdir -p "$OUT"

# the Pi update: the app sources in a central-control/ folder (no installers, no node_modules)
TMP="$(mktemp -d)"; mkdir -p "$TMP/central-control"
tar --exclude=./release --exclude=./.git --exclude=./.github --exclude=./central-control-desktop/src --exclude=./release-notes --exclude='./*/dist' --exclude='*/node_modules' --exclude='./parts' --exclude='*.zip' --exclude='__pycache__' --exclude=./staging --exclude=./central-usage/native/sounds --exclude=./central-usage/native/build --exclude='./central-usage/native/build-*' --exclude=./central-usage/player-src --exclude=./central-usage/driver-dist --exclude=./central-control-desktop/driver-dist --exclude=./central-control-desktop/native --exclude=./central-control-desktop/sounds --exclude=./central-usage-mobile --exclude=./central-pedal-control-ios --exclude=./central-pedal-control/src --exclude=./central-pedal-control/driver-dist --exclude=./central-pedal-control/node_modules --exclude=./docs -cf - . | tar -xf - -C "$TMP/central-control"
(cd "$TMP" && zip -qr "$OLDPWD/$OUT/central-control-source.zip" central-control)
rm -rf "$TMP"

for f in central-usage/dist/central-usage-* central-usage/dist/CentralUsage-* central-usage/dist/central-pedal-control-* central-pedal-control/dist/central-pedal-control-* central-usage-mobile/dist/CentralUsage-*; do
  [ -f "$f" ] && cp "$f" "$OUT/"
done
(cd "$OUT" && sha256sum -- * > SHA256SUMS)
echo "release files in $OUT:"; ls -la "$OUT"

if [ -n "$REPO" ]; then
  : "${GITHUB_TOKEN:?set GITHUB_TOKEN (a token with contents: write on $REPO) to publish}"
  API="https://api.github.com/repos/$REPO"
  NOTES="${NOTES:-Central Control $VER}"
  REL=$(curl -fsS -X POST -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json" "$API/releases" \
        -d "$(python3 -c 'import json,sys; print(json.dumps({"tag_name":"v"+sys.argv[1],"name":"Central Control "+sys.argv[1],"body":sys.argv[2]}))' "$VER" "$NOTES")")
  UPLOAD=$(echo "$REL" | python3 -c 'import json,sys; print(json.load(sys.stdin)["upload_url"].split("{")[0])')
  for f in "$OUT"/*; do
    echo "uploading $(basename "$f")…"
    curl -fsS -X POST -H "Authorization: Bearer $GITHUB_TOKEN" -H "Content-Type: application/octet-stream" --data-binary @"$f" "$UPLOAD?name=$(basename "$f")" > /dev/null
  done
  echo "published: https://github.com/$REPO/releases/tag/v$VER"
fi

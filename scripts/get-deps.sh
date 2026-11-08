#!/bin/bash
# Fetches Tracktion Engine and the JUCE version it pins, into deps/tracktion_engine.
# The exact commits Motion Studio was built and tested against:
set -euo pipefail
TE_COMMIT=a5e44996f5f08dfa6af5f5d02d900fb3cfa37422
JUCE_COMMIT=7ff644f65d7daa1428c34b9738ebb5c449dc9172
HERE="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$HERE/deps/tracktion_engine"

if [ -f "$DEST/modules/juce/CMakeLists.txt" ]; then
  echo "Tracktion Engine + JUCE already in $DEST"
  exit 0
fi
mkdir -p "$HERE/deps"
rm -rf "$DEST"
echo "==> Tracktion Engine ($TE_COMMIT)"
git init -q "$DEST"
git -C "$DEST" remote add origin https://github.com/Tracktion/tracktion_engine.git
git -C "$DEST" fetch -q --depth 1 origin "$TE_COMMIT"
git -C "$DEST" checkout -q FETCH_HEAD
echo "==> JUCE ($JUCE_COMMIT)"
rm -rf "$DEST/modules/juce"
git init -q "$DEST/modules/juce"
git -C "$DEST/modules/juce" remote add origin https://github.com/juce-framework/JUCE.git
git -C "$DEST/modules/juce" fetch -q --depth 1 origin "$JUCE_COMMIT"
git -C "$DEST/modules/juce" checkout -q FETCH_HEAD
echo "Done."

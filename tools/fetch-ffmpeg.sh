#!/bin/bash
# The ffmpeg that comes with Central Usage (the Video tab's encoder: libx264, SRT, TLS / RTMPS, hardware
# encoders). Pinned builds, checked against their SHA-256 before use:
#   Linux x64, Windows x64: BtbN/FFmpeg-Builds, GPL static, n9.0.2 (month-end build, kept long-term)
#   macOS arm64 / x64:      ffmpeg.martin-riedl.de, static release 9.0.2
# Writes <dest>/ffmpeg[.exe] and <dest>/LICENSE.ffmpeg.txt (GPL v3 + where the source is).
#   bash tools/fetch-ffmpeg.sh <linux-x64|win-x64|mac-arm64|mac-x64> <dest>
# To move to a newer ffmpeg: change the URL and SHA-256 below (BtbN: a month-end autobuild tag; its
# checksums.sha256 lists the files) - the build fails loudly on a wrong checksum.
set -euo pipefail
TARGET="${1:?usage: fetch-ffmpeg.sh <linux-x64|win-x64|mac-arm64|mac-x64> <dest>}"; DEST="${2:?dest folder}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BTBN="https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-09-30-13-08"
MR="https://ffmpeg.martin-riedl.de/download/macos"
case "$TARGET" in
  linux-x64) URL="$BTBN/ffmpeg-n9.0.2-17-g2a571b6068-linux64-gpl-9.0.tar.xz"; SHA=68ee646831adaae2495618346f3bba94ff207ff83bbd34d643e7004730d66269; BIN=ffmpeg; FROM="BtbN/FFmpeg-Builds (https://github.com/BtbN/FFmpeg-Builds, tag autobuild-2026-09-30-13-08), linux64-gpl-9.0" ;;
  win-x64)   URL="$BTBN/ffmpeg-n9.0.2-17-g2a571b6068-win64-gpl-9.0.zip";    SHA=a0e45723c72141975f51d8666302e614711745f3102b704ca3f82c897a58d278; BIN=ffmpeg.exe; FROM="BtbN/FFmpeg-Builds (https://github.com/BtbN/FFmpeg-Builds, tag autobuild-2026-09-30-13-08), win64-gpl-9.0" ;;
  mac-arm64) URL="$MR/arm64/1789931890_9.0.2/ffmpeg.zip"; SHA=c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924; BIN=ffmpeg; FROM="ffmpeg.martin-riedl.de, macOS arm64 release 9.0.2 (build scripts: https://git.martin-riedl.de/ffmpeg/build-script)" ;;
  mac-x64)   URL="$MR/amd64/1789931006_9.0.2/ffmpeg.zip"; SHA=7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4; BIN=ffmpeg; FROM="ffmpeg.martin-riedl.de, macOS x86_64 release 9.0.2 (build scripts: https://git.martin-riedl.de/ffmpeg/build-script)" ;;
  *) echo "unknown target $TARGET" >&2; exit 2 ;;
esac
mkdir -p "$DEST"; TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
curl -fsSL --retry 3 -o "$TMP/pkg" "$URL"
if command -v sha256sum >/dev/null; then GOT=$(sha256sum "$TMP/pkg" | cut -d' ' -f1); else GOT=$(shasum -a 256 "$TMP/pkg" | cut -d' ' -f1); fi
[ "$GOT" = "$SHA" ] || { echo "::error::ffmpeg download for $TARGET has SHA-256 $GOT, expected $SHA ($URL)" >&2; exit 1; }
mkdir -p "$TMP/x"
case "$URL" in *.tar.xz) tar -xf "$TMP/pkg" -C "$TMP/x" ;; *.zip) (cd "$TMP/x" && unzip -q "$TMP/pkg") ;; esac
F="$(find "$TMP/x" -type f -name "$BIN" | head -1)"; [ -n "$F" ] || { echo "no $BIN in $URL" >&2; exit 1; }
cp "$F" "$DEST/$BIN"; chmod +x "$DEST/$BIN"
{
  echo "ffmpeg (https://ffmpeg.org) - included with Central Usage as a separate program for the Video tab."
  echo
  echo "This build: $FROM"
  echo "Downloaded from: $URL"
  echo "SHA-256: $SHA"
  echo
  echo "It is licensed under the GNU General Public License version 3 (it includes GPL components such as"
  echo "libx264); the full text follows. The source code: ffmpeg 9.0.2 from https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz"
  echo "(or https://git.ffmpeg.org/ffmpeg.git, tag n9.0.2), with the build scripts and library versions named above."
  echo "Written offer: for three years from each release, we provide the complete corresponding source of this"
  echo "binary on request - open an issue at https://github.com/MotionAudio/Central-Apps/issues."
  echo
  cat "$ROOT/tools/licenses/GPL-3.0.txt"
} > "$DEST/LICENSE.ffmpeg.txt"
echo "ffmpeg for $TARGET -> $DEST/$BIN ($(du -h "$DEST/$BIN" | cut -f1))"

#!/bin/bash
# Smoke test of the Video tab's helpers (docs/VIDEO-INTEGRATION.md): cu-video answers, lists its audio
# devices, and the bundled ffmpeg encodes H.264 (libx264) and has SRT and TLS.
#   bash tools/smoke-video.sh <folder with cu-video[.exe] and ffmpeg[.exe]>
set -uo pipefail
export LC_ALL=C   # cu-video answers in binary frames: read them byte-wise (macOS tr / grep)
D="${1:?folder}"; EXE=""; case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) EXE=".exe" ;; esac
tmo() { if command -v timeout >/dev/null; then timeout "$@"; else perl -e 'alarm shift; exec @ARGV' "$@"; fi; }
fail() { echo "::error title=video smoke test::$*"; exit 1; }
v=$("$D/cu-video$EXE" version) || fail "cu-video version did not run"
[ "$(echo "$v" | tr -d '\r')" = "cu-video 1" ] || fail "cu-video version printed: $v"
echo "ok  $v"
out=$(printf '{"cmd":"list"}\n{"cmd":"quit"}\n' | tmo 20 "$D/cu-video$EXE" audio | LC_ALL=C tr -d '\0' | head -c 20000)
echo "$out" | grep -aq '"ev":"devices"' || fail "cu-video audio did not list devices: $(echo "$out" | head -c 300)"
echo "ok  cu-video audio lists its devices"
"$D/ffmpeg$EXE" -hide_banner -loglevel error -f lavfi -i testsrc2=size=320x180:rate=30 -frames:v 30 -c:v libx264 -f null - || fail "ffmpeg could not encode with libx264"
echo "ok  ffmpeg encodes H.264 (libx264)"
p=$("$D/ffmpeg$EXE" -hide_banner -protocols 2>/dev/null | tr -d '\r')
for want in srt tls rtmps; do echo "$p" | grep -qx " *$want" || fail "ffmpeg has no $want protocol"; done
echo "ok  ffmpeg has srt, tls, rtmps"
[ -f "$D/LICENSE.ffmpeg.txt" ] || fail "LICENSE.ffmpeg.txt is missing"
echo "VIDEO SMOKE TEST PASSED"

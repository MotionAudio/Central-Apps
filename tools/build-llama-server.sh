#!/bin/bash
# llama-server (llama.cpp) for the lights' AI model (10.0), built from a fixed llama.cpp release for the computer the
# build runs on: one program, no extra libraries, nothing downloaded while it builds (no web page, no HTTPS - it only
# answers on 127.0.0.1), and no CPU tricks that older computers don't have.
#   Linux x64 / Windows x64 / macOS arm64 / macOS x64 (ARCH=arm64|x86_64 on a Mac)
#   llama.cpp tag b11600 (2026-10-13), commit ace20f679e30a39c09a7b17bec14199855469633, MIT licence
# Writes <dest>/llama-server[.exe] and <dest>/LICENSE.llama.cpp.txt. Needs git, cmake and a C++ compiler (the CI
# runners have them: gcc, MSVC, Xcode's clang).
#   bash tools/build-llama-server.sh <dest>
set -euo pipefail
DEST="${1:?usage: build-llama-server.sh <dest>}"
TAG=b11600
COMMIT=ace20f679e30a39c09a7b17bec14199855469633
mkdir -p "$DEST"; DEST="$(cd "$DEST" && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
git -c advice.detachedHead=false clone --quiet --depth 1 --branch "$TAG" https://github.com/ggml-org/llama.cpp "$TMP/src"
GOT="$(git -C "$TMP/src" rev-parse HEAD)"
[ "$GOT" = "$COMMIT" ] || { echo "::error::llama.cpp $TAG is commit $GOT, expected $COMMIT" >&2; exit 1; }
EXTRA=()
case "$(uname -s)" in
  Darwin)
    A="${ARCH:-$(uname -m)}"; EXTRA+=(-DCMAKE_OSX_ARCHITECTURES="$A" -DCMAKE_OSX_DEPLOYMENT_TARGET=11.0)
    [ "$A" = arm64 ] || EXTRA+=(-DGGML_METAL=OFF) ;;   # (Intel Macs: the CPU is plenty for a 0.5B model)
  MINGW*|MSYS*|CYGWIN*) EXTRA+=(-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded) ;;   # (the C++ runtime inside the .exe)
esac
cmake -S "$TMP/src" -B "$TMP/build" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF \
  -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF -DLLAMA_BUILD_SERVER=ON -DLLAMA_BUILD_UI=OFF -DLLAMA_USE_PREBUILT_UI=OFF \
  -DLLAMA_OPENSSL=OFF -DLLAMA_CURL=OFF ${EXTRA[@]+"${EXTRA[@]}"} >/dev/null
cmake --build "$TMP/build" --config Release --target llama-server -j 4 >/dev/null
BIN="$(find "$TMP/build" -type f \( -name llama-server -o -name llama-server.exe \) | head -1)"
[ -n "$BIN" ] || { echo "::error::llama-server was not built" >&2; exit 1; }
cp "$BIN" "$DEST/"; chmod +x "$DEST/$(basename "$BIN")"
{ echo "llama.cpp (https://github.com/ggml-org/llama.cpp), tag $TAG, commit $COMMIT - llama-server, included with"
  echo "Central Control to run the lights' AI model on this computer."; echo; cat "$TMP/src/LICENSE"; } > "$DEST/LICENSE.llama.cpp.txt"
"$DEST/$(basename "$BIN")" --version 2>&1 | head -3 || true
echo "llama-server: $DEST/$(basename "$BIN") ($(wc -c < "$DEST/$(basename "$BIN")" | tr -d ' ') bytes)"

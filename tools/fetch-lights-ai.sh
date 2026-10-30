#!/bin/bash
# The lights' AI model that comes with Central Control (10.0): the Lighting tab's "Tell it the show" box uses it to
# read freer sentences. It runs on the computer itself (llama-server, tools/build-llama-server.sh), nothing goes online.
#   Qwen2.5 0.5B Instruct, GGUF, Q4_K_M quantisation - 491,400,032 bytes (about 470 MB), Apache License 2.0
#   from huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF at a fixed revision, checked against its SHA-256
# Writes <dest>/qwen2.5-0.5b-instruct-q4_k_m.gguf and <dest>/LICENSE.model.txt. A file already there with the right
# checksum is kept (the CI cache).
#   bash tools/fetch-lights-ai.sh <dest>
# To move to another model: change NAME, URL, SHA and SIZE below and MODEL in central-usage/services.js.
set -euo pipefail
DEST="${1:?usage: fetch-lights-ai.sh <dest>}"
NAME="qwen2.5-0.5b-instruct-q4_k_m.gguf"
REV="9217f5db79a29953eb74d5343926648285ec7e67"
URL="https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/$REV/$NAME"
LIC="https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/$REV/LICENSE"
SHA=74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db
SIZE=491400032
sum() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
mkdir -p "$DEST"
if [ -f "$DEST/$NAME" ] && [ "$(sum "$DEST/$NAME")" = "$SHA" ]; then echo "lights AI model: already here ($NAME)"; else
  curl -fsSL --retry 4 --retry-delay 5 -o "$DEST/$NAME.part" "$URL"
  GOT="$(sum "$DEST/$NAME.part")"
  [ "$GOT" = "$SHA" ] || { rm -f "$DEST/$NAME.part"; echo "::error::the lights AI model has SHA-256 $GOT, expected $SHA ($URL)" >&2; exit 1; }
  mv "$DEST/$NAME.part" "$DEST/$NAME"
fi
[ "$(wc -c < "$DEST/$NAME" | tr -d ' ')" = "$SIZE" ] || { echo "::error::the lights AI model is not $SIZE bytes" >&2; exit 1; }
{
  echo "Qwen2.5-0.5B-Instruct (GGUF, Q4_K_M) by the Qwen team, Alibaba Cloud - included with Central Control for the"
  echo "Lighting tab's \"Tell it the show\". It runs on this computer; nothing is sent anywhere."
  echo
  echo "Downloaded from: $URL"
  echo "SHA-256: $SHA"
  echo
  curl -fsSL --retry 3 "$LIC" || echo "Apache License 2.0 - https://www.apache.org/licenses/LICENSE-2.0"
} > "$DEST/LICENSE.model.txt"
echo "lights AI model: $DEST/$NAME ($SIZE bytes)"

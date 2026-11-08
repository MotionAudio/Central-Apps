#!/bin/bash
# Builds Motion Studio for your Mac (Apple Silicon and Intel in one app) and makes a .dmg.
#
#   bash scripts/build-mac.sh
#
# Needs: the Xcode Command Line Tools (the script asks macOS to install them if they're missing) and an internet
# connection the first time. The first build takes 20-40 minutes; later builds only rebuild what changed.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

if ! xcode-select -p >/dev/null 2>&1; then
  echo "Installing the Xcode Command Line Tools - finish that window, then run this script again."
  xcode-select --install || true
  exit 1
fi

# cmake + ninja without Homebrew: a private Python environment in .tools
if ! command -v cmake >/dev/null 2>&1 || ! command -v ninja >/dev/null 2>&1; then
  if [ ! -x .tools/bin/cmake ]; then
    echo "==> Getting cmake and ninja"
    python3 -m venv .tools
    .tools/bin/pip install --quiet --upgrade pip
    .tools/bin/pip install --quiet cmake ninja
  fi
  export PATH="$ROOT/.tools/bin:$PATH"
fi

bash scripts/get-deps.sh

ARCHS="${ARCHS:-arm64;x86_64}"
echo "==> Configuring ($ARCHS)"
cmake -S . -B build-mac -G Ninja -DCMAKE_BUILD_TYPE=Release \
      -DTE_DIR="$ROOT/deps/tracktion_engine" -DCMAKE_OSX_ARCHITECTURES="$ARCHS" -DCMAKE_OSX_DEPLOYMENT_TARGET=12.0
echo "==> Building (this is the long part)"
cmake --build build-mac --config Release

APP="build-mac/MotionStudio_artefacts/Release/Motion Studio.app"
[ -d "$APP" ] || { echo "Build failed: no app at $APP"; exit 1; }
# ad-hoc signature so Apple Silicon runs it
codesign --force --deep --sign - "$APP"

echo "==> Making the .dmg"
rm -rf build-mac/dmg && mkdir -p build-mac/dmg
cp -R "$APP" build-mac/dmg/
ln -s /Applications build-mac/dmg/Applications
rm -f "MotionStudio.dmg"
hdiutil create -volname "Motion Studio" -srcfolder build-mac/dmg -ov -format UDZO "MotionStudio.dmg" >/dev/null

echo
echo "Done: $ROOT/MotionStudio.dmg"
echo "Open it and drag Motion Studio into Applications. (Or run the app straight from $APP)"

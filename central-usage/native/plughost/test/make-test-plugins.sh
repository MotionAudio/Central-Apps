#!/bin/bash
# Build the test plugins for the plugin host's checks (never shipped) into <out>/test-plugins:
#   central-test.clap, crash-test.clap (CLAP, plain C), central-test.vst3 (VST3: a bundle, or one file on Windows)
#   bash plughost/test/make-test-plugins.sh <out> [linux|win|mac] [extra compiler flags, e.g. "-arch arm64"]
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"; NATIVE="$HERE/../.."; OUT="$1/test-plugins"; T="${2:-linux}"; FLAGS="$3"
mkdir -p "$OUT"
V="$NATIVE/vendor/vst3sdk"; VSRC="$HERE/test-vst3.cpp $V/pluginterfaces/base/funknown.cpp $V/pluginterfaces/base/coreiids.cpp $V/public.sdk/source/vst/vstinitiids.cpp"
case "$T" in
  win)
    CC=${CC:-x86_64-w64-mingw32-gcc}; CXX=${CXX:-x86_64-w64-mingw32-g++}
    $CC -shared -O2 -o "$OUT/central-test.clap" "$HERE/test-plugins.c" -lm -static
    $CC -shared -O2 -DCENTRAL_TEST_CRASH -o "$OUT/crash-test.clap" "$HERE/test-plugins.c" -lm -static
    $CXX -shared -O2 -std=c++17 -w -I"$V" -o "$OUT/central-test.vst3" $VSRC -static -lole32 ;;
  mac)
    cc -bundle -O2 $FLAGS -mmacosx-version-min=11.0 -o "$OUT/central-test.clap" "$HERE/test-plugins.c"
    cc -bundle -O2 $FLAGS -mmacosx-version-min=11.0 -DCENTRAL_TEST_CRASH -o "$OUT/crash-test.clap" "$HERE/test-plugins.c"
    B="$OUT/central-test.vst3/Contents"; mkdir -p "$B/MacOS"
    c++ -bundle -O2 -std=c++17 -w $FLAGS -mmacosx-version-min=11.0 -I"$V" -o "$B/MacOS/central-test" $VSRC -framework CoreFoundation
    printf '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>CFBundleExecutable</key><string>central-test</string><key>CFBundleIdentifier</key><string>audio.motion.central-test-vst3</string><key>CFBundlePackageType</key><string>BNDL</string><key>CFBundleName</key><string>central-test</string></dict></plist>\n' > "$B/Info.plist" ;;
  *)
    CC=${CC:-cc}; CXX=${CXX:-c++}; A="$(uname -m)-linux"
    $CC -shared -fPIC -O2 -o "$OUT/central-test.clap" "$HERE/test-plugins.c" -lm
    $CC -shared -fPIC -O2 -DCENTRAL_TEST_CRASH -o "$OUT/crash-test.clap" "$HERE/test-plugins.c" -lm
    mkdir -p "$OUT/central-test.vst3/Contents/$A"
    $CXX -shared -fPIC -O2 -std=c++17 -w -I"$V" -o "$OUT/central-test.vst3/Contents/$A/central-test.so" $VSRC ;;
esac
echo "test plugins: $OUT"

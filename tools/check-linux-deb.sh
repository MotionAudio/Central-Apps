#!/usr/bin/env bash
# check-linux-deb.sh <file.deb> <window name>
# A Linux package must show its logo in the app menu and the dock:
#  - the logo in the sizes the hicolor theme has (it has no 1024x1024 folder: a lone 1024 icon shows up blank)
#  - the menu entry's Icon= is that logo, and StartupWMClass= is the app's window name (Electron's WM_CLASS)
set -euo pipefail
DEB="$1"; WM="$2"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
dpkg-deb -x "$DEB" "$T"
D="$(ls "$T"/usr/share/applications/*.desktop | head -1)"
[ -f "$D" ] || { echo "::error::$DEB has no menu entry"; exit 1; }
ICON="$(sed -n 's/^Icon=//p' "$D")"
for s in 16 32 48 64 128 256 512; do
  f="$T/usr/share/icons/hicolor/${s}x${s}/apps/$ICON.png"
  [ -f "$f" ] || { echo "::error::$DEB: no ${s}x${s} logo ($ICON.png): Linux menus would show a blank icon"; exit 1; }
  got="$(python3 -c "import struct,sys;d=open(sys.argv[1],'rb').read(24);print('%dx%d'%struct.unpack('>II',d[16:24]))" "$f")"
  [ "$got" = "${s}x${s}" ] || { echo "::error::$DEB: the ${s}x${s} logo is $got"; exit 1; }
done
grep -qx "StartupWMClass=$WM" "$D" || { echo "::error::$DEB: the menu entry should say StartupWMClass=$WM (it says $(grep StartupWMClass "$D" || echo nothing)), or the dock can't match the window"; exit 1; }
echo "$(basename "$DEB"): logo in every size, menu entry matches the \"$WM\" window"

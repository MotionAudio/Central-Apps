#!/usr/bin/env bash
# Install (or update) a Central app on Linux with one line:
#   curl -fsSL https://motionaudio.github.io/Central-Apps/install.sh | bash -s control
# Apps: control (Central Control), usage (Central Usage), pedal-control (Central Pedal Control), services (Central Services).
# No app named: it asks. Ubuntu, Debian, Mint, Pop!_OS…: the newest .deb, installed with apt (it brings what the app needs).
# Other Linux: the AppImage in ~/Applications, with a menu entry. Every download is checked against the release's SHA256SUMS.
set -euo pipefail

REPO="MotionAudio/Central-Apps"
PAGE="https://motionaudio.github.io/Central-Apps"
say() { printf '\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

# ---- which app
APP="${1:-}"
if [ -z "$APP" ]; then
  if [ -r /dev/tty ]; then
    echo "Which app?"
    echo "  1) Central Control        the main admin and admins: lighting, mix, in-ears, slides, lyrics"
    echo "  2) Central Usage          musicians and singers: chord chart, instrument, lyrics, your in-ear mix"
    echo "  3) Central Pedal Control  get the Central Pedal ready: songs, tracks, pads"
    echo "  4) Central Services       the church's schedule"
    printf "Type 1-4: "; read -r n < /dev/tty
    case "$n" in 1) APP=control ;; 2) APP=usage ;; 3) APP=pedal-control ;; 4) APP=services ;; *) fail "Nothing installed." ;; esac
  else fail "Say which app: ... | bash -s control   (or usage, pedal-control, services)"; fi
fi
case "$APP" in
  control|central-control)         NAME="Central Control";       PREFIXES="CentralControl central-usage"; ICON=central-control; BIN=central-usage ;;
  usage|central-usage)             NAME="Central Usage";         PREFIXES="CentralUsage";                 ICON=central-usage;   BIN=centralusage ;;
  pedal-control|central-pedal-control) NAME="Central Pedal Control"; PREFIXES="central-pedal-control";    ICON=central-pedal-control; BIN=central-pedal-control ;;
  services|central-services)       NAME="Central Services";      PREFIXES="central-services";             ICON=central-services; BIN=central-services ;;
  *) fail "Unknown app \"$APP\": use control, usage, pedal-control or services." ;;
esac

# ---- this computer
case "$(uname -m)" in x86_64|amd64) ;; *) fail "$NAME is made for 64-bit Intel / AMD computers (this one is $(uname -m))." ;; esac
command -v curl >/dev/null || fail "curl is needed: sudo apt install curl"
SUDO=""; if [ "$(id -u)" != 0 ]; then command -v sudo >/dev/null && SUDO="sudo" || fail "Run it as root, or install sudo."; fi
DEB=0; command -v apt-get >/dev/null && command -v dpkg >/dev/null && DEB=1

# ---- the newest release
say "Looking for the newest $NAME…"
JSON="$(curl -fsSL -H 'Accept: application/vnd.github+json' "https://api.github.com/repos/$REPO/releases/latest")" || fail "Couldn't reach GitHub. Check the internet connection and try again."
urls() { printf '%s' "$JSON" | grep -o '"browser_download_url": *"[^"]*"' | sed 's/.*"\(https[^"]*\)"/\1/'; }
pick() {   # pick <ending>: the first file of this app (newest name first) that ends like that
  local p u; for p in $PREFIXES; do u="$(urls | grep -E "/${p}-[0-9][^/]*$1\$" | head -1)"; [ -n "$u" ] && { echo "$u"; return; }; done
}
if [ "$DEB" = 1 ]; then URL="$(pick '-amd64\.deb')"; else URL="$(pick '-x86_64\.AppImage')"; fi
[ -n "$URL" ] || fail "This release has no $NAME for this computer yet. See $PAGE"
FILE="$(basename "$URL")"; VER="$(printf '%s' "$FILE" | sed -E 's/^[A-Za-z-]+-([0-9][0-9.]*)-.*/\1/')"
SUMS="$(urls | grep '/SHA256SUMS$' | head -1)"

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
say "Downloading $NAME $VER…"
curl -fL --progress-bar -o "$TMP/$FILE" "$URL" || fail "The download stopped. Try again."
if [ -n "$SUMS" ]; then
  want="$(curl -fsSL "$SUMS" | awk -v f="$FILE" '$2 == f || $2 == "*"f {print $1}')"
  got="$(sha256sum "$TMP/$FILE" | cut -d' ' -f1)"
  [ -n "$want" ] && [ "$want" != "$got" ] && fail "The download doesn't match the release (checksum). Nothing was installed; try again."
fi

if [ "$DEB" = 1 ]; then
  say "Installing (it may ask for your password)…"
  chmod 644 "$TMP/$FILE"; chmod 755 "$TMP"   # (apt reads the file as its own user)
  $SUDO apt-get update -qq || true
  $SUDO apt-get install -y "$TMP/$FILE" || fail "apt couldn't install it. The message above says why."
  say "Done. Open $NAME from your app menu (or type $BIN)."
else
  # any other Linux: the AppImage, a menu entry and its icon
  DIR="$HOME/Applications"; mkdir -p "$DIR" "$HOME/.local/share/applications" "$HOME/.local/share/icons/hicolor/256x256/apps"
  rm -f "$DIR/$ICON".AppImage; mv "$TMP/$FILE" "$DIR/$ICON.AppImage"; chmod +x "$DIR/$ICON.AppImage"
  curl -fsSL -o "$HOME/.local/share/icons/hicolor/256x256/apps/$ICON.png" "$PAGE/brand/$ICON.png" || true
  cat > "$HOME/.local/share/applications/$ICON.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=$NAME
Exec="$DIR/$ICON.AppImage" %U
Icon=$ICON
Categories=AudioVideo;Audio;Music;
Terminal=false
EOF
  command -v update-desktop-database >/dev/null && update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
  if ! ldconfig -p 2>/dev/null | grep -q 'libfuse\.so\.2'; then echo "Note: AppImages need FUSE 2 (on Fedora: sudo dnf install fuse-libs; on Arch: sudo pacman -S fuse2)."; fi
  say "Done. Open $NAME from your app menu. It updates itself from now on."
fi

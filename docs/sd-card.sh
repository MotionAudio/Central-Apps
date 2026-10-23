#!/usr/bin/env bash
# Make a Central Pedal SD card on an Ubuntu / Debian PC, with one line in the Terminal:
#   curl -fsSL https://motionaudio.github.io/Central-Apps/sd-card.sh | sudo bash
# It asks a few questions (Wi-Fi, which small touch screen, the pedal's key), downloads the newest Central Pedal,
# builds the card image (central-pedal-<version>.img) and writes it to the SD card you pick. Run it again any time:
# the Raspberry Pi OS download is kept, so the next card is quicker.
set -euo pipefail

REPO="MotionAudio/Central-Apps"
say()  { printf '\n\033[1;32m%s\033[0m\n' "$*"; }
note() { printf '   %s\n' "$*"; }
fail() { printf '\n\033[1;31m%s\033[0m\n' "$*" >&2; exit 1; }
ask()  { local q="$1" def="${2:-}" a; printf '%s' "$q" > /dev/tty; IFS= read -r a < /dev/tty || true; printf '%s' "${a:-$def}"; }

[ "$(id -u)" -eq 0 ] || fail "Run it with sudo:   curl -fsSL https://motionaudio.github.io/Central-Apps/sd-card.sh | sudo bash"
[ -r /dev/tty ] || fail "Run it in a Terminal window (it asks a few questions)."
command -v apt-get >/dev/null || fail "This needs Ubuntu or Debian (or Raspberry Pi OS)."
USER_HOME="$(getent passwd "${SUDO_USER:-root}" | cut -d: -f6)"; USER_HOME="${USER_HOME:-/root}"
WORK="${CENTRAL_PEDAL_SD:-$USER_HOME/central-pedal-sd}"
mkdir -p "$WORK"

printf '\n\033[1mCentral Pedal SD card\033[0m\n'
note "This takes about 45 minutes the first time (about 20 after that) and needs about 15 GB free."
note "Files go in $WORK"
free_gb=$(df -BG --output=avail "$WORK" | tail -1 | tr -dc 0-9)
[ "${free_gb:-0}" -ge "${MIN_GB:-14}" ] || fail "Only ${free_gb} GB free in $WORK - it needs about 15 GB. Free some space and run it again."

# ---- questions
say "1/4  Wi-Fi"
WIFI_SSID="$(ask '   The church Wi-Fi name (Enter = set it on the pedal later): ')"
WIFI_PASS=""
if [ -n "$WIFI_SSID" ]; then
  printf '   Its password: ' > /dev/tty; stty -echo < /dev/tty; IFS= read -r WIFI_PASS < /dev/tty || true; stty echo < /dev/tty; printf '\n' > /dev/tty
fi

say "2/4  The small touch screen on the pedal"
note "1) The blue 3.5\" screen with \"XPT2046\" on the back (most common)"
note "2) Waveshare 3.5\" (A)"
note "3) None, or I'll pick it on the pedal later"
case "$(ask '   Type 1, 2 or 3 [1]: ' 1)" in 2) TFT=waveshare35a ;; 3) TFT=none ;; *) TFT=piscreen ;; esac

say "3/4  The pedal's key (optional)"
PEDAL_KEY="$(ask '   Its P key, like PXXX-XXXX-XXXX-XXXX (Enter = type it on the pedal later): ' | tr '[:lower:]' '[:upper:]' | tr -d ' ')"

say "4/4  Keys sounds"
note "1) All of them, with the grand piano (the card needs 32 GB)"
note "2) Without the big grand piano (16 GB card is enough)"
case "$(ask '   Type 1 or 2 [1]: ' 1)" in 2) SOUNDS=small ;; *) SOUNDS=full ;; esac

# ---- the newest Central Pedal
say "Downloading the newest Central Pedal"
apt-get install -y -qq curl unzip ca-certificates >/dev/null
API="https://api.github.com/repos/$REPO/releases/latest"
REL="$(curl -fsSL "$API")" || fail "Couldn't reach GitHub - is this PC online?"
TAG="$(printf '%s' "$REL" | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')"
ZIP_URL="https://github.com/$REPO/releases/download/$TAG/central-control-source.zip"
SUMS_URL="https://github.com/$REPO/releases/download/$TAG/SHA256SUMS"
note "Version ${TAG#v}"
curl -fL --progress-bar -o "$WORK/central-pedal-source.zip" "$ZIP_URL" || fail "The download didn't work - try again in a minute."
if curl -fsSL -o "$WORK/SHA256SUMS" "$SUMS_URL"; then
  want="$(grep ' central-control-source.zip$' "$WORK/SHA256SUMS" | cut -d' ' -f1 || true)"
  have="$(sha256sum "$WORK/central-pedal-source.zip" | cut -d' ' -f1)"
  [ -z "$want" ] || [ "$want" = "$have" ] || fail "The download is damaged (checksum doesn't match). Run it again."
fi
rm -rf "$WORK/source"; mkdir -p "$WORK/source"
unzip -q "$WORK/central-pedal-source.zip" -d "$WORK/source"
SRC="$(dirname "$(find "$WORK/source" -name build-image.sh -print -quit)")"
[ -f "$SRC/build-image.sh" ] || fail "That download doesn't have the image builder in it."
VER="${TAG#v}"
IMG="$WORK/central-pedal-$VER.img"

# ---- build (skipped when this version's image is already here)
if [ -f "$IMG" ] && [ "${REBUILD:-0}" != 1 ]; then
  say "central-pedal-$VER.img is already built - using it (REBUILD=1 makes a new one)"
else
  say "Building central-pedal-$VER.img (the long part - leave this window open)"
  rm -f "$WORK"/central-pedal-*.img   # (an older version's image never gets written by mistake)
  WIFI_SSID="$WIFI_SSID" WIFI_PASS="$WIFI_PASS" TFT="$TFT" PEDAL_KEY="$PEDAL_KEY" SOUNDS="$SOUNDS" \
    OUT="$IMG" CACHE="$WORK/cache" bash "$SRC/build-image.sh" > "$WORK/build.log" 2>&1 &
  pid=$!
  spin='|/-\'; i=0; t0=$(date +%s)
  while kill -0 "$pid" 2>/dev/null; do
    step="$(grep -E '^.\[1;32m==>' "$WORK/build.log" 2>/dev/null | tail -1 | sed -E 's/.*==> //; s/\x1b\[[0-9;]*m//g' | cut -c1-60 || true)"
    printf '\r   %s  %3d min  %-60s' "${spin:i++%4:1}" $(( ($(date +%s) - t0) / 60 )) "${step:-starting}" > /dev/tty
    sleep 2
  done
  printf '\n' > /dev/tty
  wait "$pid" || { tail -n 25 "$WORK/build.log"; fail "The build stopped - the lines above say why (all of it: $WORK/build.log)."; }
  [ -f "$IMG" ] || fail "The build finished but there's no image - see $WORK/build.log"
fi

# ---- write it to the SD card
say "Put the SD card in this PC (a card reader is fine), then press Enter"
ask '' >/dev/null
# removable disks only (a card reader, USB, the SD slot), never this PC's own disk
mapfile -t CARDS < <(lsblk -J -d -p -o NAME,SIZE,TRAN,RM,MODEL,TYPE | python3 -c '
import json, sys
for d in json.load(sys.stdin).get("blockdevices", []):
    name, tran, rm = d.get("name") or "", (d.get("tran") or ""), d.get("rm")
    if d.get("type") != "disk" or any(x in name for x in ("loop", "zram", "/dev/sr", "/dev/nvme")):
        continue
    if rm in (True, "1", 1) or tran in ("usb", "mmc") or "mmcblk" in name:
        print("%s  %s  %s %s" % (name, d.get("size") or "", (d.get("model") or "").strip(), "(" + tran + ")" if tran else ""))
')
ROOTDEV="$(lsblk -no PKNAME "$(findmnt -no SOURCE /)" 2>/dev/null || true)"
if [ "${#CARDS[@]}" -eq 0 ]; then
  say "No SD card found."
  note "The image is ready: $IMG"
  note "Write it with Raspberry Pi Imager (sudo apt install rpi-imager): Choose OS -> Use custom -> this file."
  exit 0
fi
note "Cards and USB drives:"
n=0; for c in "${CARDS[@]}"; do n=$((n + 1)); printf '   %d) %s\n' "$n" "$c" > /dev/tty; done
pick="$(ask "   Which one is the SD card? Type 1-$n (Enter = don't write, keep the image): ")"
[ -n "$pick" ] || { note "Not written. The image is here: $IMG"; exit 0; }
[[ "$pick" =~ ^[0-9]+$ ]] && [ "$pick" -ge 1 ] && [ "$pick" -le "$n" ] || fail "That's not one of the numbers."
DEV="$(printf '%s' "${CARDS[$((pick - 1))]}" | awk '{print $1}')"
[ -n "$ROOTDEV" ] && [ "$DEV" = "/dev/$ROOTDEV" ] && fail "$DEV is this PC's own disk - not writing to it."
printf '\n\033[1;31m   Everything on %s will be erased.\033[0m\n' "$(printf '%s' "${CARDS[$((pick - 1))]}" | sed 's/  */ /g')" > /dev/tty
[ "$(ask '   Type ERASE to write the card: ')" = "ERASE" ] || { note "Not written. The image is here: $IMG"; exit 0; }
for part in $(lsblk -lnpo NAME "$DEV" | tail -n +2); do umount "$part" 2>/dev/null || true; done
say "Writing the card (a few minutes)"
dd if="$IMG" of="$DEV" bs=4M status=progress conv=fsync
sync
command -v eject >/dev/null && eject "$DEV" 2>/dev/null || true
say "Done - the card is ready."
note "Put it in the Raspberry Pi 4 and plug in the power. The first start takes about a minute longer"
note "and restarts once; after that it goes straight into Central Pedal."
[ -z "$WIFI_SSID" ] && note "It asks for the Wi-Fi on its screen the first time."
note "Next card: run the same line again."

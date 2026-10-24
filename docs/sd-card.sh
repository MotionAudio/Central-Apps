#!/usr/bin/env bash
# Make a Central Pedal SD card on an Ubuntu / Debian PC, with one line in the Terminal:
#   curl -fsSL https://motionaudio.github.io/Central-Apps/sd-card.sh | sudo bash
# No questions: put the SD card in, pick it, type ERASE. It downloads the newest Central Pedal, builds the card
# (central-pedal-<version>.img, with as many sounds as the card holds) and writes it. The pedal sets itself up from a
# phone the first time it starts (Wi-Fi, touch screen, 4-digit code). Run it again any time: the Raspberry Pi OS
# download is kept, so the next card is quicker.
set -euo pipefail

REPO="MotionAudio/Central-Apps"
say()  { printf '\n\033[1;32m%s\033[0m\n' "$*"; }
note() { printf '   %s\n' "$*"; }
fail() { printf '\n\033[1;31m%s\033[0m\n' "$*" >&2; FAILED=1; exit 1; }
# never stop without saying why
trap 'rc=$?; [ "$rc" -ne 0 ] && [ -z "${FAILED:-}" ] && printf "\n\033[1;31mThe SD card maker stopped (line %s, code %s). Run the line again; if it stops at the same place, send a photo of this window.\033[0m\n" "$LINENO" "$rc" >&2' EXIT
ask()  { local q="$1" def="${2:-}" a; printf '%s' "$q" > /dev/tty; IFS= read -r a < /dev/tty || true; printf '%s' "${a:-$def}"; }

[ "$(id -u)" -eq 0 ] || fail "Run it with sudo:   curl -fsSL https://motionaudio.github.io/Central-Apps/sd-card.sh | sudo bash"
[ -r /dev/tty ] || fail "Run it in a Terminal window."
command -v apt-get >/dev/null || fail "This needs Ubuntu or Debian (or Raspberry Pi OS)."
USER_HOME="$(getent passwd "${SUDO_USER:-root}" | cut -d: -f6)"; USER_HOME="${USER_HOME:-/root}"
WORK="${CENTRAL_PEDAL_SD:-$USER_HOME/central-pedal-sd}"
mkdir -p "$WORK"

printf '\n\033[1mCentral Pedal SD card\033[0m\n'
note "About 45 minutes the first time (about 20 after that). It needs about 15 GB free on this PC."
free_gb=$(df -BG --output=avail "$WORK" | tail -1 | tr -dc 0-9)
[ "${free_gb:-0}" -ge "${MIN_GB:-14}" ] || fail "Only ${free_gb} GB free in $WORK - it needs about 15 GB. Free some space and run it again."

# ---- the SD card first (then the long part runs by itself)
say "Put the SD card in this PC (a card reader is fine), then press Enter"
ask '' >/dev/null
# removable disks only (a card reader, USB, the SD slot), never this PC's own disk
mapfile -t CARDS < <(lsblk -J -b -d -p -o NAME,SIZE,TRAN,RM,MODEL,TYPE | python3 -c '
import json, sys
for d in json.load(sys.stdin).get("blockdevices", []):
    name, tran, rm = d.get("name") or "", (d.get("tran") or ""), d.get("rm")
    if d.get("type") != "disk" or any(x in name for x in ("loop", "zram", "/dev/sr", "/dev/nvme")):
        continue
    size = int(d.get("size") or 0)
    if size and (rm in (True, "1", 1) or tran in ("usb", "mmc") or "mmcblk" in name):
        print("%s %d %.0f GB  %s" % (name, size, size / 1e9, (d.get("model") or "").strip()))
')
ROOTDEV="$(lsblk -no PKNAME "$(findmnt -no SOURCE /)" 2>/dev/null || true)"
[ "${#CARDS[@]}" -gt 0 ] || fail "No SD card found. Put it in (or try another card reader) and run the line again."
if [ "${#CARDS[@]}" -eq 1 ]; then
  pick=1
else
  note "Cards and USB drives:"
  n=0; for c in "${CARDS[@]}"; do n=$((n + 1)); printf '   %d) %s\n' "$n" "$(printf '%s' "$c" | cut -d' ' -f1,3-)" > /dev/tty; done
  pick="$(ask "   Which one is the SD card? Type 1-$n: ")"
  [[ "$pick" =~ ^[0-9]+$ ]] && [ "$pick" -ge 1 ] && [ "$pick" -le "$n" ] || fail "That's not one of the numbers."
fi
CARD="${CARDS[$((pick - 1))]}"
DEV="$(printf '%s' "$CARD" | cut -d' ' -f1)"; BYTES="$(printf '%s' "$CARD" | cut -d' ' -f2)"; LABEL="$(printf '%s' "$CARD" | cut -d' ' -f3-)"
[ -n "$ROOTDEV" ] && [ "$DEV" = "/dev/$ROOTDEV" ] && fail "$DEV is this PC's own disk - not writing to it."
# the sounds: all of them on a 32 GB card or bigger, without the big grand piano on a 16 GB one
if [ "$BYTES" -ge 28000000000 ]; then SOUNDS=full; SUFFIX=""
elif [ "$BYTES" -ge 14000000000 ]; then SOUNDS=small; SUFFIX="-16gb"
else fail "That card is $LABEL - Central Pedal needs a 16 GB card or bigger (32 GB holds every sound)."; fi
printf '\n\033[1;31m   Everything on %s (%s) will be erased.\033[0m\n' "$DEV" "$LABEL" > /dev/tty
[ "$(ask '   Type ERASE to make the Central Pedal card: ')" = "ERASE" ] || fail "Nothing was changed."
note "Leave the card in. The rest runs by itself."

# ---- the newest Central Pedal
say "Downloading the newest Central Pedal"
apt-get install -y -qq curl unzip ca-certificates >/dev/null
API="https://api.github.com/repos/$REPO/releases/latest"
REL="$(curl -fsSL "$API")" || fail "Couldn't reach GitHub - is this PC online?"
# (grep -m1 stops reading early: under pipefail that used to end the whole script without a word)
TAG="$(printf '%s' "$REL" | python3 -c 'import json, sys; print(json.load(sys.stdin).get("tag_name", ""))' 2>/dev/null || true)"
[ -n "$TAG" ] || fail "Couldn't read the newest version from GitHub - try again in a minute."
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
IMG="$WORK/central-pedal-$VER$SUFFIX.img"

# ---- build (skipped when this version's image is already here)
if [ -f "$IMG" ] && [ "${REBUILD:-0}" != 1 ]; then
  say "$(basename "$IMG") is already built - using it (REBUILD=1 makes a new one)"
else
  say "Building $(basename "$IMG") (the long part - leave this window open)"
  find "$WORK" -maxdepth 1 -name "central-pedal-*.img" ! -name "central-pedal-$VER*.img" -delete   # (an older version's image never gets written by mistake)
  TFT=none SOUNDS="$SOUNDS" \
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
while [ ! -b "$DEV" ]; do
  say "The SD card isn't there any more - put it back in and press Enter"; ask '' >/dev/null
done
for part in $(lsblk -lnpo NAME "$DEV" | tail -n +2); do umount "$part" 2>/dev/null || true; done
say "Writing the card (a few minutes)"
dd if="$IMG" of="$DEV" bs=4M status=progress conv=fsync
sync
command -v eject >/dev/null && eject "$DEV" 2>/dev/null || true
say "Done - the card is ready."
note "1. Put it in the Raspberry Pi and plug in the power (the first start takes a couple of minutes)."
note "2. On your phone, join the Wi-Fi \"Central Pedal Setup\". The setup page opens by itself"
note "   (or go to http://10.42.0.1)."
note "3. Pick the church Wi-Fi, the touch screen and the 4-digit code, then Upload."
note "Next card: run the same line again."

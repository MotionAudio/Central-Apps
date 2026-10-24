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
# ---- progress bars: the whole build (by its steps, with the time left) and each download (MB done of MB total)
progress_build() {   # pid log workdir srcdir sounds
  python3 - "$@" > /dev/tty 2>/dev/null <<'PY' || true
import os, re, subprocess, sys, time, shutil
pid, log, work, src, sounds = int(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
# rough minutes per step on a first build (the bar moves by these; the time left is measured as it goes)
W = [("Checking build tools", 1), ("Installing:", 2), ("Downloading Raspberry Pi OS", 4), ("Using cached download", 0.1), ("Unpacking base image", 2),
     ("Fetching the free keyboard sound banks", 4 if sounds == "small" else 9), ("Making room", 1), ("Mounting image", 0.3), ("No FAT driver", 0.1),
     ("Installing Central Pedal inside the image", 25), ("Sanity-checking", 0.5), ("Cleaning up", 2), ("Compressing", 3), ("Done", 0)]
TOTAL = sum(w for _, w in W if not _.startswith(("Using cached", "Installing:", "No FAT", "Compressing")))
ansi = re.compile(r"\x1b\[[0-9;]*m")
totals = {}
def url_for(part):
    name = os.path.basename(part)[:-5]
    try:
        if name.startswith("raspios"):
            m = re.search(r'BASE_URL="\$\{BASE_URL:-([^}]+)\}"', open(os.path.join(src, "build-image.sh")).read()); return m and m.group(1)
        for f in ("get-sounds.sh", "sounds-vsco.py"):
            for u in re.findall(r'https?://[^\s"|\']+', open(os.path.join(src, f)).read()):
                if u.rstrip("/").endswith("/" + name): return u
    except OSError:
        pass
    return None
def total_of(part):
    if part not in totals:
        totals[part] = 0
        u = url_for(part)
        if u:
            try:
                h = subprocess.run(["curl", "-sIL", "--max-time", "15", u], capture_output=True, text=True).stdout
                v = [int(x) for x in re.findall(r"(?im)^content-length:\s*(\d+)", h)]
                totals[part] = v[-1] if v else 0
            except Exception:
                pass
    return totals[part]
def newest_part():
    best, bt = None, 0
    for root, _, files in os.walk(work):
        for f in files:
            if f.endswith(".part"):
                p = os.path.join(root, f)
                try:
                    t = os.path.getmtime(p)
                except OSError:
                    continue
                if t > bt and time.time() - t < 20:
                    best, bt = p, t
    return best
def mb(n): return "%.0f MB" % (n / 1e6) if n < 1e9 else "%.2f GB" % (n / 1e9)
def bar(f, n=24): f = max(0.0, min(1.0, f)); k = int(round(f * n)); return "[" + "#" * k + "-" * (n - k) + "]"
t0 = time.time(); step, step_t0, done_w, spin = "starting", time.time(), 0.0, "|/-\\"; i = 0
while True:
    alive = os.path.exists("/proc/%d" % pid)
    try:
        lines = [ansi.sub("", l) for l in open(log, errors="replace") if "==>" in l]
    except OSError:
        lines = []
    main = [l.split("==>", 1)[1].strip() for l in lines]
    cur = next((x for x in reversed(main) if any(x.startswith(k) for k, _ in W)), "starting")
    detail = main[-1] if main and main[-1] != cur else ""
    if cur != step:
        step, step_t0 = cur, time.time()
        idx = next((j for j, (k, _) in enumerate(W) if cur.startswith(k)), -1)
        done_w = sum(w for k, w in W[:max(idx, 0)] if not k.startswith(("Using cached", "Installing:", "No FAT", "Compressing")) and any(m.startswith(k) for m in main))
    sw = next((w for k, w in W if step.startswith(k)), 1)
    part = newest_part(); dl = ""
    frac = min(0.95, (time.time() - step_t0) / 60.0 / max(sw, 0.1))
    if part:
        have = os.path.getsize(part) if os.path.exists(part) else 0; tot = total_of(part)
        dl = "  %s%s downloaded" % (mb(have), (" of " + mb(tot)) if tot else "")
        if tot and step.startswith("Downloading"): frac = have / tot
    pct = min(0.99, (done_w + frac * sw) / TOTAL) if alive else 1.0
    el = time.time() - t0
    left = "" if pct < 0.03 or not alive else "  ~%d min left" % max(1, round(el * (1 - pct) / pct / 60))
    cols = shutil.get_terminal_size((100, 20)).columns
    text = " %s %s %3d%%%s%s  %s" % (spin[i % 4], bar(pct, 20), round(pct * 100), left, dl, (detail or step))
    sys.stdout.write("\r\x1b[K" + text[:cols - 1]); sys.stdout.flush(); i += 1
    if not alive:
        sys.stdout.write("\n"); break
    time.sleep(1)
PY
}
progress_write() {   # pid bytes-total
  python3 - "$@" > /dev/tty 2>/dev/null <<'PY' || true
import os, sys, time, shutil
pid, total = int(sys.argv[1]), int(sys.argv[2]); t0 = time.time()
def bar(f, n=30): f = max(0.0, min(1.0, f)); k = int(round(f * n)); return "[" + "#" * k + "-" * (n - k) + "]"
while os.path.exists("/proc/%d" % pid):
    try:
        w = int([l.split()[1] for l in open("/proc/%d/io" % pid) if l.startswith("wchar")][0])
    except Exception:
        w = 0
    f = w / total if total else 0; el = time.time() - t0
    left = ("  ~%d min left" % max(1, round(el * (1 - f) / f / 60))) if 0.03 < f < 1 else ("  finishing (making sure it's all on the card)" if f >= 1 else "")
    text = " %s %3d%%  %.2f GB of %.2f GB%s" % (bar(f), round(min(f, 1) * 100), w / 1e9, total / 1e9, left)
    sys.stdout.write("\r\x1b[K" + text[:shutil.get_terminal_size((100, 20)).columns - 1]); sys.stdout.flush()
    time.sleep(1)
sys.stdout.write("\n")
PY
}

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
  progress_build "$pid" "$WORK/build.log" "$WORK" "$SRC" "$SOUNDS"
  wait "$pid" || { tail -n 25 "$WORK/build.log"; fail "The build stopped - the lines above say why (all of it: $WORK/build.log)."; }
  [ -f "$IMG" ] || fail "The build finished but there's no image - see $WORK/build.log"
fi

# ---- write it to the SD card
while [ ! -b "$DEV" ]; do
  say "The SD card isn't there any more - put it back in and press Enter"; ask '' >/dev/null
done
for part in $(lsblk -lnpo NAME "$DEV" | tail -n +2); do umount "$part" 2>/dev/null || true; done
say "Writing the card (a few minutes)"
dd if="$IMG" of="$DEV" bs=4M conv=fsync status=none &
ddpid=$!
progress_write "$ddpid" "$(stat -c %s "$IMG")"
wait "$ddpid" || fail "Writing the card didn't work - try another card reader or card, and run the line again (the image is kept, so it's quick)."
sync
command -v eject >/dev/null && eject "$DEV" 2>/dev/null || true
say "Done - the card is ready."
note "1. Put it in the Raspberry Pi and plug in the power (the first start takes a couple of minutes)."
note "2. On your phone, join the Wi-Fi \"Central Pedal Setup\". The setup page opens by itself"
note "   (or go to http://10.42.0.1)."
note "3. Pick the church Wi-Fi, the touch screen and the 4-digit code, then Upload."
note "Next card: run the same line again."

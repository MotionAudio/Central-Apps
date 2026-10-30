#!/bin/bash
# ==============================================================================
# Central Pedal OS - image builder (run on your Ubuntu / Debian PC)
#
# Downloads the official Raspberry Pi OS Lite (64-bit), installs Central Pedal
# into it, and writes a ready-to-flash SD card image:
#
#     sudo ./build-image.sh
#     -> central-pedal-<version>.img   (flash with Raspberry Pi Imager: "Use custom")
#
# Flash it, put the card in a Raspberry Pi 4, power on: it boots straight
# into Central Pedal. Nothing else ever appears.
#
# Optional settings (put them before the command):
#   PI_USER=pi PI_PASS=padpedal     login for SSH / maintenance
#   PI_HOSTNAME=padpedal            ssh pi@padpedal.local
#   WIFI_SSID="Church WiFi" WIFI_PASS="secret" WIFI_COUNTRY=US
#   PEDAL_KEY=PXXX-XXXX-XXXX-XXXX     this pedal's P license key (from the website: the order, or Keys · staff);
#                                   the pedal offers it when it first opens. (Or put pad-pedal-key.txt on the card later.)
#   FACTORY=1|0                     1 (default): the first start is the factory test on HDMI 1 (keyboard and mouse:
#                                   footswitches, knobs, small screen, outputs, input, MIDI, Wi-Fi, health; change the
#                                   touch screen there). Unplug it afterwards: the next start is the customer's first start
#                                   ("Central Pedal Setup" on their phone). 0: no factory test.
#   TFT=rpi35-xpt2046|none|<id>     the small touch screen (default: the blue 3.5" XPT2046 board, HDMI 1 still shows
#                                   the full app; none = no small screen; ids in screens.json; Settings can change it)
#   I2S_DAC=on|off                  PCM5102A click / instrument output board (default: on)
#   SAFE_MODE=on|off                power-cut safe mode from first boot (default: on)
#   SOUNDS=full|small|none          keys sound banks: all (1.6 GB), without the Salamander grand, or none
#   EXTRA_MB=...                    grow the system partition by this much instead of working it out
#   OUT=my-card.img                 output file (default: central-pedal-<version>.img)
#   COMPRESS=1                      also write a .img.xz (smaller)
#   BASE_IMAGE=/path/to/raspios.img.xz   use an image you already downloaded
#
# Example:
#   sudo WIFI_SSID="Church WiFi" WIFI_PASS="hunter22" TFT=waveshare35a ./build-image.sh
#
# Needs ~15 GB free disk and internet. Takes 40-60 minutes (it runs ARM
# software through an emulator to install packages). The image is about 8 GB.
# ==============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VER="$(sed -nE 's/^APP_VERSION = "([^"]+)".*/\1/p' "$HERE/pedal-driver.py" 2>/dev/null | head -1)"; VER="${VER:-unknown}"
OUT="${OUT:-$HERE/central-pedal-$VER.img}"
CACHE="${CACHE:-$HERE/.cache}"
BASE_URL="${BASE_URL:-https://downloads.raspberrypi.com/raspios_lite_arm64_latest}"
BASE_IMAGE="${BASE_IMAGE:-}"
PI_USER="${PI_USER:-pi}"
PI_PASS="${PI_PASS:-padpedal}"
PI_HOSTNAME="${PI_HOSTNAME:-padpedal}"
WIFI_SSID="${WIFI_SSID:-}"
WIFI_PASS="${WIFI_PASS:-}"
WIFI_COUNTRY="${WIFI_COUNTRY:-US}"
PEDAL_KEY="${PEDAL_KEY:-}"
TFT="${TFT:-rpi35-xpt2046}"
I2S_DAC="${I2S_DAC:-on}"
SAFE_MODE="${SAFE_MODE:-on}"
EXTRA_MB="${EXTRA_MB:-}"           # how much to grow the system partition; worked out from the sound banks unless set
SOUNDS="${SOUNDS:-full}"        # full | small (no 1.2 GB Salamander grand) | none
COMPRESS="${COMPRESS:-0}"
FACTORY="${FACTORY:-1}"         # 1: the first start is the factory test (HDMI 1, keyboard and mouse); unplugged after it, the
                                # next start is the customer's (phone setup). 0: straight to the customer's start.

say()  { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run with sudo:  sudo ./build-image.sh"
say "Building Central Pedal OS $VER from $HERE"
for old in "$HERE"/pad-pedal-os.img "$HERE"/pad-pedal-os.img.xz; do
  [ -e "$old" ] && printf '    note: %s is an image from an OLDER version (before 7.1) - delete it so it never gets flashed by mistake\n' "$(basename "$old")"
done
FILES=(setup-pi.sh index.html css/pad-pedal.css css/parts.css css/live.css css/fx.css js/live.js js/report.js js/transfer.js js/streamdeck.js js/backup.js js/practice.js js/stemsplit.js js/structure.js js/app.js js/graphics.js js/features.js js/tracks.js js/actions.js js/screen-nav.js js/configure.js js/touch-select.js js/setups.js js/pair-pin.js js/factory-test.js js/pedal-job.js js/touch-wifi.js js/mini-bridge.js js/fx-dsp.js js/fx.js js/shell.js js/soundtest.js
       js/textures.js js/analysis-worker.js js/multitrack-worklet.js js/vendor/qrcode.js js/chords.js js/notation.js js/parts.js js/lyrics-ai.js js/parts-ui.js js/pedals.js js/plugin-ports.js js/instrument.js js/settings.js js/sources.js js/looper.js js/scenes.js js/integrations.js js/colors.js js/netsend.js js/hub.js js/sync.js js/io.js
       instrument_host.py sources.py instrument-plugins.json screens.json get-sounds.sh sounds-vsco.py
       companion/index.html companion/lyrics.html companion/stage.html companion/upload.html companion/remote.html companion/mini.html companion/setup.html companion/slides.html companion/common.js companion/style.css
       pedal-driver.py hardware.json pad-pedal-driver.service pad-pedal-wifi-import.service pad-pedal-bootlog pad-pedal-bootlog.service pad-pedal-bootlog.timer pad-pedal-system pad-pedal-session pad-pedal-audio-config
       xinitrc bash_profile firstboot.sh pad-pedal-firstboot.service 99-pad-pedal-usb.rules 99-pad-pedal-touch.conf pad-pedal-safe-mode pad-pedal.sudoers
       starting.html 99-central-control-vc4.conf fonts/fonts.css fonts/inter-latin.woff2 fonts/inter-latin-ext.woff2 fonts/OFL.txt fonts/archivo-latin.woff2 fonts/archivo-latin-ext.woff2 fonts/OFL-Archivo.txt
       README.md wiring.html
       central-usage/app/app.js central-usage/app/center-link.js central-usage/app/devices.js central-usage/app/lock.js central-usage/app/services-tab.js central-usage/app/countdown.js central-usage/app/chords.js central-usage/app/fixturelib.js central-usage/app/index.html central-usage/app/inear-client.js central-usage/app/inear-ui.js central-usage/app/inear.css central-usage/app/inears.js central-usage/app/instrument-shim.js central-usage/app/instrument-tab.js central-usage/app/instrument.html central-usage/app/io.js central-usage/app/lights-ai.js central-usage/app/lights-auto.js central-usage/app/lights.js central-usage/app/lyrics-listen.js central-usage/app/mix.js central-usage/app/mixer-model.js central-usage/app/mixlink.js central-usage/app/output.html central-usage/app/parts-tab.js central-usage/app/phone.html central-usage/app/remote.html central-usage/app/roles.js central-usage/app/settings.js central-usage/app/slides.js central-usage/app/style.css central-usage/app/timecode.js central-usage/app/updates.js central-usage/app/video.css central-usage/app/video.js  central-usage/build/icon.png)
for f in "${FILES[@]}"; do
  [ -f "$HERE/$f" ] || die "missing $f - keep all the Central Pedal OS files in one folder"
done

# ------------------------------------------------------------------------------
say "Checking build tools"
NEED=()
for tool in xz losetup sfdisk e2fsck resize2fs curl; do command -v "$tool" >/dev/null || NEED+=("$tool"); done
ARCH="$(uname -m)"
if [ "$ARCH" != "aarch64" ] && [ ! -x /usr/bin/qemu-aarch64-static ]; then NEED+=(qemu); fi
if [ ${#NEED[@]} -gt 0 ]; then
  say "Installing: xz-utils fdisk e2fsprogs curl qemu-user-static binfmt-support"
  apt-get update
  apt-get install -y xz-utils fdisk e2fsprogs curl util-linux python3-numpy
  [ "$ARCH" = "aarch64" ] || apt-get install -y qemu-user-static binfmt-support \
    || apt-get install -y qemu-user-binfmt
fi
if [ "$ARCH" != "aarch64" ]; then
  [ -d /proc/sys/fs/binfmt_misc ] && [ -e /proc/sys/fs/binfmt_misc/register ] \
    || mount -t binfmt_misc binfmt_misc /proc/sys/fs/binfmt_misc
  if [ ! -e /proc/sys/fs/binfmt_misc/qemu-aarch64 ]; then
    update-binfmts --enable qemu-aarch64 2>/dev/null \
      || systemctl restart systemd-binfmt 2>/dev/null || true
  fi
  if [ ! -e /proc/sys/fs/binfmt_misc/qemu-aarch64 ]; then
    # Register the emulator directly (same rule Ubuntu ships, "F" = works inside the chroot)
    printf '%s' ':qemu-aarch64:M::\x7fELF\x02\x01\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x02\x00\xb7\x00:\xff\xff\xff\xff\xff\xff\xff\x00\xff\xff\xff\xff\xff\xff\xff\xff\xfe\xff\xff\xff:/usr/bin/qemu-aarch64-static:F' \
      > /proc/sys/fs/binfmt_misc/register
  fi
  [ -e /proc/sys/fs/binfmt_misc/qemu-aarch64 ] || die "could not enable ARM64 emulation (qemu-user-static)"
fi

# ------------------------------------------------------------------------------
if [ -z "$BASE_IMAGE" ]; then
  mkdir -p "$CACHE"
  BASE_IMAGE="$CACHE/raspios-lite-arm64.img.xz"
  if [ ! -s "$BASE_IMAGE" ]; then
    say "Downloading Raspberry Pi OS Lite (64-bit) - about 550 MB"
    curl -fL --retry 3 -o "$BASE_IMAGE.part" "$BASE_URL"
    mv "$BASE_IMAGE.part" "$BASE_IMAGE"
  else
    say "Using cached download $BASE_IMAGE (delete it to fetch the newest release)"
  fi
fi

say "Unpacking base image"
case "$BASE_IMAGE" in
  *.xz) xz -dc "$BASE_IMAGE" > "$OUT.tmp" ;;
  *)    cp "$BASE_IMAGE" "$OUT.tmp" ;;
esac

# free keyboard sound banks (SoundFonts) for the Instrument tab, fetched on this PC first so the image can be sized for them
SOUNDS_MB=0
if [ "$SOUNDS" != "none" ]; then
  say "Fetching the free keyboard sound banks (FreePats, Salamander grand) - about 1.7 GB, cached in $HERE/sounds"
  SMALL=$([ "$SOUNDS" = "small" ] && echo 1 || echo 0) bash "$HERE/get-sounds.sh" "$HERE/sounds" || true
  SOUNDS_MB=$(du -cm "$HERE"/sounds/*.sf2 2>/dev/null | tail -1 | cut -f1); SOUNDS_MB=${SOUNDS_MB:-0}
fi
# system + Chromium + PipeWire + 600 plugins need about 2.5 GB on top of the base image (plus room to stage the banks); the sound banks come on top of that
if [ -z "${EXTRA_MB:-}" ]; then EXTRA_MB=$((3584 + SOUNDS_MB)); fi
say "Making room for Chromium, the plugins, the app and ${SOUNDS_MB} MB of sound banks (+${EXTRA_MB} MB)"
truncate -s "+${EXTRA_MB}M" "$OUT.tmp"
echo ", +" | sfdisk -N 2 --no-reread "$OUT.tmp" >/dev/null

LOOP=""; MNT="$(mktemp -d)"
cleanup() {
  set +e
  if [ -n "$MNT" ] && mountpoint -q "$MNT"; then
    for m in dev/pts dev proc sys run boot/firmware boot; do
      mountpoint -q "$MNT/$m" && umount -l "$MNT/$m"
    done
    umount -l "$MNT"
  fi
  [ -n "$LOOP" ] && losetup -d "$LOOP" 2>/dev/null
  rmdir "$MNT" 2>/dev/null
}
trap cleanup EXIT

LOOP="$(losetup -fP --show "$OUT.tmp")"
for _ in 1 2 3 4 5; do [ -b "${LOOP}p2" ] && break; partx -u "$LOOP" 2>/dev/null; sleep 1; done
[ -b "${LOOP}p2" ] || die "partitions of $LOOP did not appear"
e2fsck -pf "${LOOP}p2" >/dev/null || true
resize2fs "${LOOP}p2" >/dev/null

say "Mounting image"
mount "${LOOP}p2" "$MNT"
if [ -d "$MNT/boot/firmware" ]; then BOOTMNT="$MNT/boot/firmware"; else BOOTMNT="$MNT/boot"; fi
BOOT_VIA_MTOOLS=0
if ! mount "${LOOP}p1" "$BOOTMNT" 2>/dev/null; then
  # Kernel without FAT support (some containers/VMs): edit the boot partition with mtools instead
  say "No FAT driver here - using mtools for the boot partition"
  command -v mcopy >/dev/null || apt-get install -y mtools
  BOOTCOPY="$(mktemp -d)"
  MTOOLS_SKIP_CHECK=1 mcopy -s -n -i "${LOOP}p1" ::/ "$BOOTCOPY/"
  mount --bind "$BOOTCOPY" "$BOOTMNT"
  BOOT_VIA_MTOOLS=1
fi
mount --bind /dev "$MNT/dev"
mount --bind /dev/pts "$MNT/dev/pts"
mount -t proc proc "$MNT/proc"
mount -t sysfs sys "$MNT/sys"
mount -t tmpfs tmpfs "$MNT/run"

# Network for apt inside the image, and no services starting while we install
cp -L /etc/resolv.conf "$MNT/tmp/host-resolv.conf"
[ -s /run/systemd/resolve/resolv.conf ] && cp /run/systemd/resolve/resolv.conf "$MNT/tmp/host-resolv.conf"
if [ -e "$MNT/etc/resolv.conf" ] || [ -L "$MNT/etc/resolv.conf" ]; then mv "$MNT/etc/resolv.conf" "$MNT/etc/resolv.conf.padpedal-orig"; fi
cp "$MNT/tmp/host-resolv.conf" "$MNT/etc/resolv.conf"
printf '#!/bin/sh\nexit 101\n' > "$MNT/usr/sbin/policy-rc.d"; chmod +x "$MNT/usr/sbin/policy-rc.d"
[ -f "$MNT/etc/ld.so.preload" ] && mv "$MNT/etc/ld.so.preload" "$MNT/etc/ld.so.preload.padpedal"
[ "$ARCH" = "aarch64" ] || cp /usr/bin/qemu-aarch64-static "$MNT/usr/bin/" 2>/dev/null || true

mkdir -p "$MNT/tmp/pad-pedal-src/js/vendor" "$MNT/tmp/pad-pedal-src/companion" "$MNT/tmp/pad-pedal-src/css" "$MNT/tmp/pad-pedal-src/fonts" "$MNT/tmp/pad-pedal-src/central-usage/app" "$MNT/tmp/pad-pedal-src/central-usage/build"
for f in "${FILES[@]}"; do cp "$HERE/$f" "$MNT/tmp/pad-pedal-src/$f"; done
# every app file in those folders, not only the ones listed above (setup-pi.sh installs the folders whole)
cp "$HERE"/css/*.css "$MNT/tmp/pad-pedal-src/css/"; cp "$HERE"/js/*.js "$MNT/tmp/pad-pedal-src/js/"; cp "$HERE"/js/vendor/*.js "$MNT/tmp/pad-pedal-src/js/vendor/"
cp "$HERE"/companion/* "$MNT/tmp/pad-pedal-src/companion/"; cp "$HERE"/fonts/* "$MNT/tmp/pad-pedal-src/fonts/"
cp "$HERE"/central-usage/app/*.js "$HERE"/central-usage/app/*.html "$HERE"/central-usage/app/*.css "$MNT/tmp/pad-pedal-src/central-usage/app/"
[ -f "$HERE/central-pedal-control/build/icon.png" ] && mkdir -p "$MNT/tmp/pad-pedal-src/central-pedal-control/build" && cp "$HERE/central-pedal-control/build/icon.png" "$MNT/tmp/pad-pedal-src/central-pedal-control/build/"
# pre-rendered spoken cue words, so the build works without espeak-ng too
[ -d "$HERE/cues" ] && cp -r "$HERE/cues" "$MNT/tmp/pad-pedal-src/cues"
# play any sound: its plugin for the Pi (bin/, in the release zip) and its C sources
[ -d "$HERE/bin" ] && cp -r "$HERE/bin" "$MNT/tmp/pad-pedal-src/bin"
[ -d "$HERE/central-usage/native/playany" ] && mkdir -p "$MNT/tmp/pad-pedal-src/central-usage/native/playany" && cp "$HERE"/central-usage/native/playany/*.[ch] "$MNT/tmp/pad-pedal-src/central-usage/native/playany/"
# the sound banks fetched above (setup-pi.sh moves them into /opt/pad-pedal/sounds)
if [ "$SOUNDS" != "none" ]; then
  mkdir -p "$MNT/tmp/pad-pedal-src/sounds"; cp "$HERE"/sounds/*.sf2 "$HERE"/sounds/*.txt "$HERE"/sounds/*README* "$HERE"/sounds/*LICENSE* "$MNT/tmp/pad-pedal-src/sounds/" 2>/dev/null || true
fi
# Ableton Link's Python module: fetch the ARM64 wheel here on the PC (pip inside the
# emulated image is slow and sometimes can't reach PyPI); setup-pi.sh installs it from wheels/
PYVER="$(chroot "$MNT" python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null || echo 3.13)"
mkdir -p "$MNT/tmp/pad-pedal-src/wheels"
if command -v pip3 >/dev/null || command -v pip >/dev/null; then
  (command -v pip3 >/dev/null && PIP=pip3 || PIP=pip
   timeout 180 "$PIP" download LinkPython-extern --no-deps --python-version "$PYVER" --platform manylinux2014_aarch64 --only-binary=:all: \
     -d "$MNT/tmp/pad-pedal-src/wheels" >/dev/null 2>&1 && echo "    Ableton Link wheel for Python $PYVER downloaded" || echo "    (no Ableton Link wheel for Python $PYVER on this PC - the image will try PyPI itself)")
fi

say "Installing Central Pedal inside the image (the slow part)"
chroot "$MNT" /usr/bin/env -i HOME=/root TERM=xterm LANG=C.UTF-8 \
  PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  IN_CHROOT=1 DISABLE_FIRSTBOOT_WIZARD=1 \
  KIOSK_USER="$PI_USER" KIOSK_PASS="$PI_PASS" PI_HOSTNAME="$PI_HOSTNAME" \
  WIFI_SSID="$WIFI_SSID" WIFI_PASS="$WIFI_PASS" WIFI_COUNTRY="$WIFI_COUNTRY" TFT="$TFT" I2S_DAC="$I2S_DAC" SAFE_MODE="$SAFE_MODE" \
  /bin/bash /tmp/pad-pedal-src/setup-pi.sh

if [ "$FACTORY" = 1 ]; then   # the factory test on the first start (pedal-driver.py: Factory)
  printf 'Central Pedal factory test: the first start tests the pedal on HDMI 1. Unplug it afterwards: the next start is the customer'"'"'s.\n' > "$BOOTMNT/central-factory-test"
  echo "    factory test on the first start"
fi
if [ -n "$PEDAL_KEY" ]; then   # this pedal's license key, on the boot partition (the driver offers it to the app)
  printf '%s\n' "$PEDAL_KEY" > "$BOOTMNT/pad-pedal-key.txt"
  echo "    license key put on the card"
fi

say "Sanity-checking the image"
for path in /opt/pad-pedal/index.html /opt/pad-pedal/css/pad-pedal.css /opt/pad-pedal/js/app.js /opt/pad-pedal/js/tracks.js /opt/pad-pedal/js/shell.js /opt/pad-pedal/companion/index.html \
            /opt/pad-pedal/companion/lyrics.html /opt/pad-pedal/pedal-driver.py /opt/pad-pedal/pad-pedal-session /opt/pad-pedal/pad-pedal-audio-config \
            /etc/pad-pedal/hardware.json /usr/local/sbin/pad-pedal-system /etc/sudoers.d/pad-pedal /etc/X11/xorg.conf.d/99-pad-pedal-touch.conf \
            /opt/pad-pedal/cues/chorus.wav "/home/$PI_USER/.xinitrc" /etc/systemd/system/multi-user.target.wants/pad-pedal-driver.service \
            "/var/lib/systemd/linger/$PI_USER"; do
  [ -e "$MNT$path" ] || [ -L "$MNT$path" ] || die "image is missing $path"
done
chroot "$MNT" /bin/sh -c 'command -v chromium || command -v chromium-browser' >/dev/null || die "Chromium did not install"
chroot "$MNT" python3 -c "import websockets, gpiozero, evdev, PIL" || die "driver Python modules missing"
chroot "$MNT" python3 -c "import link" 2>/dev/null && echo "    Ableton Link installed" || echo "    (Ableton Link not installed - optional)"
chroot "$MNT" dpkg -s pipewire wireplumber pipewire-pulse poppler-utils espeak-ng >/dev/null 2>&1 || die "PipeWire / poppler / espeak-ng did not install"
grep -q '^dtoverlay=hifiberry-dac' "$BOOTMNT/config.txt" || [ "$I2S_DAC" = "off" ] || die "I2S DAC overlay missing from config.txt"
chroot "$MNT" python3 -c "import ast,sys; ast.parse(open('/opt/pad-pedal/pedal-driver.py').read()); ast.parse(open('/opt/pad-pedal/instrument_host.py').read()); ast.parse(open('/opt/pad-pedal/sources.py').read())"
[ -d "$MNT/usr/lib/lv2/gx_amp.lv2" ] && [ -d "$MNT/usr/lib/lv2/calf.lv2" ] || die "guitar plugins (Guitarix / Calf) did not install"
chroot "$MNT" /bin/sh -c 'command -v fluidsynth' >/dev/null || die "FluidSynth did not install"
echo "    instrument: $(ls -d "$MNT"/usr/lib/lv2/*.lv2 2>/dev/null | wc -l) LV2 bundles, $(ls "$MNT"/opt/pad-pedal/sounds/*.sf2 2>/dev/null | wc -l) sound banks"
if [ "$SAFE_MODE" = "on" ]; then
  chroot "$MNT" dpkg -s overlayroot >/dev/null 2>&1 || die "overlayroot (safe mode) did not install"
  ls "$BOOTMNT"/initramfs* >/dev/null 2>&1 || die "no initramfs on the boot partition - safe mode could not work"
fi
for path in /opt/pad-pedal/starting.html /opt/pad-pedal/fonts/inter-latin.woff2 /etc/X11/xorg.conf.d/99-central-control-vc4.conf /etc/pad-pedal/version; do
  [ -e "$MNT$path" ] || die "image is missing $path"
done
chroot "$MNT" /bin/sh -c 'command -v xdotool && command -v xrandr' >/dev/null || die "screen tools (xdotool / xrandr) did not install"
grep -qE '^dtoverlay=vc4-kms-v3d' "$BOOTMNT/config.txt" || die "config.txt has no KMS display driver"
[ "$(cat "$MNT/etc/pad-pedal/version")" = "$VER" ] || die "the image says version $(cat "$MNT/etc/pad-pedal/version"), expected $VER"
echo "Central Pedal OS $VER - built $(date -u +%Y-%m-%d)" > "$BOOTMNT/central-control-version.txt"
grep -qw resize "$BOOTMNT/cmdline.txt" && die "cmdline.txt still grows the system partition (the /data partition needs that space)"
grep -q '^boot_delay=0' "$BOOTMNT/config.txt" && grep -qw quiet "$BOOTMNT/cmdline.txt" \
  && [ ! -e "$MNT/etc/systemd/system/network-online.target.wants/NetworkManager-wait-online.service" ] \
  && echo "    fast start-up settings in place" || echo "    WARNING: the fast start-up settings are incomplete (boots slower) - see 'boot-tune' in pad-pedal-system"
echo "    app, companion pages, driver, screens session, audio routing, cue words and services all present"

say "Cleaning up"
rm -rf "$MNT/tmp/pad-pedal-src" "$MNT/tmp/host-resolv.conf" "$MNT/usr/sbin/policy-rc.d" "$MNT/usr/bin/qemu-aarch64-static"
rm -f "$MNT/etc/resolv.conf"
[ -e "$MNT/etc/resolv.conf.padpedal-orig" ] || [ -L "$MNT/etc/resolv.conf.padpedal-orig" ] && mv "$MNT/etc/resolv.conf.padpedal-orig" "$MNT/etc/resolv.conf"
[ -f "$MNT/etc/ld.so.preload.padpedal" ] && mv "$MNT/etc/ld.so.preload.padpedal" "$MNT/etc/ld.so.preload"
rm -rf "$MNT/var/lib/apt/lists/"* "$MNT/var/cache/apt/archives/"*.deb
fstrim -v "$MNT" >/dev/null 2>&1 || true
if [ "$BOOT_VIA_MTOOLS" = "1" ]; then
  umount "$BOOTMNT"
  MTOOLS_SKIP_CHECK=1 mcopy -o -s -i "${LOOP}p1" "$BOOTCOPY"/* ::/
  rm -rf "$BOOTCOPY"
fi
sync
cleanup
trap - EXIT
mv "$OUT.tmp" "$OUT"
[ -n "${SUDO_USER:-}" ] && chown "$SUDO_USER": "$OUT"

if [ "$COMPRESS" = "1" ]; then
  say "Compressing ($(basename "$OUT").xz)"
  xz -T0 -6 -kf "$OUT"
  [ -n "${SUDO_USER:-}" ] && chown "$SUDO_USER": "$OUT.xz"
fi

say "Done: Central Pedal OS $VER -> $OUT"
cat <<EOF

  Flash it:  Raspberry Pi Imager -> Choose OS -> "Use custom" -> pick this file
             -> Choose storage -> your SD card -> Next -> when asked about
             "OS customisation", choose NO (it's already set up).
  Or:        sudo dd if="$OUT" of=/dev/sdX bs=4M status=progress conv=fsync

  First boot takes about a minute longer and restarts once: it turns the
  rest of the card into the /data partition and switches on power-cut safe
  mode. After that, every boot goes straight into Central Pedal, on the tab
  you used last (the very first time: Tracks).
  The start-up screen and the top-right corner of the app show the version ($VER);
  the card's boot partition has central-control-version.txt too.

  Maintenance:  ssh $PI_USER@$PI_HOSTNAME.local   (password: $PI_PASS - change it with 'passwd')
EOF

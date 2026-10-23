#!/bin/bash
# ==============================================================================
# Central Pedal OS - system setup
#
# Turns a Raspberry Pi OS Lite (64-bit, Bookworm or Trixie) root filesystem
# into an appliance that boots straight into Central Pedal and nothing else:
#   power on -> Central Pedal on HDMI 1, lyrics for the projector on HDMI 2,
#   pads / tracks on the 3.5" touch screen, charts on every phone on the Wi-Fi.
#
# Used two ways (you normally don't run it by hand):
#   * build-image.sh runs it inside the image it is building (IN_CHROOT=1)
#   * install-kiosk.sh runs it on a Pi that is already running Pi OS Lite
#
# Settings come from environment variables (all optional):
#   KIOSK_USER=pi  KIOSK_PASS=...  PI_HOSTNAME=padpedal
#   WIFI_SSID=...  WIFI_PASS=...   WIFI_COUNTRY=US
#   TFT=none|waveshare35a|...      (the 3.5" SPI touch screen; System menu can change it later)
#   I2S_DAC=on|off                 (PCM5102A click / cue output on GPIO 18/19/21)
#   SAFE_MODE=on|off               (image builds: power-cut safe mode from first boot)
#   DISABLE_FIRSTBOOT_WIZARD=0|1
# ==============================================================================
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIOSK_USER="${KIOSK_USER:-pi}"
KIOSK_PASS="${KIOSK_PASS:-}"
PI_HOSTNAME="${PI_HOSTNAME:-}"
WIFI_SSID="${WIFI_SSID:-}"
WIFI_PASS="${WIFI_PASS:-}"
WIFI_COUNTRY="${WIFI_COUNTRY:-US}"
TFT="${TFT:-none}"
I2S_DAC="${I2S_DAC:-on}"
IN_CHROOT="${IN_CHROOT:-0}"
DISABLE_FIRSTBOOT_WIZARD="${DISABLE_FIRSTBOOT_WIZARD:-0}"
SAFE_MODE="${SAFE_MODE:-on}"
export DEBIAN_FRONTEND=noninteractive

step() { printf '\n==> %s\n' "$*"; }
warn() { printf '    WARNING: %s\n' "$*" >&2; }

[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo)."; exit 1; }
for f in index.html css/pad-pedal.css css/parts.css css/live.css js/live.js js/report.js js/transfer.js js/streamdeck.js js/backup.js js/practice.js js/stemsplit.js js/structure.js js/app.js js/graphics.js js/features.js js/tracks.js js/actions.js js/configure.js js/touch-select.js js/setups.js js/pair-pin.js js/pedal-job.js js/touch-wifi.js js/shell.js js/textures.js \
         js/analysis-worker.js js/multitrack-worklet.js js/vendor/qrcode.js js/chords.js js/notation.js js/parts.js js/lyrics-ai.js js/parts-ui.js js/pedals.js js/plugin-ports.js js/instrument.js js/settings.js js/sources.js js/looper.js js/scenes.js js/integrations.js js/colors.js js/netsend.js js/hub.js js/sync.js js/io.js \
         instrument_host.py sources.py instrument-plugins.json screens.json get-sounds.sh companion/index.html companion/lyrics.html companion/stage.html companion/upload.html \
         companion/remote.html companion/mini.html companion/slides.html companion/common.js companion/style.css \
         pedal-driver.py hardware.json pad-pedal-driver.service pad-pedal-wifi-import.service pad-pedal-system pad-pedal-session \
         pad-pedal-audio-config xinitrc bash_profile firstboot.sh pad-pedal-firstboot.service 99-pad-pedal-usb.rules 99-pad-pedal-touch.conf \
         pad-pedal-safe-mode pad-pedal.sudoers starting.html 99-central-control-vc4.conf fonts/fonts.css fonts/inter-latin.woff2 fonts/archivo-latin.woff2 \
         central-usage/app/app.js central-usage/app/center-link.js central-usage/app/devices.js central-usage/app/lock.js central-usage/app/services-tab.js central-usage/app/countdown.js central-usage/app/chords.js central-usage/app/fixturelib.js central-usage/app/index.html central-usage/app/inear-client.js central-usage/app/inear-ui.js central-usage/app/inear.css central-usage/app/inears.js central-usage/app/instrument-shim.js central-usage/app/instrument-tab.js central-usage/app/instrument.html central-usage/app/io.js central-usage/app/lights-ai.js central-usage/app/lights.js central-usage/app/lyrics-listen.js central-usage/app/mix.js central-usage/app/mixer-model.js central-usage/app/mixlink.js central-usage/app/output.html central-usage/app/parts-tab.js central-usage/app/phone.html central-usage/app/remote.html central-usage/app/roles.js central-usage/app/settings.js central-usage/app/slides.js central-usage/app/style.css central-usage/app/timecode.js central-usage/app/updates.js central-usage/app/video.css central-usage/app/video.js  central-usage/build/icon.png; do
  [ -f "$SRC/$f" ] || { echo "Missing $f next to setup-pi.sh"; exit 1; }
done

BOOT=/boot/firmware
[ -f "$BOOT/config.txt" ] || BOOT=/boot
[ -f "$BOOT/config.txt" ] || { echo "Can't find config.txt - is this Raspberry Pi OS?"; exit 1; }
CONFIG="$BOOT/config.txt"
CMDLINE="$BOOT/cmdline.txt"

# ------------------------------------------------------------------------------
step "Installing packages (X server, Chromium, PipeWire audio, hardware support - no desktop)"
apt-get update
apt-get install -y --no-install-recommends \
  xserver-xorg xserver-xorg-video-fbdev xinit x11-xserver-utils xdotool xinput unclutter \
  pipewire pipewire-pulse wireplumber pipewire-alsa pulseaudio-utils \
  python3 python3-websockets python3-gpiozero python3-pil python3-numpy python3-evdev python3-pip \
  i2c-tools alsa-utils poppler-utils espeak-ng fonts-dejavu-core avahi-daemon cloud-guest-utils rfkill
apt-get install -y --no-install-recommends chromium \
  || apt-get install -y --no-install-recommends chromium-browser
for optional in fonts-noto-color-emoji ffmpeg musescore-general-soundfont-small python3-lgpio python3-smbus python3-smbus2 python3-rpi-lgpio python3-mido python3-rtmidi overlayroot dbus-user-session; do
  apt-get install -y --no-install-recommends "$optional" >/dev/null 2>&1 \
    && echo "    + $optional" || echo "    (skipped $optional - not in this release)"
done
python3 -c "import smbus" 2>/dev/null || python3 -c "import smbus2" 2>/dev/null \
  || warn "no python smbus module - knobs/sliders will be disabled"

step "Instrument: free guitar pedal / amp plugins (LV2, LADSPA) and the keys engine (FluidSynth)"
# 600+ plugins: Guitarix, Calf, LSP, x42, Zam, Dragonfly, mda, swh, Invada, TAP, CAPS... ~175 MB
INSTRUMENT_PKGS="guitarix-lv2 calf-plugins lsp-plugins-lv2 x42-plugins zam-plugins dragonfly-reverb mda-lv2 swh-lv2 invada-studio-plugins-lv2 tap-plugins caps wah-plugins rev-plugins fil-plugins abgate eq10q ir.lv2 autotalent zita-at1 fluidsynth fluid-soundfont-gm lilv-utils p7zip-full"
apt-get install -y --no-install-recommends $INSTRUMENT_PKGS >/dev/null 2>&1 && echo "    + $INSTRUMENT_PKGS" || {
  warn "some instrument packages did not install; trying them one by one"
  for pkg in $INSTRUMENT_PKGS; do apt-get install -y --no-install-recommends "$pkg" >/dev/null 2>&1 && echo "    + $pkg" || echo "    (skipped $pkg)"; done
}
apt-get clean >/dev/null 2>&1 || true
step "Ableton Link (tempo sharing with other apps on the Wi-Fi)"
# a wheel downloaded by build-image.sh on the PC (wheels/) is used first; otherwise PyPI
if ls "$SRC"/wheels/linkpython_extern-*.whl >/dev/null 2>&1 && pip3 install --break-system-packages --no-cache-dir --no-index --find-links "$SRC/wheels" LinkPython-extern >/dev/null 2>&1; then
  echo "    + LinkPython-extern (from wheels/)"
elif pip3 install --break-system-packages --no-cache-dir LinkPython-extern >/dev/null 2>&1; then
  echo "    + LinkPython-extern"
else
  warn "could not install LinkPython-extern (no internet?) - Link is off until you run: sudo pip3 install --break-system-packages LinkPython-extern"
fi

# ------------------------------------------------------------------------------
step "Kiosk user: $KIOSK_USER"
if ! id "$KIOSK_USER" >/dev/null 2>&1; then
  useradd -m -s /bin/bash "$KIOSK_USER"
fi
usermod -s /bin/bash "$KIOSK_USER"
install -d -o "$KIOSK_USER" -g "$KIOSK_USER" "$(getent passwd "$KIOSK_USER" | cut -d: -f6)"
for group in audio video input render gpio i2c spi plugdev netdev sudo pipewire; do
  getent group "$group" >/dev/null && usermod -aG "$group" "$KIOSK_USER"
done
if [ -n "$KIOSK_PASS" ]; then
  echo "$KIOSK_USER:$KIOSK_PASS" | chpasswd
fi
KIOSK_HOME="$(getent passwd "$KIOSK_USER" | cut -d: -f6)"
KIOSK_UID="$(id -u "$KIOSK_USER")"
# the user's services (PipeWire) run from boot, not only while logged in, so the driver can use them
install -d /var/lib/systemd/linger && touch "/var/lib/systemd/linger/$KIOSK_USER"
if [ "$DISABLE_FIRSTBOOT_WIZARD" = "1" ]; then
  systemctl mask userconfig.service >/dev/null 2>&1 || true
  rm -f /etc/ssh/sshd_config.d/rename_user.conf
  if [ -d /etc/cloud ]; then touch /etc/cloud/cloud-init.disabled; fi
fi

# ------------------------------------------------------------------------------
step "Installing the Central Pedal app, companion pages and the driver"
install -d -m 755 /opt/pad-pedal /opt/pad-pedal/css /opt/pad-pedal/js /opt/pad-pedal/js/vendor /opt/pad-pedal/companion /opt/pad-pedal/cues /etc/pad-pedal
install -m 644 "$SRC/index.html"       /opt/pad-pedal/index.html
install -m 644 "$SRC/starting.html"    /opt/pad-pedal/starting.html
install -d -m 755 /opt/pad-pedal/fonts && install -m 644 "$SRC"/fonts/* /opt/pad-pedal/fonts/
install -m 644 "$SRC"/css/*.css        /opt/pad-pedal/css/
# pre-rendered cue words (used as-is; espeak-ng below only fills in any that are missing)
[ -d "$SRC/cues" ] && install -m 644 "$SRC"/cues/*.wav /opt/pad-pedal/cues/ 2>/dev/null
install -m 644 "$SRC"/js/*.js          /opt/pad-pedal/js/
install -m 644 "$SRC"/js/vendor/*.js   /opt/pad-pedal/js/vendor/
install -m 644 "$SRC"/companion/*      /opt/pad-pedal/companion/
# Central Control for phones and tablets (iPhone / iPad: http://<this Pi>:8080/cu/, Add to Home Screen)
install -d -m 755 /opt/pad-pedal/central-usage/app /opt/pad-pedal/central-usage/build
install -m 644 "$SRC"/central-usage/app/*.js "$SRC"/central-usage/app/*.html "$SRC"/central-usage/app/*.css /opt/pad-pedal/central-usage/app/
install -m 644 "$SRC/central-usage/build/icon.png" /opt/pad-pedal/central-usage/build/icon.png
[ -f "$SRC/central-usage/build/icon-usage.png" ] && install -m 644 "$SRC/central-usage/build/icon-usage.png" /opt/pad-pedal/central-usage/build/icon-usage.png
[ -f "$SRC/central-pedal-control/build/icon.png" ] && install -d -m 755 /opt/pad-pedal/central-pedal-control/build && install -m 644 "$SRC/central-pedal-control/build/icon.png" /opt/pad-pedal/central-pedal-control/build/icon.png
[ -f "$SRC/wiring.html" ] && install -m 644 "$SRC/wiring.html" /opt/pad-pedal/wiring.html
[ -f "$SRC/README.md" ] && install -m 644 "$SRC/README.md" /opt/pad-pedal/README.md
install -m 755 "$SRC/pedal-driver.py"        /opt/pad-pedal/pedal-driver.py
install -m 644 "$SRC/instrument_host.py"     /opt/pad-pedal/instrument_host.py
install -m 644 "$SRC/sources.py"            /opt/pad-pedal/sources.py
install -m 644 "$SRC/instrument-plugins.json" /opt/pad-pedal/instrument-plugins.json
# play any sound: its plugin (built by CI for arm64) and its C sources (the driver builds it from them if it is missing)
[ -d "$SRC/bin" ] && { rm -rf /opt/pad-pedal/bin; cp -r "$SRC/bin" /opt/pad-pedal/bin; chmod -R a+rX /opt/pad-pedal/bin; }
[ -d "$SRC/central-usage/native/playany" ] && install -d -m 755 /opt/pad-pedal/central-usage/native/playany && install -m 644 "$SRC"/central-usage/native/playany/*.c "$SRC"/central-usage/native/playany/*.h /opt/pad-pedal/central-usage/native/playany/
install -m 644 "$SRC/screens.json"           /opt/pad-pedal/screens.json
install -m 755 "$SRC/get-sounds.sh"          /opt/pad-pedal/get-sounds.sh
install -d -m 755 /opt/pad-pedal/sounds
if ls "$SRC"/sounds/*.sf2 >/dev/null 2>&1; then
  # inside the image build the staging folder is thrown away afterwards, so move the (big) banks instead of copying;
  # a bank that would not leave 300 MB free is skipped with a note rather than breaking the build
  N=0
  for sf in "$SRC"/sounds/*.sf2; do
    need=$(( $(stat -c %s "$sf") / 1048576 + 300 )); free=$(df -m /opt/pad-pedal | awk 'NR==2 {print $4}')
    if [ "${IN_CHROOT:-0}" = "1" ]; then
      if [ "$free" -lt "$need" ]; then echo "    (skipped $(basename "$sf"): only ${free} MB free - raise EXTRA_MB)"; continue; fi
      mv "$sf" /opt/pad-pedal/sounds/ && chmod 644 "/opt/pad-pedal/sounds/$(basename "$sf")" && N=$((N + 1))
    else
      if [ "$free" -lt "$need" ]; then echo "    (skipped $(basename "$sf"): only ${free} MB free)"; continue; fi
      install -m 644 "$sf" /opt/pad-pedal/sounds/ && N=$((N + 1))
    fi
  done
  for lic in "$SRC"/sounds/*.txt "$SRC"/sounds/*.md "$SRC"/sounds/*LICENSE* "$SRC"/sounds/*README*; do [ -f "$lic" ] && install -m 644 "$lic" /opt/pad-pedal/sounds/ || true; done
  echo "    $N keyboard sound banks installed"
else
  echo "    (no sound banks in $SRC/sounds - keys use the General MIDI bank; run get-sounds.sh later)"
fi
install -m 755 "$SRC/pad-pedal-session"      /opt/pad-pedal/pad-pedal-session
install -m 755 "$SRC/pad-pedal-audio-config" /opt/pad-pedal/pad-pedal-audio-config
install -m 755 "$SRC/firstboot.sh"           /opt/pad-pedal/firstboot.sh
if [ -f /etc/pad-pedal/hardware.json ]; then
  echo "    keeping existing /etc/pad-pedal/hardware.json (your pin map)"
else
  install -m 644 "$SRC/hardware.json" /etc/pad-pedal/hardware.json
fi
python3 - "$TFT" "$I2S_DAC" <<'PY'
import json, sys
path = "/etc/pad-pedal/hardware.json"
cfg = json.load(open(path))
cfg["tft_overlay"] = sys.argv[1] if sys.argv[1] != "none" else "none"
if sys.argv[1] != "none": cfg["tft_overlay_choice"] = sys.argv[1]
cfg["i2s_dac"] = sys.argv[2] != "off"
json.dump(cfg, open(path, "w"), indent=2)
PY
sed -nE 's/^APP_VERSION = "([^"]+)".*/\1/p' "$SRC/pedal-driver.py" | head -1 > /etc/pad-pedal/version
echo "$WIFI_COUNTRY" > /etc/pad-pedal/wifi-country
echo "$KIOSK_USER" > /etc/pad-pedal/kiosk-user
echo "$SAFE_MODE" > /etc/pad-pedal/safe-mode-default
install -m 755 "$SRC/pad-pedal-system"    /usr/local/sbin/pad-pedal-system
install -m 755 "$SRC/pad-pedal-safe-mode" /usr/local/sbin/pad-pedal-safe-mode
sed "s/^pi /$KIOSK_USER /" "$SRC/pad-pedal.sudoers" > /tmp/pad-pedal.sudoers
if visudo -cf /tmp/pad-pedal.sudoers >/dev/null; then install -m 440 /tmp/pad-pedal.sudoers /etc/sudoers.d/pad-pedal; else warn "sudoers rule failed validation - System menu power buttons won't work"; fi
rm -f /tmp/pad-pedal.sudoers
install -m 644 "$SRC/pad-pedal-driver.service"      /etc/systemd/system/pad-pedal-driver.service
install -m 644 "$SRC/pad-pedal-firstboot.service"   /etc/systemd/system/pad-pedal-firstboot.service
install -m 644 "$SRC/pad-pedal-wifi-import.service" /etc/systemd/system/pad-pedal-wifi-import.service
sed -i "s/^User=.*/User=$KIOSK_USER/; s#XDG_RUNTIME_DIR=/run/user/1000#XDG_RUNTIME_DIR=/run/user/$KIOSK_UID#" /etc/systemd/system/pad-pedal-driver.service
for group in gpio i2c spi input video audio render plugdev; do
  getent group "$group" >/dev/null || groupadd -r "$group"
done
systemctl enable pad-pedal-driver.service pad-pedal-firstboot.service pad-pedal-wifi-import.service
systemctl enable ssh >/dev/null 2>&1 || systemctl enable sshd >/dev/null 2>&1 || true
systemctl enable avahi-daemon >/dev/null 2>&1 || true

step "Spoken cue words (espeak-ng) for the in-ear mix"
python3 - <<'PY'
import os, subprocess
words = {"intro": "Intro", "verse": "Verse", "verse-1": "Verse one", "verse-2": "Verse two", "verse-3": "Verse three", "verse-4": "Verse four",
         "chorus": "Chorus", "chorus-1": "Chorus one", "chorus-2": "Chorus two", "chorus-3": "Chorus three", "pre-chorus": "Pre chorus", "bridge": "Bridge", "bridge-2": "Bridge two",
         "tag": "Tag", "outro": "Outro", "ending": "Ending", "interlude": "Interlude", "instrumental": "Instrumental", "turnaround": "Turnaround", "vamp": "Vamp",
         "refrain": "Refrain", "hook": "Hook", "solo": "Solo", "breakdown": "Breakdown", "build": "Build", "coda": "Coda", "end": "End",
         "last-time": "Last time", "repeat": "Repeat", "ready": "Ready", "go": "Go", "hold": "Hold", "stop": "Stop", "key-change": "Key change", "big": "Big",
         "quiet": "Quiet", "drop": "Drop", "band-in": "Band in", "band-out": "Band out", "drums-in": "Drums in", "drums-out": "Drums out", "a-cappella": "A cappella",
         "one-more": "One more", "to-the-top": "To the top", "double-chorus": "Double chorus", "half-time": "Half time", "slow-down": "Slow down", "next-song": "Next song",
         "1": "One", "2": "Two", "3": "Three", "4": "Four", "5": "Five", "6": "Six", "7": "Seven", "8": "Eight"}
ok = 0
for cue, text in words.items():
    path = "/opt/pad-pedal/cues/%s.wav" % cue
    if os.path.exists(path):
        ok += 1
        continue
    r = subprocess.run(["espeak-ng", "-v", "en-us", "-s", "165", "-p", "35", "-a", "180", "-w", path, text], capture_output=True)
    ok += r.returncode == 0
print("    %d cue words ready" % ok)
PY

# ------------------------------------------------------------------------------
step "Boot straight to the app: console autologin -> X -> Chromium kiosk"
systemctl set-default multi-user.target
systemctl disable lightdm >/dev/null 2>&1 || true
# Pi OS ships with its "create a user" wizard on and the tty1 login off; we made the user already
systemctl disable userconfig.service >/dev/null 2>&1 || true
systemctl mask userconfig.service >/dev/null 2>&1 || true
systemctl enable getty@tty1.service >/dev/null 2>&1 || ln -sf /usr/lib/systemd/system/getty@.service /etc/systemd/system/getty.target.wants/getty@tty1.service
install -d /etc/systemd/system/getty@tty1.service.d
cat > /etc/systemd/system/getty@tty1.service.d/autologin.conf <<EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin $KIOSK_USER --noclear %I \$TERM
EOF
install -m 644 -o "$KIOSK_USER" -g "$KIOSK_USER" "$SRC/bash_profile" "$KIOSK_HOME/.bash_profile"
install -m 755 -o "$KIOSK_USER" -g "$KIOSK_USER" "$SRC/xinitrc" "$KIOSK_HOME/.xinitrc"
install -d /etc/X11 /etc/X11/xorg.conf.d
printf 'allowed_users=anybody\nneeds_root_rights=auto\n' > /etc/X11/Xwrapper.config
install -m 644 "$SRC/99-pad-pedal-touch.conf" /etc/X11/xorg.conf.d/99-pad-pedal-touch.conf
# Chromium: the app's origin may use the microphone (audio input channel) without asking
install -d -o "$KIOSK_USER" -g "$KIOSK_USER" "$KIOSK_HOME/.config/pad-pedal/Default"
cat > "$KIOSK_HOME/.config/pad-pedal/Default/Preferences" <<'EOF'
{"profile":{"content_settings":{"exceptions":{"media_stream_mic":{"http://127.0.0.1:8766,*":{"setting":1}},"sound":{"http://127.0.0.1:8766,*":{"setting":1}}}},"exit_type":"Normal","exited_cleanly":true}}
EOF
chown -R "$KIOSK_USER:$KIOSK_USER" "$KIOSK_HOME/.config"

step "USB sticks mount automatically under /media (for importing WAV/MP3)"
install -m 644 "$SRC/99-pad-pedal-usb.rules" /etc/udev/rules.d/99-pad-pedal-usb.rules

# ------------------------------------------------------------------------------
step "Hardware: I2C (knobs), SPI (3.5\" screen), I2S DAC (click output), serial pins freed for buttons"
grep -q '^dtparam=i2c_arm=on' "$CONFIG" || echo 'dtparam=i2c_arm=on' >> "$CONFIG"
grep -q '^i2c-dev' /etc/modules 2>/dev/null || echo 'i2c-dev' >> /etc/modules
grep -q '^dtparam=audio=on' "$CONFIG" || echo 'dtparam=audio=on' >> "$CONFIG"
if [ "$I2S_DAC" != "off" ]; then grep -q '^dtoverlay=hifiberry-dac' "$CONFIG" || echo 'dtoverlay=hifiberry-dac' >> "$CONFIG"; fi
if [ "$TFT" != "none" ]; then grep -q '^dtparam=spi=on' "$CONFIG" || echo 'dtparam=spi=on' >> "$CONFIG"; echo "dtoverlay=$TFT:rotate=90" >> "$CONFIG"; fi
grep -q '^enable_uart=0' "$CONFIG" || echo 'enable_uart=0' >> "$CONFIG"
sed -i -E 's/ ?console=serial0,[0-9]+//' "$CMDLINE"

step "Screens: full KMS display driver, sharp native resolution on any HDMI monitor"
# the Pi's own KMS driver (Pi OS default - put back if an old config.txt lost it) and room for two screens
if ! grep -qE '^dtoverlay=vc4-(f)?kms-v3d' "$CONFIG"; then echo 'dtoverlay=vc4-kms-v3d' >> "$CONFIG"; fi
sed -i -E 's/^dtoverlay=vc4-fkms-v3d/dtoverlay=vc4-kms-v3d/' "$CONFIG"
grep -q '^max_framebuffers=' "$CONFIG" || echo 'max_framebuffers=2' >> "$CONFIG"
# old firmware-era overscan / forced-mode settings fight the KMS driver (black borders, the wrong size) - drop them
sed -i -E '/^(overscan_(left|right|top|bottom)|hdmi_group|hdmi_mode|framebuffer_width|framebuffer_height)=/d; s/^disable_overscan=.*/disable_overscan=1/' "$CONFIG"
grep -q '^disable_overscan=' "$CONFIG" || echo 'disable_overscan=1' >> "$CONFIG"
install -d -m 755 /etc/X11/xorg.conf.d
install -m 644 "$SRC/99-central-control-vc4.conf" /etc/X11/xorg.conf.d/99-central-control-vc4.conf

step "Quiet, fast boot (no rainbow, no text)"
grep -q '^disable_splash=1' "$CONFIG" || echo 'disable_splash=1' >> "$CONFIG"
for arg in quiet loglevel=3 logo.nologo vt.global_cursor_default=0 consoleblank=0 \
           "cfg80211.ieee80211_regdom=$WIFI_COUNTRY"; do
  key="${arg%%=*}"
  if grep -qE "(^| )$key(=| |\$)" "$CMDLINE"; then
    sed -i -E "s/(^| )$key(=[^ ]*)?( |\$)/\1$arg\3/" "$CMDLINE"
  else
    sed -i "1 s/\$/ $arg/" "$CMDLINE"
  fi
done

if [ -n "$PI_HOSTNAME" ]; then
  step "Hostname: $PI_HOSTNAME"
  echo "$PI_HOSTNAME" > /etc/hostname
  if grep -q '^127.0.1.1' /etc/hosts; then
    sed -i "s/^127.0.1.1.*/127.0.1.1\t$PI_HOSTNAME/" /etc/hosts
  else
    printf '127.0.1.1\t%s\n' "$PI_HOSTNAME" >> /etc/hosts
  fi
fi

if [ -n "$WIFI_SSID" ]; then
  step "Wi-Fi: $WIFI_SSID"
  install -d -m 700 /etc/NetworkManager/system-connections
  UUID="$(cat /proc/sys/kernel/random/uuid)"
  cat > /etc/NetworkManager/system-connections/padpedal-wifi.nmconnection <<EOF
[connection]
id=padpedal-wifi
uuid=$UUID
type=wifi
interface-name=wlan0
autoconnect=true
autoconnect-retries=0
autoconnect-priority=10

[wifi]
mode=infrastructure
ssid=$WIFI_SSID

[wifi-security]
key-mgmt=wpa-psk
psk=$WIFI_PASS

[ipv4]
method=auto

[ipv6]
method=auto
EOF
  chmod 600 /etc/NetworkManager/system-connections/padpedal-wifi.nmconnection
  # belt and braces: NetworkManager itself imports this on the first boot, then deletes it
  printf '%s\n%s\n' "$WIFI_SSID" "$WIFI_PASS" > "$BOOT/pad-pedal-wifi.txt"
fi
install -d -m 700 /etc/NetworkManager/conf.d
printf '[device]\nwifi.scan-rand-mac-address=no\n[connection]\nwifi.powersave=2\n' > /etc/NetworkManager/conf.d/pad-pedal.conf

step "Turning off the swap file (not needed, and it can't work on a read-only system)"
for u in rpi-resize-swap-file.service rpi-setup-loop@var-swap.service dphys-swapfile.service var-swap.swap; do
  systemctl mask "$u" >/dev/null 2>&1 || true
done
sed -i '/[[:space:]]swap[[:space:]]/d' /etc/fstab 2>/dev/null || true
rm -f /var/swap

step "Faster start-up: no boot pause, full clock while booting, services the appliance never uses turned off"
# the same step runs after every software update, so Pis set up earlier get it too (see pad-pedal-system)
/usr/local/sbin/pad-pedal-system boot-tune || warn "start-up settings reported a problem"

if [ "$IN_CHROOT" = "1" ]; then
  step "First boot will create the /data partition (instead of growing the system partition)"
  sed -i -E 's# ?init=/usr/lib/raspberrypi-sys-mods/firstboot##; s# resize( |$)#\1#' "$CMDLINE"
  if dpkg -s overlayroot >/dev/null 2>&1; then
    step "Building the initramfs with safe-mode (overlayroot) support"
    grep -qx overlay /etc/initramfs-tools/modules 2>/dev/null || echo overlay >> /etc/initramfs-tools/modules
    update-initramfs -u -k all >/dev/null 2>&1 || update-initramfs -c -k all >/dev/null 2>&1 || warn "initramfs update failed - safe mode may not work"
  fi
else
  step "Setting up /data on this card (safe mode needs the Central Pedal OS image)"
  touch /etc/pad-pedal/no-data-partition
  systemctl daemon-reload
  bash /opt/pad-pedal/firstboot.sh || warn "first-boot setup reported a problem"
  step "Starting the hardware driver now"
  systemctl restart pad-pedal-driver.service || warn "driver didn't start - check: journalctl -u pad-pedal-driver"
fi

apt-get clean
step "Central Pedal OS setup complete"

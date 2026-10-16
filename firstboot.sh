#!/bin/bash
# Central Control OS - runs once, on the very first boot of a freshly flashed card.
#  * creates the /data partition in the rest of the card (journaled ext4) for
#    your pads, songs, imported sounds and pin map
#  * turns on power-cut safe mode if the image was built with it (default)
#  * un-blocks Wi-Fi (Pi OS keeps it blocked until a country is set)
#  * makes SSH host keys if the image has none
set -u
DONE=/var/lib/pad-pedal/firstboot-done
[ -e "$DONE" ] && exit 0
mkdir -p /var/lib/pad-pedal
log() { echo "pad-pedal-firstboot: $*"; }
KIOSK_USER="$(cat /etc/pad-pedal/kiosk-user 2>/dev/null || echo pi)"
NEED_REBOOT=0

# ---- /data partition -------------------------------------------------------
ROOT_PART="$(findmnt -no SOURCE /)"
DISK="${PP_TEST_DISK:-/dev/$(lsblk -no pkname "$ROOT_PART" | head -1)}"   # PP_TEST_DISK: used by the tests only
if ! blkid -L ppdata >/dev/null 2>&1; then
  if [ -e /etc/pad-pedal/no-data-partition ]; then
    log "no data partition wanted (installed onto an existing system)"
  else
    log "creating the data partition on $DISK"
    BEFORE="$(lsblk -lno NAME "$DISK" | sort)"
    # Start the new partition AFTER the system partition. (Without an explicit start,
    # sfdisk picks the first gap on the card - the few MB before the boot partition.)
    LAST_END="$(partx -g -o END "$DISK" 2>/dev/null | sort -n | tail -1)"
    START=$(( (LAST_END + 1 + 2047) / 2048 * 2048 ))
    if [ -n "$LAST_END" ] && echo "$START, +, L" | sfdisk --append --no-reread "$DISK"; then
      partx -u "$DISK" 2>/dev/null || partprobe "$DISK" 2>/dev/null || true
      sleep 2
      NEW="$(comm -13 <(echo "$BEFORE") <(lsblk -lno NAME "$DISK" | sort) | tail -1)"
      if [ -n "$NEW" ] && mkfs.ext4 -F -q -L ppdata "/dev/$NEW"; then log "made /dev/$NEW"; else log "could not format the new partition"; fi
    else
      log "no free space for a data partition - using a folder on the system partition instead"
    fi
  fi
fi
[ -n "${PP_TEST_DISK:-}" ] && exit 0
mkdir -p /data
if blkid -L ppdata >/dev/null 2>&1; then
  grep -q "LABEL=ppdata" /etc/fstab || echo "LABEL=ppdata /data ext4 defaults,noatime,commit=5,data=journal 0 2" >> /etc/fstab
  systemctl daemon-reload
  mountpoint -q /data || mount /data
fi
mkdir -p /data/pad-pedal/sounds /data/pad-pedal/uploads /data/pad-pedal/charts /data/pad-pedal/tts /data/chromium /data/chromium-2
[ -f /data/pad-pedal/hardware.json ] || cp /etc/pad-pedal/hardware.json /data/pad-pedal/hardware.json
[ -f /data/pad-pedal/displays.json ] || echo '{"hdmi1": "app", "hdmi2": "lyrics", "cursor": "auto"}' > /data/pad-pedal/displays.json
[ -f /data/pad-pedal/audio.json ] || echo '{"main": "auto", "click": "auto"}' > /data/pad-pedal/audio.json
chown -R "$KIOSK_USER":"$KIOSK_USER" /data/pad-pedal /data/chromium /data/chromium-2
# Wi-Fi networks added later (System menu) must survive safe mode: keep them on /data
if mountpoint -q /data && ! grep -q "system-connections" /etc/fstab; then
  mkdir -p /data/pad-pedal/network
  cp -a /etc/NetworkManager/system-connections/. /data/pad-pedal/network/ 2>/dev/null || true
  chmod 700 /data/pad-pedal/network
  echo "/data/pad-pedal/network /etc/NetworkManager/system-connections none bind,x-systemd.requires=/data 0 0" >> /etc/fstab
  mount --bind /data/pad-pedal/network /etc/NetworkManager/system-connections 2>/dev/null || true
fi

# ---- the rest of the card is now /data, so the system partition just checks itself
COUNTRY="$(cat /etc/pad-pedal/wifi-country 2>/dev/null || echo US)"
command -v raspi-config >/dev/null && raspi-config nonint do_wifi_country "$COUNTRY" >/dev/null 2>&1
rfkill unblock wifi 2>/dev/null || true
for f in /var/lib/systemd/rfkill/*:wlan; do [ -e "$f" ] && echo 0 > "$f"; done
ls /etc/ssh/ssh_host_*_key >/dev/null 2>&1 || ssh-keygen -A

# ---- safe mode (takes effect from the next boot) -----------------------------
if [ "$(cat /etc/pad-pedal/safe-mode-default 2>/dev/null)" = "on" ] && mountpoint -q /data; then
  /usr/local/sbin/pad-pedal-system safe-mode on && NEED_REBOOT=1
fi

touch "$DONE"; sync
if [ "$NEED_REBOOT" = 1 ]; then log "restarting once so safe mode takes effect"; systemctl --no-block reboot; fi

#!/bin/bash
# Central Pedal Control .deb post-install: the launcher link and sandbox (as electron-builder does by default),
# a udev rule so an Elgato Stream Deck works without root, and the AppArmor profile Ubuntu 24.04+ needs.
if type update-alternatives >/dev/null 2>&1; then
  if [ -L '/usr/bin/${executable}' -a -e '/usr/bin/${executable}' -a "`readlink '/usr/bin/${executable}'`" != '/etc/alternatives/${executable}' ]; then rm -f '/usr/bin/${executable}'; fi
  update-alternatives --install '/usr/bin/${executable}' '${executable}' '/opt/${sanitizedProductName}/${executable}' 100 || ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
else
  ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
fi
chown root:root '/opt/${sanitizedProductName}/chrome-sandbox' 2>/dev/null || true
chmod 4755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
if hash update-mime-database 2>/dev/null; then update-mime-database /usr/share/mime || true; fi
if hash update-desktop-database 2>/dev/null; then update-desktop-database /usr/share/applications || true; fi
cat > /etc/udev/rules.d/70-central-pedal-control-streamdeck.rules <<'RULES'
# Central Pedal Control: an Elgato Stream Deck usable by whoever is logged in at the computer
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="0fd9", TAG+="uaccess"
SUBSYSTEM=="usb", ATTRS{idVendor}=="0fd9", TAG+="uaccess"
RULES
udevadm control --reload-rules 2>/dev/null || true
udevadm trigger --subsystem-match=hidraw 2>/dev/null || true
# Ubuntu 24.04+ only lets an app use the sandbox Chromium/Electron needs when an AppArmor profile names it
if [ -d /etc/apparmor.d ] && [ -e /etc/apparmor.d/abi/4.0 ] && command -v apparmor_parser >/dev/null 2>&1; then
  cat > /etc/apparmor.d/central-pedal-control <<'PROFILE'
abi <abi/4.0>,
include <tunables/global>

profile central-pedal-control "/opt/Central Pedal Control/central-pedal-control" flags=(unconfined) {
  userns,

  include if exists <local/central-pedal-control>
}
PROFILE
  apparmor_parser -r /etc/apparmor.d/central-pedal-control 2>/dev/null || true
fi

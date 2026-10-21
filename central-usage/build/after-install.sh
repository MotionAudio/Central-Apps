#!/bin/bash
# Central Control .deb post-install: the launcher link and sandbox (as electron-builder does by default),
# plus a udev rule so USB-DMX interfaces (FTDI-based: ENTTEC, DMXking, Eurolite...) work without root.
# (before 9.2.1 the app was in "/opt/Central Usage": drop that launcher choice so the link points at the new folder)
if type update-alternatives >/dev/null 2>&1 && [ "/opt/${sanitizedProductName}" != "/opt/Central Usage" ]; then update-alternatives --remove '${executable}' '/opt/Central Usage/${executable}' >/dev/null 2>&1 || true; fi
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
cat > /etc/udev/rules.d/60-central-usage-dmx.rules <<'RULES'
# Central Control: USB-DMX interfaces usable by everyone logged in (ENTTEC / DMXking / Eurolite use FTDI chips)
SUBSYSTEM=="tty", ATTRS{idVendor}=="0403", MODE="0666"
SUBSYSTEM=="usb", ATTRS{idVendor}=="0403", MODE="0666"
SUBSYSTEM=="tty", ATTRS{idVendor}=="16c0", ATTRS{idProduct}=="05dc", MODE="0666"
RULES
udevadm control --reload-rules 2>/dev/null || true
udevadm trigger --subsystem-match=tty 2>/dev/null || true
# Ubuntu 24.04+ only lets an app use the sandbox Chromium/Electron needs when an AppArmor profile names it
# (otherwise the app closes at once with "closed unexpectedly"). The same kind of profile Ubuntu ships for
# Chrome and VS Code: it confines nothing, it only allows user namespaces.
if [ -d /etc/apparmor.d ] && [ -e /etc/apparmor.d/abi/4.0 ] && command -v apparmor_parser >/dev/null 2>&1; then
  cat > /etc/apparmor.d/central-usage <<'PROFILE'
abi <abi/4.0>,
include <tunables/global>

profile central-usage "/opt/${sanitizedProductName}/${executable}" flags=(unconfined) {
  userns,

  include if exists <local/central-usage>
}
PROFILE
  apparmor_parser -r /etc/apparmor.d/central-usage 2>/dev/null || true
fi

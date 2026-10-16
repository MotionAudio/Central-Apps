#!/bin/bash
# Central Control (PC) .deb post-install: the launcher link and sandbox (as electron-builder does), plus an AppArmor profile.
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
# Ubuntu 24.04+ only lets an app use the sandbox Chromium/Electron needs when an AppArmor profile names it
# (otherwise the app closes at once with "closed unexpectedly"). The same kind of profile Ubuntu ships for
# Chrome and VS Code: it confines nothing, it only allows user namespaces.
if [ -d /etc/apparmor.d ] && [ -e /etc/apparmor.d/abi/4.0 ] && command -v apparmor_parser >/dev/null 2>&1; then
  cat > /etc/apparmor.d/central-control <<'PROFILE'
abi <abi/4.0>,
include <tunables/global>

profile central-control "/opt/Central Control/central-control" flags=(unconfined) {
  userns,

  include if exists <local/central-control>
}
PROFILE
  apparmor_parser -r /etc/apparmor.d/central-control 2>/dev/null || true
fi

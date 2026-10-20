#!/bin/bash
# Central Services .deb post-install: the launcher link and sandbox (as electron-builder does by default), and the
# AppArmor profile Ubuntu 24.04+ needs for the sandbox Chromium/Electron uses.
if type update-alternatives >/dev/null 2>&1; then
  if [ -L '/usr/bin/${executable}' -a -e '/usr/bin/${executable}' -a "`readlink '/usr/bin/${executable}'`" != '/etc/alternatives/${executable}' ]; then rm -f '/usr/bin/${executable}'; fi
  update-alternatives --install '/usr/bin/${executable}' '${executable}' '/opt/${sanitizedProductName}/${executable}' 100 || ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
else
  ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
fi
chown root:root '/opt/${sanitizedProductName}/chrome-sandbox' 2>/dev/null || true
chmod 4755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
if hash update-desktop-database 2>/dev/null; then update-desktop-database /usr/share/applications || true; fi
if [ -d /etc/apparmor.d ] && [ -e /etc/apparmor.d/abi/4.0 ] && command -v apparmor_parser >/dev/null 2>&1; then
  cat > /etc/apparmor.d/central-services <<'PROFILE'
abi <abi/4.0>,
include <tunables/global>

profile central-services "/opt/Central Services/central-services" flags=(unconfined) {
  userns,

  include if exists <local/central-services>
}
PROFILE
  apparmor_parser -r /etc/apparmor.d/central-services 2>/dev/null || true
fi

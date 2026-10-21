#!/bin/bash
# Central Control .deb post-install: the launcher link and sandbox (as electron-builder does by default),
# plus a udev rule so USB-DMX interfaces (FTDI-based: ENTTEC, DMXking, Eurolite...) work without root.
# Since 9.3.1 the app is /opt/Central Control/central-control (package central-control). Before that it was
# /opt/Central Control/central-usage (9.2.1 - 9.3.0) and /opt/Central Usage/central-usage (before 9.2.1).
APP='/opt/${sanitizedProductName}/${executable}'

# ---- the old launcher choices go (they point at files that are gone)
if type update-alternatives >/dev/null 2>&1; then
  update-alternatives --remove central-usage '/opt/Central Usage/central-usage' >/dev/null 2>&1 || true
  update-alternatives --remove central-usage '/opt/Central Control/central-usage' >/dev/null 2>&1 || true
fi
[ -L /usr/bin/central-usage ] && [ ! -e /usr/bin/central-usage ] && rm -f /usr/bin/central-usage
[ -d '/opt/Central Usage' ] && [ -z "$(ls -A '/opt/Central Usage' 2>/dev/null)" ] && rmdir '/opt/Central Usage' 2>/dev/null

# ---- the command (central-control)
if type update-alternatives >/dev/null 2>&1; then
  if [ -L '/usr/bin/${executable}' -a -e '/usr/bin/${executable}' -a "`readlink '/usr/bin/${executable}'`" != '/etc/alternatives/${executable}' ]; then rm -f '/usr/bin/${executable}'; fi
  update-alternatives --install '/usr/bin/${executable}' '${executable}' "$APP" 100 || ln -sf "$APP" '/usr/bin/${executable}'
else
  ln -sf "$APP" '/usr/bin/${executable}'
fi
# (an app from before 9.3.1 restarts itself after an update with its old file name: send it to the new one)
ln -sfn '${executable}' '/opt/${sanitizedProductName}/central-usage'

# ---- launchers people made from the old menu entry (a desktop icon, a copied menu entry): point them at the app
fix_launcher() {   # rewrites the file in place (same owner, same permissions)
  local f="$1" t
  grep -qE "/opt/Central Usage/central-usage|/opt/Central Control/central-usage|^Exec=\"?central-usage\b" "$f" 2>/dev/null || return 0
  grep -q "^Name=Central Usage" "$f" && grep -q "centralusage" "$f" && return 0   # (the musicians' app: not ours)
  t="$(mktemp)" || return 0
  sed -e "s#/opt/Central Usage/central-usage#$APP#g" -e "s#/opt/Central Control/central-usage#$APP#g" \
      -e 's#^Exec="\?central-usage\b#Exec=${executable}#' -e 's#^Icon=central-usage$#Icon=${executable}#' \
      -e 's#^Name=Central Usage$#Name=Central Control#' "$f" > "$t" && cat "$t" > "$f"
  rm -f "$t"
}
for f in /usr/share/applications/*.desktop /usr/local/share/applications/*.desktop \
         /home/*/.local/share/applications/*.desktop /home/*/Desktop/*.desktop /home/*/.config/autostart/*.desktop \
         /root/.local/share/applications/*.desktop /root/Desktop/*.desktop; do
  [ -f "$f" ] && [ "$f" != "/usr/share/applications/${executable}.desktop" ] && fix_launcher "$f"
done
# (the old package's own menu entry, if it is still there: the new one replaces it)
[ -f /usr/share/applications/central-usage.desktop ] && ! dpkg -S /usr/share/applications/central-usage.desktop >/dev/null 2>&1 && rm -f /usr/share/applications/central-usage.desktop

chown root:root '/opt/${sanitizedProductName}/chrome-sandbox' 2>/dev/null || true
chmod 4755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
if hash update-mime-database 2>/dev/null; then update-mime-database /usr/share/mime || true; fi
if hash update-desktop-database 2>/dev/null; then update-desktop-database /usr/share/applications || true; fi
if hash gtk-update-icon-cache 2>/dev/null; then gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor 2>/dev/null || true; fi

rm -f /etc/udev/rules.d/60-central-usage-dmx.rules
cat > /etc/udev/rules.d/60-central-control-dmx.rules <<'RULES'
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
  if [ -f /etc/apparmor.d/central-usage ]; then apparmor_parser -R /etc/apparmor.d/central-usage 2>/dev/null || true; rm -f /etc/apparmor.d/central-usage; fi
  cat > /etc/apparmor.d/central-control <<PROFILE
abi <abi/4.0>,
include <tunables/global>

profile central-control "$APP" flags=(unconfined) {
  userns,

  include if exists <local/central-control>
}
PROFILE
  apparmor_parser -r /etc/apparmor.d/central-control 2>/dev/null || true
fi
exit 0

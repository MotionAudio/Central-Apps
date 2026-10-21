#!/bin/bash
# Central Control .deb removal: the launcher link (as electron-builder does), the AppArmor profile and the USB-DMX rule.
# (on an update, "$1" is upgrade: the new version's files and links stay)
if [ "$1" = "remove" ] || [ "$1" = "purge" ]; then
  if type update-alternatives >/dev/null 2>&1; then update-alternatives --remove '${executable}' '/opt/${sanitizedProductName}/${executable}' >/dev/null 2>&1 || true; fi
  rm -f '/usr/bin/${executable}' 2>/dev/null || true
  rm -f '/opt/${sanitizedProductName}/central-usage'; rmdir '/opt/${sanitizedProductName}' 2>/dev/null || true
  if [ -f /etc/apparmor.d/central-control ]; then apparmor_parser -R /etc/apparmor.d/central-control 2>/dev/null || true; rm -f /etc/apparmor.d/central-control; fi
  rm -f /etc/udev/rules.d/60-central-control-dmx.rules
fi
exit 0

#!/bin/bash
# Central Usage .deb removal: the launcher link (as electron-builder does), the AppArmor profile and the USB-DMX rule
if type update-alternatives >/dev/null 2>&1; then update-alternatives --remove '${executable}' '/usr/bin/${executable}'; else rm -f '/usr/bin/${executable}'; fi
if [ "$1" = "remove" ] || [ "$1" = "purge" ]; then
  if [ -f /etc/apparmor.d/central-usage ]; then apparmor_parser -R /etc/apparmor.d/central-usage 2>/dev/null || true; rm -f /etc/apparmor.d/central-usage; fi
  rm -f /etc/udev/rules.d/60-central-usage-dmx.rules
fi

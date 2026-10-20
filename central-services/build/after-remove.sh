#!/bin/bash
# Central Services .deb removal: the launcher link (as electron-builder does) and the AppArmor profile
if type update-alternatives >/dev/null 2>&1; then update-alternatives --remove '${executable}' '/usr/bin/${executable}'; else rm -f '/usr/bin/${executable}'; fi
if [ "$1" = "remove" ] || [ "$1" = "purge" ]; then
  if [ -f /etc/apparmor.d/central-services ]; then apparmor_parser -R /etc/apparmor.d/central-services 2>/dev/null || true; rm -f /etc/apparmor.d/central-services; fi
fi

#!/bin/bash
# Central Pedal Control .deb removal: the launcher link (as electron-builder does), the AppArmor profile and the Stream Deck rule
if type update-alternatives >/dev/null 2>&1; then update-alternatives --remove '${executable}' '/usr/bin/${executable}'; else rm -f '/usr/bin/${executable}'; fi
if [ "$1" = "remove" ] || [ "$1" = "purge" ]; then
  if [ -f /etc/apparmor.d/central-pedal-control ]; then apparmor_parser -R /etc/apparmor.d/central-pedal-control 2>/dev/null || true; rm -f /etc/apparmor.d/central-pedal-control; fi
  rm -f /etc/udev/rules.d/70-central-pedal-control-streamdeck.rules
fi

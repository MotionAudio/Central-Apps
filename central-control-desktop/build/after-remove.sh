#!/bin/bash
if type update-alternatives >/dev/null 2>&1; then update-alternatives --remove '${executable}' '/usr/bin/${executable}'; else rm -f '/usr/bin/${executable}'; fi
if [ "$1" = "remove" ] || [ "$1" = "purge" ]; then
  if [ -f /etc/apparmor.d/central-control ]; then apparmor_parser -R /etc/apparmor.d/central-control 2>/dev/null || true; rm -f /etc/apparmor.d/central-control; fi
fi

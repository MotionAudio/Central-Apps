#!/bin/bash
# ==============================================================================
# Turn a Raspberry Pi that is ALREADY running Raspberry Pi OS Lite (64-bit)
# into Central Pedal OS. Run on the Pi, from the folder holding these files:
#
#   sudo bash install-kiosk.sh
#   sudo reboot
#
# (To make a ready-to-flash SD card image instead, use build-image.sh on your
#  Ubuntu PC.)  Optional settings, e.g.:  sudo TFT=waveshare35a bash install-kiosk.sh
# ==============================================================================
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Please run: sudo bash install-kiosk.sh"; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
# the free keyboard sound banks (needs internet; SOUNDS=none to skip, SOUNDS=small to skip the 1.2 GB grand)
if [ "${SOUNDS:-full}" != "none" ]; then SMALL=$([ "${SOUNDS:-full}" = "small" ] && echo 1 || echo 0) bash "$HERE/get-sounds.sh" "$HERE/sounds" || true; fi
KIOSK_USER="${KIOSK_USER:-${SUDO_USER:-pi}}" bash "$HERE/setup-pi.sh"
echo
echo "Done. Reboot with:  sudo reboot"
echo "The Pi will boot straight into the Central Pedal Pad screen."

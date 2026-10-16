#!/bin/sh
# Pad Pedal OS kiosk session: the screens are set up by pad-pedal-session
# (one full-screen Chromium per HDMI output, audio routing, cursor).
exec /opt/pad-pedal/pad-pedal-session

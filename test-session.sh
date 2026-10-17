#!/bin/bash
# Tests the screen session (pad-pedal-session) on a PC: a virtual X screen (Xvfb), a pretend HDMI port,
# the simulated driver and a real Chromium. Checks: the start-up page hands over to the app once the driver
# is up, the window sits exactly on the screen, an edge margin set in Settings moves it in place (same
# window - the sound would keep playing), a monitor swap redoes the layout, and changing what a screen
# shows restarts the windows.
#   sudo apt install xvfb xdotool x11-xserver-utils chromium      then:  bash test-session.sh
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
CHROME="${CHROME:-$(command -v chromium || command -v chromium-browser || ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome 2>/dev/null | head -1)}"
for t in Xvfb xdotool xrandr xwininfo python3; do command -v "$t" >/dev/null || { echo "needs $t"; exit 2; }; done
[ -x "$CHROME" ] || { echo "needs Chromium (set CHROME=...)"; exit 2; }
T="$(mktemp -d)"; FAIL=0
ok() { if eval "$2"; then echo "  ✓ $1"; else echo "  ✗ $1"; FAIL=$((FAIL + 1)); fi; }
mkdir -p "$T/drm/card1-HDMI-A-1" "$T/data" "$T/sim" "$T/home"
echo connected > "$T/drm/card1-HDMI-A-1/status"; echo monitorA > "$T/drm/card1-HDMI-A-1/edid"
echo '{"hdmi1":"app","hdmi2":"lyrics"}' > "$T/data/displays.json"
printf '#!/bin/bash\nexec "%s" --no-sandbox "$@"\n' "$CHROME" > "$T/browser"; chmod +x "$T/browser"
D=:$((80 + RANDOM % 100)); Xvfb "$D" -screen 0 1600x1000x24 >/dev/null 2>&1 & XP=$!; sleep 1
export DISPLAY="$D"
CC_APP="$HERE" CC_DATA="$T/data" CC_SCREENS="$T/screens.json" CC_LOG="$T/log" CC_DRM="$T/drm" CC_NO_AUDIO=1 CC_BROWSER="$T/browser" \
  HOME="$T/home" CC_WATCH_EVERY=1 setsid bash "$HERE/pad-pedal-session" & SP=$!
echo "Screen session:"
win() { xdotool search --onlyvisible --class CentralControl1 2>/dev/null | head -1; }
# the session doesn't wait for the driver: the start-up page opens right away (only Chromium's own start time)
for _ in $(seq 1 30); do W="$(win)"; [ -n "$W" ] && xdotool getwindowname "$W" 2>/dev/null | grep -q starting && break; sleep 0.5; done
W="$(win)"
ok "a window opens even though the driver isn't running yet (the start-up page)" '[ -n "$W" ] && xdotool getwindowname "$W" | grep -q starting'
python3 "$HERE/pedal-driver.py" --simulate "$T/sim" --app-root "$HERE" >"$T/driver.log" 2>&1 & DP=$!
for _ in $(seq 1 30); do xdotool getwindowname "$W" 2>/dev/null | grep -q "^Central Control - " && ! xdotool getwindowname "$W" | grep -q starting && break; sleep 1; done
ok "...and it hands over to the app as soon as the driver answers" 'xdotool getwindowname "$W" | grep -qv starting'
geo() { xwininfo -id "$W" | awk '/Absolute upper-left X/{x=$4} /Absolute upper-left Y/{y=$4} /Width/{w=$2} /Height/{h=$2} END{print w"x"h"+"x"+"y}'; }
for _ in $(seq 1 20); do grep -q "screen 1 moved" "$T/log" && break; sleep 0.5; done   # the session's put-it-in-place pass, 6 s after the start
sleep 1
ok "the window covers the screen exactly (1600x1000)" '[ "$(geo)" = "1600x1000+0+0" ]'
ok "the session reports the screen it found for Settings → Screens" 'grep -q "\"primary\": \"screen\"" "$T/screens.json"'
echo '{"hdmi1":"app","hdmi2":"lyrics","inset1":40}' > "$T/data/displays.json"; sleep 4
ok "an edge margin moves the same window in, live (no restart)" '[ "$(geo)" = "1520x920+40+40" ] && [ "$(win)" = "$W" ]'
echo monitorB > "$T/drm/card1-HDMI-A-1/edid"; sleep 5
ok "a different monitor on the port redoes the layout without restarting" 'grep -q "screens changed" "$T/log" && [ "$(win)" = "$W" ]'
echo '{"hdmi1":"lyrics","hdmi2":"lyrics","inset1":40}' > "$T/data/displays.json"; sleep 4
ok "changing what HDMI 1 shows restarts the windows (the session ends; .bash_profile starts it again)" '! kill -0 $SP 2>/dev/null'
kill $DP $XP 2>/dev/null; pkill -P $SP 2>/dev/null
[ "$FAIL" = 0 ] && echo "ALL SESSION CHECKS PASSED" || { echo "$FAIL CHECK(S) FAILED - log: $T/log"; exit 1; }
rm -rf "$T"

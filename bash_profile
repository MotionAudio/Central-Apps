# Pad Pedal OS: logging in on the main screen (tty1) starts the screens.
# If the session ever exits or crashes, it simply starts again.
# SSH logins and other consoles (Ctrl+Alt+F2) get a normal shell.
if [ -z "${DISPLAY:-}" ] && [ "$(tty)" = "/dev/tty1" ]; then
  while true; do
    startx >/tmp/pad-pedal-x.log 2>&1
    sleep 2
  done
fi

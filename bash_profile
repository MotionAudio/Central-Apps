# Central Pedal: logging in on the main screen (tty1) starts the screens.
# If the session ever exits or crashes, it simply starts again; when it keeps failing, the main screen says so
# (instead of sitting on a login prompt) and the start-up report on the SD card says why.
# SSH logins and other consoles (Ctrl+Alt+F2) get a normal shell.
if [ -z "${DISPLAY:-}" ] && [ "$(tty)" = "/dev/tty1" ]; then
  fails=0
  while true; do
    t0=$(date +%s)
    startx >/tmp/pad-pedal-x.log 2>&1
    if [ $(( $(date +%s) - t0 )) -lt 20 ]; then fails=$((fails + 1)); else fails=0; fi
    if [ "$fails" -ge 3 ]; then
      clear
      printf '\n  Central Pedal could not start its screens.\n\n'
      printf '  A report is on the SD card: central-pedal-log.txt\n'
      printf '  (turn the pedal off, put the card in a computer, open the "bootfs" drive).\n\n'
      tail -5 /tmp/pad-pedal-x.log 2>/dev/null | sed 's/^/    /'
      printf '\n  Trying again in 15 seconds...\n'
      sleep 15
    else
      sleep 2
    fi
  done
fi

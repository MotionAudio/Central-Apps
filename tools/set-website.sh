#!/bin/bash
# Motion Audio Central - point every app at the website once it's online (10.3).
#
#   bash tools/set-website.sh https://motionaudio.org            (checks the site answers first)
#   bash tools/set-website.sh https://motionaudio.org --no-check (from a machine that can't reach it)
#
# The apps read the website's address from one place, js/license.js (SERVER). Central Control, Central Usage, Central
# Services and Central Production copy that file when they're built, so this one line reaches every app.
# Afterwards: bump a quick fix version (bash tools/bump-version.sh X.Y.Z+1), write its release notes, and release. Keys
# are then checked on the website, and the default keys keep working until they're switched off on the staff page.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/.." && pwd)"
URL="${1:-}"; CHECK=1; [ "${2:-}" = "--no-check" ] && CHECK=0
URL="${URL%/}"
if ! [[ "$URL" =~ ^https://[a-z0-9.-]+\.[a-z]{2,}$ ]]; then
  echo "Give the website's address, e.g. https://motionaudio.org (https, no path)." >&2; exit 1
fi
if [ "$CHECK" = 1 ]; then
  if ! curl -fsS --max-time 15 "$URL/health" | grep -q '"ok":true'; then
    echo "$URL/health didn't answer {\"ok\":true}. Is the site online at that address? (Use --no-check to set it anyway.)" >&2; exit 1
  fi
  echo "The website answers at $URL."
fi
F="$ROOT/js/license.js"
grep -q '^  var SERVER = "' "$F" || { echo "js/license.js has no SERVER line to change" >&2; exit 1; }
sed -i -E "s#^  var SERVER = \"[^\"]*\";#  var SERVER = \"$URL\";#" "$F"
grep -n '^  var SERVER = ' "$F"
echo "Every app now points at $URL. Next: a quick fix release (bump-version.sh, release notes, push to main)."

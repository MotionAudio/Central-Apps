#!/bin/bash
# CI helper: runs a command; if it fails, its last lines become an error annotation on the run (readable in
# the run's summary without downloading logs), then it fails with the same code.
#   bash tools/ci-run.sh "<title>" <command...>
title="$1"; shift
log="$(mktemp)"
"$@" 2>&1 | tee "$log"; code=${PIPESTATUS[0]}
if [ "$code" != "0" ]; then
  tail -c 3500 "$log" | sed -e 's/%/%25/g' -e 's/\r/%0D/g' | awk 'BEGIN{ORS="%0A"} {print}' > "$log.tail"
  echo "::error title=$title (exit $code)::$(cat "$log.tail")"
fi
rm -f "$log" "$log.tail"; exit "$code"

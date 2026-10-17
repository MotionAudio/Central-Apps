#!/bin/bash
# Smoke test of the Central Pedal driver: starts it simulated, asks http://127.0.0.1:8080/api/info, stops it.
#   bash tools/smoke-driver.sh <driver command...>      e.g.  python3 pedal-driver.py   or   driver-dist/pedal-driver/pedal-driver
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; D="$(mktemp -d)"
"$@" --simulate "$D" --app-root "$ROOT" > "$D/driver.log" 2>&1 &
P=$!
ok=""
for i in $(seq 1 90); do
  if out=$(curl -fsS --max-time 2 http://127.0.0.1:8080/api/info 2>/dev/null); then ok=1; echo "api/info: $out" | cut -c1-300; break; fi
  if ! kill -0 $P 2>/dev/null; then break; fi
  sleep 1
done
if [ -n "$ok" ]; then
  curl -fsS --max-time 3 -o /dev/null http://127.0.0.1:8766/app/ && echo "app page served" || { echo "the app page is not served"; ok=""; }
fi
kill $P 2>/dev/null; sleep 1; kill -9 $P 2>/dev/null
if [ -z "$ok" ]; then echo "DRIVER SMOKE TEST FAILED"; tail -40 "$D/driver.log"; exit 1; fi
echo "DRIVER SMOKE TEST PASSED"

#!/bin/bash
# Copies the shared design tokens (css/central-tokens.css, see docs/DESIGN-SYSTEM.md) to the website, to Central
# Services' page and to the GitHub Pages download page (docs/). Change the tokens in css/ only, then run this.
# server/test/tokens.mjs fails if a copy is stale.
#   bash tools/sync-tokens.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
for dest in server/public/central-tokens.css server/public/services/central-tokens.css docs/central-tokens.css; do
  cp "$ROOT/css/central-tokens.css" "$ROOT/$dest"
done
echo "design tokens copied"

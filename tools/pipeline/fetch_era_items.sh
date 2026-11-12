#!/usr/bin/env bash
# Downloads Classic Era ItemSparse (explicit MinDamage/MaxDamage columns), used as the weapon
# fallback for items missing from the Forever client data.
# Usage: tools/pipeline/fetch_era_items.sh [ERA_BUILD=1.15.9.70576] [OUT=data/raw/<ERA_BUILD>]
set -euo pipefail
ERA_BUILD="${1:-1.15.9.70576}"
OUT="${2:-data/raw/$ERA_BUILD}"
mkdir -p "$OUT"
code=$(curl -s --max-time 600 -o "$OUT/ItemSparse.csv" -w '%{http_code}' \
  "https://wago.tools/db2/ItemSparse/csv?build=$ERA_BUILD")
if [[ "$code" != 200 ]]; then echo "ERROR ItemSparse -> HTTP $code"; rm -f "$OUT/ItemSparse.csv"; exit 1; fi
echo "ok  ItemSparse ($(($(wc -l < "$OUT/ItemSparse.csv") - 1)) rows) -> $OUT"

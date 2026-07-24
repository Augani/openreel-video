#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

BUCKET="${OPENREEL_FILTERS_BUCKET:-openreel-filters}"
OUT="${OUT_DIR:-out}"

if [[ ! -f "$OUT/manifest.json" ]]; then
  echo "Run generate.py first (no $OUT/manifest.json)." >&2
  exit 1
fi

echo "Uploading .cube files..."
for cube in "$OUT"/cube/*.cube; do
  key="cube/$(basename "$cube")"
  wrangler r2 object put "$BUCKET/$key" \
    --file "$cube" \
    --content-type "text/plain" \
    --cache-control "public, max-age=31536000, immutable" \
    --remote
done

echo "Uploading manifest..."
wrangler r2 object put "$BUCKET/manifest.json" \
  --file "$OUT/manifest.json" \
  --content-type "application/json" \
  --cache-control "public, max-age=300, s-maxage=3600" \
  --remote

echo "Done. https://filters.openreel.video/manifest.json"

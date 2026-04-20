#!/usr/bin/env bash
set -euo pipefail

BUNDLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_PATH="$BUNDLE_DIR/docker-compose.offline.yml"

echo "Checking Docker daemon..."
docker version >/dev/null

if [[ ! -f "$COMPOSE_PATH" ]]; then
  echo "Compose file not found: $COMPOSE_PATH" >&2
  exit 1
fi

echo "Stopping OpenReel offline container"
docker compose -f "$COMPOSE_PATH" down

echo "OpenReel offline container stopped."

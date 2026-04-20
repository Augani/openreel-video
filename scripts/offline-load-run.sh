#!/usr/bin/env bash
set -euo pipefail

BUNDLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TAR_PATH="$BUNDLE_DIR/openreel-offline.tar"
COMPOSE_PATH="$BUNDLE_DIR/docker-compose.offline.yml"

echo "Checking Docker daemon..."
docker version >/dev/null

if [[ ! -f "$TAR_PATH" ]]; then
  echo "Offline image archive not found: $TAR_PATH" >&2
  exit 1
fi

if [[ ! -f "$COMPOSE_PATH" ]]; then
  echo "Compose file not found: $COMPOSE_PATH" >&2
  exit 1
fi

echo "Loading Docker image from: $TAR_PATH"
docker load -i "$TAR_PATH"

echo "Starting OpenReel offline container"
docker compose -f "$COMPOSE_PATH" up -d

echo "OpenReel is starting at: http://localhost:8080"

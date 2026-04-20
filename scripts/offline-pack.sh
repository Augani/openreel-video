#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE_DIR="$ROOT_DIR/offline-bundle"
IMAGE="openreel-offline:latest"
TAR_PATH="$BUNDLE_DIR/openreel-offline.tar"

mkdir -p "$BUNDLE_DIR"

echo "Checking Docker daemon..."
docker version >/dev/null

echo "Building Docker image: $IMAGE"
docker build -t "$IMAGE" "$ROOT_DIR"

echo "Saving image to: $TAR_PATH"
docker save -o "$TAR_PATH" "$IMAGE"

cp "$ROOT_DIR/docker-compose.offline.yml" "$BUNDLE_DIR/"
cp "$ROOT_DIR/scripts/offline-load-run.ps1" "$BUNDLE_DIR/"
cp "$ROOT_DIR/scripts/offline-load-run.sh" "$BUNDLE_DIR/"
cp "$ROOT_DIR/scripts/offline-load-run.bat" "$BUNDLE_DIR/"
cp "$ROOT_DIR/scripts/offline-stop.ps1" "$BUNDLE_DIR/"
cp "$ROOT_DIR/scripts/offline-stop.sh" "$BUNDLE_DIR/"
cp "$ROOT_DIR/scripts/offline-stop.bat" "$BUNDLE_DIR/"
cp "$ROOT_DIR/OFFLINE-DELIVERY.md" "$BUNDLE_DIR/"

echo "Offline bundle created at: $BUNDLE_DIR"

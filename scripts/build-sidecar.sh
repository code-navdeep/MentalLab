#!/bin/bash
# Builds the applekit Swift sidecar (Apple Intelligence + EventKit bridge).
# Skips gracefully when the toolchain can't build it — the app runs without
# it, hiding Apple-dependent features.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SIDECAR="$ROOT/sidecar/applekit"

if ! command -v swift >/dev/null 2>&1; then
  echo "sidecar: swift toolchain not found — skipping applekit build"
  exit 0
fi

cd "$SIDECAR"
if swift build -c release 2>&1; then
  BIN="$SIDECAR/.build/release/applekit"
  echo "sidecar: built $BIN"
else
  echo "sidecar: build failed (SDK too old?) — continuing without applekit"
fi

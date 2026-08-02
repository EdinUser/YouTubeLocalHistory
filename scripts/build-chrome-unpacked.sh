#!/usr/bin/env bash
# Unpacked Chrome extension in build/e2e/chrome - no CRX/signing (for Playwright / dev load).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rm -rf "$ROOT/build/e2e/chrome"
mkdir -p "$ROOT/build/e2e/chrome"

node "$ROOT/merge_locales.js" "build/e2e/chrome/_locales"

# This is a development/E2E package. Copy every source module so manifest
# dependencies and HTML-loaded modules cannot drift from this builder.
cp "$ROOT"/src/*.js "$ROOT"/src/*.html "$ROOT/build/e2e/chrome/"
cp "$ROOT/src/icon"*.png "$ROOT/build/e2e/chrome/"
cp "$ROOT/src/manifest.chrome.json" "$ROOT/build/e2e/chrome/manifest.json"

echo "Unpacked Chrome E2E extension: $ROOT/build/e2e/chrome"

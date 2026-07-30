#!/usr/bin/env bash
# Unpacked Chrome extension in build/e2e/chrome - no CRX/signing (for Playwright / dev load).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rm -rf "$ROOT/build/e2e/chrome"
mkdir -p "$ROOT/build/e2e/chrome"

node "$ROOT/merge_locales.js" "build/e2e/chrome/_locales"

cp "$ROOT/src/background.js" \
   "$ROOT/src/content.js" \
   "$ROOT/src/popup.html" \
   "$ROOT/src/popup.js" \
   "$ROOT/src/storage.js" \
   "$ROOT/src/indexeddb-storage.js" \
   "$ROOT/build/e2e/chrome/"
cp "$ROOT/src/icon"*.png "$ROOT/build/e2e/chrome/"
cp "$ROOT/src/manifest.chrome.json" "$ROOT/build/e2e/chrome/manifest.json"

echo "Unpacked Chrome E2E extension: $ROOT/build/e2e/chrome"

#!/usr/bin/env bash
# Unpacked Chrome extension in build/chrome — no CRX/signing (for Playwright / dev load).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$ROOT/build/chrome"

node "$ROOT/merge_locales.js"

cp "$ROOT/src/background.js" \
   "$ROOT/src/content.js" \
   "$ROOT/src/popup.html" \
   "$ROOT/src/popup.js" \
   "$ROOT/src/storage.js" \
   "$ROOT/src/indexeddb-storage.js" \
   "$ROOT/build/chrome/"
cp "$ROOT/src/icon"*.png "$ROOT/build/chrome/"
cp "$ROOT/src/manifest.chrome.json" "$ROOT/build/chrome/manifest.json"

echo "Unpacked extension: $ROOT/build/chrome"

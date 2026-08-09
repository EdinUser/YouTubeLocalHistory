#!/usr/bin/env bash
# Unpacked Chrome extension in build/e2e/chrome - no CRX/signing (for Playwright / dev load).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Keep the directory Chrome loaded stable. Removing and recreating it causes
# Chrome to invalidate the unpacked extension, leaving its Reload action with
# a transient "missing file" error even after the build has completed.
mkdir -p "$ROOT/build/e2e/chrome"

node "$ROOT/merge_locales.js" "build/e2e/chrome/_locales"

# This is a development/E2E package. Copy every source module so manifest
# dependencies and HTML-loaded modules cannot drift from this builder. Remove
# top-level JS/HTML files that no longer exist in src without replacing the
# directory Chrome has already loaded.
for built_file in "$ROOT"/build/e2e/chrome/*.js "$ROOT"/build/e2e/chrome/*.html; do
  [[ -e "$built_file" ]] || continue
  source_file="$ROOT/src/${built_file##*/}"
  if [[ ! -e "$source_file" ]]; then
    rm -f -- "$built_file"
  fi
done

cp "$ROOT"/src/*.js "$ROOT"/src/*.html "$ROOT/build/e2e/chrome/"
cp "$ROOT/src/icon"*.png "$ROOT/build/e2e/chrome/"
cp "$ROOT/src/manifest.chrome.json" "$ROOT/build/e2e/chrome/manifest.json"

echo "Unpacked Chrome E2E extension: $ROOT/build/e2e/chrome"

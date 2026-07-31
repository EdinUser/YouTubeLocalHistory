#!/usr/bin/env bash
# Unpacked Firefox extension in build/e2e/firefox for web-ext lint/run and Firefox E2E.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rm -rf "$ROOT/build/e2e/firefox" "$ROOT/build/e2e/firefox-e2e.xpi"
mkdir -p "$ROOT/build/e2e/firefox"

node "$ROOT/merge_locales.js" "build/e2e/firefox/_locales"

cp "$ROOT/src/background.js" \
   "$ROOT/src/content.js" \
   "$ROOT/src/popup.html" \
   "$ROOT/src/popup.js" \
   "$ROOT/src/storage.js" \
   "$ROOT/src/indexeddb-storage.js" \
   "$ROOT/build/e2e/firefox/"
cp "$ROOT/src/icon"*.png "$ROOT/build/e2e/firefox/"
cp "$ROOT/src/manifest.firefox.json" "$ROOT/build/e2e/firefox/manifest.json"

node - "$ROOT/build/e2e/firefox/manifest.json" <<'NODE'
const fs = require('node:fs');

const manifestPath = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const localFixtureMatch = 'http://127.0.0.1/*';

manifest.host_permissions = Array.from(new Set([
  ...(manifest.host_permissions || []),
  localFixtureMatch,
]));

for (const contentScript of manifest.content_scripts || []) {
  contentScript.matches = Array.from(new Set([
    ...(contentScript.matches || []),
    localFixtureMatch,
  ]));
}

for (const resource of manifest.web_accessible_resources || []) {
  resource.matches = Array.from(new Set([
    ...(resource.matches || []),
    localFixtureMatch,
  ]));
}

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 4)}\n`);
NODE

NO_UPDATE_NOTIFIER=1 web-ext build \
  --source-dir "$ROOT/build/e2e/firefox" \
  --artifacts-dir "$ROOT/build/e2e" \
  --filename firefox-e2e.xpi \
  --overwrite-dest \
  --no-input \
  --no-config-discovery

echo "Unpacked Firefox E2E extension: $ROOT/build/e2e/firefox"
echo "Packaged Firefox E2E extension: $ROOT/build/e2e/firefox-e2e.xpi"

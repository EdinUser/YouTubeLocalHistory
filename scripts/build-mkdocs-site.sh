#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_RELATIVE="${1:-}"
MKDOCS_IMAGE="rewatch-mkdocs-builder:9.7.7"

case "$OUTPUT_RELATIVE" in
  site|helpers/mkdocs/site)
    ;;
  *)
    echo "Unsupported documentation output: ${OUTPUT_RELATIVE:-<missing>}" >&2
    echo "Use 'site' for CI/CD or 'helpers/mkdocs/site' for the local preview." >&2
    exit 2
    ;;
esac

OUTPUT_DIRECTORY="$PROJECT_ROOT/$OUTPUT_RELATIVE"
STAGING_DIRECTORY="$(mktemp -d)"
STAGED_PROJECT="$STAGING_DIRECTORY/project"

cleanup() {
  if [[ -n "${STAGING_DIRECTORY:-}" && -d "$STAGING_DIRECTORY" ]]; then
    rm -rf -- "$STAGING_DIRECTORY"
  fi
}
trap cleanup EXIT

mkdir -p "$STAGED_PROJECT/docs" "$OUTPUT_DIRECTORY"
cp "$PROJECT_ROOT/mkdocs.yml" "$STAGED_PROJECT/mkdocs.yml"
cp -a "$PROJECT_ROOT/docs/." "$STAGED_PROJECT/docs/"

cd "$PROJECT_ROOT"
npm run docs:safety
npm run build:e2e:chrome
node scripts/generate-docs-screenshots.js \
  --output-dir "$STAGED_PROJECT/docs/assets/guide"

docker build \
  --file "$PROJECT_ROOT/scripts/mkdocs.Dockerfile" \
  --tag "$MKDOCS_IMAGE" \
  "$PROJECT_ROOT/scripts"

docker run --rm \
  --user "$(id -u):$(id -g)" \
  --volume "$STAGED_PROJECT:/docs:ro" \
  --volume "$OUTPUT_DIRECTORY:/site" \
  "$MKDOCS_IMAGE" \
  build --strict --clean --site-dir /site

node -e '
  const fs = require("node:fs");
  const path = require("node:path");
  const catalog = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const site = process.argv[2];
  const required = [
    path.join(site, "index.html"),
    ...catalog.screenshots.map((item) =>
      path.join(site, "assets", "guide", path.basename(item.output))),
  ];
  const missing = required.filter((file) => !fs.existsSync(file) || fs.statSync(file).size === 0);
  if (missing.length) {
    throw new Error(`Incomplete documentation output:\n${missing.join("\n")}`);
  }
  console.log(`Verified documentation output and ${catalog.screenshots.length} screenshots in ${site}`);
' "$PROJECT_ROOT/scripts/docs-screenshot-catalog.json" "$OUTPUT_DIRECTORY"

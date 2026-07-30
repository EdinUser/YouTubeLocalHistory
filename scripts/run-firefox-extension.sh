#!/usr/bin/env bash
# Launch Firefox with the unpacked extension in an isolated temporary profile.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ytlh-firefox-profile.XXXXXX")"

cleanup() {
  rm -rf "$PROFILE_DIR"
}
trap cleanup EXIT

NO_UPDATE_NOTIFIER=1 web-ext run \
  --source-dir "$ROOT/build/e2e/firefox" \
  --firefox-profile "$PROFILE_DIR" \
  --profile-create-if-missing \
  --no-input \
  --no-config-discovery \
  "$@"

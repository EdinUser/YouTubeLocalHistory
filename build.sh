#!/bin/bash

# Use environment variables with fallbacks for security (paths not exposed in git)
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Recreate build directories so clean and repeated builds start from the same
# empty filesystem state.
rm -rf -- "$PROJECT_ROOT/build/chrome" "$PROJECT_ROOT/build/firefox"
mkdir -p "$PROJECT_ROOT/build/chrome" "$PROJECT_ROOT/build/firefox" "$PROJECT_ROOT/dist"

# Get current version from manifest
VERSION=$(grep '"version"' "$PROJECT_ROOT/src/manifest.chrome.json" | cut -d'"' -f4)
CHROME_ZIP_PATH="$PROJECT_ROOT/dist/youtube-local-history-chrome-v$VERSION.zip"
FIREFOX_ZIP_PATH="$PROJECT_ROOT/dist/youtube-local-history-firefox-v$VERSION.zip"

# zip updates existing archives in place, so remove only the exact outputs for
# this version before packaging to prevent deleted files from surviving.
rm -f -- "$CHROME_ZIP_PATH" "$FIREFOX_ZIP_PATH"

# Merge locale files before copying - FIX: Use absolute path
node "$PROJECT_ROOT/merge_locales.js"

# Function to copy common files
copy_common_files() {
    local target_dir=$1
    cp "$PROJECT_ROOT/src/background.js" \
       "$PROJECT_ROOT/src/content.js" \
       "$PROJECT_ROOT/src/content-css.js" \
       "$PROJECT_ROOT/src/content-url.js" \
       "$PROJECT_ROOT/src/content-import.js" \
       "$PROJECT_ROOT/src/content-playlists.js" \
       "$PROJECT_ROOT/src/content-info.js" \
       "$PROJECT_ROOT/src/content-thumbnails.js" \
       "$PROJECT_ROOT/src/content-messages.js" \
       "$PROJECT_ROOT/src/popup.html" \
       "$PROJECT_ROOT/src/popup-preload.js" \
       "$PROJECT_ROOT/src/popup-core.js" \
       "$PROJECT_ROOT/src/popup-utils.js" \
       "$PROJECT_ROOT/src/popup-import.js" \
       "$PROJECT_ROOT/src/popup-settings.js" \
       "$PROJECT_ROOT/src/popup-search.js" \
       "$PROJECT_ROOT/src/popup-data-pages.js" \
       "$PROJECT_ROOT/src/popup-history-display.js" \
       "$PROJECT_ROOT/src/popup-video-pagination.js" \
       "$PROJECT_ROOT/src/popup-analytics-core.js" \
       "$PROJECT_ROOT/src/popup-analytics-charts.js" \
       "$PROJECT_ROOT/src/popup-analytics-extra.js" \
       "$PROJECT_ROOT/src/popup-playlists.js" \
       "$PROJECT_ROOT/src/popup-subscriptions.js" \
       "$PROJECT_ROOT/src/popup-theme.js" \
       "$PROJECT_ROOT/src/popup-shorts.js" \
       "$PROJECT_ROOT/src/popup-localization.js" \
       "$PROJECT_ROOT/src/popup.js" \
       "$PROJECT_ROOT/src/import.html" \
       "$PROJECT_ROOT/src/import.js" \
       "$PROJECT_ROOT/src/feed.html" \
       "$PROJECT_ROOT/src/feed-async.js" \
       "$PROJECT_ROOT/src/feed-contracts.js" \
       "$PROJECT_ROOT/src/rss-parser.js" \
       "$PROJECT_ROOT/src/rss-client.js" \
       "$PROJECT_ROOT/src/feed-ingestion.js" \
       "$PROJECT_ROOT/src/feed-enrichment.js" \
       "$PROJECT_ROOT/src/feed-channel-metadata.js" \
       "$PROJECT_ROOT/src/feed-retention.js" \
       "$PROJECT_ROOT/src/feed-channel-classification.js" \
       "$PROJECT_ROOT/src/feed-scheduler.js" \
       "$PROJECT_ROOT/src/feed-view-data.js" \
       "$PROJECT_ROOT/src/feed-subscription-import.js" \
       "$PROJECT_ROOT/src/feed-view-preference.js" \
       "$PROJECT_ROOT/src/feed-state-utils.js" \
       "$PROJECT_ROOT/src/feed-cards.js" \
       "$PROJECT_ROOT/src/feed-local-search.js" \
       "$PROJECT_ROOT/src/feed-home.js" \
       "$PROJECT_ROOT/src/feed-analytics.js" \
       "$PROJECT_ROOT/src/feed-subscriptions-view.js" \
       "$PROJECT_ROOT/src/feed-playlist-import.js" \
       "$PROJECT_ROOT/src/feed-playlists-view.js" \
       "$PROJECT_ROOT/src/feed-history-view.js" \
       "$PROJECT_ROOT/src/feed-settings.js" \
       "$PROJECT_ROOT/src/feed-localization.js" \
       "$PROJECT_ROOT/src/feed-backup.js" \
       "$PROJECT_ROOT/src/feed-subscribe-results.js" \
       "$PROJECT_ROOT/src/feed-channel-view.js" \
       "$PROJECT_ROOT/src/feed-refresh.js" \
       "$PROJECT_ROOT/src/feed.js" \
       "$PROJECT_ROOT/src/storage.js" \
       "$PROJECT_ROOT/src/local-subscription-actions.js" \
       "$PROJECT_ROOT/src/content-subscriptions.js" \
       "$PROJECT_ROOT/src/indexeddb-storage.js" \
       "$target_dir/"
    cp "$PROJECT_ROOT/src/icon"*.png "$target_dir/"
    # Removed copying of _locales directory
}

# Build Chrome extension
echo "Building Chrome extension..."
copy_common_files "$PROJECT_ROOT/build/chrome"
cp "$PROJECT_ROOT/src/manifest.chrome.json" "$PROJECT_ROOT/build/chrome/manifest.json"

# Sign the Chrome extension with private key for Verified CRX Uploads
echo "Signing Chrome extension..."
# Use environment variables with fallbacks for security (paths not exposed in git)
CHROME_EXTENSION_DIR="${CHROME_EXTENSION_DIR:-$PROJECT_ROOT/build/chrome}"
PRIVATE_KEY_PATH="${PRIVATE_KEY_PATH:-$PROJECT_ROOT/certs/privatekey.pem}"

CHROME_BIN="$(command -v google-chrome-stable || command -v google-chrome || true)"

if [ -z "$CHROME_BIN" ]; then
    echo "Error: Google Chrome is not installed."
    echo "Install it with: sudo dnf install google-chrome-stable"
    exit 1
fi

"$CHROME_BIN" \
    --pack-extension="$CHROME_EXTENSION_DIR" \
    --pack-extension-key="$PRIVATE_KEY_PATH"

# Copy the generated .crx file to dist directory with proper naming
# Chrome creates the .crx file in the build directory, not inside the chrome subdirectory
CRX_SOURCE="$PROJECT_ROOT/build/chrome.crx"
CRX_DEST="$PROJECT_ROOT/dist/youtube-local-history-chrome-v$VERSION.crx"
if [ -f "$CRX_SOURCE" ]; then
    cp "$CRX_SOURCE" "$CRX_DEST"
    rm "$CRX_SOURCE"  # Remove the .crx file from build directory to avoid leftovers
    echo "Signed .crx file copied to dist/"
else
    echo "Warning: .crx file was not generated at $CRX_SOURCE"
fi

# Create zip file (keeping existing process for compatibility)
cd "$PROJECT_ROOT/build/chrome"
zip -r "$CHROME_ZIP_PATH" ./* -x ".*"
cd ../..

# Build Firefox extension
echo "Building Firefox extension..."
copy_common_files "$PROJECT_ROOT/build/firefox"
cp "$PROJECT_ROOT/src/manifest.firefox.json" "$PROJECT_ROOT/build/firefox/manifest.json"
cd "$PROJECT_ROOT/build/firefox"
# Zip every file selected by copy_common_files so the archive cannot drift from
# the Firefox build directory.
zip -j "$FIREFOX_ZIP_PATH" ./* -x ".*"
# Include _locales in the Firefox zip if it exists
if [ -d _locales ]; then
    zip -r "$FIREFOX_ZIP_PATH" _locales -x ".*"
fi
cd ../..

echo -e "\nBuild complete!"
echo "Chrome extension (ZIP): dist/youtube-local-history-chrome-v$VERSION.zip"
echo "Chrome extension (CRX): dist/youtube-local-history-chrome-v$VERSION.crx"
echo "Firefox extension: dist/youtube-local-history-firefox-v$VERSION.zip"
echo -e "\nPackage contents:"
ls -lh dist/

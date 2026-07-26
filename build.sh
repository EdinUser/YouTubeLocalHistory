#!/bin/bash

# Use environment variables with fallbacks for security (paths not exposed in git)
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Clean build directories - FIX: Remove quotes around globs to allow expansion
rm -rf $PROJECT_ROOT/build/chrome/* $PROJECT_ROOT/build/firefox/*

# Create dist directory if it doesn't exist
mkdir -p "$PROJECT_ROOT/dist"

# Get current version from manifest
VERSION=$(grep '"version"' "$PROJECT_ROOT/src/manifest.chrome.json" | cut -d'"' -f4)

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
       "$PROJECT_ROOT/src/feed-core.js" \
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
       "$PROJECT_ROOT/src/feed-data-pipeline.js" \
       "$PROJECT_ROOT/src/feed-subscribe-results.js" \
       "$PROJECT_ROOT/src/feed-youtube-search-core.js" \
       "$PROJECT_ROOT/src/feed-youtube-search-render.js" \
       "$PROJECT_ROOT/src/feed-channel-view.js" \
       "$PROJECT_ROOT/src/feed-refresh.js" \
       "$PROJECT_ROOT/src/feed.js" \
       "$PROJECT_ROOT/src/storage.js" \
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
google-chrome --pack-extension="$CHROME_EXTENSION_DIR" --pack-extension-key="$PRIVATE_KEY_PATH"

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
zip -r "../../dist/youtube-local-history-chrome-v$VERSION.zip" ./* -x ".*"
cd ../..

# Build Firefox extension
echo "Building Firefox extension..."
copy_common_files "$PROJECT_ROOT/build/firefox"
cp "$PROJECT_ROOT/src/manifest.firefox.json" "$PROJECT_ROOT/build/firefox/manifest.json"
cd "$PROJECT_ROOT/build/firefox"
# For Firefox, we need to zip the files directly, not the directory
zip -j "../../dist/youtube-local-history-firefox-v$VERSION.zip" manifest.json background.js content.js content-css.js content-url.js content-import.js content-playlists.js content-info.js content-thumbnails.js content-messages.js popup.html popup-core.js popup-utils.js popup-import.js popup-settings.js popup-search.js popup-data-pages.js popup-history-display.js popup-video-pagination.js popup-analytics-core.js popup-analytics-charts.js popup-analytics-extra.js popup-playlists.js popup-subscriptions.js popup-theme.js popup-shorts.js popup-localization.js popup.js import.html import.js feed.html feed-core.js feed-state-utils.js feed-cards.js feed-local-search.js feed-home.js feed-analytics.js feed-subscriptions-view.js feed-playlist-import.js feed-playlists-view.js feed-history-view.js feed-settings.js feed-localization.js feed-backup.js feed-data-pipeline.js feed-subscribe-results.js feed-youtube-search-core.js feed-youtube-search-render.js feed-channel-view.js feed-refresh.js feed.js storage.js content-subscriptions.js indexeddb-storage.js icon*.png -x ".*"
# Include _locales in the Firefox zip if it exists
if [ -d _locales ]; then
    zip -r "../../dist/youtube-local-history-firefox-v$VERSION.zip" _locales -x ".*"
fi
cd ../..

echo -e "\nBuild complete!"
echo "Chrome extension (ZIP): dist/youtube-local-history-chrome-v$VERSION.zip"
echo "Chrome extension (CRX): dist/youtube-local-history-chrome-v$VERSION.crx"
echo "Firefox extension: dist/youtube-local-history-firefox-v$VERSION.zip"
echo -e "\nPackage contents:"
ls -lh dist/

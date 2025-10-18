#!/bin/bash

# Use environment variables with fallbacks for security (paths not exposed in git)
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Clean build directories
rm -rf "$PROJECT_ROOT/build/chrome/*" "$PROJECT_ROOT/build/firefox/*"

# Create dist directory if it doesn't exist
mkdir -p "$PROJECT_ROOT/dist"

# Get current version from manifest
VERSION=$(grep '"version"' "$PROJECT_ROOT/src/manifest.chrome.json" | cut -d'"' -f4)

# Merge locale files before copying
node merge_locales.js

# Function to copy common files
copy_common_files() {
    local target_dir=$1
    cp "$PROJECT_ROOT/src/background.js" "$PROJECT_ROOT/src/content.js" "$PROJECT_ROOT/src/popup.html" "$PROJECT_ROOT/src/popup.js" "$PROJECT_ROOT/src/storage.js" "$PROJECT_ROOT/src/sync-service.js" "$target_dir/"
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
cp src/manifest.firefox.json "$PROJECT_ROOT/build/firefox/manifest.json"
cd "$PROJECT_ROOT/build/firefox"
# For Firefox, we need to zip the files directly, not the directory
zip -j "../../dist/youtube-local-history-firefox-v$VERSION.zip" manifest.json background.js content.js popup.html popup.js storage.js sync-service.js icon*.png -x ".*"
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
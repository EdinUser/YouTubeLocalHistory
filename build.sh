#!/bin/bash

# Clean build directories
rm -rf build/chrome/* build/firefox/*

# Create dist directory if it doesn't exist
mkdir -p dist

# Get current version from manifest
VERSION=$(grep '"version"' src/manifest.chrome.json | cut -d'"' -f4)

# Function to copy common files
copy_common_files() {
    local target_dir=$1
    cp src/{background.js,content.js,popup.html,popup.js,storage.js,sync-service.js} "$target_dir/"
    cp src/icon*.png "$target_dir/"
}

# Build Chrome extension
echo "Building Chrome extension..."
copy_common_files "build/chrome"
cp src/manifest.chrome.json "build/chrome/manifest.json"
cd build/chrome
zip -r "../../dist/youtube-local-history-chrome-v$VERSION.zip" ./* -x ".*"
cd ../..

# Build Firefox extension
echo "Building Firefox extension..."
copy_common_files "build/firefox"
cp src/manifest.firefox.json "build/firefox/manifest.json"
cd build/firefox
# For Firefox, we need to zip the files directly, not the directory  
zip -j "../../dist/youtube-local-history-firefox-v$VERSION.zip" manifest.json background.js content.js popup.html popup.js storage.js sync-service.js icon*.png -x ".*"
cd ../..

echo -e "\nBuild complete!"
echo "Chrome extension: dist/youtube-local-history-chrome-v$VERSION.zip"
echo "Firefox extension: dist/youtube-local-history-firefox-v$VERSION.zip"
echo -e "\nPackage contents:"
ls -lh dist/ 
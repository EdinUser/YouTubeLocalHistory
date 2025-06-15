#!/bin/bash

# Create dist directory if it doesn't exist
mkdir -p dist

# Get current version from manifest.json (assuming both extensions have the same version)
VERSION=$(grep '"version"' chrome_extension/manifest.json | cut -d'"' -f4)

# Package Chrome extension
zip -r "dist/youtube-local-history-chrome-v$VERSION.zip" chrome_extension/* -x "chrome_extension/.*" -x "chrome_extension/README.md"
echo "Chrome extension packaged: dist/youtube-local-history-chrome-v$VERSION.zip"

# Package Firefox extension
zip -r "dist/youtube-local-history-firefox-v$VERSION.zip" firefox_extension/* -x "firefox_extension/.*" -x "firefox_extension/README.md"
echo "Firefox extension packaged: dist/youtube-local-history-firefox-v$VERSION.zip"

echo "\nPackaging complete!"
ls -lh dist/

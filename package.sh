#!/bin/bash

# Exit immediately if a command fails
set -e

# --- Configuration ---
# Directories containing the extension source code
SOURCE_DIRS=("firefox_extension" "chrome_extension")
# Directory where the final .zip files will be placed
OUTPUT_DIR="dist"

# --- Script ---
# Get the absolute path of the directory containing this script
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" &>/dev/null && pwd)
cd "$SCRIPT_DIR"

echo "Starting extension packaging process..."
echo "Output directory: $OUTPUT_DIR"

# Create the output directory if it doesn't exist
mkdir -p "$OUTPUT_DIR"

# Loop through each source directory and package it
for SOURCE in "${SOURCE_DIRS[@]}"; do
    if [ ! -d "$SOURCE" ]; then
        echo "⚠️ Warning: Source directory '$SOURCE' not found. Skipping."
        continue
    fi

    OUTPUT_NAME="${SOURCE}.zip"
    OUTPUT_PATH="$SCRIPT_DIR/$OUTPUT_DIR/$OUTPUT_NAME"

    echo "--------------------------------------------------"
    echo "📦 Packaging '$SOURCE' into '$OUTPUT_DIR/$OUTPUT_NAME'"

    # Go into the source directory to zip its contents
    cd "$SCRIPT_DIR/$SOURCE"

    # Create the zip file, excluding common unnecessary files
    # The path to the zip file is relative to the directory we're in
    zip -r "../$OUTPUT_DIR/$OUTPUT_NAME" . -x "*/.*" "*.sh" "*/.idea*" "*/.vscode*"

    echo "✅ Successfully created: $OUTPUT_PATH"
    
    # Go back to the script's root directory for the next loop
    cd "$SCRIPT_DIR"
done

echo "--------------------------------------------------"
echo "🎉 All extensions packaged successfully!" 
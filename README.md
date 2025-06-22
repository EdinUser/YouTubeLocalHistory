# YouTube Local History Tracker

A browser extension that tracks your YouTube video watch history locally using secure browser storage. This extension automatically saves your progress in videos and shows visual indicators for videos you've already watched.

## Features

- **Automatic Progress Tracking**: Saves your current position in videos automatically
- **Visual Indicators**: Shows "viewed" labels and progress bars on video thumbnails
- **Local Storage**: All data is stored locally on your device using secure browser storage
- **Playlist Tracking**: Saves playlist information for easy access
- **Export/Import**: Backup and restore your watch history
- **Customizable Settings**: Adjust overlay appearance and auto-cleanup settings
- **Cross-Browser Support**: Works on Chrome and Firefox

## Installation

### Chrome
1. Run `./build.sh` to build the extension
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the `dist/chrome` folder

### Firefox
1. Run `./build.sh` to build the extension
2. Open Firefox and go to `about:debugging#/runtime/this-firefox`
3. Click "Load Temporary Add-on" and select the `manifest.json` file from the `dist/firefox` folder

**Note**: Both extensions are now fully synced and use the same secure storage system with automatic migration from IndexedDB.

## Storage System

This extension uses `chrome.storage.local` (Chrome) or `browser.storage.local` (Firefox) for secure data storage instead of IndexedDB. This provides better security as the data cannot be easily accessed through browser developer tools.

### Migration from IndexedDB

If you're updating from a previous version that used IndexedDB, the extension will automatically migrate your existing data to the new storage system on first run. The migration process:

1. Reads all existing data from IndexedDB
2. Transfers it to the new storage system
3. Marks the migration as complete to avoid re-migration

### Data Structure

The extension stores three types of data:

- **Video History**: Video IDs, timestamps, progress, titles, and URLs
- **Playlist History**: Playlist IDs, titles, and URLs
- **Settings**: User preferences for overlay appearance and cleanup

## Usage

1. **Install the extension** following the instructions above
2. **Visit YouTube** and start watching videos
3. **Your progress is automatically saved** every 5 seconds
4. **Click the extension icon** to view your watch history
5. **Use the settings tab** to customize the overlay appearance

### Settings

- **Auto-clean Period**: Automatically remove history entries older than specified days (1-180 days)
- **Items per Page**: Number of items to show per page in history view (5-20)
- **Overlay Title**: Text to show in the overlay (max 12 characters)
- **Overlay Color**: Color of the progress bar overlay (blue, red, green, purple, orange)
- **Overlay Label Size**: Size of the overlay label and progress bar (small, medium, large, extra large)

## Privacy

- **No Data Collection**: The extension does not collect, transmit, or store any data outside your device
- **Local Storage Only**: All data is stored locally using the browser's secure storage API
- **No External Servers**: The extension does not communicate with any external servers

## Security

The extension uses the browser's built-in storage API (`chrome.storage.local`/`browser.storage.local`) which provides:

- **Encrypted Storage**: Data is stored in an encrypted format
- **Access Control**: Only the extension can access the stored data
- **No Console Access**: Data cannot be easily dumped through browser developer tools

## Troubleshooting

### Extension Not Working
1. Make sure you're on a YouTube page
2. Refresh the page and try again
3. Check if the extension is enabled in your browser

### History Not Loading
1. Close and reopen the popup
2. Refresh the YouTube page
3. Check the browser console for error messages

### Migration Issues
If you experience issues with data migration:
1. The extension will automatically retry migration on next startup
2. If problems persist, you can clear the extension data and start fresh
3. Export your data before clearing if you want to preserve it

## Development

### Project Structure
```
├── src/                      # Source files
│   ├── background/          # Background script
│   ├── content/             # Content scripts
│   ├── popup/               # Popup interface
│   ├── shared/              # Shared utilities and components
│   └── manifest/            # Manifest templates
├── dist/                    # Distribution packages
├── helpers/                 # Build helper scripts
├── build.sh                 # Build script
└── youtube-local-history.user.js  # Userscript version
```

### Building
1. Make changes to the source files in the `src/` directory
2. Run `./build.sh` to build both Chrome and Firefox extensions
3. Test the built extensions in your browser
4. The built extensions will be available in the `dist/` directory

## License

MIT License - see LICENSE file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Changelog

### Version 2.2.0
- **Major Security Update**: Migrated from IndexedDB to `chrome.storage.local`/`browser.storage.local`
- **Automatic Migration**: Existing IndexedDB data is automatically migrated to the new storage system
- **Enhanced Security**: Data is now stored in encrypted format and cannot be easily accessed through browser developer tools
- **Improved Reliability**: Better error handling and storage management
- **Cross-Browser Sync**: Chrome and Firefox extensions are now fully synchronized with identical functionality
- **CSP Compliance**: Removed inline styles to comply with Content Security Policy
- **Updated Descriptions**: Reflects the new secure storage system

### Version 2.1.x
- Added playlist tracking
- Improved thumbnail overlay system
- Enhanced settings management
- Better error handling

### Version 1.x
- Initial release with IndexedDB storage
- Basic video progress tracking
- Simple overlay system

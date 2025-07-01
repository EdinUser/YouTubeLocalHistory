<div align="center">

# <img src="./src/icon128.png" alt="YT re:Watch" width="48" height="48" style="vertical-align: middle; margin-right: 10px;"> YT re:Watch

[![Tests](https://github.com/EdinUser/YouTubeLocalHistory/actions/workflows/ci.yml/badge.svg)](https://github.com/EdinUser/YouTubeLocalHistory/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/EdinUser/YouTubeLocalHistory)](https://github.com/EdinUser/YouTubeLocalHistory/releases)
[![Privacy First](https://img.shields.io/badge/Privacy-First-blueviolet?logo=privateinternetaccess)](https://github.com/EdinUser/YouTubeLocalHistory#privacy)
[![Browser Support](https://img.shields.io/badge/Browser-Chrome_|_Firefox-FF7139?logo=googlechrome&logoColor=white)](https://github.com/EdinUser/YouTubeLocalHistory#installation)
[![Local Storage](https://img.shields.io/badge/Data-Local_Only-important)](https://github.com/EdinUser/YouTubeLocalHistory#data-storage)
[![Telegram Channel](https://img.shields.io/badge/Community-Telegram-2AABEE?logo=telegram&logoColor=white)](https://t.me/+eFftKWGVvSpiZjZk)

</div>

**YT re:Watch** is your personal YouTube companion that keeps track of your video journey. Never lose your place in a video again! This lightweight browser extension automatically saves your progress and helps you pick up right where you left off, all while keeping your data private and secure on your device.

## Features

### 🎬 Video Tracking
- **Automatic Progress Tracking**: Saves your current position in videos automatically with improved timestamp accuracy and instant updates
- **YouTube Shorts Support**: Full tracking and display for YouTube Shorts with dedicated interface
- **Smart Timestamp Loading**: 250ms delay to prevent video interruption with respect for YouTube's state restoration
- **Progress Percentage**: View both watched time and percentage completion for each video
- **Visual Indicators**: Shows "viewed" labels and progress bars on video thumbnails with modern card-based layout

### 🗂️ Data Management
- **Local Storage**: All data is stored locally on your device using secure browser storage (`chrome.storage.local`)
- **Playlist Tracking**: Saves playlist information for easy access with enhanced metrics
- **Export/Import**: Backup and restore your watch history with support for both legacy and new formats
- **Automatic Migration**: Seamless migration from IndexedDB to secure browser storage

### 🔄 Sync & Cross-Device
- **Firefox Sync Integration**: Automatically syncs data across devices when Firefox Sync is enabled
- **Cross-Device Synchronization**: Real-time sync of video history and playlists with conflict resolution
- **Sync Status Indicator**: Visual sync progress with manual sync controls
- **Local Priority**: Local storage takes precedence during sync conflicts to ensure data integrity

### 📊 Analytics & Insights
- **Analytics Dashboard**: Full analytics dashboard with interactive charts
- **Watch Time Distribution**: See your viewing patterns by hour of day
- **Content Type Analysis**: Compare time spent on regular videos vs Shorts
- **Weekly Activity Tracking**: Visualize your weekly YouTube activity
- **Completion Rate Statistics**: Track how often you finish videos
- **Playlist Metrics**: Analyze your playlist viewing habits

### 🎨 User Experience
- **Modern UI/UX**: Card-based layout with thumbnails and improved error messages
- **Dark Theme Support**: Full dark/light theme system with system preference detection
- **Responsive Design**: Theme-aware visualizations and smooth transitions
- **Tab State Persistence**: Extension remembers which tab (Videos, Shorts, Playlists) was last active
- **Customizable Settings**: Adjust overlay appearance, auto-cleanup settings, and theme preferences

### 🔧 Technical Features
- **Cross-Browser Support**: Works on Chrome and Firefox with identical functionality
- **SPA Navigation Handling**: Improved single-page application navigation without video interruption
- **Enhanced Security**: Encrypted data storage that cannot be accessed through browser developer tools
- **Comprehensive Testing**: Full test suite covering sync, storage, and UI functionality

## Installation

### Chrome
#### Option 1: Install from Chrome Web Store
[![Get YT re:Watch on Chrome Web Store](https://img.shields.io/badge/Get_YT_re:Watch_on-Chrome_Web_Store-4285F4?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/local-youtube-video-histo/pebiokefjgdbfnkolmblaaladkmpilba)
[![Chrome Users](https://img.shields.io/chrome-web-store/users/pebiokefjgdbfnkolmblaaladkmpilba?logo=googlechrome&color=green)](https://chromewebstore.google.com/detail/local-youtube-video-histo/pebiokefjgdbfnkolmblaaladkmpilba)
[![Chrome Rating](https://img.shields.io/chrome-web-store/rating/pebiokefjgdbfnkolmblaaladkmpilba?logo=googlechrome)](https://chromewebstore.google.com/detail/local-youtube-video-histo/pebiokefjgdbfnkolmblaaladkmpilba)

#### Option 2: Manual Installation
1. Run `./build.sh` to build the extension
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the `dist/chrome` folder

### Firefox
#### Option 1: Install from Firefox Add-ons
[![Get it on Firefox Add-ons](https://img.shields.io/badge/Get_it_on-Firefox_Add--ons-FF7139?logo=firefox-browser&logoColor=white)](https://addons.mozilla.org/firefox/addon/yt-rewatch/)
[![Firefox Users](https://img.shields.io/amo/users/local-youtube-video-history?logo=firefox&color=blue)](https://addons.mozilla.org/firefox/addon/yt-rewatch/)
[![Firefox Rating](https://img.shields.io/amo/rating/local-youtube-video-history?logo=firefox)](https://addons.mozilla.org/firefox/addon/local-youtube-video-history/)

#### Option 2: Manual Installation
1. Run `./build.sh` to build the extension
2. Open Firefox and go to `about:debugging#/runtime/this-firefox`
3. Click "Load Temporary Add-on" and select the `manifest.json` file from the `dist/firefox` folder

**Note**: Both extensions use the same secure storage system with automatic migration from IndexedDB. Firefox users can enable Firefox Sync to automatically sync their history across devices with real-time sync status indicators.

## Community

Join our [Telegram channel](https://t.me/+eFftKWGVvSpiZjZk) for updates, support, and discussions about YT re:Watch! 💬

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
- **Settings**: User preferences for overlay appearance, cleanup, and theme preferences

## Usage

1. **Install the extension** following the instructions above
2. **Visit YouTube** and start watching videos
3. **Your progress is automatically saved** every 5 seconds with smart timestamp loading to prevent video interruption
4. **Click the extension icon** to view your watch history across multiple tabs:
   - **Videos**: Regular YouTube videos with progress tracking
   - **Shorts**: Dedicated interface for YouTube Shorts
   - **Playlists**: Saved playlists with metadata
   - **Analytics**: Interactive charts and viewing statistics
   - **Settings**: Customize appearance, sync, and preferences
5. **Enable Firefox Sync** (Firefox users) for cross-device synchronization with real-time status updates

### Settings

#### 🎨 Appearance
- **Theme**: Choose between System (follows your OS theme), Light, or Dark theme with instant switching
- **Overlay Title**: Text to show in the overlay (max 12 characters)
- **Overlay Color**: Color of the progress bar overlay (blue, red, green, purple, orange)
- **Overlay Label Size**: Size of the overlay label and progress bar (small, medium, large, extra large)

#### 🗂️ Data Management  
- **Auto-clean Period**: Automatically remove history entries older than specified days (1-180 days)
- **Items per Page**: Number of items to show per page in history view (5-20)
- **Debug Mode**: Enable debug logging for troubleshooting

#### 🔄 Sync Settings (Firefox)
- **Enable/Disable Sync**: Toggle Firefox Sync integration
- **Sync Status**: Real-time sync status with last sync time
- **Manual Sync**: Trigger immediate sync or full sync with cleanup
- **Sync Indicator**: Visual status indicator in popup interface

### Theme System

The extension supports a comprehensive theme system:

- **System Theme**: Automatically follows your operating system's dark/light mode preference
- **Manual Themes**: Choose Light or Dark theme regardless of system setting
- **Dynamic Switching**: Theme changes are applied immediately without page refresh
- **Browser Integration**: Detects and responds to browser theme changes
- **Persistent Settings**: Your theme preference is saved and restored across sessions

### Progress Display

The history view now shows enhanced progress information:

- **Watched Time**: Shows the actual time you've watched (e.g., "5:30")
- **Percentage**: Shows the percentage of the video you've completed (e.g., "45%")
- **Combined Display**: Shows both time and percentage (e.g., "5:30 (45%)")
- **Accurate Tracking**: Only shows percentage when video duration is available
- **Progress Indicators**: Modern progress bars and visual indicators for each video and playlist

## Analytics Dashboard

The Analytics tab provides comprehensive insights into your YouTube viewing habits:

#### 📈 Viewing Patterns
- **Watch Time Distribution by Hour**: Interactive charts showing when you watch the most content
- **Weekly Activity Tracking**: Visualize your daily YouTube activity over the past 7 days
- **Content Type Comparison**: Pie charts comparing time spent on regular videos vs Shorts

#### 📊 Performance Metrics  
- **Completion Rate Statistics**: Track how often you finish videos you start watching
- **Total Watch Time**: Cumulative time spent watching videos and shorts
- **Video Count Statistics**: Track total videos watched and completion rates

#### 🎨 Visual Features
- **Interactive Charts**: All analytics presented with interactive, theme-aware visualizations
- **Real-time Updates**: Charts update automatically as you watch more content  
- **Dark Theme Support**: Analytics adapt to your chosen theme preference

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
1. **Check YouTube Page**: Make sure you're on a YouTube page (youtube.com)
2. **Refresh and Retry**: Refresh the page and try again
3. **Extension Status**: Verify the extension is enabled in your browser
4. **Debug Mode**: Enable debug mode in settings for detailed logging

### History Not Loading  
1. **Popup Refresh**: Close and reopen the popup interface
2. **Page Refresh**: Refresh the YouTube page completely  
3. **Console Logs**: Check browser console for error messages (F12 → Console)
4. **Storage Check**: Verify extension has storage permissions
5. **Improved Diagnostics**: Benefit from enhanced error messages and loading states

### Sync Issues (Firefox)
1. **Firefox Sync Status**: Check if Firefox Sync is enabled in your browser
2. **Sync Indicator**: Look at the sync status indicator in the popup
3. **Manual Sync**: Try triggering a manual sync from the settings tab
4. **Full Sync**: Use "Full Sync" option to clean up and re-sync all data
5. **Network Check**: Ensure stable internet connection for sync operations

### Migration Issues
If you experience issues with data migration from older versions:
1. **Automatic Retry**: The extension will automatically retry migration on next startup
2. **Export First**: Export your data before troubleshooting to preserve it
3. **Clear and Restart**: If problems persist, clear extension data and start fresh
4. **Import Backup**: Use the import feature to restore previously exported data

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

## Release Notes

See [CHANGELOG.md](CHANGELOG.md) for detailed release notes and version history.

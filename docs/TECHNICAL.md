# 🔧 Technical Documentation

*Developer guide for YT re:Watch extension*

---

## 🏗️ Architecture Overview

### Extension Structure
```
src/
├── background.js          # Service worker / background script
├── content.js             # Content script for YouTube pages
├── popup.js               # Popup interface logic
├── popup.html             # Popup HTML structure
├── storage.js             # Storage abstraction layer
├── sync-service.js        # Firefox Sync integration
├── manifest.chrome.json   # Chrome extension manifest
├── manifest.firefox.json  # Firefox extension manifest
├── _locales/              # Multilanguage (i18n) support
│   ├── en/                # English locale files
│   ├── de/                # German locale files
│   ├── es/                # Spanish locale files
│   ├── fr/                # French locale files
│   └── bg/                # Bulgarian locale files
└── icons/                 # Extension icons
```

- All user-facing text is managed via locale files in the `_locales/<lang>/` directories.
- Supported languages: English, German, Spanish, French, Bulgarian.
- All locale keys use only underscores for Chrome/Firefox compatibility.
- See the i18n section below for more details.

### Core Components

#### 1. **Background Script** (`background.js`)
- **Purpose**: Service worker (Chrome) or persistent script (Firefox) that handles cross-tab communication and global state.
- **Key Functions**:
  - **State Management**: Uses `chrome.storage.session` to reliably manage state (like the active popup window ID and last video update) across service worker restarts in Chrome. This prevents data loss when the service worker becomes inactive. For Firefox, it uses in-memory variables.
  - **Message Routing**: Manages communication between the content scripts, the popup, and other extension components.
  - **Popup Handling**: Ensures only one popup window is open at a time, focusing the existing window if the action is triggered again.
  - **Sync Coordination**: Manages and triggers the Firefox Sync service.

#### 2. **Content Script** (`content.js`)
- **Purpose**: Injected into YouTube pages for video tracking
- **Key Functions**:
  - Video progress monitoring
  - DOM manipulation for overlays
  - SPA navigation handling
  - YouTube API interaction
  - Thumbnail processing and overlay management

#### Thumbnail Processing System

The extension implements a robust system for processing video thumbnails and applying overlays to indicate watched status. Key components:

1. **Element Processing Pipeline**
   - `processVideoElement()`: Main entry point for processing video elements
   - `getVideoIdFromThumbnail()`: Extracts video IDs from various YouTube thumbnail elements
   - `addViewedLabelToThumbnail()`: Applies the visual overlay to thumbnails

2. **Performance Optimizations**
   - Uses `requestAnimationFrame` for smooth processing
   - Implements cleanup of stale operations
   - Handles YouTube's dynamic content loading
   - Prevents memory leaks with proper cleanup

3. **Error Handling**
   - Graceful handling of missing or invalid elements
   - Automatic retry mechanism for failed operations
   - Debug logging for troubleshooting

4. **Overlay System**
   - Customizable overlay appearance
   - Progress indicators for partially watched videos
   - Responsive design for different thumbnail sizes

#### 3. **Popup Interface** (`popup.js`, `popup.html`)
- **Purpose**: User interface for viewing and managing history
- **Key Functions**:
  - History display and pagination
  - Settings management
  - Analytics visualization
  - Export/import functionality

#### 4. **Storage Layer** (`storage.js`)
- **Purpose**: Abstraction over browser storage APIs
- **Key Functions**:
  - Cross-browser storage compatibility
  - Data migration and versioning
  - Efficient batch operations
  - Storage quota management
  - Playlist-aware persistence that respects per‑playlist ignore and global playlist pause settings

#### 5. **Sync Service** (`sync-service.js`)
- **Purpose**: Firefox Sync integration (not available in Chrome)
- **Key Functions**:
  - Conflict resolution
  - Incremental sync
  - Cross-device synchronization (Firefox only)
  - Sync status tracking
  - Manual/auto sync controls (Firefox only)
  - Debug and test utilities for sync (Firefox only)
  - Sync is opt-in and disabled by default
  - Tombstone-based deletion system with 30-day retention
  - Stale device protection for devices offline 29+ days
  - Prevents deleted content from reappearing in UI or sync operations
  - Default auto-sync interval ≈ 5 minutes; immediate sync on updates disabled by default
  - Listener throttling: ignores self-writes for ~20s and enforces ≥5 minutes between listener-triggered syncs to prevent loops

#### 6. **Tombstone Deletion System**
- **Purpose**: Ensures deleted videos stay deleted across all devices
- **Key Functions**:
  - Creates deletion markers (`deleted_video_<id>`) when videos are removed
  - 30-day tombstone retention with automatic cleanup
  - Cross-device deletion propagation via sync
  - Stale device fail-safe for devices offline 29+ days
  - Prevents deleted content from reappearing in UI or sync operations

### Analytics & Statistics Dashboard
- The popup's Analytics tab aggregates and visualizes user viewing data:
  - **Summary cards:**
    - Total watch time
    - Videos watched
    - Shorts watched
    - Average duration
    - Completion rate
    - Playlists saved
  - **Longest unfinished videos:** List of long videos you haven't finished, with time left and channel info.
  - **Top watched channels:** Top 5 channels by videos watched and total watch time.
  - **Top skipped channels:** Top 5 channels where you most often skip long videos.
  - **Completion bar chart:** Visualizes completion rates for long videos (skipped, partial, completed) with a legend.
  - **Watch activity (last 7 days):** Bar chart of videos watched per day.
  - **Watch time by hour:** Bar chart of when you watch the most content.
- All analytics are calculated locally for privacy.
- For performance, a small persisted stats snapshot is maintained for totals (`totalWatchSeconds`, `hourly[24]`, `counters`).
- Short-window charts (Activity last 7 days and Watch Time by Hour) are computed on-the-fly from local history each time the Analytics tab is opened. No sync is required for these charts.
- Daily keys are local dates (YYYY-MM-DD); `daily` is pruned to the last 7 days. Hourly uses 24 buckets (0–23).

---

## 🖼️ Thumbnail Overlay System

The extension provides visual indicators on video thumbnails to show watched status. This system is designed to work with YouTube's dynamic content loading and SPA navigation.

### Overlay Types
- **Viewed**: Solid overlay indicating fully watched videos
- **In Progress**: Progress bar showing watch progress
- **New**: No overlay for unwatched content

### Implementation Details
- Uses MutationObserver to detect new thumbnails
- Handles YouTube's dynamic content loading
- Optimized for performance with minimal DOM operations
- Cleanup of unused elements to prevent memory leaks

### Customization
Overlay appearance can be customized via extension settings:
- Label text (e.g., "Watched", "Viewed")
- Overlay color
- Label size
- Progress bar visibility

## 🔌 API Reference

### Storage API

#### Core Methods

```javascript
// Get all videos
const videos = await ytStorage.getAllVideos();

// Get specific video
const video = await ytStorage.getVideo(videoId);

// Set video data
await ytStorage.setVideo(videoId, {
  title: 'Video Title',
  url: 'https://youtube.com/watch?v=...',
  timestamp: Date.now(),
  time: 300,        // watched time in seconds
  duration: 600,    // total duration in seconds
  isShorts: false   // true for YouTube Shorts
});

// Remove video
await ytStorage.removeVideo(videoId);

// Clean up expired tombstones (30 days default)
await ytStorage.cleanupTombstones();

// Get all playlists
const playlists = await ytStorage.getAllPlaylists();

// Settings management
const settings = await ytStorage.getSettings();
await ytStorage.setSettings(newSettings);
```
 
#### Statistics API

```javascript
// Get persistent stats snapshot
const stats = await ytStorage.getStats();

// Persist a full stats object (as returned by getStats)
await ytStorage.setStats(stats);

// Increment stats using a delta and optional metadata
await ytStorage.updateStats(deltaSeconds, Date.now(), {
  isNewVideo: true,     // increments counters.videos (and counters.shorts if isShorts)
  isShorts: false,      // mark if the item is a Shorts
  durationSeconds: 600, // optional, used for counters.totalDurationSeconds
  crossedCompleted: true // increments counters.completed if a video passes ~90% watched
});
```

#### Data Structure

**Video Record:**
```json5
{
  videoId: "dQw4w9WgXcQ",
  title: "Video Title",
  url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  timestamp: 1640995200000,  // Unix timestamp
  time: 150,                 // watched time in seconds
  duration: 300,             // total duration in seconds
  isShorts: false,           // true for YouTube Shorts
  channelName: "Channel Name", // always present
  channelId: "UCxxxx...",      // always present
  thumbnailUrl: "https://..."  // optional
}
```

**Playlist Record:**
```json5
{
  playlistId: "PLrAXtmRdnEQy4...",
  title: "Playlist Title",
  url: "https://www.youtube.com/playlist?list=...",
  timestamp: 1640995200000,
  lastUpdated: 1640995200000,
  videoCount: 25            // optional
}
```

**Tombstone Record:**
```json5
{
  deletedAt: 1640995200000  // Unix timestamp when video was deleted
}
```

**Stats Snapshot:**
```json5
{
  totalWatchSeconds: 12345,
  daily: {
    "2025-09-20": 3600,
    "2025-09-21": 7200
  },
  hourly: [120, 0, 0, /* ... 24 items total ... */],
  lastUpdated: 1695520000000,
  counters: {
    videos: 250,
    shorts: 80,
    totalDurationSeconds: 540000,
    completed: 120
  }
}
```

#### Deletion System Behavior

**When a video is deleted:**
1. The video record (`video_<id>`) is removed from storage
2. A tombstone marker (`deleted_video_<id>`) is created with deletion timestamp
3. Sync is triggered to propagate the deletion across devices
4. UI immediately filters out the deleted video

**During sync operations:**
- Tombstones are synchronized across all devices
- If a tombstone exists and is newer than a video record, the video is not restored
- Videos are removed from both local and sync storage when tombstones are present
- Tombstones older than 30 days are automatically cleaned up

**Stale device protection:**
- If a device hasn't synced for 29+ days, all local data is discarded
- Remote (sync) data completely replaces local data
- This prevents old devices from resurrecting deleted videos

### Message API

#### Content Script → Background
```javascript
// Update video progress
chrome.runtime.sendMessage({
  type: 'videoUpdate',
  data: {
    videoId: 'dQw4w9WgXcQ',
    time: 150,
    duration: 300,
    // ... other video data
  }
});

// Get current video info
chrome.runtime.sendMessage({
  type: 'getCurrentVideo'
}, (response) => {
  console.log(response.video);
});
```

#### Background → Content Script
```javascript
// Request video info
chrome.tabs.sendMessage(tabId, {
  type: 'getVideoInfo'
}, (response) => {
  console.log(response.videoId, response.time);
});

// Update overlay settings
chrome.tabs.sendMessage(tabId, {
  type: 'updateOverlaySettings',
  settings: {
    overlayTitle: 'viewed',
    overlayColor: 'blue',
    overlayLabelSize: 'medium'
  }
});
```

### Sync API (Firefox Only)

```javascript
// Enable sync
await syncService.enable();

// Disable sync
await syncService.disable();

// Get sync status
const status = await syncService.getStatus();

// Trigger manual sync
await syncService.triggerSync();

// Full sync with cleanup
await syncService.fullSync();
```

---

## 🔄 Data Flow

### Video Tracking Flow
1. **Content Script** detects video play/pause/timeupdate events
2. **Content Script** sends video data to **Background Script**
3. **Background Script** stores data via **Storage API**
4. **Background Script** notifies **Popup** of updates (if open)
5. **Popup** updates UI with new data

### Sync Flow (Firefox)
1. **Sync Service** monitors storage changes
2. **Sync Service** uploads changes to Firefox Sync
3. **Sync Service** downloads changes from other devices
4. **Sync Service** resolves conflicts using timestamp priority
5. **Sync Service** updates local storage with merged data

### Settings Flow
1. **Popup** updates settings via **Storage API**
2. **Background Script** detects settings change
3. **Background Script** broadcasts to all **Content Scripts**
4. **Content Scripts** update overlay appearance
5. Playlist context is considered by the storage layer to skip persistence when playlist ignore/pause flags are active

---

## 🛠️ Development Setup

### Prerequisites
- Node.js 14+
- NPM or Yarn
- Chrome/Firefox for testing

### Local Development

```bash
# Clone repository
git clone https://github.com/EdinUser/YouTubeLocalHistory.git
cd YouTubeLocalHistory

# Install dependencies
npm install

# Build extension
./build.sh

# Built extensions will be in dist/
# Load dist/chrome or dist/firefox in browser
```

### Testing

```bash
# Run all tests
npm test

# Run specific test suites
npm run test:unit
npm run test:integration
npm run test:e2e

# Run with coverage
npm run test:coverage
```

### Building for Production

```bash
# Build both Chrome and Firefox versions
./build.sh

# Build specific browser
./build.sh chrome
./build.sh firefox
```

---

## 🔍 Debugging

### Enable Debug Mode
1. Open extension popup
2. Go to Settings tab
3. Enable "Debug Mode"
4. Check browser console for detailed logs

### Debug Logging
```javascript
// Use the debug logger
if (DEBUG) {
  console.log('[ythdb-popup]', 'Message', data);
}

// Background script logging
console.log('[ythdb-bg]', 'Background message', data);

// Content script logging
console.log('[ythdb-content]', 'Content message', data);
```

### Common Debug Points

**Content Script Issues:**
- Check if script is injected: `console.log` in content script
- Verify YouTube page detection: Check URL patterns
- Monitor video events: `video.currentTime`, `video.duration`

**Storage Issues:**
- Check browser storage: `chrome.storage.local.get()`
- Verify permissions: Check manifest permissions
- Monitor storage changes: `chrome.storage.onChanged`

**Sync Issues (Firefox):**
- Check Firefox Sync status: `about:sync-log`
- Verify addon sync enabled: Firefox preferences
- Monitor sync events: Enable debug logging

---

## 📊 Performance Considerations

### Storage Optimization
- Use batch operations for multiple updates
- Implement lazy loading for large datasets
- Regular cleanup of old entries
- Efficient indexing for searches

### Memory Management
- Minimize content script memory footprint
- Use event-driven architecture
- Implement proper cleanup on tab close
- Avoid memory leaks in popup

### Network Optimization (Sync)
- Implement incremental sync
- Use compression for large payloads
- Implement retry logic with exponential backoff
- Batch multiple changes into single sync operation

---

## 🔐 Security Considerations

### Data Protection
- All data stored locally using secure browser APIs
- No external server communication
- Encryption at rest via browser storage
- No sensitive data in console logs (production)

### ⚠️ Privacy Scope and Limitations

**What YT re:Watch Does:**
- Intercepts and stores video progress data locally
- Replaces YouTube's history tracking with local storage
- Prevents YouTube from knowing your viewing progress/completion
- Operates independently of YouTube's account system
- **Provides account-agnostic tracking** - same history regardless of YouTube login state

**What YT re:Watch Does NOT Do:**
- ❌ Block IP address tracking
- ❌ Prevent browser fingerprinting
- ❌ Block Google Analytics/GTM scripts
- ❌ Stop cookie tracking
- ❌ Prevent advertising profile building
- ❌ Block YouTube's recommendation algorithms from accessing your data
- ❌ Stop YouTube from knowing you visited specific video pages
- ❌ Prevent network-level tracking

**Technical Reality:**
This extension only handles the **application-level history data**. Google/YouTube still receives:
- HTTP requests to video URLs
- Viewer analytics (views, duration)
- Network fingerprinting data
- Cookie-based tracking
- IP-based geolocation

**For developers:** YT re:Watch is a **history replacement tool**, not a comprehensive privacy solution. Users need additional tools (VPN, ad blockers, privacy browsers) for broader privacy protection.

### Content Security Policy
```json
{
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'"
  }
}
```

### Permissions
- Minimal required permissions
- `storage` for local data storage
- `tabs` for cross-tab communication
- `activeTab` for YouTube page access

---

## 🧪 Testing Strategy

### Unit Tests
- Storage layer functionality
- Data validation and sanitization
- Utility functions
- Settings management

### Integration Tests
- Content script ↔ Background communication
- Storage operations
- Sync functionality
- Cross-browser compatibility

### End-to-End Tests
- Full user workflows
- Extension installation/uninstallation
- Data migration scenarios
- Error handling

### Test Files Structure
```
tests/
├── unit/
│   ├── storage.test.js
│   ├── popup.test.js
│   └── utils.test.js
├── integration/
│   ├── video-tracking.test.js
│   └── sync.test.js
├── e2e/
│   ├── extension.e2e.test.js
│   └── user-flows.test.js
└── helpers/
    ├── setup.js
    └── mock-data.js
```

---

## 🔄 Migration & Versioning

### Data Migration
```javascript
// Migration from v1 to v2
async function migrateV1ToV2() {
  const oldData = await getOldFormatData();
  const newData = transformToNewFormat(oldData);
  await storeNewFormatData(newData);
  await markMigrationComplete('v1-to-v2');
}
```

### Version Compatibility
- Backward compatibility for data formats
- Graceful handling of missing fields
- Migration scripts for breaking changes
- Version detection and automatic migration

---

## 📝 Contributing

### Code Style
- Use ES6+ features
- Follow existing naming conventions
- Add JSDoc comments for public APIs
- Use consistent indentation (2 spaces)

### Pull Request Process
1. Fork repository
2. Create feature branch
3. Write tests for new functionality
4. Ensure all tests pass
5. Update documentation
6. Submit pull request

### Code Review Guidelines
- Focus on functionality and performance
- Check for security vulnerabilities
- Ensure cross-browser compatibility
- Verify test coverage

---

## 📚 Additional Resources

### Browser Extension APIs
- [Chrome Extension API](https://developer.chrome.com/docs/extensions/)
- [Firefox WebExtensions API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions)
- [WebExtensions Standard](https://github.com/w3c/webextensions)

### Storage APIs
- [chrome.storage](https://developer.chrome.com/docs/extensions/reference/storage/)
- [browser.storage](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage)

### Sync APIs
- [Firefox Sync](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/sync)

### Testing Frameworks
- [Jest](https://jestjs.io/) - Unit testing
- [Playwright](https://playwright.dev/) - E2E testing
- [Puppeteer](https://pptr.dev/) - Browser automation

---

## 📊 Metrics & Analytics

### Performance Metrics
- Extension load time
- Content script injection time
- Storage operation latency
- Memory usage patterns

### Usage Metrics (Local Only)
- Number of videos tracked
- Average session duration
- Feature usage statistics
- Error rates and types

### Monitoring
- Error tracking and reporting
- Performance regression detection
- User feedback collection
- A/B testing for new features

---

## 🤝 Developer Community

- 💬 **[Join our Telegram community](https://t.me/+eFftKWGVvSpiZjZk)** - Connect with other developers
- 🐛 **[Report bugs on GitHub](https://github.com/EdinUser/YouTubeLocalHistory/issues)** - Found an issue?
- 📖 **[Read the source code](https://github.com/EdinUser/YouTubeLocalHistory)** - Open source development

---

## 📋 Feature Parity Table

| Feature                        | Chrome | Firefox |
|------------------------------- |:------:|:-------:|
| Local video history            |   ✅   |   ✅    |
| Visual overlays on YouTube     |   ✅   |   ✅    |
| Analytics/statistics dashboard |   ✅   |   ✅    |
| Multilanguage (i18n) support   |   ✅   |   ✅    |
| Export/import history          |   ✅   |   ✅    |
| Sync across devices            |   ❌   |   ✅    |
| Manual/auto sync controls      |   ❌   |   ✅    |
| Debug sync tools               |   ❌   |   ✅    |

---

## Internationalization (i18n) System

- All locale files are in `src/_locales/<lang>/`.
- Supported languages: English (en), German (de), Spanish (es), French (fr), Bulgarian (bg).
- All message keys must use only ASCII letters, numbers, and underscores (`[a-zA-Z0-9_]`). Dots and dashes are not allowed (Chrome requirement).
- **⚠️ All non-English translations are currently machine-generated. Native speakers are encouraged to review and improve translations.**
- To contribute, edit the appropriate `messages.json`, `messages-group.json`, `tabs.json`, or `settings.json` file in your language folder. See `src/_locales/README.md` for details.

**Example Structure:**
```
_locales/
  en/
    messages.json
    messages-group.json
    tabs.json
    settings.json
  de/
    messages.json
    messages-group.json
    tabs.json
    settings.json
  es/
    messages.json
    messages-group.json
    tabs.json
    settings.json
  fr/
    messages.json
    messages-group.json
    tabs.json
    settings.json
  bg/
    messages.json
    messages-group.json
    tabs.json
    settings.json
```

---

*For more technical details, check the source code and inline documentation.* 
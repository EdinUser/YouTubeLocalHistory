# Changelog

All notable changes to YT re:Watch will be documented in this file.

## [4.0.2] - 2025-11-27

### 🐛 Playback & Navigation Fixes
- **Enhanced playlist autoplay detection**: Improved logic to detect playlist autoplay scenarios and delay timestamp restoration appropriately, preventing conflicts with YouTube's autoplay behavior.
- **Smart timestamp restoration**: Added checks for significant viewing history (>30s) before attempting timestamp restoration to avoid unnecessary resets for short or unwatched videos.
- **Refined timing reset logic**: Skip timing resets when videos are already playing near the beginning (within 5 seconds) to prevent unnecessary interruptions during playlist navigation.
- **Improved SPA navigation handling**: Enhanced single-page application navigation detection with better timestamp flag management and null video object protection.

### 📊 Analytics & Statistics Improvements
- **Robust average duration calculation**: Added `Number.isFinite` checks to prevent invalid duration calculations in analytics summaries.
- **Enhanced video tracking reliability**: Improved timestamp reset logic and dataset flag management for better consistency across navigation types.

### 🗄️ Storage System Enhancements
- **Fixed date manipulation logic**: Corrected retention days calculation to properly handle date arithmetic and prevent incorrect pruning of daily statistics.

### 🧪 Testing & Quality Assurance
- **Enhanced E2E test setup**: Improved Playwright configuration with dedicated `chromium-with-extension` project for better extension testing.
- **Better navigation and consent dialog handling**: Updated test suites to handle YouTube's cookie/consent dialogs and improve test reliability.
- **Jest setup improvements**: Added `ytStorage` mock and exposed testing helpers for more comprehensive unit testing.
- **Memory management**: Replaced `WeakSet` with `Set` for `trackedVideos` to allow manual management during testing.

---

## [4.0.1] - 2025-11-26

### 🐛 Stats & Analytics Fixes
- Fixed inconsistent Analytics summary cards by rebuilding the persistent stats snapshot from the full hybrid history (IndexedDB + localStorage) and using it as the single source of truth.
- Summary cards (Total Watch Time, Videos Watched, Shorts Watched, Average Duration, Completion Rate, Playlists Saved) now read from the stored stats counters instead of only the currently loaded page.
- Activity (Last 7 Days) and Watch Time by Hour charts now use the same persisted `daily`/`hourly` stats snapshot (with local‑day keys and 24 hourly buckets) for stable, full‑history graphs.

### 🎬 Playlist Handling Improvements
- Improved playlist detection and title extraction across YouTube layout variants using a broader selector set and a retry‑based saver.
- Playlist “pause history” toggles are now more reliable and consistently respected when saving progress, preventing unwanted history entries for ignored playlists.

### 🧹 Data Hygiene
- Hybrid stats rebuilds now prune the `daily` stats map to the last 7 local days, keeping the snapshot compact and aligned with what the UI displays.

## [4.0.0] - 2025-11-25

### ✨ Major New Features

#### 🔄 **Hybrid Storage Architecture - Unlimited Local Storage**
- **Complete removal of Firefox Sync** - Eliminated cross-device synchronization complexity
- **IndexedDB + localStorage hybrid system** - Unlimited local storage capacity (GBs scale vs previous ~50MB limit)
- **Manual export/import for data portability** - Transfer data between devices via JSON files instead of sync
- **Enhanced performance** - Fast local queries, memory-efficient pagination, no sync overhead
- **Bulletproof reliability** - Core functionality (getVideo/setVideo) never depends on IndexedDB availability

#### 🗄️ **Storage System Overhaul**
- **Layer 1: IndexedDB** - Complete video/playlists history with full metadata (unlimited capacity)
- **Layer 2: localStorage** - Fast overlay for recent/active content and lightweight config
- **Merged view reads** - Seamless access to complete history with local changes taking priority
- **Fail-safe migration** - Verified batch migration from old storage with comprehensive error handling
- **Context-aware access** - Extension origin owns IndexedDB, content scripts use RPC for privacy

### 🧭 Behavior Changes
- **No cross-device sync** - All storage is local-only, eliminating sync conflicts and bandwidth usage
- **Export/import workflow** - Manual data portability replaces automatic sync
- **Local-only architecture** - No network dependencies, works completely offline
- **Simplified complexity** - Removed ~1300 lines of sync-related code

### 📊 Performance Improvements
- **Unlimited storage scaling** - Handle 100,000+ videos without performance degradation
- **Memory efficiency** - Load only current page into memory, not entire dataset
- **Fast queries** - IndexedDB indexes for timestamp, isShorts, and title search
- **No sync overhead** - Eliminated background sync operations and quota limits

### 🔒 Privacy & Security
- **Extension-scoped IndexedDB** - Database never created under YouTube origin
- **No cloud storage** - All data stays local, no external servers involved
- **No sync tracking** - Eliminated potential sync metadata collection
- **Enhanced local encryption** - Browser's built-in storage security applies

### 🚀 Core Stability
- **Bulletproof core functionality** - Reading/saving video times always works
- **Failsafe strategy** - localStorage primary, IndexedDB non-blocking archive
- **Graceful degradation** - Continues working if IndexedDB unavailable
- **Verified migration** - Each migration batch verified before cleanup

### 💔 Breaking Changes
- **Firefox Sync completely removed** - No longer available in any form
- **Cross-device workflow changed** - Manual export/import replaces sync
- **Storage architecture rewritten** - Hybrid system replaces layered sync
- **API simplification** - Removed all sync-related methods and interfaces

### 🔄 Migration Notes
- **Automatic migration** - Existing data seamlessly moved to hybrid storage
- **Data preservation** - No data loss during architectural transition
- **Backward compatibility** - Export format remains compatible
- **Performance improvement** - Immediate benefits after migration completes

---

## [3.1.5] - 2025-10-30

### 🐛 Fixes
- **Fixed SPA navigation saving issues** - Videos that auto-start before save interval initialization now properly track progress
- **Enhanced navigation detection** - Added multiple fallback methods to catch channel page clicks and other navigation types that bypass standard SPA events
- **Fallback timestamp restoration** - Added intelligent restoration when YouTube fails to restore timestamps for certain navigation paths
- **Improved channel page compatibility** - Videos clicked from channel pages now properly resume from saved positions

### 🔧 Technical Improvements
- **Multi-method navigation detection** - Uses `yt-navigate-finish`, URL monitoring, history API interception, and page visibility events
- **Smart save interval initialization** - Checks video state immediately after event listener setup to prevent missed saves
- **Event-driven content change logging** - Added comprehensive logging for debugging navigation and content loading issues

---

## [3.1.4] - 2025-10-18

### 🐛 Fixes
- **Fixed video timestamp restoration in YouTube's new player interface** - Videos now properly resume playback when loading inside already loaded pages (SAP)
- **Improved timestamp comparison logic** - More robust detection of YouTube's restoration vs manual restoration needed
- **Enhanced error handling** - Better recovery when YouTube's restoration mechanism fails

---

## [3.1.3] - 2025-09-25

### 🐛 Fixes
- Issue with daily statistics

---

## [3.1.2] - 2025-09-24

### ✨ New Features
- Persistent, privacy‑preserving watch‑time statistics stored locally (`totalWatchSeconds`, last 7 days `daily`, 24‑slot `hourly`)
- History list now shows the video channel name beneath the title

### 🧭 Behavior Changes
- Shorts tracking: save interval aligned to 5s and relaxed duration checks to avoid missed saves
- Initial stats seeding from existing history for accurate analytics on upgrade

### 📊 Analytics
- Summary cards and charts now prefer persistent stats for accuracy and performance
- Activity (last 7 days) and "Watch time by hour" use stored stats with local‑day keys

### 🔄 Sync & Performance (Firefox)
- Throttled `storage.sync` change listener to prevent self‑triggered loops; ignores self‑writes for 20s and enforces a 5‑minute minimum between listener‑triggered syncs
- Stats updates are debounced to the background cadence (default ~10 minutes) unless immediate sync is explicitly enabled

### 🗄️ Export/Import
- Export schema bumped to `dataVersion: "1.1"` and now includes a `stats` object

### 📦 Build & Manifests
- Version bump to 3.1.2 in Chrome and Firefox manifests

---

## [3.1.1]

### 🐛 Fixes
- Improved timestamp validation and optimized `timeupdate` handling to reliably record progress
- Shorts tracking no longer skips saves when duration is unavailable

### 📦 Build & Manifests
- Version bump to 3.1.1 in Chrome and Firefox manifests

---

## [3.1.0] - 2025-09-06

### ✨ New Features
- Per-playlist "Ignore videos" toggle with UI controls in the Playlists tab
- Global setting: "Pause history in playlists" to stop tracking while browsing playlists

### 🧭 Behavior Changes
- Playlist-aware logic skips saving progress when a playlist is ignored or when playlist history is paused

### 🌐 i18n & UI
- Added new locale strings across all supported languages
- Updated popup UI to expose new playlist controls and settings

### 📦 Build & Manifests
- Version bump to 3.1.0 in Chrome and Firefox manifests

---

## [3.0.4] - 2025-09-06

### ✨ New
- "Remove from history" button on YouTube thumbnails (hover action) for quick deletion

### 🧪 Stability
- Sync cadence: reduced default frequency from 5 minutes to 10 minutes
- Immediate sync on updates is disabled by default (can be enabled explicitly)

### 📦 Build & Manifests
- Version bump to 3.0.4 in Chrome and Firefox manifests

---

## [3.0.3] - 2025-08-29

### 🐛 Fixes
- Restored watched overlays on YouTube Home after recent layout changes
- Improved video ID detection for new home tiles and playlist items
- Ensured overlays render above thumbnails (higher z-index)

### 🧪 Stability
- Hardened tests and minor internal cleanups

— Small compatibility release; no settings or UI changes

## [3.0.2] - 2025-07-30

### 🐛 Bug Fixes
- **Fixed incorrect "viewed" overlays** on unwatched videos in YouTube's home feed
- **Improved thumbnail processing** to handle YouTube's dynamic content loading
- **Reduced console logging** for cleaner developer experience
- **Enhanced memory management** with better cleanup of processed elements
- **Fixed race conditions** in thumbnail overlay processing

## [3.0.1]

### ✨ Major New Features

#### 🔄 Tombstone-Based Deletion System
- **Robust video deletion** with tombstone markers to prevent deleted videos from reappearing after sync
- **30-day tombstone retention** ensures deletion consistency across all devices
- **Stale device protection** automatically handles devices that haven't synced for 29+ days
- **Cross-device deletion propagation** ensures deletions are respected on all synchronized devices

### 🐛 Critical Bug Fixes
- **Fixed deleted videos reappearing** after sync operations
- **Resolved immediate video restoration** when delete button was clicked
- **Enhanced popup filtering** prevents deleted videos from appearing in the UI

### 🐛 Bug Fixes
- **Video Overlay**: Fixed an issue where the "viewed" overlay was not appearing on related videos in the right-hand column of a video page. This was caused by a YouTube UI update that introduced a new `yt-lockup-view-model` element, which is now correctly handled.

### 🚀 Core Stability
- **Chrome MV3 Compatibility**: Refactored the background script to use `chrome.storage.session` for state management, preventing state loss when the service worker becomes inactive. This fixes bugs related to popup handling and ensures reliable operation on Chrome.
- **Enhanced Reliability**: Replaced unreliable `beforeunload` events with `pagehide` and added defensive checks to prevent race conditions and errors during page unload.
- **Improved Popup Handling**: The extension now focuses the existing popup window instead of opening a duplicate if the action is triggered multiple times.

### 🛠️ Other Improvements
- Automatic tombstone cleanup and storage optimization
- Improved sync reliability with enhanced conflict resolution
- Better handling of offline devices and stale data scenarios

---

## [3.0.0]

### ✨ Major New Features

#### 🌐 Multilanguage Support (i18n)
- Full support for English, German, Spanish, French, and Bulgarian.
- All non-English translations are currently machine-generated. Native speakers are encouraged to contribute improvements!
- All locale keys now use only underscores for Chrome/Firefox compatibility.

#### 📊 Analytics & Statistics Dashboard Redesign
- Completely redesigned Analytics Tab in the popup.
- New summary cards: Total Watch Time, Videos Watched, Shorts Watched, Average Duration, Completion Rate, Playlists Saved.
- Longest Unfinished Videos: List of long videos you haven't finished, with time left and channel info.
- Top Watched Channels: Top 5 channels by videos watched and total watch time.
- Top Skipped Channels: Top 5 channels where you most often skip long videos.
- Completion Bar Chart: Visualizes completion rates for long videos (skipped, partial, completed) with a legend.
- Watch Activity (Last 7 Days): Bar chart of videos watched per day.
- Watch Time by Hour: Bar chart of when you watch the most content.
- Improved data aggregation and display logic for all analytics.
- Better i18n support for all analytics/statistics labels and messages.

### 🛠️ Other Improvements
- Numerous bug fixes, UI/UX improvements, and codebase refactoring for maintainability.

---

## [2.6.4]

> **Note:** All Firefox Sync–related functionality introduced in the 2.6.x series has been **removed in 4.0.0**. The extension now uses a pure local hybrid storage + manual export/import model for data portability.

### ✨ Major New Features

#### 🔄 Firefox Sync Integration
- **Added comprehensive Firefox Sync support** (`src/sync-service.js`)
  - Cross-device synchronization of video history and playlists
  - Local storage priority with conflict resolution
  - Automatic sync triggers on data changes
  - Manual sync controls with full sync capability
  - Intelligent sync status management and error handling
  - Batch data processing for Firefox sync storage limits
  - Real-time sync status indicator in popup interface
  - Debug logging and sync testing capabilities

#### 🎯 Enhanced User Interface
- **Added sync status indicator** to popup interface
  - Real-time sync status updates (Disabled, Initializing, Syncing, Success, Error)
  - Visual sync progress animations
  - Click-to-sync functionality
  - Last sync time display
- **Enhanced sync settings panel**
  - Enable/disable sync toggle
  - Manual sync trigger buttons
  - Full sync with confirmation dialog
  - Sync status and error reporting

### 🎨 Major UI/UX Improvements

#### 📋 Playlist Tab Redesign
- **Card-Based Layout**: Transformed playlist tab from cramped table to modern card layout matching Videos/Shorts
- **SVG Icons**: Replaced unreliable emoji characters with clean, scalable SVG playlist icons
- **Visual Consistency**: Added proper line separators, spacing, and consistent styling across all tabs
- **Enhanced Typography**: Improved font sizes, weights, and hierarchical text layout

#### 🔢 Pagination System Overhaul
- **Conservative Display**: Reduced pagination threshold from 10 to 7 pages for cleaner interface
- **Smart Page Selection**: Show current page ± 1 neighbor instead of ± 2 for less clutter
- **Clean Ellipsis**: Replaced ugly "..." text with proper HTML entity (…) with enhanced styling
- **Removed UI Clutter**: Eliminated "Go to page" input that was breaking UI flow
- **Applied Universally**: Enhanced pagination across Videos, Playlists, and Shorts tabs

#### ⚙️ Settings Interface Polish
- **Improved Column Spacing**: Increased settings gap from 10px to 25px for better visual separation
- **Enhanced Readability**: Better distinction between Interface & Display and Data & Sync sections

### 🐛 Critical Bug Fixes

#### 📊 Analytics Tab Fixes
- **Playlist Count Fix**: Resolved issue where playlist count always showed 0 initially
- **Initialization Loading**: Added playlist loading during extension startup for accurate analytics
- **Chart Bar Width Issues**: Set minimum bar widths (12px activity, 8px hourly) to prevent invisible bars

#### 🔄 Tab Restoration & Sync
- **Smart Tab Loading**: Fixed tab restoration not loading playlist data when extension opens
- **Sync Indicator Visibility**: Enhanced sync indicator with defensive CSS and initialization code
- **Data Loading Logic**: Added proper data loading to switchTab function for all tab types

### 🚀 Core Improvements

#### 📊 Storage System Enhancements
- **Integrated sync triggering** across all storage operations
  - Automatic sync triggers on video/playlist saves
  - Sync triggers on data removal and clear operations
  - Multiple fallback approaches for sync reliability
  - Error handling to prevent sync failures from breaking storage
- **Streamlined storage architecture**
  - Removed `src/popup-storage.js` (functionality consolidated)
  - Enhanced `src/storage.js` with sync integration
  - Improved error handling and retry mechanisms

#### 🎬 Video Position & Navigation Fixes
- **Smart timestamp loading** improvements
  - Added 250ms delay to prevent video interruption
  - Respects YouTube's state restoration process
  - Prevents loading timestamps during video transitions
- **SPA navigation handling**
  - Improved single-page application navigation detection
  - Prevents video interruption during YouTube navigation
  - Better handling of video ID changes and mode transitions

#### 🎛️ Popup Interface Enhancements
- **Sync-aware storage change listeners**
  - Prevents duplicate UI updates during sync operations
  - Improved storage change detection and filtering
  - Better race condition handling
- **Updated clear history functionality**
  - Uses `clearHistoryOnly()` instead of `clear()` 
  - Preserves settings and sync configuration
  - Enhanced confirmation dialog with clearer warnings

### 🔧 Technical Enhancements

#### 🎯 Performance Improvements
- **Optimized Chart Rendering**: Enhanced chart bar width calculations with minimum constraints
- **Efficient Data Loading**: Load playlists during initialization instead of on-demand only
- **Better Resource Management**: Improved sync indicator visibility with proper CSS rules

#### 🧹 Code Quality
- **Consistent Styling**: Standardized card-based layouts across all content tabs
- **Enhanced Error Handling**: Better defensive programming for UI element initialization
- **Visual Harmony**: Unified delete button placement and styling across all interfaces

#### 📦 Build and Manifest Updates
- **Version bump to 2.6.4** in both Chrome and Firefox manifests
- **Firefox manifest enhancements**
  - Added `sync-service.js` to background scripts
  - Proper script loading order for sync functionality
- **Build script improvements** (`build.sh`)
  - Enhanced Firefox build process
  - Better error handling and validation

#### 🧪 Testing and Quality
- **Comprehensive test updates**
  - Updated popup tests for new sync functionality  
  - Enhanced storage tests with sync integration
  - Improved integration tests for video tracking
  - Added sync service test coverage
- **Mock improvements**
  - Better Chrome runtime mocking for sync features
  - Enhanced storage mocking with sync triggers
  - Improved error handling in test scenarios

### 💔 Breaking Changes

- **Removed `src/popup-storage.js`** - functionality consolidated into main popup script
- **Updated storage methods** - all storage operations now trigger sync when available
- **Modified clear history behavior** - now uses `clearHistoryOnly()` to preserve settings

### 🔄 Migration Notes

- Existing installations will automatically migrate to the new storage system
- Sync functionality is opt-in and disabled by default
- All existing data and settings are preserved during the update
- Firefox users can enable sync through the popup settings panel

### 📈 Performance Improvements

- **Reduced sync delays** from 250ms to 100ms for more responsive syncing
- **Optimized sync storage** with intelligent batching and cleanup
- **Enhanced error recovery** with multiple fallback mechanisms
- **Improved memory usage** with better cleanup and resource management

---

## [2.6.2]

### ✨ Major New Features

#### 🔄 Firefox Sync Integration
- **Added comprehensive Firefox Sync support** (`src/sync-service.js`)
  - Cross-device synchronization of video history and playlists
  - Local storage priority with conflict resolution
  - Automatic sync triggers on data changes
  - Manual sync controls with full sync capability
  - Intelligent sync status management and error handling
  - Batch data processing for Firefox sync storage limits
  - Real-time sync status indicator in popup interface
  - Debug logging and sync testing capabilities

#### 🎯 Enhanced User Interface
- **Added sync status indicator** to popup interface
  - Real-time sync status updates (Disabled, Initializing, Syncing, Success, Error)
  - Visual sync progress animations
  - Click-to-sync functionality
  - Last sync time display
- **Enhanced sync settings panel**
  - Enable/disable sync toggle
  - Manual sync trigger buttons
  - Full sync with confirmation dialog
  - Sync status and error reporting

### 🚀 Core Improvements

#### 📊 Storage System Enhancements
- **Integrated sync triggering** across all storage operations
  - Automatic sync triggers on video/playlist saves
  - Sync triggers on data removal and clear operations
  - Multiple fallback approaches for sync reliability
  - Error handling to prevent sync failures from breaking storage
- **Streamlined storage architecture**
  - Removed `src/popup-storage.js` (functionality consolidated)
  - Enhanced `src/storage.js` with sync integration
  - Improved error handling and retry mechanisms

#### 🎬 Video Position & Navigation Fixes
- **Smart timestamp loading** improvements
  - Added 250ms delay to prevent video interruption
  - Respects YouTube's state restoration process
  - Prevents loading timestamps during video transitions
- **SPA navigation handling**
  - Improved single-page application navigation detection
  - Prevents video interruption during YouTube navigation
  - Better handling of video ID changes and mode transitions

#### 🎛️ Popup Interface Enhancements
- **Sync-aware storage change listeners**
  - Prevents duplicate UI updates during sync operations
  - Improved storage change detection and filtering
  - Better race condition handling
- **Updated clear history functionality**
  - Uses `clearHistoryOnly()` instead of `clear()` 
  - Preserves settings and sync configuration
  - Enhanced confirmation dialog with clearer warnings

### 🔧 Technical Changes

#### 📦 Build and Manifest Updates
- **Version bump to 2.6.1** in both Chrome and Firefox manifests
- **Firefox manifest enhancements**
  - Added `sync-service.js` to background scripts
  - Proper script loading order for sync functionality
- **Build script improvements** (`build.sh`)
  - Enhanced Firefox build process
  - Better error handling and validation

#### 🧪 Testing and Quality
- **Comprehensive test updates**
  - Updated popup tests for new sync functionality  
  - Enhanced storage tests with sync integration
  - Improved integration tests for video tracking
  - Added sync service test coverage
- **Mock improvements**
  - Better Chrome runtime mocking for sync features
  - Enhanced storage mocking with sync triggers
  - Improved error handling in test scenarios

### 🐛 Bug Fixes

#### ⏰ Timestamp Loading
- **Fixed video interruption issues**
  - Prevented timestamp loading during video playback
  - Added smart detection of YouTube's state restoration
  - Improved timing of timestamp application

#### 🧹 Memory and Performance
- **Enhanced cleanup procedures**
  - Better event listener management
  - Improved resource cleanup on navigation
  - Reduced memory leaks in long-running sessions

#### 🔗 SPA Navigation
- **Fixed single-page application issues**
  - Better detection of page transitions
  - Improved video element tracking
  - Enhanced state management across navigation

### 💔 Breaking Changes

- **Removed `src/popup-storage.js`** - functionality consolidated into main popup script
- **Updated storage methods** - all storage operations now trigger sync when available
- **Modified clear history behavior** - now uses `clearHistoryOnly()` to preserve settings

### 🔄 Migration Notes

- Existing installations will automatically migrate to the new storage system
- Sync functionality is opt-in and disabled by default
- All existing data and settings are preserved during the update
- Firefox users can enable sync through the popup settings panel

### 📈 Performance Improvements

- **Reduced sync delays** from 250ms to 100ms for more responsive syncing
- **Optimized sync storage** with intelligent batching and cleanup
- **Enhanced error recovery** with multiple fallback mechanisms
- **Improved memory usage** with better cleanup and resource management

---

## [2.5.1] - 2024-12-15

### 🔧 Performance & Debug Improvements
- **Console Logging Optimization**: Reduced verbose logging in thumbnail observer
- **Improved Video ID Extraction**: Streamlined video ID extraction from thumbnails
- **Debug Mode Enhancement**: Added debug mode toggle in settings with proper persistence
- **Version Display**: Added version number display in settings tab

### 🐛 Bug Fixes
- **Error Handling**: Enhanced error messages for missing UI elements
- **Settings Tab**: Fixed settings tab not showing/working properly
- **Theme Handling**: Added proper theme preference handling
- **Code Cleanup**: Fixed duplicate settingsTab declaration

### ✨ Feature Enhancements
- **Success Messages**: Added success messages for settings updates
- **Performance**: Maintained critical debugging logs while reducing noise
- **Thumbnail Processing**: Improved thumbnail observer efficiency
- **Overlay System**: Enhanced overlay handling for all video types
- **Playlist Support**: Added proper overlay support for playlist panel videos
- **Version Management**: Implemented fetching version from manifest.json instead of hardcoding

---

## [2.4.0] - 2024-12-01

### 🎬 YouTube Shorts Support
- **YouTube Shorts Tracking**: Added comprehensive tracking and display for YouTube Shorts
- **Separate Shorts Tab**: New dedicated tab interface for viewing Shorts history with pagination
- **Enhanced UI Structure**: Refactored popup interface with separate containers for Videos, Shorts, and Playlists

### 🎨 UI/UX Improvements
- **Tab State Persistence**: Extension remembers which tab was last active across sessions
- **Theme Handling Improvements**: Refactored theme handling logic for better clarity and efficiency
- **Simplified Theme Toggle**: Theme toggle button now only switches between light and dark themes
- **Enhanced Theme Persistence**: Fixed issues with theme preference saving and application

### 🚀 Performance Optimizations
- **Code Optimization**: Streamlined theme application logic and removed redundant code
- **Better Performance**: Improved theme switching performance and reduced code complexity

---

## [2.3.0] - 2024-11-15

### 🎨 Dark Theme System
- **Dark Theme Support**: Added comprehensive dark/light theme system with system preference detection
- **Theme Toggle Button**: Added dynamic theme toggle button that shows current theme selection
- **Browser Theme Integration**: Added support for browser theme detection and automatic theme switching
- **Enhanced UI**: Improved theme switching with smooth transitions and consistent theming

### 📊 Progress Tracking Enhancements
- **Progress Percentage Display**: Enhanced progress column to show both watched time and percentage completion
- **Better User Experience**: Dynamic theme button, visual progress feedback, and seamless theme switching

### 🔄 Firefox Sync Integration
- **Firefox Sync**: Full compatibility with Firefox Sync for cross-device data synchronization

---

## [2.2.0] - 2024-10-20

### 🔒 Major Security Update
- **Storage Migration**: Migrated from IndexedDB to `chrome.storage.local`/`browser.storage.local`
- **Automatic Migration**: Existing IndexedDB data is automatically migrated to the new storage system
- **Enhanced Security**: Data is now stored in encrypted format and cannot be easily accessed through browser developer tools
- **Improved Reliability**: Better error handling and storage management

### 🌐 Cross-Browser Improvements
- **Cross-Browser Sync**: Chrome and Firefox extensions are now fully synchronized with identical functionality
- **CSP Compliance**: Removed inline styles to comply with Content Security Policy
- **Updated Descriptions**: Reflects the new secure storage system

---

## [2.1.x] - 2024-09-10

### ✨ Feature Additions
- Added playlist tracking functionality
- Improved thumbnail overlay system
- Enhanced settings management
- Better error handling and user feedback

### 🔧 Technical Improvements
- Refined storage operations
- Improved overlay positioning and visibility
- Enhanced playlist detection and tracking

---

## [1.x] - 2024-08-01

### 🎉 Initial Release
- Initial release with IndexedDB storage
- Basic video progress tracking functionality
- Simple overlay system for video thumbnails
- Core extension infrastructure
- Basic popup interface for viewing history

---

## Development Notes

### Sync Architecture
The new sync system prioritizes local storage and uses Firefox Sync as a backup/sharing mechanism. Data conflicts are resolved with local storage taking precedence, ensuring user data integrity.

### Testing Coverage
All new sync functionality includes comprehensive unit and integration tests. The test suite now covers sync triggers, error handling, and cross-device scenarios.

### Debug Features
Enhanced debugging capabilities for sync operations, including detailed logging and testing utilities for developers and advanced users. 

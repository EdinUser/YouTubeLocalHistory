# Changelog

All notable changes to YT re:Watch will be documented in this file.

## [3.0.0] - Upcoming

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
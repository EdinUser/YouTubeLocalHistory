# ![YT re:Watch](./src/icon48.png) YT re:Watch

[![Tests](https://github.com/EdinUser/YouTubeLocalHistory/actions/workflows/ci.yml/badge.svg)](https://github.com/EdinUser/YouTubeLocalHistory/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/EdinUser/YouTubeLocalHistory)](https://github.com/EdinUser/YouTubeLocalHistory/releases)
[![Telegram Channel](https://img.shields.io/badge/Community-Telegram-2AABEE?logo=telegram&logoColor=white)](https://t.me/+eFftKWGVvSpiZjZk)

**Private local YouTube history, progress tracking, local subscriptions, playlists, and a YouTube-style feed inside your browser.**

YT re:Watch keeps your watch progress on your device so you can switch YouTube accounts, use YouTube logged out, import your data, and browse a local subscription feed without relying on Google account history.

📚 **[New user? Start with the guide](./docs/index.md)**

<div align="center">
  <strong>Local history • Local subscriptions • Local playlists • In-extension feed • No Google login required</strong>
  <br>
  <em><a href="./docs/faq.md">FAQ</a> | <a href="./docs/detailed_guide.md">Complete Guide</a> | <a href="./docs/technical.md">Developer Docs</a></em>
</div>

---

<div align="center">
  <img src="./src/icon128.png" alt="YT re:Watch YouTube History Extension" width="96" height="96">
  
  [![Chrome Web Store](https://img.shields.io/badge/Get_it_on-Chrome_Web_Store-4285F4?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/local-youtube-video-histo/pebiokefjgdbfnkolmblaaladkmpilba)
  [![Firefox Add-ons](https://img.shields.io/badge/Get_it_on-Firefox_Add--ons-FF7139?logo=firefox-browser&logoColor=white)](https://addons.mozilla.org/firefox/addon/yt-rewatch/)
  
  *YouTube progress tracking without account limitations. Your viewing history stays local.*
</div>


---

## What It Does

YT re:Watch gives YouTube a local history layer that works independently from your Google account.

- **Track progress locally** across YouTube accounts, private sessions, or logged-out browsing
- **Show watched labels** and progress bars inside the extension feed
- **Resume videos** from your saved local timestamp
- **Subscribe to channels locally** and browse their videos inside the extension feed
- **Manage local channels, subscriptions, playlists, history, and settings** from one full-page extension interface
- **Search locally across saved history and feed inventory**, with channel matches grouped above video results
- **Import YouTube history and channels** from Google Takeout / CSV files
- **Back up and restore documented profile data** as a JSON file
- **Analyze your watching patterns** without sending your history to an app server

### Privacy Transparency

YT re:Watch stores your history, subscriptions, playlists, settings, and analytics locally in your browser.

It does not provide network anonymity. YouTube can still see normal YouTube page requests, cookies, IP address, and browser fingerprinting signals. For stronger privacy, combine this extension with browser privacy settings, content blockers, VPN/Tor-style tools, and logged-out browsing.

## 🚀 Get Started in 30 Seconds

### Step 1: Install the Extension
**Chrome Users:** [Get it from Chrome Web Store →](https://chromewebstore.google.com/detail/local-youtube-video-histo/pebiokefjgdbfnkolmblaaladkmpilba)

**Firefox Users:** [Get it from Firefox Add-ons →](https://addons.mozilla.org/firefox/addon/yt-rewatch/)

### Step 2: That's It!
- Go to YouTube and start watching videos
- The extension works automatically in the background
- Click the extension icon to continue watching, open Watch Later, or launch the full feed page
- Use the feed page to search local data, subscribe locally, browse channels, manage playlists, view history, and back up your data

## Perfect For

### 🔄 **Multi-Account Users** (#1 Use Case!)
- "I switch between work and personal YouTube accounts and hate losing progress"
- "My family shares this computer and we use separate browser profiles"
- "I manage multiple YouTube channels and need consistent local tracking"
- "I want to watch YouTube logged out without losing my history"

### 🔒 **Privacy-Focused Users**
- "I want watch history saved locally instead of tied to my Google account"
- "I want my extension-saved history kept separate from my YouTube account history"
- "I want YouTube progress tracking while using stricter browser privacy settings"
- "I need a private local alternative to YouTube's built-in history page"

### 👨‍🎓 **Students & Content Creators**
- "I need reliable progress tracking for research, tutorials, and long videos"
- "I want to keep viewing notes and habits separate from my YouTube profile"
- "I want consistent local history while switching accounts or browsing sessions"
- "I need analytics for my own viewing patterns without sending data to a server"

### 📺 **Local Feed Users**
- "I want a subscriptions feed without relying on a Google account subscription list"
- "I want to import channels from Google Takeout and browse them locally"
- "I want local playlists, watch later, history, channels, and settings in one place"
- "I want a YouTube-style feed that I can back up and move between browsers"

---

## 📱 What You'll See

### 🏷️ **Viewed Indicators**
The extension adds visual indicators inside YT re:Watch:
- **"Viewed" labels** - Shows videos already in your local watch history
- **Progress bars** - Shows local completion progress on video cards
- **Works across feed views** - Home, subscriptions, playlists, search, and history
- **Best-effort YouTube support** - Adds watched labels on supported YouTube thumbnail layouts

Additionally, the history list now shows the video’s channel name beneath the title for quicker scanning.

### 🎛️ **Extension Interface**
The popup now focuses on quick actions:
- **Continue watching** - Quickly resume recently watched videos
- **Watch Later** - Open videos you saved for later
- **Open Feed** - Launch the full local YouTube-style interface

The full feed page contains the larger sections:
- **Home** - Local recommendations from your subscribed channels
- **Subscriptions** - Latest videos from locally subscribed channels in date order
- **Shorts** - Dedicated Shorts view
- **Playlists** - Local playlists you create and manage
- **History** - Watched videos, progress, and date watched
- **Channels** - All locally subscribed channels, with open/unsubscribe actions
- **Analytics** - Watch-time and completion statistics
- **Settings** - Theme, history/feed, import/export, and cleanup controls

The feed page also includes local search across saved history and cached feed records, grouped channel matches, and in-extension channel pages where you can subscribe locally and browse cached videos without using YouTube's account subscriptions. It does not send typed searches to YouTube.

---

## 🗂️ Key Features

### 🔄 **Multi-Account & Privacy**
- **Account Independence**: Same YouTube history across all accounts (or no account)
- **Local Storage**: All data stored securely on your device only
- **Local Progress Tracking**: Use your own browser history instead of relying on YouTube account history
- **Backup/Restore**: Back up and merge the documented YT re:Watch profile data anytime
- **Robust Deletion System**: Deleted videos stay deleted across all devices with tombstone-based protection

### 🎯 **Progress Tracking**
- **Viewed indicators**: Shows "Viewed" labels and local progress bars inside YT re:Watch, plus best-effort labels on supported YouTube thumbnail layouts
- **Auto-save**: Tracks video position every 5 seconds while you watch
- **YouTube Shorts**: Tracks short-form videos separately from regular videos
- **Local playlists**: Save videos into local playlists and manage them inside the feed page

### 🏠 **Local YouTube-Style Feed**
- **Local subscriptions**: Subscribe to channels locally without needing a Google account
- **Home page**: Randomized local recommendations from subscribed channels, balanced with freshness and channel diversity
- **Subscriptions page**: Latest videos from subscribed channels in date order
- **Channels page**: View, open, and unsubscribe from local channels
- **Extension search**: Search saved history and the locally cached feed inventory, with channel matches grouped above video results
- **In-extension channel pages**: Open a channel inside YT re:Watch to subscribe locally and browse that channel's videos
- **Local playlists**: Create playlists, add videos from the feed, view saved videos, and remove items
- **Local history page**: Review watched videos, watch progress, and watched date
- **Cleaner full-page UI**: Larger YouTube-like interface for browsing feed, history, analytics, playlists, and settings

### 📊 **Analytics & Insights**
- **Interactive Charts**: Viewing patterns by hour and day
- **Longest Unfinished Videos**: Quickly resume long videos you haven't finished (shows channel, time left, and link)
- **Top Watched Channels**: See your top 5 channels by videos watched (with links)
- **Top Skipped Channels**: See your top 5 channels where you most often skip long videos (with links)
- **Completion Bar Chart**: Visualize your completion rate for long videos (skipped, partial, completed) with a bar chart and legend
- **Weekly Activity**: Visualize your YouTube usage patterns

Analytics now prefer locally persisted, privacy-preserving statistics for better accuracy and performance.

### 🔄 **Data Portability & Local Storage**
- **Unlimited local storage**: GB-scale capacity with IndexedDB + localStorage hybrid system
- **Profile backup/restore**: Export and merge history, legacy and canonical subscriptions, YouTube playlist references, local playlists, Watch Later, settings, stats, recommendation preferences, and selected local caches via JSON files
- **Manual export/import**: Transfer data between devices via JSON files
- **Bulletproof reliability**: Core functionality works even if IndexedDB unavailable
- **Privacy protection**: All extension-saved data stays local; no re:Watch cloud service is required
- **Performance optimized**: Fast queries with indexed search and memory-efficient pagination

### 🎨 **User Experience**
- **Modern Interface**: Clean, card-based layout
- **Dark/Light Theme**: Automatic system theme detection
- **Smart Search**: Search saved history and feed records locally from the feed page
- **Responsive Design**: Works perfectly on all screen sizes
- **Simpler popup**: The toolbar popup stays focused on quick resume/watch-later actions while full browsing happens on the feed page

---

## 🤝 Community & Support

- 🌐 **[Visit our website](https://rewatch.kirilov.dev/)** - Complete documentation and guides
- 💬 **[Join our community forum](https://community.kirilov.dev/t/re-watch)** - Get help, share tips, and connect with other users
- 💬 **[Telegram community](https://t.me/+eFftKWGVvSpiZjZk)** - Real-time chat and support
- 📖 **[Read our documentation](./docs/index.md)** - Complete guides for all skill levels
- 🗺️ **[View the roadmap](./docs/roadmap.md)** - See the planned direction after the current stable release
- 🐛 **[Report bugs on GitHub](https://github.com/EdinUser/YouTubeLocalHistory/issues)** - Help improve the extension
- ⭐ **[Rate us on browser stores](https://chromewebstore.google.com/detail/local-youtube-video-histo/pebiokefjgdbfnkolmblaaladkmpilba)** - Support the project

---

## 📥 Installation

### 🔥 **Recommended: Install from Browser Stores**

**Chrome Users:**
[![Get YT re:Watch on Chrome Web Store](https://img.shields.io/badge/Get_YT_re:Watch_on-Chrome_Web_Store-4285F4?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/local-youtube-video-histo/pebiokefjgdbfnkolmblaaladkmpilba)

**Firefox Users:**
[![Get it on Firefox Add-ons](https://img.shields.io/badge/Get_it_on-Firefox_Add--ons-FF7139?logo=firefox-browser&logoColor=white)](https://addons.mozilla.org/firefox/addon/yt-rewatch/)

### 🔧 **For Developers: Manual Installation**

<details>
<summary>Click to expand developer installation instructions</summary>

**Chrome:**
1. Run `npm run build` from Git Bash/WSL to build the Chrome extension
2. Open Chrome → `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the `build/chrome` folder

**Firefox:**
1. Run `npm install`
2. Run `npm run prepare:firefox`
3. Open Firefox → `about:debugging#/runtime/this-firefox`
4. Click "Load Temporary Add-on" and select `build/firefox/manifest.json`

</details>

## Storage System

This extension uses a **hybrid storage architecture** combining IndexedDB and localStorage for optimal performance and unlimited capacity:

- **IndexedDB**: Unlimited storage for complete video/playlists history with full metadata
- **localStorage**: Fast overlay for recent/active content and lightweight configuration
- **Merged reads**: Seamless access to complete history with local changes taking priority
- **Extension-scoped**: IndexedDB is never created under YouTube origin for privacy protection

### Persistent Statistics
For faster and more consistent Analytics, the extension maintains a small, local statistics snapshot:
- `totalWatchSeconds`: cumulative seconds watched
- `daily`: last 7 days of totals keyed by local date `YYYY-MM-DD`
- `hourly`: array of 24 totals for each hour of day

These stats are calculated and stored locally only. On first upgrade, they are seeded from your existing history when possible.

### Hybrid Storage Migration

The extension automatically migrates from legacy storage to the new hybrid system on first run. The migration process:

1. **Verified migration**: Each batch is written to IndexedDB and verified before cleanup
2. **Fail-safe**: Local data is never deleted until IndexedDB archival is confirmed
3. **Resumable**: Migration continues from last successful batch if interrupted
4. **Stats rebuild**: Analytics statistics are recalculated from migrated data
5. **Graceful fallback**: Extension continues working during migration process

### Data Stored

The extension can store:

- **Video History**: Video IDs, timestamps, progress, titles, and URLs
- **Playlist History**: Playlist IDs, titles, and URLs
- **Local Subscriptions**: Channels you subscribe to inside YT re:Watch
- **Local Playlists and Watch Later**: Playlists and saved videos managed by the extension
- **Settings**: User preferences for feed appearance, refresh, cleanup, and default page
- **Statistics**: Aggregated watch-time summaries used for analytics (local only)
- **Caches**: Duration, Shorts detection, and release-date caches used to make the feed faster and more accurate

## Usage

1. **Install the extension** following the instructions above
2. **Visit YouTube** and start watching videos
3. **Your progress is automatically saved** every 5 seconds with smart timestamp loading to prevent video interruption
4. **Click the extension icon** to quickly continue watching, open Watch Later, or open the full feed page
5. **Use the feed page** for Home, Subscriptions, Shorts, Playlists, History, Channels, Analytics, Settings, search, and in-extension channel pages
6. **Export/import data** anytime for backup and transfer between devices

### Settings

#### 🎨 Appearance
- **Theme**: Choose between System (follows your OS theme), Light, or Dark theme with instant switching
- **Accent Color**: Choose the feed page accent color
- **Default Feed Page**: Choose whether the full feed opens to the last used page, Home, Subscriptions, Shorts, Playlists, History, Channels, or Analytics

#### 🗂️ History & Feed
- **Auto-clean Period**: Automatically remove history entries older than specified days (1–180 days), or choose **Forever** to disable auto-cleanup
- **Feed Refresh Interval**: Choose how often the extension checks locally subscribed channels for new videos
- **History cleanup**: Use the History tab's clear action when you need to remove local watch history

#### 🔄 Data Management
- **Backup profile data**: Download a local JSON backup containing history, legacy and canonical subscriptions, YouTube playlist references, local playlists, Watch Later, settings, analytics data, recommendation preferences, and selected caches
- **Restore backup**: Merge a previous YT re:Watch backup into the current browser profile
- **Import YouTube history**: Import Google Takeout watch history
- **Import channels**: Import YouTube subscribed channels from `subscriptions.csv` in Google Takeout
- **Data Portability**: Transfer history between devices manually

Backups are merge-oriented profile backups, not byte-for-byte database
snapshots. Rebuildable subscription-feed inventory, scheduler state, Home
impressions, and internal maintenance/deletion records are not exported.

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

- **No app backend**: YT re:Watch does not upload your history to an extension-owned server
- **Local Storage First**: Your history, local subscriptions, playlists, settings, backups, and analytics live in browser storage
- **Limited direct YouTube requests**: Feed synchronization reads public channel RSS. Adding an `@handle` may resolve its public channel page, and the feed may refresh public channel metadata. These requests omit browser credentials.
- **YouTube-hosted images**: Thumbnails, avatars, and banners may load from YouTube-owned image hosts when displayed
- **No remote feed search or playlist hydration**: Feed search uses local records. Saved or imported YouTube playlist references are not fetched in the background; clicking one opens YouTube normally.
- **Normal YouTube traffic remains visible to YouTube**: Watching videos or opening YouTube links still makes ordinary page, media, cookie, analytics, and advertising requests that the extension does not hide
- **Manual portability**: Backups are local JSON files that you control

## Security

The extension stores data in extension-scoped browser storage (`chrome.storage.local` / `browser.storage.local`) and IndexedDB:

- **Extension isolation**: Web pages cannot read the extension's storage directly
- **Browser-managed storage**: Data is protected by the browser profile and operating system user account
- **Local backups**: Exported backup files are plain JSON, so store them somewhere you trust

## Troubleshooting

### Extension Not Working
1. **Refresh and Retry**: Refresh the YouTube page or the full feed page
2. **Check Permissions**: Make sure the extension has access to YouTube
3. **Extension Status**: Verify the extension is enabled in your browser
4. **Reload Extension**: Disable/enable the extension or reload it from the browser extension page

### History Not Loading  
1. **Feed Refresh**: Open the feed page and click Refresh
2. **Page Refresh**: Refresh the YouTube page completely  
3. **Console Logs**: Check browser console for error messages (F12 → Console)
4. **Storage Check**: Verify extension has storage permissions
5. **Backup First**: Export a backup before clearing any extension data

### Storage & Migration Issues
1. **Storage Space**: Ensure sufficient disk space for IndexedDB storage
2. **Browser Storage**: Verify extension has storage permissions enabled
3. **Fallback Mode**: Extension continues working if IndexedDB is unavailable
4. **Export Backup**: Always export data before major troubleshooting

### Migration Issues
If you experience issues with data migration from older versions:
1. **Automatic Retry**: The extension will automatically retry migration on next startup
2. **Export First**: Export your data before troubleshooting to preserve it
3. **Clear and Restart**: If problems persist, clear extension data and start fresh
4. **Import Backup**: Use the import feature to restore previously exported data

## Development

### Project Structure
```
├── src/
│   ├── background.js                 # Extension background/service worker logic
│   ├── content*.js                   # YouTube page tracking, overlays, playlists, and messages
│   ├── popup*.js / popup.html        # Toolbar popup, settings, history, and quick actions
│   ├── feed*.js / feed.html          # Full local feed app, search, subscriptions, playlists, settings, and backup
│   ├── storage.js                    # Hybrid storage API
│   ├── indexeddb-storage.js          # IndexedDB backend
│   ├── manifest.chrome.json          # Chrome manifest
│   └── manifest.firefox.json         # Firefox manifest
├── docs/                             # User and maintainer docs
├── tests/                            # Unit and integration tests
├── build/                            # Prepared browser builds
├── dist/                             # Release packages, when built
├── build.sh                          # Chrome/Firefox build script
├── prepare-firefox-build.js          # Firefox temporary-addon build helper
└── merge_locales.js                  # Locale build helper
```

### Building
1. Make changes to the source files in the `src/` directory
2. Run `./build.sh` for release packages, or `npm run prepare:firefox` for a Firefox temporary build
3. Test the built extensions in your browser
4. Temporary unpacked builds are written to `build/`; release packages are written to `dist/`

## License

MIT License - see LICENSE file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Release Notes

See [CHANGELOG.md](CHANGELOG.md) for detailed release notes and version history.

---

## 🎯 **Summary: Why Choose YT re:Watch?**

**YT re:Watch** is the ultimate **YouTube history extension** for users who:
- Switch between **multiple YouTube accounts** (work/personal)
- Want **YouTube history without login** requirements
- Need **YouTube progress tracking** with local viewed indicators
- Prefer an **account-independent local history** over relying on YouTube's account history
- Want **consistent viewing history** regardless of account status

**Key Search Terms:** YouTube multiple accounts, YouTube account switching, YouTube history extension, YouTube progress tracking, YouTube without login, YouTube privacy extension, YouTube progress bar, YouTube viewed videos, YouTube multi-account, YouTube local storage

**Perfect for:** Multi-account users, privacy-conscious users, students, researchers, content creators, families sharing computers, and anyone who wants reliable local progress tracking without relying on Google account history.

⭐ **[Install now from Chrome Web Store](https://chromewebstore.google.com/detail/local-youtube-video-histo/pebiokefjgdbfnkolmblaaladkmpilba)** or **[Firefox Add-ons](https://addons.mozilla.org/firefox/addon/yt-rewatch/)**

## Multilanguage Support

This extension supports multiple languages:
- English (en)
- German (de) (machine-generated)
- Spanish (es) (machine-generated)
- French (fr) (machine-generated)
- Bulgarian (bg) (machine-generated)

**Note:** All non-English translations are currently machine-generated. If you are a native speaker and notice any issues, please consider contributing improvements! See `src/_locales/README.md` for translation guidelines.

## ❤️ Support the Project

If you find YT re:Watch useful, consider supporting development on [Patreon](https://patreon.com/EdinUser)!

[![Support on Patreon](https://img.shields.io/badge/Support%20on-Patreon-orange?logo=patreon&logoColor=white)](https://patreon.com/EdinUser)

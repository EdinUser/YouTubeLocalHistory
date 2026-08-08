# Code Notes for Maintainers

These notes are for the original developer or anyone reviewing the fork. They explain the main moving parts in plain language and call out recent refactors/behavior changes.

## High-Level Purpose

YT re:Watch is a local-first YouTube history extension. It stores watch progress, playlist data, local subscriptions, feed cache, analytics data, and user settings in extension storage/IndexedDB. The extension avoids using a backend server.

## Runtime Areas

### YouTube Page Content Scripts

These files run directly on YouTube pages through the manifest `content_scripts` list. Load order matters because these are plain scripts, not ES modules.

- `storage.js`: defines the global `ytStorage` API used by the rest of the extension.
- `content-css.js`: injects shared content-script CSS for playlist history controls, the active-info popup, and thumbnail viewed/progress overlays.
- `content-url.js`: extracts YouTube video IDs and handles clean/timestamped YouTube URLs.
- `content-import.js`: shows the in-page import overlay when YouTube opens with `#ytlh_import`.
- `content-playlists.js`: reads playlist metadata from YouTube pages, saves playlist records, and adds the per-playlist History active/paused control. On playlist pages it creates a separate row below native actions and ignores hidden legacy headers; on playlist-backed watch pages it uses the playlist panel.
- `content-info.js`: shows the one-time YT re:Watch active info popup.
- `content-thumbnails.js`: adds viewed/progress overlays to extension-feed thumbnails and best-effort viewed labels on supported YouTube thumbnail layouts. YouTube page markup changes often, so native YouTube overlays are intentionally conservative.
- `content-messages.js`: handles popup/import messages sent to the YouTube tab.
- `content.js`: remaining bootstrap and video tracking logic. It wires the helpers together, tracks video elements, saves/restores timestamps, detects SPA navigation, and registers listeners.
- `feed-core.js`: shared parser/selector helpers for local subscription feed data.
- `content-subscriptions.js`: local subscription behavior inside YouTube pages, compact/local Subscribe companions, account UI hiding, and feed-cache refresh wiring. Watch-page state is resolved through the extension-origin canonical subscription store, including an `@handle` to UC-ID fallback, and its observer is limited to real subscription-surface replacement to avoid Firefox remount blinking.

Important: when adding another content helper file, update all manifests and `build.sh`, otherwise packaged builds can miss the file.

## Extension Pages

### Popup

Files named `popup*.js` power the browser action popup:

- `popup-core.js`: initializes popup storage/state and shared popup helpers.
- `popup.js`: top-level popup wiring and tab switching.
- `popup-data-pages.js`, `popup-history-display.js`, `popup-video-pagination.js`, `popup-shorts.js`, `popup-playlists.js`: history/shorts/playlist display and paging.
- `popup-search.js`: popup search and search suggestions.
- `popup-settings.js`, `popup-theme.js`, `popup-localization.js`: settings, theme, and localized text.
- `popup-analytics*.js`: local analytics and charts.
- `popup-import.js`: import UI logic.
- `popup-subscriptions.js`: local subscriptions/watch-later related popup behavior.

### Feed Page

Files named `feed*.js` power the extension feed page:

- `feed.js`: top-level feed page wiring.
- `feed-refresh.js`: refresh button/status handling.
- `feed-data-pipeline.js`: fetches RSS/backfill videos, resolves durations/Shorts metadata, and writes `feedCache`. RSS entries are the source of truth for subscription dates/views; YouTube backfill should only add older missing videos or safe metadata such as member badges.
- `feed-home.js`: ranks and renders the local Home view.
- `feed-cards.js`: builds video cards and card menus. Cached feed cards should display dates from `published`; `_whenText` is reserved for live YouTube search/history-style results.
- `feed-local-search.js`: local feed/history search and metadata enrichment.
- `feed-youtube-search-core.js`, `feed-youtube-search-render.js`: YouTube search integration.
- `feed-subscriptions-view.js`, `feed-playlists-view.js`, `feed-playlist-import.js`, `feed-history-view.js`, `feed-analytics.js`, `feed-settings.js`, `feed-backup.js`: individual feed page sections.
- `feed-state-utils.js`: shared feed state, formatting, and utility helpers.

## Storage Notes

`storage.js` is still large and central. It exposes `globalThis.ytStorage = new SimpleStorage()`.

Main responsibilities:

- browser storage wrapper
- migration from old storage paths
- hybrid IndexedDB/storage.local behavior
- video history methods
- playlist methods
- paginated history methods
- settings
- watch later
- import/export helpers
- stats
- local subscriptions
- feed/duration/Shorts/release-date caches

Because many files depend on `ytStorage`, split `storage.js` carefully. Good future split targets are subscription/cache methods and stats/import methods, but do that with tests available.

## Recent Refactor Notes

`content.js` used to be over 3,000 lines. It has been split into helper files:

- CSS moved to `content-css.js`
- URL helpers moved to `content-url.js`
- import overlay moved to `content-import.js`
- playlist helpers moved to `content-playlists.js`
- info popup moved to `content-info.js`
- thumbnail overlay logic moved to `content-thumbnails.js`
- popup message listener moved to `content-messages.js`

The helper files expose small globals like `window.YTVHTContentUrls` because the extension currently uses plain manifest script loading instead of a bundler/module system.

## Home Feed Ranking Notes

The Home feed is intentionally randomized across the local back catalog, while still keeping some freshness and channel-affinity signal.

Recent change in `feed-home.js`:

- Home ranks across all ready feed videos instead of hard-limiting to recent uploads.
- Random discovery is strong enough to surface uploads from weeks or months ago.
- The ranked list is interleaved by age buckets so the top grid is not mostly this week when older cached videos exist.
- Videos older than the back-catalog window receive only a soft age penalty.
- Channel diversity is capped to avoid one channel, such as EthosLab, filling too much of Home.

The chronological Subscriptions view should still show newest-first.

## Build Notes

`build.sh` copies files explicitly. If a new source file is added, update:

- the copy list in `copy_common_files`
- the Firefox zip file list
- all manifest files if it is loaded by the browser

Current manifests:

- `src/manifest.chrome.json`
- `src/manifest.firefox.json`

## Known Risk Areas

- YouTube DOM selectors change often. Content script selectors should be broad but not too eager.
- YouTube SPA navigation reuses video elements, so video tracking must reset per-video state carefully.
- Feed backfill can introduce older videos; ranking should balance discovery with freshness.
- Do not let YouTube channel backfill overwrite RSS dates/views for videos already present in RSS. YouTube's rendered relative text can be stale or page-load relative, which makes Subscriptions show incorrect "minutes ago" dates.
- `storage.js` is a shared public API inside the extension. Avoid changing method names without updating popup/feed/content code.
- Run `npm run lint`, `npm test -- --runInBand`, `npm run prepare:firefox`, and `npx web-ext lint --source-dir=build/firefox` after refactors.

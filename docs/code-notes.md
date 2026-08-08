# Code Notes for Maintainers

These notes are for the original developer or anyone reviewing the fork. They explain the main moving parts in plain language and call out recent refactors/behavior changes.

## High-Level Purpose

YT re:Watch is a local-first YouTube history extension. It stores watch
progress, playlist data, local subscriptions, canonical feed inventory,
analytics data, and user settings in extension storage/IndexedDB. The
extension has no application backend.

## Runtime Areas

### YouTube Page Content Scripts

These files run directly on YouTube pages through the manifest `content_scripts` list. Load order matters because these are plain scripts, not ES modules.

- `indexeddb-storage.js`: defines the extension-origin IndexedDB repository,
  including durable history/playlist stores and the canonical v5 feed stores.
- `storage.js`: defines the global `ytStorage` compatibility API used by the
  rest of the extension.
- `local-subscription-actions.js`: centralizes canonical local Follow/Unfollow
  behavior and bounded `@handle` resolution.
- `content-css.js`: injects shared content-script CSS for playlist history controls, the active-info popup, and thumbnail viewed/progress overlays.
- `content-url.js`: extracts YouTube video IDs and handles clean/timestamped YouTube URLs.
- `content-import.js`: shows the in-page import overlay when YouTube opens with `#ytlh_import`.
- `content-playlists.js`: reads playlist metadata from YouTube pages, saves playlist records, and adds the per-playlist History active/paused control. On playlist pages it creates a separate row below native actions and ignores hidden legacy headers; on playlist-backed watch pages it uses the playlist panel.
- `content-info.js`: shows the one-time YT re:Watch active info popup.
- `content-thumbnails.js`: adds viewed/progress overlays to extension-feed thumbnails and best-effort viewed labels on supported YouTube thumbnail layouts. YouTube page markup changes often, so native YouTube overlays are intentionally conservative.
- `content-messages.js`: handles popup/import messages sent to the YouTube tab.
- `content.js`: remaining bootstrap and video tracking logic. It wires the helpers together, tracks video elements, saves/restores timestamps, detects SPA navigation, and registers listeners.
- `content-subscriptions.js`: local subscription behavior inside YouTube pages,
  compact/local Subscribe companions, and account UI hiding. Watch-page state
  is resolved through the extension-origin canonical subscription store,
  including an `@handle` to UC-ID fallback, and its observer is limited to real
  subscription-surface replacement to avoid Firefox remount blinking. It does
  not own RSS, feed inventory, or scheduler work.

The removed `feed-core.js` helper is not a content script. When adding another
content helper, update both manifests and `build.sh`; the release-artifact gate
must also continue to pass.

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

- `feed.js`: top-level page wiring and page-active scheduler coordination.
- `feed-refresh.js`: reloads canonical projections and owns manual Refresh
  status/notice behavior.
- `feed-contracts.js`, `rss-parser.js`, `rss-client.js`, and
  `feed-ingestion.js`: normalize public channel RSS and idempotently upsert the
  canonical feed inventory and per-channel sync state.
- `feed-enrichment.js` and `feed-channel-metadata.js`: bounded presentation
  metadata work; they do not own feed discovery.
- `feed-channel-classification.js`, `feed-scheduler.js`, and
  `feed-retention.js`: activity-based eligibility, bounded RSS scheduling,
  retry/lease state, and cleanup limited to feed-owned records.
- `feed-view-data.js`, `feed-view-preference.js`, and `feed-state-utils.js`:
  canonical view projections, durable view choice, shared state, and formatting.
- `feed-local-search.js`: searches only saved history and canonical feed records;
  it does not call YouTube search or an internal API.
- `feed-home.js` and `feed-cards.js`: rank and render local Home/feed cards,
  including durable Home-impression updates.
- `feed-subscription-import.js`, `feed-subscriptions-view.js`,
  `feed-subscribe-results.js`, and `feed-channel-view.js`: canonical local
  subscription acquisition and channel surfaces.
- `feed-playlists-view.js`, `feed-playlist-import.js`,
  `feed-history-view.js`, `feed-analytics.js`, `feed-settings.js`, and
  `feed-backup.js`: individual feed sections and profile portability.

The legacy `feed-data-pipeline.js`, `feed-youtube-search-core.js`,
`feed-youtube-search-render.js`, and `feed-core.js` modules were removed. The
active feed has one RSS scheduler and no remote-search fallback.

## Storage Notes

The extension has two central storage boundaries:

- `storage.js` exposes `globalThis.ytStorage = new SimpleStorage()` for durable
  watch history, playlists, deletion markers, Watch Later, settings, stats,
  selected caches, and legacy `sub_*` compatibility records.
- `indexeddb-storage.js` exposes `globalThis.ytIndexedDBStorage` and owns the
  extension-origin database at version 5. Its canonical feed stores are
  `subscriptions`, `subscription_feed_videos`, `channel_sync_state`,
  `home_impressions`, and `feed_sync_runs`.

Main responsibilities:

- `subscriptions` contains only explicit canonical local follows/imports keyed
  by UC channel ID. Legacy `sub_*` records are not automatic feed inputs.
- `subscription_feed_videos` is the RSS-derived feed inventory. Existing watch
  history remains a separate durable source used only for local ranking and
  watched presentation.
- `channel_sync_state` persists scheduler eligibility, leases, retry state, and
  initialization progress.
- `home_impressions` supports local Home rotation, and `feed_sync_runs` keeps a
  bounded scanner summary history.
- Feed retention removes only feed-owned inventory, impression, and run-summary
  records. It does not prune history, progress, playlists, saved items, local
  subscriptions, or channel sync state.
- `feedCache` and the aggregate/backfill pipeline are not part of the active v5
  feed runtime.

Because many files depend on these globals, change either storage API carefully
and keep migrations plus repository contract tests aligned.

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

- Home ranks across the ready canonical feed inventory instead of hard-limiting
  to recent uploads.
- Random discovery is strong enough to surface uploads from weeks or months ago.
- The ranked list is interleaved by age buckets so the top grid is not mostly this week when older cached videos exist.
- Videos older than the back-catalog window receive only a soft age penalty.
- Channel diversity is capped to avoid one channel, such as EthosLab, filling too much of Home.

The chronological Subscriptions view should still show newest-first.

## Build Notes

`build.sh` copies release files explicitly. If a new loaded source file is
added, update:

- the copy list in `copy_common_files`;
- `feed.html` or the appropriate manifest when it owns the load order;
- both browser manifests when it is a content/background script.

`tests/integration/release-artifacts.test.js` runs the real build in an isolated
checkout and verifies directory/archive parity plus every manifest/HTML
reference for both browsers. It also contains a negative missing-module case.

Current manifests:

- `src/manifest.chrome.json`
- `src/manifest.firefox.json`

## Known Risk Areas

- YouTube DOM selectors change often. Content script selectors should be broad but not too eager.
- YouTube SPA navigation reuses video elements, so video tracking must reset per-video state carefully.
- The retained RSS inventory can include older videos; ranking should balance
  discovery with freshness while Subscriptions remains chronological.
- `storage.js` is a shared public API inside the extension. Avoid changing method names without updating popup/feed/content code.
- Run `npm run lint`, focused Jest tests, the release-artifact gate, and the
  relevant packaged Chrome/Firefox suites after refactors.

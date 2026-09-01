# Changelog

## v5.2.0 — 1 September 2026

- Added experimental **AI-labeled video handling** with Off, Badge, Dim, and
  Hide modes for videos YouTube itself discloses as made with AI.
- Added a dedicated IndexedDB cache, paced viewport-driven lookups with at most
  two requests in flight, long cache lifetimes, and bounded retry backoff to
  keep request volume low.
- The setting explains that it makes direct YouTube requests when enabled and
  is not a general or fully reliable AI detector.
- Fixed Subscriptions so the chosen upload-date or detection-date order survives
  **Reload view** and **Show**, without pinning newly discovered videos ahead of
  the selected order.
- Fixed popup startup and live-update races that could make already-loaded
  content pulse or render repeatedly after a YouTube tab had been open longer.
- Added the installed extension version and consistent re:Watch icon branding
  to both the popup and full-page feed.
- Unified the first-use welcome and AI-label notices into one branded re:Watch
  toast with dark-mode styling, one-at-a-time protection, and a normal browser
  action-popup handoff.
- Refined full-page headers to avoid duplicate nearby titles when the sidebar is
  expanded, while keeping the current view title visible in collapsed mode.
- The full-page sidebar now starts expanded. **Reload videos** scans followed
  channels, while the adjacent **Refresh** button redraws only the local view.
- Reduced redundant overlay and thumbnail work by targeting changed video IDs,
  coalescing startup scans, and limiting focus rescans to presentation changes.
- Made background, storage, and AI-label informational output respect debug mode.
- Fixed Firefox **System default** appearance so the compact popup and full-page
  re:Watch view use the same theme.
- Treats removed or incomplete AI-label responses as indeterminate and uses
  bounded live Chrome/Firefox canary fallbacks when an external fixture changes.

## v5.1.0 — 14 August 2026

- Added extension-managed local playlists, including creation, rename, deletion, ordering, and video actions that remain separate from the user's YouTube account playlists.
- Made the RSS-backed subscription feed resilient to temporary YouTube `404`, `403`, `429`, `5xx`, timeout, and network failures: cached videos remain intact, retries use backoff and jitter, first imports retain priority, and retry-only work is paced conservatively.
- Added a per-channel RSS log in **Channels**, showing the latest 15 successful and failed feed reads with timestamps and HTTP status.
- Made popup history strictly last-watched ordered, including completed videos, and preserved the current popup page during live updates.
- Added upload-date and detection-date ordering for Subscriptions, with clear explanation of videos hidden by active filters.
- Unified full-page Feed headers around an icon, title, description, and view-local controls; added contextual Reload actions and a persisted collapsed sidebar icon rail.
- Handled extension-context invalidation without a misleading content-script error and made release rebuilds preserve the unpacked extension directory.

## v5.0.1 — 11 August 2026

- Fixed Continue Watching to use one unfinished-only, timestamp-sorted projection for its rows and popup pagination; live updates no longer mix visible rows with unfiltered history indexes.
- Restored the saved appearance color across the popup, full re:Watch page, and existing YouTube tabs, including Viewed badges and progress bars.
- Added the full-page **Watch Later** view, including newest-first ordering, open/remove actions, localization, and automatic repair of incomplete saved title/channel metadata.
- Made **Show** advertise only subscription discoveries that remain in local inventory after retention and active-subscription filtering.

## v5.0.0 — 9 August 2026

v5 turns re:Watch from a local progress tracker into a complete local browsing companion while keeping its account-independent storage model.

Highlights include:

- local channel subscriptions with public RSS-backed Home and Subscriptions feeds;
- stable 50-card pagination and distinct **Check**, **Reload**, and **Show** behavior;
- import-aware ignored-channel tombstones with a review tab that appears only when needed;
- Home, Subscriptions, Shorts, playlist references, History, Channels, Analytics, and Settings in one full-page interface;
- local search and feed actions without remote YouTube search or account mutation;
- improved resume tracking across ordinary videos and Shorts SPA navigation;
- duration badges and stable History card controls during incremental metadata updates;
- expanded local analytics, including restored insights and sortable channel metrics;
- canonical subscription and tombstone backup/restore support;
- complete reset of history, feed state, subscriptions, tombstones, deletion markers, analytics, and settings;
- Chrome and Firefox packages, offline browser suites, and isolated live YouTube canaries.

Saved YouTube playlists remain outbound references. v5 does not import their videos, provide extension-managed local playlists, use OAuth, or synchronize data through a re:Watch cloud service.

[Read the complete v5 notes and release history](https://github.com/EdinUser/YouTubeLocalHistory/blob/main/CHANGELOG.md){ .md-button .md-button--primary }

Completed behavior belongs in release notes. Planned behavior belongs in the [roadmap](roadmap.md).

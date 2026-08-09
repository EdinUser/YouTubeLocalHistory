# Changelog

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

# Technical reference

YT re:Watch is a browser extension with no application backend. Chrome and Firefox use separate manifests while sharing the same plain-script runtime modules.

## Runtime contexts

| Context | Main files | Responsibility |
| --- | --- | --- |
| YouTube content script | `content*.js`, `storage.js`, `indexeddb-storage.js` | Playback tracking, resume, SPA identity, overlays, playlist references, local follow controls |
| Background runtime | `background.js` | Cross-context messages, extension-page coordination, storage RPC |
| Popup | `popup*.js` | Compact unfinished/Watch Later view and handoff to full feed |
| Feed page | `feed*.js`, `rss-*.js` | Home, Subscriptions, Shorts, local playlists, History, Channels, Analytics, Settings, imports, backup |

Scripts expose bounded globals because the extension does not use a runtime bundler. Manifest/HTML load order is therefore part of the internal contract.

## Playback tracking

The content runtime identifies the active video from the YouTube route and active player, waits for meaningful playback, writes progress periodically, and flushes state on navigation or lifecycle changes. Resume compares the saved position with the player position after metadata becomes available.

YouTube reuses player elements during single-page navigation. Tracking state is keyed to the active route/video identity and reset when the identity changes, including Shorts navigation where player and route events can arrive in different orders.

Playlist-aware persistence checks both the global pause setting and a saved reference's ignore flag before writing history.

## YouTube overlays and controls

Content helpers add best-effort viewed/progress overlays and local follow controls to supported YouTube surfaces. Mutations are scoped to relevant containers so unrelated page updates do not repeatedly remount controls.

YouTube DOM is external and unstable. Production selectors are backed by captured-DOM Chrome and Firefox tests; live behavior is monitored separately by canaries.

## Storage architecture

`storage.js` exposes `globalThis.ytStorage`, the compatibility API used by content, popup, and feed code. `indexeddb-storage.js` exposes `globalThis.ytIndexedDBStorage`, the extension-origin IndexedDB repository.

The IndexedDB database is `YTLH_HybridDB`, version 6. Its stores are:

| Store | Key | Purpose |
| --- | --- | --- |
| `videos` | `videoId` | Durable history and playback progress |
| `playlists` | `playlistId` | Saved YouTube playlist references |
| `deletions` | `videoId` | Temporary history deletion markers |
| `subscriptions` | `channelId` | Explicit canonical local follows |
| `local_unsubscribe_tombstones` | `channelId` | Ignored import/unfollow records |
| `subscription_feed_videos` | `videoId` | Canonical public RSS inventory |
| `channel_sync_state` | `channelId` | Eligibility, leases, retries, initialization state |
| `home_impressions` | `videoId` | Local Home rotation history |
| `feed_sync_runs` | `runId` | Bounded scan summaries |

`storage.local` also holds settings, Watch Later, local playlists, analytics snapshots, selected caches, and compatibility records. Reads merge recent compatibility data with IndexedDB where required.

### Reset contract

`ytStorage.resetAllData()` clears extension local storage and calls the IndexedDB repository's full-store reset. The reset includes history, local playlists, playlist references, deletion markers, canonical feed stores, local-unsubscribe tombstones, settings, and cached state.

History-only removal is a distinct operation and must not be substituted for full reset.

## Canonical local subscriptions

Subscriptions are keyed by canonical `UC…` channel ID. Handle resolution is bounded and used only when a canonical ID is not already known. Legacy `sub_*` compatibility records do not automatically become scheduler inputs.

Unfollow can atomically remove the subscription and its feed/sync state while writing `local_unsubscribe_tombstones`. Import consults that store and reports skipped records. Restore removes the tombstone and recreates the canonical follow; forget removes only the tombstone.

## Feed ingestion and scheduling

The v5 feed has one public RSS ingestion path:

```text
explicit local follow
        ↓
eligibility + scheduler lease
        ↓
public RSS request (credentials omitted)
        ↓
normalized canonical feed records
        ↓
Home ranking / chronological Subscriptions
```

`rss-client.js` performs credential-omitted requests. `rss-parser.js` and `feed-ingestion.js` normalize and idempotently upsert uploads. `feed-scheduler.js` owns foreground initialization, retries, leases, and eligible maintenance. `feed-retention.js` prunes feed-owned records only.

The interface distinguishes network work from presentation:

- Check asks the scheduler to scan eligible channels.
- Reload reconstructs projections from local storage.
- Show reloads the complete subscription inventory without replacing its selected ordering.
- Opening Home regenerates local ranking without initiating a Home-owned request.

## Views and pagination

`feed-view-data.js` creates canonical projections. Home ranks the ready inventory
with freshness, affinity, impression, and channel-diversity signals.
Subscriptions defaults to canonical newest-first pagination and can apply a
persisted upload-date or detection-date ordering without pinning newly
discovered records outside that selection.

Home and Subscriptions use stable 50-record keyset pages. Page traversal must neither duplicate records nor allow a concurrent ordering change to corrupt the current boundary.

Local search combines saved history and canonical feed records; there is no remote-search fallback.

## Cards and incremental updates

`feed-cards.js` owns shared feed-card rendering and local actions. `feed-history-view.js` separates stable row controls from video-specific metadata so progress/duration refreshes do not replace Remove or menu controls.

Subscribe/unsubscribe state uses canonical channel identity and known aliases rather than display-name equality.

## Playlists

`content-playlists.js` extracts available playlist metadata and persistence preferences. re:Watch renders outbound references without hydrating YouTube playlist members in the background. `feed-playlists-view.js` separately manages extension-owned local playlists; neither form changes the user's YouTube account.

## Analytics

Analytics are calculated from local history and a compact persisted snapshot. The snapshot uses local-day `YYYY-MM-DD` keys and 24 hourly buckets. The full history remains authoritative and can rebuild derived presentation data.

Channel insights and unfinished/skipped groupings are rendered locally. Chart layout shares a common baseline between activity and hourly bars.

## Backup and restore

`feed-backup.js` exports supported profile data and restores it with merge semantics. Canonical subscriptions are deduplicated by channel ID. Non-empty existing metadata is retained, missing fields may be filled from the backup, and the earliest valid follow date is preserved. Local-unsubscribe tombstones round-trip with their canonical identity.

Rebuildable feed inventory and transient scheduler state are not required for portability.

## Network and permissions

The extension needs YouTube host access for content scripts and public feed/channel retrieval. Direct RSS and metadata requests omit browser credentials. Images rendered from YouTube-owned hosts remain ordinary resource requests.

v5 has no OAuth flow, remote search service, application server, or YouTube-account mutation path.

## Localization

User-facing messages live under `src/_locales/{locale}/messages.json`. The shipped locale directories are English, Bulgarian, German, Spanish, and French. Message keys use underscores for Chrome/Firefox compatibility.

## Build invariants

`build.sh` copies release sources explicitly. Every loaded file must exist in both appropriate browser artifacts and appear in the correct manifest/HTML order. `tests/integration/release-artifacts.test.js` checks artifact parity and missing references.

See [Build instructions](build.md) and [Testing](testing.md).

## Primary risk areas

- YouTube DOM and SPA event ordering;
- channel handle/ID identity transitions;
- storage migrations and reset completeness;
- scheduler leases and reload reconstruction;
- browser-specific extension lifecycle differences;
- backup compatibility and sensitive-data handling.

Changes in these areas need focused unit/integration coverage plus deterministic packaged Chrome and Firefox checks. Live canaries monitor, but do not replace, those gates.

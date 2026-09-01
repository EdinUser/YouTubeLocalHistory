# Privacy and data

## Experimental AI-labeled video handling

This feature is off by default. If enabled, re:Watch sends a direct request to
YouTube only for each previously unchecked card that approaches the viewport
on an open YouTube page. The request can use the ordinary YouTube page context
and credentials. re:Watch's own views never start these checks or send their
local history, subscription, or saved-video IDs to YouTube; they can only show
results already cached from YouTube-page browsing. The result (video ID,
observed YouTube disclosure state, and cache expiry) stays in the extension's
private IndexedDB storage; re:Watch sends no result or telemetry to another
service. The feature only reflects YouTube's own disclosure and is not a
reliable way to identify every AI-made video.

This restriction prevents a local re:Watch view from revealing which videos
exist in your local history, subscriptions, or saved lists merely because you
opened, paged through, or scrolled that view.

YT re:Watch is local-first. Its history, progress, subscriptions, cached feed records, analytics, settings, local playlists, playlist references, and ignored-channel records are stored in the extension profile on the current device.

## What stays local

- watched-video and Shorts history;
- playback positions, durations, and completion state;
- re:Watch channel subscriptions and ignored-channel tombstones;
- cached feed inventory and scheduling state;
- AI-label cache entries (video ID, observed disclosure state, and expiry);
- playlist references;
- extension-managed local playlists;
- analytics snapshots and presentation settings;
- backup and import state.

The project does not operate an account system, history server, advertising profile, or cloud synchronization service. Changing YouTube accounts does not change the local re:Watch profile.

## Network requests

The feed needs public information to discover uploads and identify channels.

- Public YouTube RSS feeds are requested for followed channels.
- A public channel page may be requested for handle resolution or metadata.
- These direct extension requests omit browser credentials.
- Thumbnails, avatars, and banners displayed in the interface may load from YouTube-owned image hosts.
- Local feed search does not send a remote search request.
- Saving a playlist reference does not fetch or import its member videos in the background.

re:Watch does not use OAuth in v5.2 and does not change subscriptions, playlists, history, or other data in the user's YouTube account.

## What re:Watch does not hide

The extension is not an anonymity tool. Google, YouTube, the browser, the network provider, and websites may still observe ordinary browsing through requests, cookies, IP addresses, browser identifiers, or other mechanisms. re:Watch only controls the separate data that it records for its own features.

## Retention and deletion

Records remain until they are removed in re:Watch, reset from Settings, or deleted with the browser profile/extension data.

AI-label cache entries expire automatically. They are rebuildable and are not
included in backups; **Reset all data** also clears them.

Removing a local subscription creates an ignored-channel tombstone. That record prevents a later import from silently restoring the channel. When tombstones exist, **Channels → Ignored** provides restore and forget actions.

**Reset all data** removes re:Watch-owned history, local playlists, playlist references, local subscriptions, ignored-channel tombstones, feed and scheduler state, deletion markers, analytics snapshots, and settings from the current browser profile.

## Backup and transfer

Export creates a local JSON file containing the supported profile data. Restore merges compatible records into the current browser profile. The file may reveal viewing habits, so store and share it as sensitive data.

There is no automatic synchronization between devices or browsers. Export and restore are the supported transfer method.

## Permissions

Browser permissions are used to store extension data, run the YouTube integration, open extension pages, and retrieve the public channel information required by the local feed. Chrome and Firefox packages use browser-specific manifests but follow the same privacy boundaries.

For implementation details, see the [technical reference](technical.md). For practical questions, see the [FAQ](faq.md).

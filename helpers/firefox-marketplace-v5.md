# YT re:Watch — Firefox Add-ons v5 copy

## Name

YT re:Watch — Local YouTube History

## Summary

Keep YouTube history and progress locally, follow channels, and browse a private feed independent from your YouTube account.

## Description

Keep your YouTube viewing progress in Firefox, independent from whichever Google account is active — or use it while logged out.

YT re:Watch records meaningful playback locally so you can find watched videos, see progress, and resume unfinished videos. Version 5 adds a complete local browsing companion built around channels you choose to follow in re:Watch.

### What you can do

- Keep an account-independent history of regular videos and Shorts.
- Resume videos from locally saved playback positions.
- See viewed indicators, progress, and available video durations.
- Follow channels locally without changing your YouTube subscriptions.
- Browse a locally arranged Home feed and chronological Subscriptions inventory.
- Search saved history and cached feed records without remote YouTube search.
- Review channels ignored by a subscription import and restore or forget them.
- Save YouTube playlists as references that open the original playlist.
- Explore local watch-time, completion, activity, and channel analytics.
- Export and restore supported profile data with JSON backups.
- Customize theme, overlay text, color, size, and retention.

### How the local feed works

re:Watch retrieves public upload feeds for channels you follow locally. **Home** arranges cached uploads using local viewing and feedback signals. **Subscriptions** shows the cached inventory chronologically. Both views use stable 50-video pages.

**Check** scans eligible channel feeds. **Reload** redraws the current local data without starting a scan. **Show** opens the full chronological subscription inventory.

### Privacy and account boundaries

History, progress, local subscriptions, feed state, analytics, settings, and playlist references are stored in the current Firefox profile. YT re:Watch does not operate an account system or cloud-sync service.

Direct public RSS and channel-metadata requests omit browser credentials. Displayed thumbnails and channel artwork may load from YouTube-owned image hosts. The extension does not use OAuth in version 5, perform remote search, or change subscriptions, playlists, or history in your YouTube account.

YT re:Watch is not an anonymity tool. YouTube, Firefox, and your network can still observe normal browsing activity.

### Playlist behavior in version 5

Saved YouTube playlists are outbound references. re:Watch does not fetch their member videos in the background and does not yet provide extension-managed local playlists.

### Data portability

Use Backup and Restore to move supported data manually between browser profiles or devices. There is no automatic cross-device synchronization. Backup files can reveal viewing habits and should be kept private.

Available in English, Bulgarian, German, Spanish, and French. Non-English translations are machine-generated and corrections are welcome.

## Version 5.0.0 release notes

Version 5 introduces:

- local channel subscriptions and public RSS-backed Home and Subscriptions views;
- stable 50-card pagination and explicit Check, Reload, and Show behavior;
- ignored-channel review for subscription imports;
- local search, improved History and Shorts, and playlist references;
- expanded local analytics and complete backup/reset handling;
- stronger SPA resume and Shorts identity tracking;
- stable History actions during metadata updates and available duration badges;
- deterministic Firefox and Chrome release coverage with isolated live canaries.

## Screenshot upload order and captions

1. `firefox_home.png` — A locally arranged Home feed built from channels followed in re:Watch.
2. `firefox_subscriptions.png` — A chronological subscription inventory with stable 50-video pagination.
3. `firefox_channels.png` — Manage local channel follows without changing the active YouTube account.
4. `firefox_history.png` — Local watch history with progress, duration, resume, and per-video controls.
5. `firefox_analytics.png` — Private local activity, watch-time, completion, and channel insights.

## AMO metadata and review notes

- License: **MIT**.
- Source repository: <https://github.com/EdinUser/YouTubeLocalHistory>
- Privacy policy: <https://rewatch.kirilov.dev/privacy/>
- Remote code: none.
- Authentication: no OAuth or re:Watch account in version 5.
- Account mutation: none; local follows do not change Firefox users' YouTube subscriptions.
- Host access: used for YouTube integration and public channel feed/metadata retrieval. Direct feed and metadata requests omit credentials.

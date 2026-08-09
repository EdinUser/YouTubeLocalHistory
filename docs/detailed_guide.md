# YT re:Watch detailed guide

YT re:Watch records YouTube history and progress in the current browser profile. It works while logged out and remains independent when you switch YouTube accounts.

## Install and begin

### Chrome

1. Open the [Chrome Web Store listing](https://chromewebstore.google.com/detail/local-youtube-video-histo/pebiokefjgdbfnkolmblaaladkmpilba).
2. Select **Add to Chrome**, then confirm.
3. Pin the re:Watch button if you want quick access.

### Firefox

1. Open the [Firefox Add-ons listing](https://addons.mozilla.org/firefox/addon/yt-rewatch/).
2. Select **Add to Firefox**, then confirm the requested permissions.
3. Pin the re:Watch button if desired.

Visit YouTube and play a video normally. re:Watch begins saving after meaningful playback, then updates the position as you continue. The record is separate from YouTube's account history.

## Interface overview

The toolbar popup is a compact resume surface. The full-page interface contains the complete v5 workflow.

| Tab | Purpose |
| --- | --- |
| Home | Locally arranged videos from followed channels |
| Subscriptions | Complete chronological cached subscription inventory |
| Shorts | Locally watched YouTube Shorts |
| Playlists | References that open the original YouTube playlist |
| History | Ordinary watched videos and progress |
| Channels | Local follows and, when present, ignored import records |
| Analytics | Locally calculated activity and channel insights |
| Settings | Feed, appearance, backup, import, and data controls |

### Popup { #popup }

<figure markdown="span">
  ![The re:Watch popup showing unfinished videos with progress bars and an Open Feed button.](assets/guide/popup-continue-watching.png){ width="600" height="480" }
  <figcaption>Resume unfinished videos or open the full re:Watch interface.</figcaption>
</figure>

The popup also reports subscription-import results. If an import skipped previously removed channels, its action opens **Channels → Ignored** so you can review them.

## Home and Subscriptions

### Home { #home }

<figure markdown="span">
  ![The re:Watch Home feed displaying locally personalized video cards.](assets/guide/feed-home.png){ width="1440" height="960" loading="lazy" }
  <figcaption>Home arranges cached uploads using local viewing and feedback signals.</figcaption>
</figure>

Home is not a copy of the YouTube recommendation service. It ranks locally cached uploads from channels followed in re:Watch. Opening Home regenerates that local view and does not start a Home-owned network request.

Home uses stable 50-card pages. Moving between pages does not duplicate cards or silently change the page boundary.

### Subscriptions { #subscriptions }

<figure markdown="span">
  ![The re:Watch Subscriptions tab showing recent cached uploads from locally followed channels.](assets/guide/feed-subscriptions.png){ width="1440" height="960" loading="lazy" }
  <figcaption>Subscriptions lists cached uploads in chronological order.</figcaption>
</figure>

Subscriptions is the complete chronological inventory of regular cached uploads. It also uses stable 50-card pages.

### Check, Reload, and Show

- **Check** scans eligible followed channels and updates cached feed records. The status beside it reports progress, scheduling, and outcomes.
- **Reload** renders current local storage again without starting a feed request.
- **Show** opens the chronological Subscriptions inventory after a scan or subscription-import handoff.

The interface renders cached data before initialization work completes, so an existing feed remains usable during a scan.

### Local search

Search matches locally saved history and cached feed records. It does not send the query to YouTube and cannot discover a video that the extension has never stored.

### Card actions

Video menus provide local actions such as more or less from a channel, hide, subscribe or unsubscribe, Watch Later, and playlist-reference actions where applicable. Following state is matched by canonical YouTube channel identity so the card does not offer **Subscribe** for a channel already followed locally.

## History and Shorts

### History { #history }

<figure markdown="span">
  ![The re:Watch History tab listing locally stored viewing activity and progress.](assets/guide/feed-history.png){ width="1440" height="960" loading="lazy" }
  <figcaption>History keeps ordinary viewing activity and resume progress local.</figcaption>
</figure>

History cards show the available channel, progress, and video duration. When metadata or progress changes, re:Watch updates the video-specific portion of the card while preserving its **Remove** control and three-dot menu.

Removing a history record also creates a temporary deletion marker so an older archive or import cannot immediately recreate it.

### Shorts { #shorts }

<figure markdown="span">
  ![The re:Watch Shorts tab showing watched short-form videos.](assets/guide/feed-shorts.png){ width="1440" height="960" loading="lazy" }
  <figcaption>Shorts separates locally watched short-form videos from ordinary history.</figcaption>
</figure>

re:Watch follows Shorts navigation inside YouTube's single-page interface and records the active Short's video and channel identity. The Shorts tab updates from local history without requiring a feed reload.

## Playlist references { #playlists }

<figure markdown="span">
  ![The re:Watch Playlists tab showing saved references that open their playlists on YouTube.](assets/guide/feed-playlists.png){ width="1440" height="960" loading="lazy" }
  <figcaption>A saved reference opens its original playlist on YouTube.</figcaption>
</figure>

v5 stores YouTube playlists as references with available title, artwork, and source link. It does not fetch the playlist's member videos in the background.

The per-playlist **Ignore videos** toggle prevents history saves while viewing that playlist. The global **Pause history in playlists** setting applies the same behavior to every playlist.

Creating and managing extension-owned local playlists is planned separately and is not part of stable v5.

## Channels { #channels }

<figure markdown="span">
  ![The re:Watch Channels tab showing channels followed locally by the extension.](assets/guide/feed-channels.png){ width="1440" height="960" loading="lazy" }
  <figcaption>Channels manages follows owned by re:Watch, not by the YouTube account.</figcaption>
</figure>

Follow a channel from a supported YouTube channel/watch surface, a re:Watch video menu, or the Channels controls. You can also import subscriptions in Settings. re:Watch canonicalizes channel IDs and avoids duplicate follows.

### Ignored channels

Unfollowing an imported/local channel can create a tombstone. Future imports skip that channel instead of silently restoring it. When one or more tombstones exist, an **Ignored** internal tab appears under Channels.

For each ignored channel you can:

- **Restore** it to the local subscription list; or
- **Forget** the tombstone so a later import may add it again.

When no tombstones exist, the Ignored tab is hidden instead of showing an empty state.

## Analytics { #analytics }

<figure markdown="span">
  ![The re:Watch Analytics tab summarizing locally calculated viewing activity.](assets/guide/feed-analytics.png){ width="1440" height="960" loading="lazy" }
  <figcaption>Analytics derives viewing patterns from local extension data.</figcaption>
</figure>

Analytics includes total watch time, videos and Shorts watched, average duration, completion rate, saved playlist references, weekly activity, and watch time by hour. Hourly bars share a consistent baseline so selected or low-activity hours remain visually comparable.

Additional insights include unfinished videos and skipped, watched, and completion groupings. Channel metrics can be switched and sorted without sending history to a server. A compact local statistics snapshot improves startup speed and can be rebuilt from the full local history.

## Settings { #settings }

<figure markdown="span">
  ![The re:Watch Settings tab showing appearance, feed, import, backup, and data controls.](assets/guide/feed-settings.png){ width="1440" height="960" loading="lazy" }
  <figcaption>Settings contains appearance, import, backup, and data-management controls.</figcaption>
</figure>

### Appearance and overlays

- Choose System, Light, or Dark theme.
- Change the viewed-overlay text, color, and size.
- YouTube thumbnail overlays are best effort because YouTube can change its page structure.

### Retention

Choose an automatic cleanup period from 1–180 days, or **Forever**. Popup/history pagination preferences affect their respective lists; Home and Subscriptions always use stable 50-card pages.

### Subscription import

Import accepts supported subscription files and reports added, existing, invalid, and ignored outcomes. The import result remains visible in Settings and can hand off to the chronological inventory or ignored-channel review.

### Backup and restore

**Backup** downloads a JSON file containing supported history, playlist references, Watch Later records, legacy and canonical subscriptions, ignored-channel tombstones, settings, preferences, and analytics data. Rebuildable feed inventory and transient scheduler state need not be preserved.

**Restore** merges compatible data into the current profile. Canonical subscriptions are matched by YouTube channel ID; restoring the same backup repeatedly does not create duplicates. Keep backup files private because they can reveal viewing habits.

### Reset all data

Reset removes all re:Watch-owned data in the current browser profile: history, playlist references, Watch Later, canonical subscriptions, tombstones, feed and scheduler state, deletion markers, analytics, settings, and legacy compatibility records. Export first if you may need the data again.

## Account and privacy behavior

- re:Watch storage belongs to the browser profile, not the active YouTube account.
- Switching Google accounts does not create a separate re:Watch history.
- There is no re:Watch login, OAuth connection, cloud synchronization, or remote search in v5.
- Public RSS/channel metadata requests omit browser credentials.
- YouTube and other parties can still observe normal browsing and network activity.

See [Privacy and data](privacy.md) for the complete boundary.

## Moving data between browsers or devices

1. Open Settings in the source browser and select **Backup**.
2. Transfer the JSON file securely.
3. Open Settings in the destination browser and select **Restore**.
4. Select the backup and allow the merge to complete.

There is no automatic cross-device sync.

## Help

If a feature is not behaving as described, use the [Troubleshooting guide](troubleshooting.md). For short answers, see the [FAQ](faq.md). Include the browser/version, operating system, reproduction steps, and visible status or error text when reporting a [GitHub issue](https://github.com/EdinUser/YouTubeLocalHistory/issues).

# YT re:Watch

YT re:Watch keeps a private, account-independent YouTube history in your browser. It records watch progress locally, lets you follow channels without changing your YouTube account, and builds a local feed from public channel feeds.

[Install for Chrome](https://chromewebstore.google.com/detail/local-youtube-video-histo/pebiokefjgdbfnkolmblaaladkmpilba){ .md-button .md-button--primary }
[Install for Firefox](https://addons.mozilla.org/firefox/addon/yt-rewatch/){ .md-button }

## What v5.2 includes

| Area | What it does |
| --- | --- |
| History | Keeps watched videos, progress, duration, and resume points locally |
| Home | Builds a mixed local feed from followed channels |
| Subscriptions | Shows cached subscription videos ordered by upload or detection time |
| Shorts | Separates watched Shorts from ordinary history |
| Watch Later | Keeps videos explicitly saved for later, independently of a YouTube account |
| Channels | Manages local follows and reviewable ignored-channel records |
| Analytics | Summarizes local activity, watch time, completion, and channel patterns |
| Playlist references | Saves links to YouTube playlists without importing their members |
| Local playlists | Creates and manages extension-owned playlists without changing YouTube account playlists |
| Backup | Exports and restores the documented local profile data |
| Experimental AI labels | Optionally badges, dims, or hides YouTube-disclosed AI videos |

The feed's Home and Subscriptions views use stable 50-card pages. Search is local: it searches records already saved by re:Watch and does not send a remote YouTube search request.

## AI-labeled videos

The experimental **AI-labeled video handling** setting is off by default. When
enabled, it can badge, dim, or hide cards that YouTube itself discloses as made
with AI. It is not a general AI detector, and an unmarked video is not confirmed
non-AI. [Learn how it works and what it sends to YouTube](ai-labeled-videos.md).

## Start in three steps

1. Install the extension and open YouTube.
2. Watch a video. re:Watch records meaningful playback and updates the local resume point.
3. Follow channels from supported YouTube surfaces, add them in **Channels**, or import a subscriptions file in **Settings**.

Click the extension button for quick actions. On first use, the welcome notice
can open that same browser popup for you. Open the full re:Watch page for Home,
Subscriptions, Shorts, Watch Later, playlists, History, Channels, Analytics,
and Settings.

## Feed refresh controls

The feed renders cached local records first.

- **Reload videos** scans eligible followed channels and updates cached feed records.
- **Refresh** rebuilds the visible view from local storage without starting a network scan.
- **Show** reloads the complete subscription inventory after a scan or import handoff while preserving the selected upload-date or detection-date order.

Public YouTube RSS feeds provide new uploads. re:Watch does not use OAuth, mutate the user's YouTube subscriptions, or perform remote search.

## Local subscriptions and ignored channels

A re:Watch subscription belongs only to the current browser profile. Following or unfollowing a channel does not change the signed-in YouTube account.

When an imported channel was previously removed, re:Watch keeps a tombstone so later imports do not silently add it again. If such records exist, **Channels → Ignored** appears and lets you restore or permanently forget them. The tab stays hidden when there is nothing to review.

## Playlist behavior

re:Watch saves YouTube playlists as outbound references: title, available metadata, and the original YouTube link. It does not hydrate their members in the background. Separately, **Playlists** lets you create and manage extension-owned local playlists without changing a YouTube account playlist.

## Watch Later

Right-click a recognized YouTube video or Short and choose **Save to Watch Later (local)**, or use **Save to Watch Later** from a re:Watch video menu. The **Watch Later** sidebar view lists these local saves newest first and provides Open and Remove actions. This list is independent of YouTube's account-based Watch Later playlist.

## Privacy boundaries

History, progress, settings, local subscriptions, feed state, and analytics remain in extension storage in the current browser profile. re:Watch has no account system or cloud-sync service.

To build the feed, the extension requests public YouTube RSS feeds and may request a public channel page for handle resolution or metadata. Direct requests omit browser credentials. Thumbnails and channel artwork may load from YouTube-owned image hosts. YouTube and the browser can still observe ordinary browsing and network requests; re:Watch is not an anonymity tool.

Read the full [Privacy and data guide](privacy.md).

## Backups and reset

Use **Settings → Export** to make a JSON backup before clearing browser data or reinstalling. Restore merges supported records into the current profile. **Reset all data** removes history, playlist references, feed state, canonical subscriptions, ignored-channel tombstones, deletion markers, analytics snapshots, and settings owned by re:Watch.

There is no automatic cross-device synchronization. Use export and restore to move data manually.

## Learn more

- [Detailed guide](detailed_guide.md)
- [AI-labeled video handling](ai-labeled-videos.md)
- [Frequently asked questions](faq.md)
- [Troubleshooting](troubleshooting.md)
- [v5.2 release notes](changelog.md)
- [Roadmap](roadmap.md)

For support, use the [community forum](https://community.kirilov.dev/t/re-watch), [Telegram community](https://t.me/+eFftKWGVvSpiZjZk), [Discord community](https://discord.gg/9fuvSzP7Qr), or [GitHub issues](https://github.com/EdinUser/YouTubeLocalHistory/issues).

YT re:Watch is available in English, Bulgarian, German, Spanish, and French. Non-English translations are machine-generated and community improvements are welcome.

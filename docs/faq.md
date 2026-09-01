# Frequently asked questions

## Accounts and privacy

### Does re:Watch require a YouTube account?

No. Tracking, local subscriptions, the feed, and analytics work while logged out.

### What happens when I switch YouTube accounts?

Nothing happens to the re:Watch profile. Its data belongs to the current browser profile, so the same local history remains available across account changes.

### Does following a channel change my YouTube subscriptions?

No. re:Watch subscriptions are local and do not mutate the signed-in YouTube account.

### Is all extension data local?

The feature data is stored locally. To build the feed, re:Watch requests public YouTube RSS feeds and may request public channel pages for resolution or metadata; those direct requests omit browser credentials. Displayed images may load from YouTube-owned hosts. See [Privacy and data](privacy.md).

### Does re:Watch stop YouTube from tracking me?

No. It keeps a separate local history but is not an anonymity or tracker-blocking tool. Normal YouTube browsing remains visible to YouTube, the browser, and the network.

### Is there cloud sync?

No. Use Backup and Restore for manual transfer between browser profiles or devices.

## History and progress

### When is a video saved?

After meaningful playback begins. re:Watch then updates progress and the resume point while you watch.

### Are Shorts stored separately?

They use the same local history system but appear in the dedicated Shorts tab rather than ordinary History.

### Why does a card show no duration?

Duration is shown when the extension has observed or received it. Existing records may lack duration until that video is played or its metadata is updated.

### What happens when I remove a history video?

The record is removed and a temporary deletion marker prevents stale archives or imports from immediately restoring it.

### Can I pause tracking in playlists?

Yes. Use the global playlist pause setting or the ignore toggle on a saved playlist reference.

## Feed and subscriptions

### Where do Home and Subscriptions videos come from?

From public RSS uploads cached for channels followed in re:Watch. Home arranges
that local inventory; Subscriptions can order it by upload date or by when
re:Watch detected it.

### What is the difference between Check, Reload, and Show?

- **Check** scans eligible channel feeds and updates local records.
- **Reload** redraws from local storage without starting a scan.
- **Show** reloads the full Subscriptions inventory while retaining its selected upload-date or detection-date order.

### Does feed search query YouTube?

No. It searches only local history and cached feed records.

### How many videos are on a page?

Home and Subscriptions use stable 50-card pages. Their page size is not controlled by the popup/history items-per-page setting.

### Why was a subscription import channel ignored?

The channel was previously removed and has an ignored-channel tombstone. Open **Channels → Ignored** to restore the follow or forget the tombstone. The tab appears only while ignored records exist.

### Why is an imported channel already listed?

Subscriptions are matched by canonical YouTube channel ID. Reimporting the same channel updates missing information without creating a duplicate.

## Playlists

### Does re:Watch import every video in a YouTube playlist?

No. re:Watch saves an outbound playlist reference and available metadata, then opens the original playlist on YouTube. It does not hydrate members in the background.

### Can I create extension-managed playlists?

Yes. Use **Playlists** to create and manage a local playlist. It remains separate from YouTube account playlists.

## Analytics

### Where are analytics calculated?

In the extension from local history. A compact local snapshot improves performance and can be rebuilt from the complete history.

### What do skipped and unfinished mean?

They are local classifications based on duration and recorded progress. They are viewing aids, not YouTube account metrics.

## Backup, restore, and reset

### What does Backup contain?

Supported history, progress, playlist references, Watch Later, subscriptions, ignored-channel tombstones, preferences, and analytics data. Transient scheduler state and rebuildable feed inventory may be omitted.

### Does Restore replace my current data?

No. Restore merges compatible records into the current profile and deduplicates canonical subscriptions by channel ID.

### What does Reset all data remove?

All re:Watch-owned history, playlist references, Watch Later, subscriptions, tombstones, feed/scheduler state, deletion markers, analytics, settings, and compatibility records in the current browser profile. Back up first if you may need them.

### How much history can I keep?

The IndexedDB-backed store is designed for large histories, but capacity is controlled by the browser and available disk space. No fixed unlimited-storage guarantee is made.

## Browsers and support

### Are Chrome and Firefox both supported?

Yes. The project ships browser-specific packages and runs deterministic coverage in both engines. Live YouTube canaries are isolated because YouTube markup, consent, experiments, and network state are external and can change independently.

### Does private/incognito mode work?

Only if the browser is configured to allow the extension there. Private-window storage behavior can differ and may be cleared when the session closes.

### Where can I get help?

Use the [Troubleshooting guide](troubleshooting.md), [community forum](https://community.kirilov.dev/t/re-watch), [Telegram community](https://t.me/+eFftKWGVvSpiZjZk), [Discord community](https://discord.gg/9fuvSzP7Qr), or [GitHub issues](https://github.com/EdinUser/YouTubeLocalHistory/issues).

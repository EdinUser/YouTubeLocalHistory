# Troubleshooting

Start with the smallest relevant check. Export a backup before clearing extension data, reinstalling, or resetting.

## Videos are not being recorded

1. Confirm the page is a normal `youtube.com/watch` or Shorts page.
2. Start playback and leave it running long enough for meaningful progress to be recorded.
3. Check whether global playlist pause or the current playlist's ignore toggle is enabled.
4. Reload the YouTube tab after installing or updating the extension.
5. Temporarily disable other YouTube-modifying extensions and retry.
6. Confirm the extension is allowed in the current private/incognito window if applicable.

If only one YouTube layout fails, include the page type and a screenshot in the bug report. YouTube rolls out different markup to different users.

## Resume or metadata looks stale

Close and reopen the popup, reopen the affected view, or select **Refresh** in the feed to render current local records. Duration appears only when it is available; playing an older saved video can fill it later.

If a History card refreshes, its **Remove** control and three-dot menu should remain present. Report a reproducible disappearance as a UI bug.

## The feed is empty

1. Open **Channels** and confirm at least one local follow exists.
2. Open **Subscriptions**, select **Reload videos**, and watch the status beside it. For one channel, use **Channels → Check for new videos** on its card.
3. Allow the check to finish and review its checked, failed, and deferred counts. Existing cached cards should render before initialization completes.
4. Inspect the Subscriptions inventory. After background or per-channel discoveries, select **Show** to include them in the selected ordering.

Public feeds can be missing, delayed, rate-limited, or temporarily unavailable. A failed channel does not mean your local history was lost.

## Reload videos, Refresh, or Show did something unexpected

- **Reload videos** checks followed channels and updates the list, including channels whose normal successful-check interval has not elapsed.
- **Refresh** only rebuilds the visible interface from local storage.
- **Show** opens the complete Subscriptions inventory in its selected upload-date or detection-date order.

A deferred check means a channel is in failure backoff or already has a scan in progress. Repeated clicks do not bypass those limits. Open **Channels → Log** for that channel's recorded RSS attempts and failure details.

Opening Home also regenerates its local ordering; it should not initiate a separate Home-owned request.

## A frequently uploading channel has a stale activity level or distant next check

1. Confirm the installed version is 5.2.1 or later, then reopen the feed after updating. The scheduler repairs obsolete 30-day delays left by older RSS 404 handling.
2. Open **Channels** and find the channel by **Name**, or sort **Last checked** with oldest first to locate stale or never-checked channels.
3. Select **Check for new videos** on its card. A successful result refreshes the latest upload, activity, and next-check time.
4. Open **Log** to see the latest recorded attempts. Failed checks can leave the upload evidence stale; a deferred check has not made a new RSS attempt.

An empty log means there are no recorded RSS reads yet. Repairing an old schedule does not create a synthetic log entry. If the problem persists after a successful check, report the channel URL, installed version, displayed activity and next-check time, and relevant log details.

## Search cannot find a YouTube video

Feed search is intentionally local. It can find only saved history and cached feed records. Use YouTube itself for remote discovery.

Search waits for a 300 ms pause in typing. Press Enter for an immediate search; clearing the field cancels pending work immediately.

## A subscription import skipped channels

Review the result in Settings. Previously removed channels are counted as ignored. Select the result action or open **Channels → Ignored**, then choose **Restore** or **Forget** for each record.

The Ignored tab is hidden when no tombstones exist.

## A followed channel still shows Subscribe

Reload the local interface. re:Watch compares canonical channel identity, including known handle/channel-ID aliases. If the action remains wrong, report the video URL, channel URL, and whether the follow was added manually or imported.

## Playlist videos are missing from re:Watch

This is expected for a saved playlist reference. v5 stores the link and available metadata but does not import playlist members. Open the reference to view the original playlist on YouTube.

## Analytics are blank or delayed

Analytics are derived from meaningful local history. A new profile may not have enough data for every card. Reload the interface to rebuild the presentation from the local statistics snapshot and history.

Hourly and activity bars should share a consistent baseline. Include a screenshot if a selected hour appears offset or extends below the chart.

## Backup will not restore

1. Confirm the file is an unmodified JSON backup created by re:Watch.
2. Check that sufficient browser storage and disk space are available.
3. Retry in a normal browser window.
4. Preserve the failed file and visible error message for a bug report.

Restore merges; it does not offer a destructive replace mode. Older supported backup fields are migrated when possible.

## Reset did not produce an empty profile

After **Reset all data**, close and reopen extension pages. History, playlist references, Watch Later, subscriptions, tombstones, feed/scheduler state, deletion markers, analytics, and settings should be cleared.

Do not use the browser's developer tools to delete individual IndexedDB stores unless you are diagnosing with a developer; partial deletion can leave inconsistent state.

## Firefox-specific checks

- Confirm re:Watch is enabled in `about:addons`.
- Confirm it has permission to access YouTube.
- Reload existing YouTube tabs after an extension update.
- If testing a temporary development build, remember that it disappears when that Firefox session ends.

Firefox and Chrome can receive different YouTube layouts. A problem in one browser still needs its browser/version recorded even when the other works.

## Collect useful diagnostics

Enable debug logging only while reproducing the problem, then include:

- re:Watch version;
- browser and browser version;
- operating system;
- exact steps and affected URL type;
- visible status/error text;
- whether the problem reproduces in a clean browser profile;
- a screenshot with personal information removed.

Do not publish backup files or logs containing sensitive viewing data.

## Get help

- [GitHub issues](https://github.com/EdinUser/YouTubeLocalHistory/issues)
- [Community forum](https://community.kirilov.dev/t/re-watch)
- [Telegram community](https://t.me/+eFftKWGVvSpiZjZk)
- [Discord community](https://discord.gg/9fuvSzP7Qr)
- [FAQ](faq.md)

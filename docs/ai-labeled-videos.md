# AI-labeled video handling

**AI-labeled video handling** is an experimental, opt-in YouTube-page feature.
It can mark, dim, or hide videos only when YouTube itself shows a **Made with
AI** disclosure. It is not an AI detector: a video without a re:Watch marker
is not confirmed to be free of AI-made content.

## Turn it on

1. Open the re:Watch page from the extension popup.
2. Select **Settings**.
3. Under **History & feed**, choose an **AI-labeled video handling** mode.

| Mode | What happens |
| --- | --- |
| **Off** | Does not check cards or change their appearance. This is the default. |
| **Badge** | Adds a purple **AI** badge to videos YouTube disclosed as made with AI. |
| **Dim** | Adds the AI badge and visually de-emphasizes the card. Hovering or focusing a dimmed card makes it easier to inspect. |
| **Hide** | Removes disclosed cards from supported YouTube card lists; dims them in re:Watch’s own views. |

The setting is saved in the current browser profile and takes effect on open
YouTube pages. Choose **Off** at any time to stop further checks and remove the
feature’s presentation from cards.

## In re:Watch views

re:Watch’s own Home, Subscriptions, History, Shorts, Watch Later, channel, and
playlist views never start AI checks. They only show a badge when a fresh
result was already cached while you were browsing an open YouTube page.

This boundary is intentional: scanning a card from a local re:Watch view would
send its video ID to YouTube and could reveal that the video exists in your
local history, subscriptions, or saved list. Opening, paging through, or
scrolling a re:Watch view therefore never creates an AI lookup.

In these local views, **Hide** behaves like **Dim**: the card remains visible,
is dimmed, and retains its AI badge. Local history and saved videos are never
removed by this setting.

## What it checks

Only on supported, open YouTube pages, re:Watch checks cards as they approach
the visible part of the page. It supports regular videos and Shorts on Home,
search, channel, playlist, and watch-page recommendation surfaces. If the same
video appears more than once, one result is shared by its cards.

Results are cached locally, so a recently checked video is not normally looked
up again. A temporary YouTube error or an unexpected response leaves the card
unchanged; re:Watch does not treat a failed check as evidence that a video is
unlabeled.

The cache is stored only in the extension’s private IndexedDB database. Each
entry contains the video ID, observed state (`ai`, `unlabeled`, or `unknown`),
when it was checked, and its expiry/retry information. It is not stored in
YouTube’s website storage, exported in a re:Watch backup, or sent to another
service.

## Limits to keep in mind

- The feature uses YouTube’s own disclosure only. It does not inspect titles,
  thumbnails, channels, audio, or video content.
- YouTube’s disclosure and its underlying page response can change or be
  unavailable, so the feature can miss videos that use AI.
- **Hide** hides only cards for which YouTube’s disclosure was observed. It
  does not block a video URL, channel, search result, or YouTube account
  content outside supported card surfaces.
- This is experimental in both Chrome and Firefox. If it stops marking cards,
  leave the setting off and report the affected page and browser version.

## Privacy

When enabled, re:Watch makes a direct YouTube request for each previously
unchecked card near the viewport on an open YouTube page. That request can use
the ordinary YouTube page context and credentials. re:Watch views do not send
their local video IDs to YouTube: they use cached results only. The video ID,
observed disclosure state, and cache expiry remain in the extension’s private
IndexedDB storage; re:Watch sends no result or telemetry to another service.

For the full data and network boundary, see [Privacy and data](privacy.md).

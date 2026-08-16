# AI-labeled video handling

## Status

Proposed experimental feature. It is not part of the stable v5 promise until
the implementation, browser coverage, and live YouTube canary are in place.

The investigation and DevTools proof of concept are in
[`../ai_detect`](../ai_detect). That note is the source of the
observed YouTube response details; this document is the implementation
contract.

## User-facing promise

The setting is **AI-labeled video handling**, with these choices:

- **Off** — do not request or change cards for this feature.
- **Badge** — show an extension badge on videos YouTube marks as AI-made.
- **Dim** — visually de-emphasize those videos.
- **Hide** — hide those videos from supported YouTube card surfaces.

The setting must describe the signal accurately. Preferred supporting text:

> Applies only to videos that YouTube marks as “Made with AI.” It does not
> identify every video that uses AI.

Do not label an unmarked video as non-AI. The extension can only report that
no YouTube disclosure was observed at the time it checked.

## Scope and non-goals

Supported surfaces should include Home, search, channel pages, playlists, and
watch-page recommendations. Regular videos, Shorts, and duplicate cards for
the same video ID should share one result.

This feature does not use title, thumbnail, channel, visual, or audio
heuristics. It does not make a judgement about content quality or whether a
video is fully AI-generated. It does not alter a YouTube account.

## Technical design

1. Extract a canonical video ID from a supported card.
2. Read a persistent per-video result first from extension-origin storage.
3. For an unexpired cached result, apply its presentation to every matching
   card.
4. For an uncached or expired result close to the viewport, queue one lookup.
5. Make a same-origin YouTube watch-next request and parse only the centralized
   AI-disclosure parser.
6. Store and apply the result, unless the page navigation or setting changed.

The observed source is YouTube's internal `/youtubei/v1/next` response, where
the current proof of concept finds the disclosure in a
`videoPrimaryInfoRenderer` metadata badge. This is undocumented and can change.
The implementation must obtain current YouTube client context at runtime rather
than permanently hard-code a `clientVersion` from the investigation.

### Result model and cache policy

Use explicit results:

| Result | Meaning | Initial cache policy |
| --- | --- | --- |
| `ai` | A YouTube AI disclosure was observed. | Long TTL, e.g. 90 days |
| `unlabeled` | A valid response was parsed but had no disclosure. | Shorter TTL, e.g. 30 days |
| `unknown` | Lookup, response validation, or parsing failed. | Retry after a short TTL, e.g. 6 hours |

Never convert an HTTP error, timeout, malformed response, unavailable video, or
schema mismatch into `unlabeled`. `unknown` cards remain unchanged.

### Scheduling and lifecycle

- Use `IntersectionObserver`; do not poll all cards indefinitely.
- Deduplicate by video ID across all cards and navigation updates.
- Start with at most 2–3 concurrent requests, including a bounded queue.
- Apply a timeout with `AbortController`.
- Cancel queued and in-flight work on SPA navigation, teardown, or changing the
  setting to Off.
- Keep request, parsing, cache, and card-presentation code separate.

The request must be tested from the packaged extension in both Chrome and
Firefox. A request that works from the DevTools page world is evidence, but not
a cross-browser extension contract.

### Storage isolation

AI-label cache records (video ID, status, expiry, and retry metadata) belong
only in the extension-origin IndexedDB database. A YouTube content script must
use the extension background's shared storage RPC; it must not read or write
this cache through an IndexedDB database scoped to `youtube.com`. This keeps
the derived local cache isolated from YouTube page scripts and makes the same
result available to extension-owned views.

## Privacy and product boundaries

When enabled, this feature sends a YouTube request for each previously unknown
video that approaches the viewport, subject to caching. It may include the
user's ordinary YouTube page context and credentials. Before release, update
the privacy documentation and user-facing settings copy to state this clearly.

The setting defaults to Off. No result or telemetry leaves the browser except
the direct YouTube lookup needed to provide the enabled feature. Extension-owned
views must use cached results only: initiating a lookup from local history,
subscriptions, or saved lists would disclose those local video IDs to YouTube.

## Tests and release gates

### Deterministic tests

- Unit-test the response parser with AI, unlabeled, malformed, and alternate
  renderer-order fixtures.
- Unit-test cache expiry, `unknown` retries, deduplication, queue bounds,
  cancellation, and Off behavior.
- Add static HTML fixtures for each supported card surface and representative
  regular-video/Short URLs.
- Add packaged Chromium and Firefox tests that verify Badge, Dim, Hide, duplicate
  cards, SPA navigation, and that unknown cards are not hidden.

Fixtures must contain captured/minimized response payloads as well as page HTML;
they must never make live YouTube requests.

### Live YouTube canary

Add an opt-in live canary to the existing `test:canary` groups for both Chrome
and Firefox. It should:

1. Open a supported YouTube page in the packaged extension.
2. Exercise one known AI-labeled video ID through the actual extension
   request path.
3. Assert that the request produces the expected extension result and card
   treatment.
4. Report a clear external-contract failure when YouTube changes the endpoint,
   response shape, consent flow, or availability.

The canary is an alert, not a deterministic release test: YouTube experiments,
rate limits, consent, regional access, and anti-bot behavior can cause it to
fail. When it does, capture the changed contract and reproduce it in a static
fixture before changing production code.

## Estimated change size and blast radius

This is a medium-sized, contained feature: roughly a new content-side runtime
module, storage/cache support, settings/localization/UI wiring, CSS/card
presentation, documentation, fixtures, and browser canaries. It should not
touch history, playback-resume, subscriptions, or the local-feed data model.

The main risk surface is YouTube-page runtime behavior: SPA lifecycle cleanup,
card selectors, request volume, and undocumented YouTube response changes.
Keep it behind the setting and isolated from existing thumbnail/progress overlay
logic so a failure degrades to unchanged cards.

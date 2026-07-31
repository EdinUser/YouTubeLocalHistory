# Test Coverage Audit

Branch audited: `feat/tests`

Related PR branch inspected: `local-feed`

## Purpose

This document lists the current extension functionality and the test coverage needed before relying on the Playwright suite to validate large changes such as `local-feed`.

The goal is not to test YouTube exhaustively. The goal is to lock the extension behavior that depends on YouTube while using live YouTube only where it gives useful signal.

## Core Product Contract

The extension has many valuable features: popup history, overlays, playlists, settings, stats, import/export, analytics, and local-feed style workflows. These should be protected by tests too.

However, those features depend on one foundation: saved video progress must be trustworthy.

The core contract is:

1. While a user watches a YouTube video, the extension saves the current timestamp.
2. When the same video is loaded again, the player resumes from the timestamp saved by the extension.

If this contract breaks, the dependent features lose most of their value even if their own UI still works.

The highest-priority tests must therefore prove this behavior against real YouTube, because the main risk is YouTube changing its runtime behavior or DOM in a way that breaks save/restore. Fixture tests are still useful for deterministic regression coverage, but they cannot replace the live contract test that answers: "Does save and resume still work on YouTube today?"

## Core Test Strategy

The core contract should be protected by three layers.

Unit and integration tests prove the internal logic:

- video ID extraction from watch, Shorts, and playlist URLs.
- save rules for valid time/duration.
- near-end timestamp clamping.
- playlist ignore and pause rules.
- extension storage reads/writes.
- timestamp restore decisions and tolerance.
- clean URL and timestamp helper behavior.
- SPA navigation resets and tracking reinitialization.

Playwright tests prove the real browser contract:

- the unpacked extension installs and loads.
- the content script runs on real YouTube.
- watching a video saves `video_<id>` into extension storage.
- a clean reload restores `video.currentTime`.
- clean navigation away and back restores `video.currentTime`.
- opening a saved video from popup/list resumes correctly.
- the test result is not explained by YouTube native history, Google account state, or a stale `t=` URL parameter.

The Playwright core resume suite should be the highest-priority E2E suite in the repo. It should be small, strict, and diagnostic. Failures should identify the broken step clearly: extension load, content script injection, YouTube consent, video element detection, timestamp save, stored timestamp shape, clean URL restore, reload restore, or popup/list open behavior.

Static YouTube fixture tests prove deterministic DOM behavior:

- captured YouTube markup is loaded under a `https://www.youtube.com/...` route so the extension content script still runs.
- extension storage can be seeded before the fixture page loads.
- overlay insertion, duplicate prevention, remove buttons, and reprocessing can be tested without live consent, ads, network latency, or YouTube throttling.
- SPA-style DOM replacement and URL-change handling can be simulated repeatably.

Static fixtures do not replace the live core resume tests. They cannot prove real playback, ad/player reset behavior, browser media behavior, or whether YouTube's current runtime still allows the extension to save and restore timestamps.

Current fixture download foundation:

- Runner: `scripts/download-youtube-fixtures.js`.
- Command: `npm run fixtures:youtube:download`.
- Manifest: `tests/fixtures/youtube-pages/pages.json`.
- Generated output: `tests/fixtures/youtube-pages/captures/`.
- README: `tests/fixtures/youtube-pages/README.md`.
- The generated capture directory is gitignored because captured YouTube HTML may contain volatile markup, generated identifiers, consent state, or accidental local signals.
- The runner strips scripts, iframes, `noscript`, and preload hints from `page.html` by default after the rendered DOM and screenshot have been captured.
- Use `--preserve-scripts` only while debugging the capture runner itself.

Current manifest targets:

- `rick-watch`: `https://www.youtube.com/watch?v=dQw4w9WgXcQ`.
  - Use for watch-page DOM, watch-page video ID extraction, recommendations/sidebar DOM, and SPA watch-route fixture work.
  - Do not use as proof that real playback resumes.
- `controlled-playlist`: `https://www.youtube.com/playlist?list=PLQga0f7orXVB8fZObVcpXuX-2swTybQqR`.
  - Use for playlist item overlay, progress, remove button, duplicate overlay, and playlist DOM regression tests.
- `controlled-channel-videos`: `https://www.youtube.com/@TodorKirilov/videos`.
  - Use for channel/user video grid overlay and dynamic list reprocessing tests.

Regeneration commands:

```bash
npm run fixtures:youtube:download
npm run fixtures:youtube:download -- --only controlled-playlist
npm run fixtures:youtube:download -- --only controlled-playlist,controlled-channel-videos --headless
npm run fixtures:youtube:download -- --out /tmp/ytlh-youtube-captures
```

Normal tests must not regenerate these pages automatically. Regeneration is a manual maintenance action or a dedicated download workflow. After regeneration, inspect `metadata.json`, `screenshot.png`, and `page.html` before using a capture as a regression fixture.

Test split for static pages:

- Use static pages for deterministic DOM regression tests:
  - overlay insertion on playlist/channel/search/home/recommendation list items.
  - overlay progress width/label rendering from seeded storage.
  - overlay `X` removal behavior and storage deletion.
  - duplicate overlay prevention when the same DOM is processed more than once.
  - reprocessing when new YouTube nodes are appended after initial load.
  - SPA-style DOM replacement and URL-change handling when real media playback is not the assertion.
  - video ID extraction from captured YouTube anchors/renderers.
- Keep live E2E tests for current YouTube runtime contracts:
  - timestamp save while watching a real video.
  - clean URL resume from extension storage.
  - reload resume from extension storage.
  - ad/player-reset behavior.
  - consent handling and anonymous YouTube state isolation.
  - small selector-contract canaries on controlled playlist/channel/watch surfaces.
- Keep Jest unit/integration tests for pure logic:
  - storage merge/remove/tombstone behavior.
  - timestamp validation/clamping.
  - helper parsing and formatting.
  - popup state rendering that does not require a real browser extension install.

## Build Output Ownership

Store/release build output is owned by the root build script:

- `./build.sh`
- `build/chrome`
- `build/firefox`
- `dist/`

E2E build output is owned by the test build scripts:

- `scripts/build-chrome-unpacked.sh`
- `scripts/build-firefox-unpacked.sh`
- `build/e2e/chrome`
- `build/e2e/firefox`
- `build/e2e/firefox-e2e.xpi`

Do not point E2E tests at `build/chrome` or `build/firefox`. Those folders are packaging inputs for Chrome/Firefox store builds.

Do not add E2E-only host permissions, test manifests, local replay permissions, or temporary files to `build/chrome` or `build/firefox`.

`merge_locales.js` defaults to store build output when called without arguments. E2E build scripts must pass their own locale output path explicitly.

## YouTube Native History Isolation

Core resume tests must avoid accidentally passing because of YouTube's own watch history or URL timestamp behavior.

Playwright helps because the extension fixture launches Chromium with a temporary isolated browser profile. That profile does not share the user's normal Chrome cookies, Google login, YouTube watch history, or local storage. The temp profile is removed after the test.

The same isolation rule applies to Firefox E2E. Firefox tests launch real Firefox with a temporary profile and install only this extension. This is slower than reusing one browser, but extension storage and YouTube anonymous state are exactly the state under test, so the clean-profile cost is intentional.

Still, anonymous YouTube can keep local/session state inside that temporary profile. Tests should therefore minimize false positives:

- Start from a fresh Playwright profile.
- Do not sign in to YouTube.
- First open the video with a clean URL that has no `t=` parameter.
- Assert the initial `video.currentTime` is near zero before saving.
- Save progress through the extension while watching.
- Verify extension storage contains `video_<id>` with the expected saved time.
- Navigate away from the watch page.
- Return to the same video with a clean URL that has no `t=` parameter.
- Assert the player seeks to the saved timestamp.
- Reload the clean watch URL and assert the player seeks to the saved timestamp again.

For stronger isolation, the test can clear YouTube origin storage/cookies before returning to the video while preserving extension storage. If the clean YouTube page still resumes to the saved timestamp, the result is attributable to the extension rather than YouTube URL parameters or ordinary YouTube account history.

Storage helper strategy:

- Chromium Playwright tests should use `tests/e2e/chromium-extension-storage.js`.
- Firefox Selenium tests should use the storage helpers exported from `tests/firefox/firefox-fixture.js`.
- Keep the helper names conceptually aligned: `getExtensionStorage`, `setExtensionStorage`, `removeExtensionStorage`, `getStoredVideo`, `removeStoredVideo`, `seedStoredVideo`, and `setExtensionSettings`.

## Existing Test Inventory

### Jest

- `tests/unit/storage.test.js`
  - Hybrid storage local-first reads/writes.
  - IndexedDB fallback reads.
  - `removeVideo` local removal, IndexedDB delete, and tombstone creation.
  - `getAllVideos` merged IndexedDB plus `chrome.storage.local` view.
  - Stats rebuild/update behavior.

- `tests/unit/popup.test.js`
  - Popup button order and destructive clear styling.
  - Clear-history confirmation and `clearHistoryOnly` usage.
  - Export/import helpers.
  - URL timestamp helpers.
  - Popup UI state refresh and message handling.

- `tests/unit/thumbnail-overlay.test.js`
  - Thumbnail video ID extraction.
  - Overlay/progress element creation behavior.
  - Basic thumbnail overlay handling.

- `tests/unit/thumbnail-utils.test.js`
  - Thin wrapper coverage for thumbnail helper calls.

- `tests/unit/utils.test.js`
  - YouTube/Shorts URL parsing.
  - Time formatting.
  - Progress calculation.
  - Sorting/filtering helpers.

- `tests/integration/video-tracking.test.js`
  - Content-script video detection and tracking setup.
  - Progress saving on playback events.
  - Timestamp restore behavior.
  - Playlist context handling.
  - Shorts tracking.
  - Thumbnail overlay integration.

- `tests/integration/spa-navigation-real.test.js`
  - Real `content.js` SPA navigation entry points.
  - Watch page URL changes.
  - Playlist URL changes.
  - Idempotency for repeated video IDs.

- `tests/memory/cleanup.test.js`
  - Observer cleanup.
  - interval/timeout cleanup.
  - event listener cleanup.
  - repeated init/cleanup behavior.

### Playwright

- `tests/e2e/core-resume.spec.js`
  - Loads the unpacked Chrome extension in real Chromium through `launchPersistentContext`.
  - Opens the live Rick Astley YouTube watch page with a clean URL.
  - Saves a timestamp through the real content-script/media-event path.
  - Verifies `chrome.storage.local` contains the saved `video_<id>` record.
  - Clears YouTube origin state/cookies while preserving extension storage.
  - Navigates back to the clean watch URL and verifies the real player resumes from the extension-saved timestamp.
  - Reloads/returns again and verifies the resume behavior still holds.

- `tests/e2e/core-overlays.spec.js`
  - Loads the unpacked Chrome extension in real Chromium through `launchPersistentContext`.
  - Opens the maintainer-controlled live playlist `PLQga0f7orXVB8fZObVcpXuX-2swTybQqR`.
  - Dynamically extracts the first visible playlist video ID rather than hard-coding a playlist item.
  - Opens the maintainer-controlled channel videos page `https://www.youtube.com/@TodorKirilov/videos`.
  - Dynamically extracts the first visible channel video ID rather than hard-coding a channel item.
  - Seeds `chrome.storage.local` with a saved `video_<id>` record.
  - Verifies extension-owned overlay elements appear on saved playlist and channel items:
    - `.ytvht-viewed-label`.
    - `.ytvht-progress-bar`.
    - `.ytvht-remove-button`.
  - Clicks the overlay remove button and verifies the storage record and overlay elements are removed.

- `tests/e2e/static-overlays.spec.js`
  - Loads the unpacked Chrome extension in real Chromium through `launchPersistentContext`.
  - Replays captured YouTube HTML from `tests/fixtures/youtube-pages/captures/` under the original `https://www.youtube.com/...` URLs.
  - Uses the controlled playlist capture to verify:
    - saved item overlay/progress/remove controls appear.
    - repeated processing does not duplicate overlay elements.
    - overlay remove deletes extension storage and removes visible overlay elements.
  - Uses the controlled channel videos capture to verify:
    - saved channel item overlay/progress/remove controls appear.
    - dynamically appended video nodes are processed by the mutation observer.
    - duplicate overlay elements are not created when YouTube's nested renderer shapes cause the same item to be processed more than once.

Notes:

- This test exposed a real core failure: YouTube ads/player source resets could restart the real content from the beginning and cause the extension to overwrite the saved timestamp with lower startup times.
- The app now guards against short post-reset saves and reapplies the saved timestamp during the startup/player-reset window.
- The static overlay test exposed a real duplicate-overlay race: concurrent processing of nested YouTube renderers could append more than one `.ytvht-*` overlay set to the same video item. The app now rechecks existing overlay nodes after the async storage lookup resolves and removes stale sibling overlays from the same item container.

### Removed

- `tests/e2e/extension-smoke.spec.js`
  - Removed because it opened live YouTube, opened popup, and searched a result, but mostly acted as a broad smoke test.
  - It did not lock the core resume contract and would add noise to the Playwright sheet.

- `tests/e2e/extension.e2e.test.js`
  - Removed because it mostly tested live YouTube without the extension loaded.
  - It failed on stale selectors, consent redirects, signed-out home feed behavior, and non-extension assertions.

## Mandatory Acceptance Tests

These are must-have tests before accepting large behavior changes. They are stricter than the general gap list below.

### Saved History Resume

Required behavior:

- Watch a video long enough to save progress.
- Verify the saved timestamp exists in extension storage.
- Navigate away.
- Navigate back to the same video using a clean URL with no `t=` parameter.
- Assert playback seeks to the saved timestamp.
- Reload the same clean watch page.
- Assert playback still seeks to the saved timestamp.
- Open a saved video from the popup/list UI.
- Assert the opened YouTube URL includes the saved timestamp and/or the video seeks to the saved timestamp.
- Avoid passing because of YouTube native history, YouTube account state, or a stale URL timestamp.

Current coverage:

- Partially covered in `tests/integration/video-tracking.test.js` through mocked `loadTimestamp` and `ensureVideoReady` tests.
- Partially covered in `tests/unit/popup.test.js` through `addTimestampToUrl`.
- Covered as a real Playwright extension flow in `tests/e2e/core-resume.spec.js` for:
  - real extension install/load.
  - live YouTube watch page.
  - extension storage save.
  - clean URL navigation away/back.
  - YouTube origin storage/cookie cleanup to reduce native-history false positives.
  - player resume from extension storage.
  - repeat return/reload resume.
  - YouTube ads/player reset behavior that previously overwrote the saved timestamp with lower startup times.

Required new tests:

- Done: Playwright extension test with live YouTube watch page:
  - saves `video_<id>` at timestamp N.
  - asserts the first clean load starts near 0.
  - asserts extension storage contains timestamp N.
  - leaves page and returns.
  - returns using a clean watch URL with no `t=`.
  - verifies `video.currentTime` reaches N within tolerance.
  - clears YouTube origin storage/cookies before return while preserving extension storage.
  - verifies the behavior across a second clean return/reload path.
- Playwright popup/list test:
  - seed storage with `video_<id>`.
  - open popup.
  - click video entry.
  - verify opened page has `t=Ns` or reaches timestamp N after content script restore.

### Overlay Markings On YouTube Lists

Required behavior:

- Saved videos show overlay/progress markings on:
  - YouTube home/list surfaces when available.
  - search results.
  - playlists.
  - user/channel video lists.
  - watch-page recommendation lists.
- Unsaved videos do not show viewed overlays.
- Reprocessing a list does not duplicate overlays.

Current coverage:

- Partially covered in `tests/unit/thumbnail-overlay.test.js`.
- Partially covered in `tests/integration/video-tracking.test.js` with mocked thumbnail DOM.
- Covered as a real browser extension test for a live YouTube playlist and channel videos page in `tests/e2e/core-overlays.spec.js`.

Required new tests:

- Done: Chrome/Chromium live playlist overlay test (`tests/e2e/core-overlays.spec.js`):
  - seed extension storage for a real playlist item.
  - verify extension overlay/progress/remove controls appear.
  - verify overlay remove deletes storage and removes overlay elements.
- Done: Chrome/Chromium live channel videos overlay test (`tests/e2e/core-overlays.spec.js`):
  - seed extension storage for a real channel video item.
  - verify extension overlay/progress/remove controls appear.
  - verified in the normal Playwright command: `npm run test:e2e` (`3 passed`).
- Done: Chrome/Chromium static playlist overlay fixture test (`tests/e2e/static-overlays.spec.js`):
  - uses the downloaded controlled playlist capture.
  - loads it under the live playlist URL via Playwright route fulfillment.
  - seeds extension storage for a captured video ID.
  - verifies overlay/progress/remove controls appear.
  - verifies an unseeded captured playlist item does not show viewed overlays.
  - verifies repeated processing does not duplicate overlays.
  - verifies overlay remove deletes storage and removes overlay elements.
  - verifies overlay removal stays removed after a forced reprocessing mutation.
- Done: Chrome/Chromium static channel overlay fixture test (`tests/e2e/static-overlays.spec.js`):
  - uses the downloaded controlled channel videos capture.
  - loads it under the live channel videos URL via Playwright route fulfillment.
  - seeds extension storage for captured video IDs.
  - verifies overlay/progress/remove controls appear.
  - verifies a non-default stored progress ratio renders as the expected progress width.
  - verifies an unseeded captured channel item does not show viewed overlays.
  - appends a fresh captured video node after initial load.
  - verifies the mutation observer processes the new node.
  - verifies duplicate overlays are not created by nested YouTube renderer processing.
- Done: Chrome/Chromium static watch recommendation fixture test (`tests/e2e/static-overlays.spec.js`):
  - uses the downloaded `rick-watch` capture when present.
  - loads it under the live watch URL via Playwright route fulfillment.
  - discovers renderable recommendation IDs from the loaded captured DOM.
  - seeds extension storage for a captured recommendation item.
  - verifies overlay/progress/remove controls appear on the saved recommendation item.
  - verifies an unseeded recommendation item does not show viewed overlays.
  - verifies forced reprocessing does not create duplicate overlays.
- Done: Chrome/Chromium static SPA-style DOM replacement test (`tests/e2e/static-overlays.spec.js`):
  - loads the controlled playlist capture.
  - replaces the document body with the controlled channel videos capture without a full page reload.
  - dispatches route/mutation signals that simulate YouTube document reuse.
  - verifies the new captured list surface is processed.
  - verifies stale playlist containers are gone after the replacement.
- Done: Firefox static overlay fixture tests (`tests/firefox/static-overlays.firefox.test.js`):
  - mirrors playlist, channel, watch recommendation, and SPA replacement static overlay contracts.
  - serves fixtures through the local static fixture server.
  - keeps the ignored `rick-watch` capture optional with a clear skip message.
- Remaining deterministic fixture tests for other list surfaces:
  - search result captures.
  - home/list captures if signed-out YouTube serves useful content.
- Additional live YouTube selector-contract tests for other list surfaces, with diagnostic failure messages when YouTube markup changes:
  - search results.
  - channel/user video lists.
  - watch-page recommendations.

### History Removal

Required behavior:

- Removing a video from popup/list history deletes the storage record and creates/keeps the expected tombstone behavior.
- Popup/list UI removes the row after deletion.
- YouTube overlays update after deletion and disappear for that video.
- Removing via overlay `X` icon deletes the record and removes the overlay without requiring a reload.

Current coverage:

- `tests/unit/storage.test.js` covers `removeVideo` tombstone behavior.
- `tests/unit/popup.test.js` covers clear-all-history behavior.
- Individual video deletion from popup/list is not clearly covered end to end.
- Overlay `X` deletion is covered for a live YouTube playlist in `tests/e2e/core-overlays.spec.js`.

Required new tests:

- Playwright popup/list test:
  - seed video record.
  - open popup.
  - delete one video.
  - verify storage no longer has `video_<id>`.
  - verify row disappears.
- Playwright content fixture test:
  - seed video record.
  - load list page fixture.
  - verify overlay appears.
  - click overlay delete/`X`.
  - verify storage deletion and overlay removal.

### Playlist Ignore / Pause Rules

Required behavior:

- Global `pauseHistoryInPlaylists` prevents saving videos watched in playlist context.
- Per-playlist `ignoreVideos` prevents saving videos from that playlist.
- Non-ignored playlists still save video progress.
- Playlist metadata save preserves flags such as `ignoreVideos`.
- Changing playlist ignore settings updates future save behavior.

Current coverage:

- Done: `tests/integration/playlist-rules-real.test.js` exercises the real content-script save path:
  - global `pauseHistoryInPlaylists` prevents playlist saves.
  - per-playlist `ignoreVideos` prevents playlist saves.
  - non-ignored playlists save progress.
  - playlist metadata refresh preserves `ignoreVideos` and existing custom fields.
- Added: `tests/e2e/core-playlist-spa.spec.js` is a live Chromium canary that saves one controlled playlist item, clicks another item through YouTube's SPA, and verifies storage records the new video ID.
  - It skips with an explicit diagnostic when YouTube presents a CAPTCHA or unusual-traffic block.
  - Verified live on 2026-07-31: `1 passed` in 25.8 seconds.

## Current Functionality To Lock

### Extension Installation And Runtime

Behavior:

- Build unpacked Chrome extension from source.
- Load the extension in Chromium as Manifest V3.
- Register the background service worker.
- Inject content scripts on `*.youtube.com`.
- Open popup UI from extension context.

Existing coverage:

- The live Playwright core resume test covers extension build/load indirectly because the real content script must run and extension storage must be readable through the service worker.

Gaps:

- No separate lightweight extension install/popup diagnostic test after the broad smoke spec was removed.
- No explicit assertion that all required content scripts are present in the built `manifest.json`.
- No explicit assertion that popup initialization can read seeded storage.
- Firefox build/lint validation exists through `npm run test:firefox`.
- Firefox E2E launch/install/profile-isolation smoke and live Rick resume coverage exist through `npm run test:firefox:e2e`.

Recommended tests:

- Jest manifest/build contract test for expected permissions, host permissions, scripts, popup, and locale.
- Playwright extension test that opens popup with seeded storage and verifies visible video rows.
- Firefox `web-ext lint` gate, currently covered by `npm run test:firefox`.
- Firefox E2E launch/install/profile-isolation smoke and live Rick resume behavior, currently covered by `npm run test:firefox:e2e`.
- Optional manual Firefox/web-ext runtime smoke through `npm run firefox:run`.

### Video Progress Tracking

Behavior:

- Detect regular watch page video IDs.
- Track video current time and duration.
- Save `video_<id>` records with title, URL, channel name, channel ID, duration, timestamp, and time.
- Avoid saving zero time or invalid duration.
- Clamp near-end timestamps.
- Resume saved timestamps when revisiting videos.
- Broadcast updates after saves.

Existing coverage:

- Jest integration covers setup, playback events, storage writes, and restore scenarios.
- Playwright `core-resume.spec.js` covers a live YouTube watch-page save and restore flow against the real extension.

Gaps:

- Live e2e does not assert title/channel/duration fields deeply.
- No deterministic Playwright page fixture for watch-page tracking.

Recommended tests:

- Deterministic Playwright fixture for `https://www.youtube.com/watch?v=<id>` with a minimal YouTube-like watch DOM and video element.
- Live selector contract test for current watch page selectors: video element, title source, channel source, clean URL.
- Jest tests for clamping near video end and zero/invalid duration skip if not already direct enough.

### Shorts Tracking

Behavior:

- Detect `/shorts/<id>` URLs.
- Save Shorts separately through the same storage record shape with `isShorts`.
- Restore saved Shorts timestamp where possible.

Existing coverage:

- Jest integration has Shorts-related tracking coverage.
- Utility tests cover Shorts URL extraction.

Gaps:

- No Playwright test against live Shorts with extension loaded.
- No live selector contract for Shorts current DOM.

Recommended tests:

- Live selector contract: `/shorts/<id>` exposes a playable `video` and extractable ID.
- Deterministic Playwright fixture for Shorts save path.

### Thumbnail Overlays

Behavior:

- Detect video IDs from thumbnail/link DOM.
- Add viewed label.
- Add progress bar and percentage.
- Avoid duplicate overlays.
- Update overlays after SPA navigation and dynamic YouTube list changes.

Existing coverage:

- Unit tests cover helper-level overlay creation and video ID extraction.
- Integration tests cover overlay flow at a mocked DOM level.
- Current Playwright coverage does not assert actual overlay rendering.

Gaps:

- No live YouTube selector contract for all thumbnail surfaces the extension depends on.
- No deterministic browser-level test that pre-seeds storage, loads a YouTube results/grid DOM, and verifies overlays appear in the real content script.

Recommended tests:

- Live selector contracts:
  - Search result thumbnail watch links.
  - Watch-page recommendation links.
  - Playlist item links.
  - Channel/video-grid links.
- Deterministic Playwright fixture:
  - Seed `chrome.storage.local` with watched videos.
  - Load a search/results fixture under `youtube.com`.
  - Assert labels/progress bars are inserted once.

### Playlist Discovery And Playlist Rules

Behavior:

- Detect playlist IDs from YouTube URLs.
- Extract playlist title where possible.
- Save playlist metadata.
- Preserve playlist flags such as ignored videos.
- Respect global pause-history-in-playlists and per-playlist ignore flags.
- Display playlists in popup.

Existing coverage:

- Storage unit tests cover playlist storage merge paths partially.
- Integration tests cover playlist URL/SPAs and playlist ignore/pause behavior.
- Popup tests cover playlist display/reset in clear flow.

Gaps:

- No live selector contract for playlist pages.
- Existing old live playlist test used a brittle selector and public playlist that did not reliably load.
- No deterministic Playwright test for playlist discovery from current content script.

Recommended tests:

- Live selector contract using a stable public playlist URL, with diagnostics when only the YouTube shell loads.
- Deterministic Playwright fixture for playlist page DOM extraction.
- Jest test for playlist metadata merge preserving ignore flags.

### Popup UI

Behavior:

- Tabs: Videos, Shorts, Playlists, Analytics, Settings.
- Paginated video/shorts/history display.
- Sort/filter/search behavior.
- Open video links with timestamp.
- Clear all history with confirmation.
- Export/import history JSON.
- Theme toggle.
- Settings save/load.
- Sync status indicator.
- Analytics/statistics display.

Existing coverage:

- Popup unit tests cover several helper and clear/import/export behaviors.

Gaps:

- Unit tests mostly interact with globals and simulated handlers, not full popup startup.
- No browser-level popup test with seeded storage covering real DOM rendering across tabs.
- No screenshot or layout assertions for popup regressions.

Recommended tests:

- Playwright extension-page tests:
  - Seed storage in extension service worker.
  - Open `chrome-extension://<id>/popup.html`.
  - Verify Videos, Shorts, Playlists, Analytics, and Settings tabs render.
  - Verify search/filter/sort changes visible rows.
  - Verify opening a video produces a timestamped YouTube URL.
  - Verify export button creates JSON with expected shape.
- Jest tests should be moved toward exported helpers where possible instead of manually duplicating handler logic.

### Storage And Sync Architecture

Behavior:

- Local-first storage for recent/active records.
- IndexedDB archive fallback.
- Merged reads across local and IndexedDB.
- Tombstones for deletes.
- Stats snapshots and incremental stats updates.
- Migration from older storage shapes.
- Runtime messages for storage operations.
- `chrome.storage.onChanged` broadcasts updates.

Existing coverage:

- Storage unit tests cover many core hybrid paths.
- Background tests are not clearly present.

Gaps:

- No direct background message contract tests.
- Migration/version compatibility coverage appears partial.
- No large-dataset pagination/performance tests.
- No integration test for `chrome.storage.onChanged` to popup/content update flow.

Recommended tests:

- Jest background message contract test:
  - get/set/remove video.
  - get playlists.
  - stats request.
  - error response when storage unavailable.
- Storage migration fixtures for legacy data.
- Large dataset test for pagination and stats rebuild.

### Import And Export

Behavior:

- Export history as JSON.
- Import JSON into storage.
- Preserve video, Shorts, playlist, and settings-related data.
- Import flow can be opened through YouTube hash/import page behavior.

Existing coverage:

- Popup unit tests cover parts of export/import.

Gaps:

- No end-to-end import/export round trip in a real extension context.
- No invalid/corrupt import JSON tests at browser level.

Recommended tests:

- Playwright extension-page test:
  - Seed storage.
  - Trigger export and parse downloaded JSON.
  - Clear storage.
  - Import JSON.
  - Verify popup/feed renders restored data.
- Jest invalid import shape tests.

### Theme And Settings

Behavior:

- Theme selection.
- Overlay label customization.
- Overlay colors/progress settings.
- Analytics/settings preferences.
- Playlist pause/ignore settings.

Existing coverage:

- Popup tests cover some UI setup and helper behavior.
- Integration tests cover playlist pause/ignore behavior.

Gaps:

- No full settings persistence test in extension context.
- No Playwright visual/DOM check that changed overlay settings affect live content script output.

Recommended tests:

- Playwright popup settings persistence:
  - Open popup.
  - Change settings.
  - Reload popup.
  - Verify persisted values.
- Deterministic content fixture:
  - Seed settings.
  - Load thumbnail DOM.
  - Assert overlay text/color/progress reflects settings.

### SPA Navigation And Dynamic YouTube DOM

Behavior:

- Detect YouTube client-side URL changes.
- Reinitialize tracking on new videos.
- Handle playlist autoplay/navigation.
- Reprocess thumbnails as DOM changes.
- Avoid duplicate listeners/observers.

Existing coverage:

- `spa-navigation-real.test.js` covers core SPA entry points.
- Memory tests cover cleanup and listener/observer lifecycle.

Gaps:

- No live Playwright test for actual YouTube SPA navigation with the real content script loaded.
- No live test proving the extension follows a new video ID after YouTube reuses the document and/or player.
- No live test proving playlist navigation does not carry stale timestamp/overlay state from the previous video.
- No browser-level duplicate overlay/listener test.

Recommended tests:

- Live Playwright playlist SPA contract using the maintainer-controlled playlist:
  - Open `https://www.youtube.com/playlist?list=PLQga0f7orXVB8fZObVcpXuX-2swTybQqR`.
  - Extract at least two visible `watch?v=` IDs from the playlist page.
  - Click the first playlist item and wait for `/watch?v=<A>`.
  - Click the second playlist item from the playlist/sidebar UI and wait for `/watch?v=<B>`.
  - Assert `A !== B`.
  - Assert the extension saves or can save progress for `B`, not only stale `A`.
  - Seed storage for `B` and assert the playlist/sidebar item for `B` gets extension overlay/progress after SPA navigation.
  - Optionally navigate back to `A` and assert the extension can switch back without duplicate overlays or stale player timing.
- Live Playwright recommendation SPA proposal:
  - Start from the Rick Astley watch page already used by `core-resume.spec.js`.
  - Click the second or third visible recommendation, not the first ad/sponsored item.
  - Assert the URL changes to a different `watch?v=<B>`.
  - Verify the extension saves progress for `B`.
  - If Rick Astley appears in recommendations, click back to it and verify saved resume/overlay behavior.
  - If Rick does not appear, use a third recommendation hop and verify the extension continues tracking the current video ID.
  - Treat this as higher-noise than the controlled playlist test because recommendation ranking and ads are not controlled.
- Deterministic Playwright SPA fixture:
  - Start on one watch URL.
  - Push a new watch URL.
  - Replace video/title DOM.
  - Assert old tracking does not duplicate and new video saves separately.

Notes:

- If the controlled playlist SPA test passes, that is strong evidence that the extension handles YouTube's core SPA mechanics: reused document, delayed playlist/sidebar DOM, URL mutation, and video ID switching.
- It does not fully prove every other surface because recommendations, channel grids, Shorts, and search results use different renderer shapes. Keep the playlist test as the first live SPA contract, then add one higher-noise recommendation/watch-page flow only if we need broader confidence.
- Do not make normal test runs download or regenerate deterministic fixtures. A fixture should be committed, sanitized, and deterministic. Use a separate capture script/workflow when fixtures need refreshing.

### Captured YouTube Fixture Strategy

Purpose:

- Deterministic fixture tests are useful for DOM edge cases, but they must not secretly depend on live YouTube during normal test runs.

Current implementation:

- Manifest: `tests/fixtures/youtube-pages/pages.json`.
- Local generated captures: `tests/fixtures/youtube-pages/captures/<fixture-name>/`.
- Per-capture files:
  - `page.html`: rendered DOM, sanitized by default.
  - `metadata.json`: source URL, capture timestamp, purpose, viewport, sanitizer flag.
  - `screenshot.png`: visual reference for the captured state.
- Runner: `scripts/download-youtube-fixtures.js`.
- Command: `npm run fixtures:youtube:download`.
- Capture output is gitignored by default. Raw regenerated captures should be treated as local working data until deliberately reviewed.

Dedicated Playwright download/capture run:

- Refresh all manifest pages:

```bash
npm run fixtures:youtube:download
```

- Refresh one or more pages:

```bash
npm run fixtures:youtube:download -- --only controlled-playlist
npm run fixtures:youtube:download -- --only controlled-playlist,controlled-channel-videos --headless
```

- Capture to a temporary review folder:

```bash
npm run fixtures:youtube:download -- --out /tmp/ytlh-youtube-captures
```

Rules:

- Use Playwright, not `curl`, to capture fixture candidates. `curl` usually receives pre-hydration/shell HTML and misses the JavaScript-rendered DOM the extension actually depends on.
- Keep fixture refresh opt-in and excluded from normal `npm test`, `npm run test:e2e`, and CI test gates unless explicitly requested.
- The runner should open live YouTube, handle consent, wait for hydrated DOM, annotate the capture, save a screenshot, strip active page elements, and write the static HTML.
- It should fail loudly if a target surface cannot be captured, but that failure should not block ordinary deterministic test runs.
- It should never save cookies, local storage, account state, or raw active scripts in normal mode.
- If a captured fixture is ever promoted into a tracked fixture, review it like source code first.

Tests that should use captured static pages:

- Overlay list tests:
  - playlist item overlay/progress/remove button.
  - channel/user grid overlay/progress/remove button.
  - search result overlay once a search fixture is added.
  - watch recommendation/sidebar overlay.
- Dynamic DOM tests:
  - adding new YouTube item nodes after initial page load.
  - re-running overlay scans without duplicate labels/buttons.
  - removing/replacing list containers.
- SPA DOM tests:
  - watch URL changes with replaced title/video metadata.
  - playlist item navigation where the DOM updates without a full document reload.
  - route back/forward simulations where the content script must reset state.
- Extraction tests:
  - video ID extraction from real YouTube anchor variants.
  - playlist ID extraction from real playlist/watch URLs.
  - channel/user page item detection.

Tests that should not use captured static pages:

- Core save/resume contract.
- Real media playback timing.
- Ad interruption and post-ad reset behavior.
- YouTube consent flow.
- Firefox-vs-Chromium media/runtime differences.
- Any assertion whose value comes from current live YouTube availability.

Recommended workflow shape:

```text
live Playwright tests -> detect whether YouTube changed today
saved fixture tests -> deterministic regression coverage for known DOM shapes
dedicated Playwright capture/download run -> manually refresh sanitized fixtures when needed
```

Do not:

- Make unit/integration tests download YouTube pages on every run.
- Use Playwright tests as the first step of `npm test` to create local HTML fixtures.
- Hide live fixture downloads inside deterministic test commands.
- Commit raw full YouTube pages with scripts/cookies/tracking data.

### Firefox / WebExtension Testing

The extension is dual-browser and Firefox coverage is required, but Firefox should use a Firefox-specific workflow.

Current understanding:

- Playwright supports automating Firefox pages, but the documented browser-extension loading flow is Chromium-specific.
- The current extension fixture relies on Chromium flags:
  - `--disable-extensions-except`
  - `--load-extension`
- There is no equivalent repo-ready Playwright Firefox extension fixture in the current Playwright docs.
- `web-ext` is Mozilla's CLI for WebExtensions. It is intended to run, lint, build, and sign Firefox extensions.

Recommended Firefox test layers:

- Build/manifest checks:
  - Build `build/e2e/firefox`.
  - Assert `manifest.firefox.json` contains expected permissions, content scripts, popup, locales, and Firefox-compatible keys.
  - Done foundation: `npm run build:e2e:firefox` creates the unpacked Firefox E2E extension in `build/e2e/firefox`.
- `web-ext lint`:
  - Validate the Firefox extension package/source.
  - Run this in CI as the first Firefox-specific gate.
  - Done foundation: `npm run test:firefox` runs `web-ext lint --warnings-as-errors` against `build/e2e/firefox`.
- Firefox smoke with `web-ext run`:
  - Launch Firefox with the unpacked Firefox extension temporarily installed.
  - Verify the extension starts on YouTube and popup/content scripts do not immediately fail.
  - Done foundation: `npm run firefox:run` launches Firefox through `web-ext`; automated assertions are not added yet.
- Firefox E2E automation:
  - Done foundation: `tests/firefox/firefox-fixture.js` uses Selenium WebDriver with a clean `/tmp` profile and temporary extension install.
  - Done foundation: `tests/firefox/extension-smoke.firefox.test.js` verifies launch/install/profile cleanup, `moz-extension://` UUID discovery, and `browser.storage.local` read/write/remove.
  - Done overlay behavior: `tests/firefox/core-overlays.firefox.test.js` verifies live playlist overlay rendering/removal and live channel videos overlay rendering.
  - Done core behavior: `tests/firefox/core-resume.firefox.test.js` verifies live Rick timestamp save in Firefox extension storage, extension storage survival after clearing YouTube origin state, return restore, and reload restore.
  - Keep Firefox automation separate from the Chromium Playwright fixture unless Playwright gains reliable Firefox WebExtension loading support.

GitHub Actions / CI stance:

- Live Chromium and Firefox tests can run in GitHub Actions in principle.
- They should be separate opt-in jobs, not the default fast PR gate.
- CI must provide browsers, allow headless execution, and allow driver setup such as Selenium Manager/geckodriver.
- Expect live YouTube flake sources: network variance, consent UI, ads, player readiness, and Firefox-specific YouTube throttling.
- Keep unit/integration tests as the stable default gate; use live E2E as the canary for real YouTube/browser breakage.

What "re-create Firefox tests" means here:

- Do not copy the Chromium Playwright fixture and expect it to work unchanged.
- Add a dedicated Firefox workflow around `web-ext`.
- Done: lint/build/runtime smoke foundation exists.
- Add deeper Firefox E2E only after the Firefox launch/install path is stable.

## Live YouTube Selector Contracts

These tests should be small, diagnostic, and separate from extension behavior tests. They should fail with messages that identify which YouTube surface changed.

Recommended contracts:

- Search results:
  - `ytd-video-renderer` or accepted alternative exists.
  - First playable result has a `watch?v=` link.
  - Title text can be extracted.

- Watch page:
  - `video` exists.
  - URL contains `watch?v=`.
  - Title can be extracted from current selector fallback chain.
  - Channel name/link can be extracted.
  - Recommendations expose thumbnail/watch links.

- Shorts page:
  - `video` exists.
  - URL or page state exposes a Shorts ID.

- Playlist page:
  - Playlist ID remains in URL.
  - At least one playlist item/watch link is extractable, or failure reports that YouTube served shell/consent/unavailable content.

- Channel page:
  - Channel identity is visible.
  - At least one video link can be extracted using current selector fallback chain.

Live contracts should avoid:

- YouTube home feed as a required content source. Signed-out sessions often show "Try searching to get started."
- `#logo` strict selector assertions.
- Expecting the native `controls` attribute on YouTube's main video element.
- Full happy paths for every feature.

## `local-feed` PR Surface

The `local-feed` branch is not only a feed addition. It changes the extension architecture and test setup.

Observed incoming changes:

- Adds `feed.html` and many `feed-*` modules.
- Adds local feed, local search, YouTube search, history, playlist, subscription, analytics, backup, and settings feed surfaces.
- Splits large `content.js` into focused modules such as URL, CSS, import, playlists, info, thumbnails, messages, and subscriptions.
- Splits large `popup.js` into focused popup modules.
- Adds `content-subscriptions.js`.
- Adds `youtubei.googleapis.com` host permission.
- Adds `cookies` and `contextMenus` permissions.
- Changes build/config files.
- Removes the current working `extension-fixture.js` and `youtube-consent.js` approach.
- Reintroduces the brittle older Playwright file shape.

Required tests before trusting `local-feed`:

- Preserve or port the current `launchPersistentContext` extension fixture.
- Preserve or port the core live resume contract test from `tests/e2e/core-resume.spec.js`.
- Preserve or port the live overlay tests from `tests/e2e/core-overlays.spec.js`.
- Add or preserve a live SPA playlist navigation contract before merging large content-script/navigation changes.
- Add extension-page tests for `feed.html`.
- Add storage-seeded feed tests for:
  - history view.
  - playlist view.
  - subscriptions view.
  - local search.
  - analytics cards.
  - settings persistence.
- Add unit tests for:
  - `feed-data-pipeline`.
  - `feed-local-search`.
  - `feed-youtube-search-core`.
  - feed card rendering helpers.
  - subscription storage/update behavior.
- Add background/message tests for new permissions and APIs.
- Add manifest/build contract tests verifying every module referenced by the manifest exists in `build/chrome`.
- Add Firefox-specific build/lint smoke using `web-ext` for the Firefox package.

## Recommended Build Order

Current foundation already done on `feat/tests`:

1. Chrome live core resume contract: `tests/e2e/core-resume.spec.js`.
2. Chrome live playlist/channel overlay contracts: `tests/e2e/core-overlays.spec.js`.
3. Firefox E2E foundation with clean temp profiles, extension install, storage helpers, smoke, live Rick resume, and live overlay tests.
4. Static YouTube fixture download runner: `scripts/download-youtube-fixtures.js`.
5. Chrome static playlist/channel overlay fixture tests: `tests/e2e/static-overlays.spec.js`.
6. Firefox static playlist/channel overlay fixture tests: `tests/firefox/static-overlays.firefox.test.js`.
7. Jest default suite separated from live browser E2E by ignoring `tests/e2e/` and `tests/firefox/`.

Next test priority:

1. Popup saved-video open test.
   - Seed `video_<id>` in extension storage.
   - Open popup or future `local-feed` history surface.
   - Click the saved video entry.
   - Verify the opened YouTube URL includes the expected timestamp, or verify resume in a live browser flow.
   - Reason: this is adjacent to the core contract, but the incoming `local-feed` branch may change the popup/feed UI shape.
2. Static overlay expansion for additional surfaces.
   - Add search result capture and overlay test.
   - Add home/list capture only if signed-out YouTube serves useful content.
3. Manifest/build contract tests.
   - Verify manifest permissions, host permissions, popup/background/content script references, and store/E2E build output file existence.
   - Verify E2E-only local replay permissions exist only under `build/e2e/firefox`, not `src/manifest.firefox.json` or store `build/firefox`.
   - Reason: `local-feed` changes many modules and build references.
7. Feed/local-feed extension-page tests after the UI contract is known.
   - History view.
   - Playlist view.
   - Subscriptions view.
   - Local search.
   - Analytics cards.
   - Settings persistence.
8. Focused live YouTube selector canaries where needed.
   - Add only when static tests cannot provide enough confidence for a user-critical DOM path.
9. Port the foundation tests to `local-feed`.
   - Preserve the core live resume contract first.
   - Preserve overlay contracts second.
   - Then add feed-specific tests.

## Commands Used During Audit

Current Playwright extension suite:

```bash
npm run test:e2e
```

This now runs Chromium live plus Chromium static E2E:

```bash
npm run test:e2e:live
npm run test:e2e:static
```

Result after cleaning the live Playwright sheet:

```text
3 passed
```

Current static Playwright overlay suite:

```bash
npm run fixtures:youtube:download -- --only controlled-playlist,controlled-channel-videos --headless
npm run test:e2e:static
```

Result after adding static playlist/channel overlay coverage:

```text
2 passed
```

Current Firefox static overlay suite:

```bash
npm run test:firefox:static
```

Result after adding Firefox static playlist/channel overlay coverage:

```text
2 scenarios passed
```

Current default Jest suite, excluding live browser E2E:

```bash
npm test
```

Result after separating Jest from browser E2E:

```text
8 passed, 114 passed, 4 skipped
```

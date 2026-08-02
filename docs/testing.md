# 🧪 Testing Guide

This document provides a comprehensive overview of the testing strategy, frameworks, and specific tests for the YT re:Watch extension.

---

## 🚀 Running Tests

```bash
npm test
```

Runs **Jest** (unit, integration, memory). Playwright E2E is separate: `npm run test:e2e` (see End-to-End section below).

For the complete local extension suite, including fresh ignored YouTube HTML and public RSS captures, run:

```bash
npm run test:local:full
```

This command uses a clean browser context for the HTML captures, reads the
public RSS feeds for AsmonTV, Mentour Pilot, and Nerdrotic Daily without
credentials, then runs Jest and the Chromium/Firefox packaged-extension suites.
It is intentionally local-only: the default `npm test` and GitHub Actions do
not make these external requests.

---

## 🛠️ Frameworks

- **[Jest](https://jestjs.io/)**: Primary framework for unit, integration, and memory tests. Uses the `jsdom` environment with custom browser/extension mocks.
- **[Playwright](https://playwright.dev/)**: Used for end-to-end (E2E) testing. It allows for testing the extension in a real browser environment (Chromium/Firefox/WebKit) to simulate user interactions accurately.

---

## 🔬 Test Categories

### End-to-End (Chromium Playwright) — local first

Real Chromium loads the **unpacked E2E** extension from `build/e2e/chrome`.

```bash
npx playwright install chromium   # one-time

npm run test:e2e         # build + all Chromium extension E2E
npm run test:e2e:all     # build Chrome + Firefox, then run every browser E2E check
npm run test:e2e:live    # live YouTube Chromium extension E2E
npm run test:e2e:static  # captured-DOM Chromium extension E2E
npm run test:e2e:ui      # Playwright UI
npm run test:e2e:all     # all Playwright projects
```

If `build/e2e/chrome/manifest.json` is missing, global setup runs `npm run build:e2e`.

Chromium and Firefox extension E2E runs are headless by default. Set
**`PW_HEADED=1`** only when you need a visible browser for debugging, for
example `PW_HEADED=1 npm run test:e2e:live`.

Optional **yt-storage.json** in the repo root (loaded by `extension-fixture.js` when present) saves cookies after you accept consent once—**best way to avoid flaky CMP dialogs**; keep it **gitignored**. **`tests/e2e/youtube-consent.js`** also walks **every frame** (Google CMP often uses iframes), tries **button** and **link** roles, several **locales**, `tp-yt-paper-button` / `ytd-button-renderer` fallbacks, **Escape**, and multiple passes for stacked dialogs. Use `dismissYouTubeConsent(page, { preferReject: true })` if you want “reject all” first.

GitHub: run **E2E (Playwright)** manually via Actions (`workflow_dispatch`) — `.github/workflows/e2e.yml`.

- **`core-resume.spec.js`**: live YouTube save/resume contract.
- **`core-overlays.spec.js`**: live playlist/channel overlay contracts.
- **`static-overlays.spec.js`**: captured playlist/channel DOM overlay contracts.

Local Chromium and Firefox extension tests are headless by default. Use
`PW_HEADED=1` for a visible debugging session. Live YouTube may show anti-bot /
CAPTCHA interstitials on watch pages in either mode.

### Testing YouTube DOM changes

Live YouTube is useful as a **thin smoke target**, but it is not reliable enough to be the only way to catch markup changes. For DOM-sensitive extension behavior, prefer **fixture-based regression tests** in addition to live Playwright checks.

Recommended approach:

- Keep a very small live YouTube smoke suite:
  - extension loads on `youtube.com`
  - content script injects styles
  - one or two critical selectors still exist
- Move DOM parsing and DOM-targeting logic into helper functions where possible, then test those helpers against saved HTML fixtures with Jest/jsdom.
- Save representative HTML snapshots for the YouTube surfaces the extension depends on:
  - search results
  - home/rich grid
  - watch page recommendations
  - playlist pages
  - Shorts pages
- Use those saved fixtures to validate:
  - video ID extraction
  - thumbnail target resolution
  - title/channel extraction
  - overlay insertion points

Practical fixture workflow:

1. Open the relevant YouTube page variant.
2. Capture the DOM you actually depend on, usually with `document.body.innerHTML` or a narrower subtree instead of a full browser save.
3. Store that snapshot under `tests/fixtures/youtube/` with a scenario-based name such as `search-results.html` or `playlist-sidebar.html`.
4. Write Jest/jsdom tests that load the fixture and run the extension’s DOM helpers against it.
5. When YouTube changes its markup, add the new snapshot and a regression test before adjusting the production selectors.

This gives the project two safety nets:

- **Live smoke** tells us that production YouTube behavior has changed.
- **Fixture-based tests** let us debug and lock in selector/parser fixes deterministically without fighting CAPTCHA, VPN reputation, or other anti-bot systems.

### Integration Tests (`/tests/integration`)

Integration tests focus on the interactions between different components of the extension.

- **`video-tracking.test.js`**: This suite tests the interaction between the `content.js` script and the storage layer. It ensures that video progress is correctly tracked and saved under various conditions, such as page navigation and video playback events.

### Unit Tests (`/tests/unit`)

Unit tests verify the functionality of individual modules or components in isolation.

- **`popup.test.js`**:
  - **Purpose**: Tests the UI logic in `popup.js`.
  - **Key Scenarios**:
    - **Internationalization (i18n)**: Ensures the UI correctly displays translated strings by mocking the `chrome.i18n.getMessage` API.
    - Basic popup layout (button ordering, initial sync indicator state).
    - Clear history UX (confirmation, use of `clearHistoryOnly`, UI refresh).
    - URL helpers like `addTimestampToUrl` used when opening videos from the popup.
    - Import/export flows (`exportHistory`, `openImportPage`) including JSON structure and browser integration (blob download, YouTube `#ytlh_import` tab).
    - Storage change listener behavior and sync status message handling.

- **`storage.test.js`**:
  - **Purpose**: Tests the hybrid storage system (`SimpleStorage` / `ytStorage`) and how it interacts with `chrome.storage.local` and IndexedDB.
  - **Key Scenarios**:
    - Local-first writes for videos (`setVideo`) and playlists.
    - Hybrid reads: `getVideo` preferring `storage.local`, then falling back to IndexedDB.
    - Hybrid deletion: `removeVideo` removing from local storage, calling IndexedDB delete with tombstone creation, and writing legacy `deleted_video_*` markers.
    - Merged views: `getAllVideos` combining IndexedDB base data with a local overlay where local wins on newer timestamps.

- **`utils.test.js`**:
  - **Purpose**: Tests various utility and helper functions.
  - **Key Scenarios**:
    - Time formatting functions.
    - Data sorting and filtering logic.
    - URL parsing and video ID extraction.

### Memory Tests (`/tests/memory`)

Memory tests are designed to identify potential memory leaks or excessive resource consumption.

- **`cleanup.test.js`**:
  - **Purpose**: Verifies that DOM elements and event listeners created by the `content.js` script are properly cleaned up when they are no longer needed (e.g., during YouTube's SPA navigations). This prevents memory leaks and ensures the extension remains performant over long browsing sessions. 

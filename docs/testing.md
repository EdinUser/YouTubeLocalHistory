# 🧪 Testing Guide

This document provides a comprehensive overview of the testing strategy, frameworks, and specific tests for the YT re:Watch extension.

---

## 🚀 Running Tests

All tests can be executed using the following command from the project root:

```bash
npm test
```

This command will run all test suites, including unit, integration, memory, and end-to-end tests.

---

## 🛠️ Frameworks

- **[Jest](https://jestjs.io/)**: Primary framework for unit, integration, and memory tests. Uses the `jsdom` environment with custom browser/extension mocks.
- **[Playwright](https://playwright.dev/)**: Used for end-to-end (E2E) testing. It allows for testing the extension in a real browser environment (Chromium/Firefox/WebKit) to simulate user interactions accurately.

---

## 🔬 Test Categories

### End-to-End (E2E) Tests (`/tests/e2e`)

E2E tests simulate real user workflows from start to finish. They run the extension in a headless browser to validate the complete user experience.

- **`global-setup.js` / `global-teardown.js`**: These files handle the setup and teardown for the Playwright test environment. The setup script launches a persistent browser context with the extension loaded, and the teardown script closes it.
- **`extension.e2e.test.js`**: Contains the main E2E test suite. It verifies core extension functionality, such as:
  - The popup window opens correctly.
  - The history view displays tracked videos.
  - Settings can be changed and persisted.
  - Search and filter functionalities in the popup work as expected.

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

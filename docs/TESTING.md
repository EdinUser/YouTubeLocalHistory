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

- **[Vitest](https://vitest.dev/)**: Used as the primary framework for unit, integration, and memory tests. It provides a fast, modern testing experience with a Jest-compatible API.
- **[Playwright](https://playwright.dev/)**: Used for end-to-end (E2E) testing. It allows for testing the extension in a real browser environment (Chromium) to simulate user interactions accurately.

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

- **`storage.test.js`**:
  - **Purpose**: Tests the `storage.js` abstraction layer.
  - **Key Scenarios**:
    - CRUD (Create, Read, Update, Delete) operations for video and playlist records.
    - **Tombstone Deletion**: Verifies that deleting a video creates a tombstone, and that the cleanup logic correctly removes old tombstones while preserving recent ones.
    - Data migration logic between different database versions.

- **`popup.test.js`**:
  - **Purpose**: Tests the UI logic in `popup.js`.
  - **Key Scenarios**:
    - **Internationalization (i18n)**: Ensures the UI correctly displays translated strings by mocking the `chrome.i18n.getMessage` API.
    - Rendering of video history, playlists, and statistics.
    - User interactions like searching, sorting, and pagination.
    - Settings are loaded and saved correctly.

- **`sync-service.test.js`**:
  - **Purpose**: Tests the Firefox Sync integration logic in `sync-service.js`.
  - **Key Scenarios**:
    - Conflict resolution between local and remote data.
    - Incremental sync and full sync operations.
    - Handling of tombstones to ensure deletions are propagated across devices.

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
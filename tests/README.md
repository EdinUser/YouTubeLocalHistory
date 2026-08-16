# Testing Guide

This directory contains comprehensive tests for the YT re:Watch extension.

## Test Structure

```
tests/
├── setup.js                    # Jest setup and mocks
├── unit/                       # Unit tests for individual modules
│   ├── utils.test.js           # Utility function tests
│   ├── storage.test.js         # Hybrid storage (ytStorage) tests
│   ├── popup.test.js           # Popup UI logic, URLs, import/export
│   ├── thumbnail-utils.test.js # Thumbnail utility tests
│   └── thumbnail-overlay.test.js # Overlay behavior tests
├── integration/                # Integration tests
│   └── video-tracking.test.js  # Video tracking workflow tests
├── memory/                     # Memory leak detection tests
│   └── cleanup.test.js         # Cleanup and memory management tests
├── e2e/                        # Chromium Playwright extension tests
│   ├── core-resume.spec.js     # Live YouTube save/resume contract
│   ├── core-overlays.spec.js   # Live YouTube overlay contracts
│   └── static-overlays.spec.js # Captured YouTube DOM overlay contracts
└── firefox/                    # Firefox Selenium/WebExtension tests
    ├── core-resume.firefox.test.js
    ├── core-overlays.firefox.test.js
    └── static-overlays.firefox.test.js
```

## Running Tests

### Install Dependencies
```bash
npm install
```

### Run All Tests
```bash
npm test
```

### Run the Deterministic Local Gate
```bash
npm run test:local:offline
```

This is the release-blocking local command. It runs Jest, the packaged Chromium
feed/runtime tests, captured/static Chromium DOM tests, Firefox package lint,
Firefox extension smoke tests, and captured/static Firefox tests. It does not
make live YouTube requests, so a failure should represent repository behavior
rather than current YouTube content, consent, throttling, or SPA timing.
Independent test groups continue after a failure, and the command returns
nonzero after every group has reported.

### Run Only the Cross-browser Static Fixtures

```bash
npm run test:static
```

Builds both browser packages and runs only the committed, sanitized static HTML
fixture suites. It does not contact YouTube.

### Run Every Available Test Locally
```bash
npm run test:local:full
```

This deliberately includes everything: fixture refresh, all Jest tests with the
opt-in RSS and channel-metadata readings enabled, every Chromium project, every
Firefox scenario, and both retained-host-permission canaries. It therefore uses
live YouTube and can fail because the external site, consent flow, throttling,
or network changed. Use it when you explicitly want the complete inventory,
not as the deterministic release gate. A failed group does not prevent later
Chromium or Firefox groups from running; the final exit code remains nonzero.

### Run Live YouTube Canaries
```bash
npm run test:canary
```

This runs only the external contracts: public RSS and channel metadata, live
Chromium overlays/playlist/resume/Shorts/permission checks, and their Firefox
counterparts. It is intended for scheduled monitoring and early warning when
YouTube changes HTML, CSS, SPA behavior, feeds, permissions, or player behavior.
It runs every canary even when an earlier one reports an alert, then exits
nonzero with a summary of failed groups. It is not a substitute for
`test:local:offline`.

Example crontab entry (replace the repository and npm paths for the machine):

```cron
0 6 * * * cd /absolute/path/to/YouTubeLocalHistory && /usr/bin/npm run test:canary >> /tmp/ytlh-canary.log 2>&1
```

### Run Specific Test Types
```bash
# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration

# Memory leak tests only
npm run test:memory

# All tests with coverage report
npm run test:coverage

# Watch mode (re-runs tests on file changes)
npm run test:watch
```

### Run E2E Tests (if configured)
```bash
npm run test:e2e       # build + Chromium live and static
npm run test:e2e:all   # build Chrome + Firefox, then run all browser E2E checks
npm run test:e2e:offline  # deterministic packaged Chromium + captured/static DOM
npm run test:e2e:live  # Chromium live only
npm run test:e2e:static
npm run test:firefox:offline
npm run test:firefox:all
npm run test:e2e:ui  # Opens Playwright UI
npm run test:rss:live
npm run test:channel-metadata:live  # opt-in public YouTube Channels metadata contract
```

Chromium and Firefox extension E2E runs are headless by default. To use a
visible browser while debugging, prefix the command with `PW_HEADED=1`, for
example `PW_HEADED=1 npm run test:e2e:live`.

## Test Types Explained

### Unit Tests (`tests/unit/`)
- **Purpose**: Test individual functions in isolation
- **What they test**: 
  - Video ID extraction and utilities
  - Hybrid storage operations (local-first writes, IndexedDB fallback, merged views)
  - Popup behavior (history rendering, settings wiring, URL timestamp helpers)
  - Import/export logic (export JSON structure, import flows)
  - Data validation and error handling
- **Tools**: Jest with jsdom
- **Example**: Does `getVideoId()` correctly extract IDs from various YouTube URLs?

### Integration Tests (`tests/integration/`)
- **Purpose**: Test how different components work together
- **What they test**:
  - Video tracking setup and teardown
  - Storage integration with video tracking
  - Message passing between components
  - Thumbnail overlay functionality
- **Tools**: Jest with jsdom
- **Example**: When a video is played, does the timestamp get saved to storage?

### Memory Tests (`tests/memory/`)
- **Purpose**: Detect memory leaks and ensure proper cleanup
- **What they test**:
  - Observer disconnection
  - Event listener cleanup
  - Timer and interval cleanup
  - Resource tracking
- **Tools**: Jest with custom memory monitoring
- **Example**: After page navigation, are all observers properly disconnected?

### E2E Tests (`tests/e2e/`)
- **Purpose**: Test complete user workflows in a real browser
- **What they test**:
  - Full extension functionality
  - Real YouTube page interactions
  - Cross-browser compatibility
- **Tools**: Playwright or Puppeteer
- **Example**: Load extension, navigate to YouTube, play video, verify tracking

## Test Coverage

The test suite covers:

### Core Functionality
- ✅ Video ID extraction from various URL formats
- ✅ Storage operations (CRUD for videos and playlists)
- ✅ Settings management
- ✅ Video progress tracking
- ✅ Thumbnail overlay system

### Memory Management
- ✅ Observer cleanup on page unload
- ✅ Event listener removal
- ✅ Timer and interval cleanup
- ✅ Resource tracking and disposal

### Error Handling
- ✅ Storage operation failures
- ✅ Video element errors
- ✅ Initialization failures
- ✅ Graceful degradation

### Performance
- ✅ No duplicate event listeners
- ✅ Efficient thumbnail processing
- ✅ Memory usage monitoring

## Writing New Tests

### Unit Test Example
```javascript
describe('Video ID Extraction', () => {
  test('should extract video ID from standard URL', () => {
    const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    const videoId = extractVideoId(url);
    expect(videoId).toBe('dQw4w9WgXcQ');
  });
});
```

### Integration Test Example
```javascript
describe('Video Tracking Integration', () => {
  test('should save timestamp when video is paused', async () => {
    const video = createMockVideoElement();
    setupVideoTracking(video);
    
    // Simulate video pause
    video.pause();
    
    expect(mockStorage.setVideo).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ time: expect.any(Number) })
    );
  });
});
```

### Memory Test Example
```javascript
describe('Memory Leak Prevention', () => {
  test('should cleanup observers on page unload', () => {
    const observer = createMockObserver();
    
    // Simulate page unload
    simulatePageNavigation();
    
    expect(observer.disconnect).toHaveBeenCalled();
  });
});
```

## Debugging Tests

### Enable Verbose Logging
```bash
npm test -- --verbose
```

### Run Single Test File
```bash
npm test -- tests/unit/utils.test.js
```

### Run Tests with Coverage
```bash
npm run test:coverage
# Opens coverage report in browser
```

### Debug Failing Tests
```bash
# Run tests in debug mode
node --inspect-brk node_modules/.bin/jest --runInBand
```

## Continuous Integration

The test suite is designed to run in CI environments:

```yaml
# GitHub Actions example
- name: Run Tests
  run: |
    npm install
    npm test
    npm run test:coverage
```

## Best Practices

1. **Keep tests focused**: Each test should verify one specific behavior
2. **Use descriptive names**: Test names should explain what they're testing
3. **Mock external dependencies**: Don't rely on real YouTube or browser APIs
4. **Test error conditions**: Include tests for failure scenarios
5. **Maintain test data**: Use consistent, realistic test data
6. **Clean up after tests**: Reset mocks and DOM state between tests

## Troubleshooting

### Common Issues

**Tests failing due to missing mocks**
- Check that all browser APIs are mocked in `tests/setup.js`
- Ensure `ytStorage` is properly mocked

**Memory tests failing**
- Verify cleanup functions are being called
- Check that WeakMap/WeakSet references are properly cleared

**Integration tests timing out**
- Increase Jest timeout: `jest.setTimeout(10000)`
- Check for async operations that aren't properly awaited

**E2E tests failing**
- Ensure Playwright is properly installed
- Check that extension is built before running E2E tests 

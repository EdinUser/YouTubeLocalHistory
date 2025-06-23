# Testing Guide

This directory contains comprehensive tests for the YouTube Local History extension.

## Test Structure

```
tests/
├── setup.js                    # Jest setup and mocks
├── unit/                       # Unit tests for individual functions
│   ├── utils.test.js          # Utility function tests
│   └── storage.test.js        # Storage functionality tests
├── integration/               # Integration tests
│   └── video-tracking.test.js # Video tracking workflow tests
├── memory/                    # Memory leak detection tests
│   └── cleanup.test.js        # Cleanup and memory management tests
└── e2e/                       # End-to-end tests (future)
    └── extension.e2e.test.js  # Full browser automation tests
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
npm run test:e2e
npm run test:e2e:ui  # Opens Playwright UI
```

## Test Types Explained

### Unit Tests (`tests/unit/`)
- **Purpose**: Test individual functions in isolation
- **What they test**: 
  - Video ID extraction from URLs
  - Storage operations (get, set, remove)
  - Utility functions
  - Data validation
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
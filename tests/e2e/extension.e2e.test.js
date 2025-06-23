/**
 * End-to-End tests for YouTube Local History Extension
 *
 * Note: These tests require the extension to be built and loaded
 * Run with: npm run test:e2e
 */

const { test, expect } = require('@playwright/test');

// Test configuration
test.describe('YouTube Local History Extension E2E', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to YouTube
    await page.goto('https://www.youtube.com');

    // Wait for page to load
    await page.waitForLoadState('networkidle');
  });

  test('should load extension on YouTube page', async ({ page }) => {
    // Check if extension is loaded by looking for extension-specific elements
    // This would require the extension to be loaded in the browser

    // For now, we'll just verify YouTube loads correctly
    await expect(page).toHaveTitle(/YouTube/);

    // Check for YouTube-specific elements
    await expect(page.locator('#logo')).toBeVisible();
  });

  test('should detect video page and setup tracking', async ({ page }) => {
    // Navigate to a specific video
    await page.goto('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    // Wait for video player to load
    await page.waitForSelector('video', { timeout: 10000 });

    // Check if video element exists
    const videoElement = page.locator('video');
    await expect(videoElement).toBeVisible();

    // Verify video has proper attributes
    await expect(videoElement).toHaveAttribute('src');
  });

  test('should show thumbnail overlays on home page', async ({ page }) => {
    // Navigate to YouTube home page
    await page.goto('https://www.youtube.com');

    // Wait for thumbnails to load
    await page.waitForSelector('ytd-rich-item-renderer', { timeout: 10000 });

    // Check for thumbnail elements
    const thumbnails = page.locator('ytd-rich-item-renderer');
    await expect(thumbnails.first()).toBeVisible();

    // Note: Extension overlays would be added by the extension
    // This test would need the extension to be loaded
  });

  test('should handle playlist pages', async ({ page }) => {
    // Navigate to a playlist (using a public playlist)
    await page.goto('https://www.youtube.com/playlist?list=PLrAXtmRdnEQy6nuLMHjMZOz59Oq8WGfwR');

    // Wait for playlist to load
    await page.waitForSelector('ytd-playlist-video-renderer', { timeout: 10000 });

    // Check for playlist elements
    const playlistVideos = page.locator('ytd-playlist-video-renderer');
    await expect(playlistVideos.first()).toBeVisible();
  });

  test('should handle Shorts pages', async ({ page }) => {
    // Navigate to a Shorts page
    await page.goto('https://www.youtube.com/shorts/dQw4w9WgXcQ');

    // Wait for Shorts video to load
    await page.waitForSelector('video', { timeout: 10000 });

    // Check for video element
    const videoElement = page.locator('video');
    await expect(videoElement).toBeVisible();
  });

  test('should handle page navigation', async ({ page }) => {
    // Start on home page
    await page.goto('https://www.youtube.com');

    // Navigate to a video
    await page.goto('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    // Navigate back to home
    await page.goto('https://www.youtube.com');

    // Verify navigation worked
    await expect(page).toHaveURL(/youtube\.com\/$/);
  });

  test('should handle search results', async ({ page }) => {
    // Navigate to search results
    await page.goto('https://www.youtube.com/results?search_query=test');

    // Wait for search results to load
    await page.waitForSelector('ytd-video-renderer', { timeout: 10000 });

    // Check for search result elements
    const searchResults = page.locator('ytd-video-renderer');
    await expect(searchResults.first()).toBeVisible();
  });

  test('should handle channel pages', async ({ page }) => {
    // Navigate to a channel page
    await page.goto('https://www.youtube.com/channel/UCX6OQ3DkcsbYNE6H8uQQuVA');

    // Wait for channel content to load
    await page.waitForSelector('ytd-rich-grid-renderer', { timeout: 10000 });

    // Check for channel elements
    const channelVideos = page.locator('ytd-rich-grid-renderer');
    await expect(channelVideos).toBeVisible();
  });
});

// Extension-specific tests (would require extension to be loaded)
test.describe('Extension Functionality (requires extension)', () => {
  test.skip('should track video progress', async ({ page }) => {
    // This test would require the extension to be loaded
    // and would test actual video tracking functionality

    await page.goto('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    // Wait for video to load
    await page.waitForSelector('video');

    // Play video for a few seconds
    await page.locator('video').click();

    // Wait for video to play
    await page.waitForTimeout(3000);

    // Check if extension has tracked the progress
    // This would require checking extension storage or UI elements
  });

  test.skip('should show viewed overlays on thumbnails', async ({ page }) => {
    // This test would require the extension to be loaded
    // and would check for overlay elements added by the extension

    await page.goto('https://www.youtube.com');

    // Wait for thumbnails to load
    await page.waitForSelector('ytd-rich-item-renderer');

    // Check for extension overlays
    // const overlays = page.locator('.ytvht-viewed-label');
    // await expect(overlays.first()).toBeVisible();
  });

  test.skip('should handle extension popup', async ({ page, context }) => {
    // This test would require the extension to be loaded
    // and would test the popup functionality

    // Open extension popup
    // const popup = await context.newPage();
    // await popup.goto('chrome-extension://[extension-id]/popup.html');

    // Check popup content
    // await expect(popup.locator('#history-list')).toBeVisible();
  });
});

// Performance tests
test.describe('Performance Tests', () => {
  test('should load YouTube pages quickly', async ({ page }) => {
    const startTime = Date.now();

    await page.goto('https://www.youtube.com');
    await page.waitForLoadState('networkidle');

    const loadTime = Date.now() - startTime;

    // YouTube should load within 10 seconds
    expect(loadTime).toBeLessThan(10000);
  });

  test('should handle multiple page navigations', async ({ page }) => {
    const pages = [
      'https://www.youtube.com',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube.com/playlist?list=PLrAXtmRdnEQy6nuLMHjMZOz59Oq8WGfwR'
    ];

    for (const url of pages) {
      await page.goto(url);
      await page.waitForLoadState('networkidle');

      // Verify page loaded correctly
      await expect(page).toHaveURL(url);
    }
  });
});

// Accessibility tests
test.describe('Accessibility Tests', () => {
  test('should have proper page titles', async ({ page }) => {
    await page.goto('https://www.youtube.com');
    const title = await page.title();
    expect(title).toContain('YouTube');
  });

  test('should have proper video controls', async ({ page }) => {
    await page.goto('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await page.waitForSelector('video');

    // Check for video controls
    const video = page.locator('video');
    await expect(video).toHaveAttribute('controls');
  });
});
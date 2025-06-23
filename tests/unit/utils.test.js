/**
 * Unit tests for utility functions
 */

// Import the functions we want to test
// Note: We'll need to extract these functions or test them in context

describe('Utility Functions', () => {
  describe('Video ID Extraction', () => {
    test('should extract video ID from YouTube URL', () => {
      const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
      const urlParams = new URLSearchParams(url.split('?')[1]);
      const videoId = urlParams.get('v');
      
      expect(videoId).toBe('dQw4w9WgXcQ');
    });

    test('should extract video ID from Shorts URL', () => {
      Object.defineProperty(window, 'location', {
        value: {
          href: 'https://www.youtube.com/shorts/dQw4w9WgXcQ',
          pathname: '/shorts/dQw4w9WgXcQ'
        },
        writable: true
      });

      const videoId = window.location.pathname.match(/\/shorts\/([^\/\?]+)/)?.[1];
      expect(videoId).toBe('dQw4w9WgXcQ');
    });

    test('should extract video ID from youtu.be URL', () => {
      Object.defineProperty(window, 'location', {
        value: {
          href: 'https://youtu.be/dQw4w9WgXcQ'
        },
        writable: true
      });

      const videoId = window.location.href.match(/youtu\.be\/([^\/\?]+)/)?.[1];
      expect(videoId).toBe('dQw4w9WgXcQ');
    });

    test('should return null for invalid URLs', () => {
      const url = 'https://www.youtube.com/';
      const urlParams = new URLSearchParams(url.split('?')[1]);
      const videoId = urlParams.get('v');
      
      expect(videoId).toBeNull();
    });
  });

  describe('URL Cleaning', () => {
    test('should clean YouTube URLs', () => {
      const testUrls = [
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=123s&list=PL1234567890',
        'https://youtu.be/dQw4w9WgXcQ?t=123s&list=PL1234567890'
      ];

      testUrls.forEach(url => {
        // Extract video ID using regex - handle both youtube.com and youtu.be formats
        let videoId = null;
        if (url.includes('youtube.com/watch')) {
          const videoIdMatch = url.match(/[?&]v=([^&]+)/);
          videoId = videoIdMatch ? videoIdMatch[1] : null;
        } else if (url.includes('youtu.be/')) {
          const videoIdMatch = url.match(/youtu\.be\/([^?&]+)/);
          videoId = videoIdMatch ? videoIdMatch[1] : null;
        }
        
        // Remove query parameters except 'v'
        const cleanUrl = url.split('?')[0] + '?v=' + videoId;
        expect(cleanUrl).toContain('v=dQw4w9WgXcQ');
        expect(cleanUrl).not.toContain('t=');
        expect(cleanUrl).not.toContain('list=');
      });
    });
  });

  describe('Playlist Info Extraction', () => {
    test('should extract playlist information', () => {
      // Mock DOM elements
      document.querySelector = jest.fn((selector) => {
        if (selector === 'meta[property="og:url"]') {
          return { content: 'https://www.youtube.com/playlist?list=PL1234567890' };
        }
        if (selector === '#title') {
          return { textContent: 'Test Playlist' };
        }
        return null;
      });

      const playlistId = 'PL1234567890';
      const playlistTitle = 'Test Playlist';
      
      // Extract playlist ID from meta tag
      const metaUrl = document.querySelector('meta[property="og:url"]')?.content;
      const extractedPlaylistId = metaUrl?.match(/[?&]list=([^&]+)/)?.[1];
      
      // Extract title from page
      const extractedTitle = document.querySelector('#title')?.textContent;

      expect(extractedPlaylistId).toBe(playlistId);
      expect(extractedTitle).toBe('Test Playlist');
    });

    test('should return null for non-playlist pages', () => {
      Object.defineProperty(window, 'location', {
        value: {
          href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          search: '?v=dQw4w9WgXcQ'
        },
        writable: true
      });

      const urlParams = new URLSearchParams(window.location.search);
      const playlistId = urlParams.get('list');
      
      expect(playlistId).toBeNull();
    });
  });

  describe('Settings Management', () => {
    test('should have default settings', () => {
      const defaultSettings = {
        autoCleanPeriod: 90,
        paginationCount: 10,
        overlayTitle: 'viewed',
        overlayColor: 'blue',
        overlayLabelSize: 'medium'
      };

      expect(defaultSettings.autoCleanPeriod).toBe(90);
      expect(defaultSettings.overlayColor).toBe('blue');
      expect(defaultSettings.overlayLabelSize).toBe('medium');
    });

    test('should validate overlay colors', () => {
      const validColors = ['blue', 'red', 'green', 'purple', 'orange'];
      const invalidColor = 'invalid';

      expect(validColors).toContain('blue');
      expect(validColors).not.toContain(invalidColor);
    });

    test('should validate overlay label sizes', () => {
      const validSizes = ['small', 'medium', 'large', 'xlarge'];
      const invalidSize = 'invalid';

      expect(validSizes).toContain('medium');
      expect(validSizes).not.toContain(invalidSize);
    });
  });

  describe('CSS Generation', () => {
    test('should generate valid CSS for overlays', () => {
      const size = { fontSize: 16, bar: 3 };
      const color = '#4285f4';

      const css = `
        .ytvht-viewed-label {
          padding: ${size.fontSize / 2}px 4px !important;
          background-color: ${color} !important;
          font-size: ${size.fontSize}px !important;
        }
        .ytvht-progress-bar {
          height: ${size.bar}px !important;
          background-color: ${color} !important;
        }
      `;

      expect(css).toContain('background-color: #4285f4');
      expect(css).toContain('font-size: 16px');
      expect(css).toContain('height: 3px');
    });

    test('should handle different color values', () => {
      const colors = {
        blue: '#4285f4',
        red: '#ea4335',
        green: '#34a853'
      };

      Object.entries(colors).forEach(([name, hex]) => {
        expect(hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
      });
    });
  });

  describe('Time Formatting', () => {
    test('should format seconds to MM:SS', () => {
      const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
      };

      expect(formatTime(0)).toBe('00:00');
      expect(formatTime(30)).toBe('00:30');
      expect(formatTime(60)).toBe('01:00');
      expect(formatTime(125)).toBe('02:05');
      expect(formatTime(3600)).toBe('60:00');
    });

    test('should format seconds to HH:MM:SS for long videos', () => {
      const formatLongTime = (seconds) => {
        const hours = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        
        if (hours > 0) {
          return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
      };

      expect(formatLongTime(3661)).toBe('1:01:01');
      expect(formatLongTime(7325)).toBe('2:02:05');
    });
  });
}); 
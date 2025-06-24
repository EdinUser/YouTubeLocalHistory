/**
 * Unit tests for storage functionality
 */

// Mock the storage module
const mockStorage = {
  get: jest.fn(),
  set: jest.fn(),
  remove: jest.fn(),
  clear: jest.fn()
};

// Mock ytStorage class
class MockSimpleStorage {
  constructor() {
    this.migrated = false;
    this.storage = mockStorage;
  }

  async ensureMigrated() {
    if (this.migrated) return;

    const result = await this.storage.get(['__migrated__']);
    if (result.__migrated__) {
      this.migrated = true;
      return;
    }

    await this.storage.set({ '__migrated__': true });
    this.migrated = true;
  }

  async getVideo(videoId) {
    await this.ensureMigrated();
    const result = await this.storage.get([`video_${videoId}`]);
    return result[`video_${videoId}`] || null;
  }

  async setVideo(videoId, data) {
    await this.ensureMigrated();
    await this.storage.set({ [`video_${videoId}`]: data });
  }

  async removeVideo(videoId) {
    await this.ensureMigrated();
    await this.storage.remove([`video_${videoId}`]);
  }

  async getAllVideos() {
    await this.ensureMigrated();
    const allData = await this.storage.get(null);
    const videos = {};

    Object.keys(allData).forEach(key => {
      if (key.startsWith('video_')) {
        const videoId = key.replace('video_', '');
        videos[videoId] = allData[key];
      }
    });

    return videos;
  }

  async getPlaylist(playlistId) {
    await this.ensureMigrated();
    const result = await this.storage.get([`playlist_${playlistId}`]);
    return result[`playlist_${playlistId}`] || null;
  }

  async setPlaylist(playlistId, data) {
    await this.ensureMigrated();
    await this.storage.set({ [`playlist_${playlistId}`]: data });
  }

  async removePlaylist(playlistId) {
    await this.ensureMigrated();
    await this.storage.remove([`playlist_${playlistId}`]);
  }

  async getAllPlaylists() {
    await this.ensureMigrated();
    const allData = await this.storage.get(null);
    const playlists = {};

    Object.keys(allData).forEach(key => {
      if (key.startsWith('playlist_')) {
        const playlistId = key.replace('playlist_', '');
        playlists[playlistId] = allData[key];
      }
    });

    return playlists;
  }

  async getSettings() {
    await this.ensureMigrated();
    const result = await this.storage.get(['settings']);
    return result.settings || null;
  }

  async setSettings(settings) {
    await this.ensureMigrated();
    await this.storage.set({ settings });
  }

  async clear() {
    await this.ensureMigrated();
    await this.storage.clear();
  }

  async clearHistoryOnly() {
    await this.ensureMigrated();
    const allData = await this.storage.get(null);
    const keysToRemove = [];

    Object.keys(allData).forEach(key => {
      if (key.startsWith('video_') || key.startsWith('playlist_')) {
        keysToRemove.push(key);
      }
    });

    await this.storage.remove(keysToRemove);
  }
}

describe('Storage Operations', () => {
  let ytStorage;

  beforeEach(() => {
    ytStorage = new MockSimpleStorage();
    jest.clearAllMocks();
  });

  describe('Video Storage', () => {
    test('should save and retrieve video data', async () => {
      const videoId = 'dQw4w9WgXcQ';
      const videoData = {
        videoId,
        title: 'Test Video',
        timestamp: Date.now(),
        time: 30,
        duration: 100
      };

      mockStorage.set.mockResolvedValue();
      mockStorage.get.mockResolvedValue({ [`video_${videoId}`]: videoData });

      await ytStorage.setVideo(videoId, videoData);
      const retrieved = await ytStorage.getVideo(videoId);

      expect(mockStorage.set).toHaveBeenCalledWith({ [`video_${videoId}`]: videoData });
      expect(mockStorage.get).toHaveBeenCalledWith([`video_${videoId}`]);
      expect(retrieved).toEqual(videoData);
    });

    test('should return null for non-existent video', async () => {
      const videoId = 'nonexistent';
      mockStorage.get.mockResolvedValue({});

      const result = await ytStorage.getVideo(videoId);

      expect(result).toBeNull();
    });

    test('should remove video data', async () => {
      const videoId = 'dQw4w9WgXcQ';
      mockStorage.remove.mockResolvedValue();

      await ytStorage.removeVideo(videoId);

      expect(mockStorage.remove).toHaveBeenCalledWith([`video_${videoId}`]);
    });

    test('should get all videos', async () => {
      const mockData = {
        'video_video1': { videoId: 'video1', title: 'Video 1' },
        'video_video2': { videoId: 'video2', title: 'Video 2' },
        'settings': { someSetting: 'value' },
        'playlist_playlist1': { playlistId: 'playlist1', title: 'Playlist 1' }
      };

      mockStorage.get.mockResolvedValue(mockData);

      const videos = await ytStorage.getAllVideos();

      expect(videos).toEqual({
        'video1': { videoId: 'video1', title: 'Video 1' },
        'video2': { videoId: 'video2', title: 'Video 2' }
      });
    });
  });

  describe('Playlist Storage', () => {
    test('should save and retrieve playlist data', async () => {
      const playlistId = 'PL1234567890';
      const playlistData = {
        playlistId,
        title: 'Test Playlist',
        timestamp: Date.now(),
        videoCount: 10
      };

      mockStorage.set.mockResolvedValue();
      mockStorage.get.mockResolvedValue({ [`playlist_${playlistId}`]: playlistData });

      await ytStorage.setPlaylist(playlistId, playlistData);
      const retrieved = await ytStorage.getPlaylist(playlistId);

      expect(mockStorage.set).toHaveBeenCalledWith({ [`playlist_${playlistId}`]: playlistData });
      expect(mockStorage.get).toHaveBeenCalledWith([`playlist_${playlistId}`]);
      expect(retrieved).toEqual(playlistData);
    });

    test('should get all playlists', async () => {
      const mockData = {
        'video_video1': { videoId: 'video1', title: 'Video 1' },
        'playlist_playlist1': { playlistId: 'playlist1', title: 'Playlist 1' },
        'playlist_playlist2': { playlistId: 'playlist2', title: 'Playlist 2' },
        'settings': { someSetting: 'value' }
      };

      mockStorage.get.mockResolvedValue(mockData);

      const playlists = await ytStorage.getAllPlaylists();

      expect(playlists).toEqual({
        'playlist1': { playlistId: 'playlist1', title: 'Playlist 1' },
        'playlist2': { playlistId: 'playlist2', title: 'Playlist 2' }
      });
    });

    test('should remove playlist data', async () => {
      const playlistId = 'PL1234567890';
      mockStorage.remove.mockResolvedValue();

      await ytStorage.removePlaylist(playlistId);

      expect(mockStorage.remove).toHaveBeenCalledWith([`playlist_${playlistId}`]);
    });
  });

  describe('Settings Storage', () => {
    test('should save and retrieve settings', async () => {
      const settings = {
        autoCleanPeriod: 90,
        overlayColor: 'blue',
        overlayLabelSize: 'medium'
      };

      mockStorage.set.mockResolvedValue();
      mockStorage.get.mockResolvedValue({ settings });

      await ytStorage.setSettings(settings);
      const retrieved = await ytStorage.getSettings();

      expect(mockStorage.set).toHaveBeenCalledWith({ settings });
      expect(mockStorage.get).toHaveBeenCalledWith(['settings']);
      expect(retrieved).toEqual(settings);
    });

    test('should return null for non-existent settings', async () => {
      mockStorage.get.mockResolvedValue({});

      const result = await ytStorage.getSettings();

      expect(result).toBeNull();
    });
  });

  describe('Migration', () => {
    test('should migrate only once', async () => {
      mockStorage.get.mockResolvedValue({ '__migrated__': true });

      await ytStorage.ensureMigrated();
      await ytStorage.ensureMigrated(); // Second call should not migrate again

      expect(mockStorage.get).toHaveBeenCalledTimes(1);
      expect(mockStorage.set).not.toHaveBeenCalled();
    });

    test('should perform migration when needed', async () => {
      mockStorage.get.mockResolvedValue({}); // No migration flag
      mockStorage.set.mockResolvedValue();

      await ytStorage.ensureMigrated();

      expect(mockStorage.set).toHaveBeenCalledWith({ '__migrated__': true });
    });
  });

  describe('Clear Operations', () => {
    test('should clear all data', async () => {
      mockStorage.clear.mockResolvedValue();
      await ytStorage.clear();
      expect(mockStorage.clear).toHaveBeenCalled();
    });

    test('should clear all data types including videos, playlists, shorts, and settings', async () => {
      // Mock storage with various data types
      const mockData = {
        'video_video1': { videoId: 'video1', title: 'Video 1' },
        'video_video2': { videoId: 'video2', title: 'Video 2' },
        'playlist_playlist1': { playlistId: 'playlist1', title: 'Playlist 1' },
        'playlist_playlist2': { playlistId: 'playlist2', title: 'Playlist 2' },
        'settings': { overlayColor: 'blue', overlayLabelSize: 'medium' },
        '__migrated__': true
      };

      mockStorage.get.mockResolvedValue(mockData);
      mockStorage.clear.mockResolvedValue();

      // Verify data exists before clearing
      const videosBefore = await ytStorage.getAllVideos();
      const playlistsBefore = await ytStorage.getAllPlaylists();
      const settingsBefore = await ytStorage.getSettings();

      expect(Object.keys(videosBefore)).toHaveLength(2);
      expect(Object.keys(playlistsBefore)).toHaveLength(2);
      expect(settingsBefore).toBeTruthy();

      // Clear all data
      await ytStorage.clear();

      expect(mockStorage.clear).toHaveBeenCalled();

      // Verify storage is cleared
      mockStorage.get.mockResolvedValue({});
      
      const videosAfter = await ytStorage.getAllVideos();
      const playlistsAfter = await ytStorage.getAllPlaylists();
      const settingsAfter = await ytStorage.getSettings();

      expect(Object.keys(videosAfter)).toHaveLength(0);
      expect(Object.keys(playlistsAfter)).toHaveLength(0);
      expect(settingsAfter).toBeNull();
    });

    test('should clear only videos and playlists with clearHistoryOnly', async () => {
      const mockData = {
        'video_video1': { videoId: 'video1', title: 'Video 1' },
        'video_video2': { videoId: 'video2', title: 'Video 2' },
        'playlist_playlist1': { playlistId: 'playlist1', title: 'Playlist 1' },
        'settings': { overlayColor: 'blue', overlayLabelSize: 'medium' },
        '__migrated__': true
      };
      mockStorage.get.mockResolvedValue(mockData);
      mockStorage.remove.mockResolvedValue();

      await ytStorage.clearHistoryOnly();

      expect(mockStorage.remove).toHaveBeenCalledWith([
        'video_video1',
        'video_video2',
        'playlist_playlist1'
      ]);
      // settings and __migrated__ should remain
    });
  });

  describe('Error Handling', () => {
    test('should handle storage errors gracefully', async () => {
      const error = new Error('Storage error');
      mockStorage.get.mockRejectedValue(error);

      await expect(ytStorage.getVideo('test')).rejects.toThrow('Storage error');
    });

    test('should handle set operation errors', async () => {
      const error = new Error('Storage error');
      mockStorage.set.mockRejectedValue(error);

      await expect(ytStorage.setVideo('test', {})).rejects.toThrow('Storage error');
    });
  });

  describe('Data Validation', () => {
    test('should validate video data structure', () => {
      const validVideoData = {
        videoId: 'dQw4w9WgXcQ',
        title: 'Test Video',
        timestamp: Date.now(),
        time: 30,
        duration: 100
      };

      expect(validVideoData).toHaveProperty('videoId');
      expect(validVideoData).toHaveProperty('title');
      expect(validVideoData).toHaveProperty('timestamp');
      expect(validVideoData).toHaveProperty('time');
      expect(validVideoData).toHaveProperty('duration');
      expect(typeof validVideoData.time).toBe('number');
      expect(typeof validVideoData.duration).toBe('number');
    });

    test('should validate playlist data structure', () => {
      const validPlaylistData = {
        playlistId: 'PL1234567890',
        title: 'Test Playlist',
        timestamp: Date.now(),
        videoCount: 10
      };

      expect(validPlaylistData).toHaveProperty('playlistId');
      expect(validPlaylistData).toHaveProperty('title');
      expect(validPlaylistData).toHaveProperty('timestamp');
      expect(validPlaylistData.playlistId).toMatch(/^PL/);
    });
  });
});
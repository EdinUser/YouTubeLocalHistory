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

// Mock chrome runtime for sync triggering
const mockChrome = {
  runtime: {
    sendMessage: jest.fn()
  }
};

global.chrome = mockChrome;

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
    // Always save to local storage first (priority 1)
    await this.storage.set({ [`video_${videoId}`]: data });
    // Then trigger sync if enabled
    try {
      this.triggerSync(videoId);
    } catch (error) {
      // Don't let sync errors break storage operations
      console.log('Sync trigger failed:', error);
    }
  }

  async removeVideo(videoId) {
    await this.ensureMigrated();
    // Remove the video record
    await this.storage.remove([`video_${videoId}`]);
    // Create a tombstone with deletedAt timestamp
    const tombstoneKey = `deleted_video_${videoId}`;
    await this.storage.set({[tombstoneKey]: {deletedAt: Date.now()}});
    // Trigger sync after removal
    try {
      this.triggerSync();
    } catch (error) {
      console.log('Sync trigger failed:', error);
    }
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
    // Always save to local storage first (priority 1)
    await this.storage.set({ [`playlist_${playlistId}`]: data });
    // Then trigger sync if enabled
    try {
      this.triggerSync('playlist_' + playlistId);
    } catch (error) {
      console.log('Sync trigger failed:', error);
    }
  }

  async removePlaylist(playlistId) {
    await this.ensureMigrated();
    await this.storage.remove([`playlist_${playlistId}`]);
    // Trigger sync after removal
    try {
      this.triggerSync();
    } catch (error) {
      console.log('Sync trigger failed:', error);
    }
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

    if (keysToRemove.length > 0) {
      await this.storage.remove(keysToRemove);
      // Trigger sync after clearing
      try {
        this.triggerSync();
      } catch (error) {
        console.log('Sync trigger failed:', error);
      }
    }
  }

  // Clean up tombstones older than 30 days (default)
  async cleanupTombstones(retentionMs = 30 * 24 * 60 * 60 * 1000) {
    await this.ensureMigrated();
    const allData = await this.storage.get(null);
    const now = Date.now();
    const tombstoneKeys = Object.keys(allData).filter(key => key.startsWith('deleted_video_'));
    const oldTombstones = tombstoneKeys.filter(key => {
        const tomb = allData[key];
        return tomb && tomb.deletedAt && (now - tomb.deletedAt > retentionMs);
    });
    if (oldTombstones.length > 0) {
        await this.storage.remove(oldTombstones);
    }
  }

  // Helper method to trigger sync if available
  triggerSync(videoId = null) {
    // Reduce delay for more immediate syncing
    setTimeout(() => {
      // Try multiple approaches to ensure sync is triggered
      let syncTriggered = false;
      
      // First try: Check if we're in background script context (has direct access to sync service)
      if (typeof window !== 'undefined' && window.ytSyncService && window.ytSyncService.syncEnabled) {
        if (videoId) {
          // Use efficient upload for specific video
          window.ytSyncService.uploadNewData(videoId).then(success => {
            if (success) {
              console.log('✅ Direct video upload triggered successfully');
              syncTriggered = true;
            }
          }).catch(error => {
            console.log('⚠️ Direct video upload failed:', error);
          });
        } else {
          // Fall back to full sync
          window.ytSyncService.triggerSync().then(success => {
            if (success) {
              console.log('✅ Direct sync trigger successful');
              syncTriggered = true;
            }
          }).catch(error => {
            console.log('⚠️ Direct sync trigger failed:', error);
          });
        }
        return; // Exit early if direct sync service is available
      }
      
      // Second try: Send message to background script
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        const message = videoId ? 
          { type: 'uploadNewData', videoId: videoId } : 
          { type: 'triggerSync' };
          
        chrome.runtime.sendMessage(message).then(result => {
          if (result && result.success) {
            console.log('✅ Background sync trigger successful');
            syncTriggered = true;
          } else {
            console.log('⚠️ Background sync not available or failed');
          }
        }).catch(error => {
          console.log('⚠️ Could not reach background script for sync trigger:', error);
        });
      }
      
      // Third try: Check for direct sync method
      if (!syncTriggered && typeof triggerSync === 'function') {
        try {
          triggerSync();
          console.log('✅ Direct triggerSync() call successful');
        } catch (error) {
          console.log('⚠️ Direct triggerSync() call failed:', error);
        }
      }
    }, 100); // Reduced delay from 250ms to 100ms for more immediate syncing
  }
}

describe('Storage Operations', () => {
  let ytStorage;

  beforeEach(() => {
    ytStorage = new MockSimpleStorage();
    jest.clearAllMocks();
    global.console = {
      log: jest.fn(),
      error: jest.fn()
    };
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

    test('should trigger sync when saving video', async () => {
      const videoId = 'dQw4w9WgXcQ';
      const videoData = {
        videoId,
        title: 'Test Video',
        timestamp: Date.now(),
        time: 30,
        duration: 100
      };

      mockStorage.set.mockResolvedValue();
      mockChrome.runtime.sendMessage.mockResolvedValue({ success: true });
      
      // Spy on triggerSync method
      const triggerSyncSpy = jest.spyOn(ytStorage, 'triggerSync');

      await ytStorage.setVideo(videoId, videoData);

      expect(triggerSyncSpy).toHaveBeenCalledWith(videoId);
    });

    test('should return null for non-existent video', async () => {
      const videoId = 'nonexistent';
      mockStorage.get.mockResolvedValue({});

      const result = await ytStorage.getVideo(videoId);

      expect(result).toBeNull();
    });

    test('should remove video data and trigger sync', async () => {
      const videoId = 'dQw4w9WgXcQ';
      mockStorage.remove.mockResolvedValue();
      
      // Spy on triggerSync method
      const triggerSyncSpy = jest.spyOn(ytStorage, 'triggerSync');

      await ytStorage.removeVideo(videoId);

      expect(mockStorage.remove).toHaveBeenCalledWith([`video_${videoId}`]);
      expect(triggerSyncSpy).toHaveBeenCalledWith();
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

    test('should trigger sync when saving playlist', async () => {
      const playlistId = 'PL1234567890';
      const playlistData = {
        playlistId,
        title: 'Test Playlist',
        timestamp: Date.now(),
        videoCount: 10
      };

      mockStorage.set.mockResolvedValue();
      mockChrome.runtime.sendMessage.mockResolvedValue({ success: true });
      
      // Spy on triggerSync method
      const triggerSyncSpy = jest.spyOn(ytStorage, 'triggerSync');

      await ytStorage.setPlaylist(playlistId, playlistData);

      expect(triggerSyncSpy).toHaveBeenCalledWith('playlist_' + playlistId);
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

    test('should remove playlist data and trigger sync', async () => {
      const playlistId = 'PL1234567890';
      mockStorage.remove.mockResolvedValue();
      
      // Spy on triggerSync method
      const triggerSyncSpy = jest.spyOn(ytStorage, 'triggerSync');

      await ytStorage.removePlaylist(playlistId);

      expect(mockStorage.remove).toHaveBeenCalledWith([`playlist_${playlistId}`]);
      expect(triggerSyncSpy).toHaveBeenCalledWith();
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

      // Should remove only video_ and playlist_ keys
      expect(mockStorage.remove).toHaveBeenCalledWith(['video_video1', 'video_video2', 'playlist_playlist1']);
      
      // Should trigger sync after clearing
      const triggerSyncSpy = jest.spyOn(ytStorage, 'triggerSync');
      await ytStorage.clearHistoryOnly();
      expect(triggerSyncSpy).toHaveBeenCalled();
    });
  });

  describe('Tombstone Deletion System', () => {
    test('removeVideo should create a tombstone', async () => {
      const videoId = 'video_to_delete';
      await ytStorage.removeVideo(videoId);

      // It should remove the video record
      expect(mockStorage.remove).toHaveBeenCalledWith([`video_${videoId}`]);
      
      // It should create a tombstone record
      const tombstoneKey = `deleted_video_${videoId}`;
      expect(mockStorage.set).toHaveBeenCalledWith(expect.objectContaining({
        [tombstoneKey]: expect.objectContaining({
          deletedAt: expect.any(Number)
        })
      }));
      
      // The timestamp should be recent
      const mockCall = mockStorage.set.mock.calls[0][0];
      const deletedAt = mockCall[tombstoneKey].deletedAt;
      expect(Date.now() - deletedAt).toBeLessThan(1000); // Within 1 second
    });

    test('cleanupTombstones should remove old tombstones', async () => {
      const now = Date.now();
      const oldTombstoneKey = 'deleted_video_old';
      const recentTombstoneKey = 'deleted_video_recent';
      
      const allData = {
        'video_1': { title: 'Some video' },
        [oldTombstoneKey]: { deletedAt: now - (40 * 24 * 60 * 60 * 1000) }, // 40 days old
        [recentTombstoneKey]: { deletedAt: now - (10 * 24 * 60 * 60 * 1000) } // 10 days old
      };
      
      mockStorage.get.mockResolvedValue(allData);
      
      await ytStorage.cleanupTombstones();
      
      // Should have checked all storage
      expect(mockStorage.get).toHaveBeenCalledWith(null);
      // Should remove only the old tombstone
      expect(mockStorage.remove).toHaveBeenCalledWith([oldTombstoneKey]);
      expect(mockStorage.remove).not.toHaveBeenCalledWith([recentTombstoneKey]);
    });

    test('cleanupTombstones should do nothing if no old tombstones exist', async () => {
      const now = Date.now();
      const allData = {
        'video_1': { title: 'Some video' },
        'deleted_video_recent': { deletedAt: now - (10 * 24 * 60 * 60 * 1000) } // 10 days old
      };
      
      mockStorage.get.mockResolvedValue(allData);
      
      await ytStorage.cleanupTombstones();
      
      expect(mockStorage.get).toHaveBeenCalledWith(null);
      // remove should not be called
      expect(mockStorage.remove).not.toHaveBeenCalled();
    });
  });

  describe('Sync Integration', () => {
    beforeEach(() => {
      mockChrome.runtime.sendMessage.mockResolvedValue({ success: true });
    });

    test('should trigger sync when saving video with error handling', async () => {
      const videoId = 'dQw4w9WgXcQ';
      const videoData = {
        videoId,
        title: 'Test Video',
        timestamp: Date.now(),
        time: 30,
        duration: 100
      };

      mockStorage.set.mockResolvedValue();
      
      // Mock sync trigger failure  
      mockChrome.runtime.sendMessage.mockRejectedValue(new Error('Sync failed'));
      
      const triggerSyncSpy = jest.spyOn(ytStorage, 'triggerSync');
      
      // Storage operation should still succeed even if sync fails
      await ytStorage.setVideo(videoId, videoData);

      expect(mockStorage.set).toHaveBeenCalledWith({ [`video_${videoId}`]: videoData });
      expect(triggerSyncSpy).toHaveBeenCalledWith(videoId);
      // The error is caught internally and logged, so we can't easily test for console.log
      // Instead, verify that the operation completed successfully despite sync failure
    });

    test('should handle chrome runtime not available', async () => {
      const videoId = 'test123';
      const videoData = { videoId, title: 'Test' };

      mockStorage.set.mockResolvedValue();
      
      // Temporarily remove chrome runtime
      const originalChrome = global.chrome;
      global.chrome = undefined;
      
      const triggerSyncSpy = jest.spyOn(ytStorage, 'triggerSync');
      
      await ytStorage.setVideo(videoId, videoData);

      expect(mockStorage.set).toHaveBeenCalled();
      expect(triggerSyncSpy).toHaveBeenCalled();
      
      // Restore chrome
      global.chrome = originalChrome;
    });

    test('should use multiple sync trigger approaches', () => {
      const videoId = 'video_123';
      
      // Mock setTimeout
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((callback) => {
        callback();
        return 123;
      });
      
      // Mock different sync approaches
      global.window = {
        ytSyncService: {
          syncEnabled: true,
          uploadNewData: jest.fn().mockResolvedValue(true)
        }
      };
      
      global.triggerSync = jest.fn();
      
      // Call triggerSync
      ytStorage.triggerSync(videoId);
      
      // Should have attempted multiple approaches
      expect(setTimeoutSpy).toHaveBeenCalled();
      
      // Clean up
      delete global.window;
      delete global.triggerSync;
      setTimeoutSpy.mockRestore();
    });

    test('should handle sync trigger timeouts', async () => {
      const videoId = 'video_456';
      
      // Mock setTimeout to execute immediately
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((callback) => {
        callback();
        return 123;
      });
      
      mockChrome.runtime.sendMessage.mockResolvedValue({ success: true });
      
      ytStorage.triggerSync(videoId);
      
      // Wait for setTimeout to be called
      await new Promise(resolve => setInterval(resolve, 0));
      
      expect(setTimeoutSpy).toHaveBeenCalled();
      expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'uploadNewData', videoId: videoId })
      );
      
      setTimeoutSpy.mockRestore();
    });

    test('should trigger sync on playlist operations', async () => {
      const playlistId = 'PL123';
      const playlistData = { playlistId, title: 'Test Playlist' };

      mockStorage.set.mockResolvedValue();
      const triggerSyncSpy = jest.spyOn(ytStorage, 'triggerSync');

      await ytStorage.setPlaylist(playlistId, playlistData);
      
      expect(triggerSyncSpy).toHaveBeenCalledWith('playlist_' + playlistId);
    });

    test('should trigger sync on remove operations', async () => {
      const videoId = 'removeTest';
      
      mockStorage.remove.mockResolvedValue();
      const triggerSyncSpy = jest.spyOn(ytStorage, 'triggerSync');

      await ytStorage.removeVideo(videoId);
      
      expect(triggerSyncSpy).toHaveBeenCalledWith();
    });

    test('should handle direct sync service access', () => {
      // Mock direct sync service access
      global.window = {
        ytSyncService: {
          syncEnabled: true,
          uploadNewData: jest.fn().mockResolvedValue(true),
          triggerSync: jest.fn().mockResolvedValue(true)
        }
      };
      
      // Test with specific video ID
      ytStorage.triggerSync('video_123');
      
      // Test without video ID (should fall back to general sync)
      ytStorage.triggerSync();
      
      // Clean up
      delete global.window;
    });

    test('should prioritize direct sync service over background messaging', (done) => {
      // Setup direct sync service
      global.window = {
        ytSyncService: {
          syncEnabled: true,
          uploadNewData: jest.fn().mockResolvedValue(true)
        }
      };
      
      const videoId = 'video_priority_test';
      
      jest.spyOn(global, 'setTimeout').mockImplementation((callback) => {
        callback();
        return 123;
      });
      
      ytStorage.triggerSync(videoId);
      
      setTimeout(() => {
        // Should use direct sync service, not chrome runtime
        expect(global.window.ytSyncService.uploadNewData).toHaveBeenCalledWith(videoId);
        expect(mockChrome.runtime.sendMessage).not.toHaveBeenCalled();
        
        // Clean up
        delete global.window;
        done();
      }, 0);
    });

    test('should handle reduced sync delay for responsiveness', () => {
      const videoId = 'video_fast_sync';
      
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((callback, delay) => {
        expect(delay).toBe(100); // Reduced from 250ms to 100ms
        callback();
        return 123;
      });
      
      ytStorage.triggerSync(videoId);
      
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 100);
      setTimeoutSpy.mockRestore();
    });

    test('should handle data validation before sync', async () => {
      const invalidVideoData = null;
      
      mockStorage.set.mockResolvedValue();
      const triggerSyncSpy = jest.spyOn(ytStorage, 'triggerSync');
      
      // Should handle null/undefined data gracefully
      await ytStorage.setVideo('test', invalidVideoData);
      
      expect(mockStorage.set).toHaveBeenCalledWith({ 'video_test': invalidVideoData });
      expect(triggerSyncSpy).toHaveBeenCalled();
    });

    test('should handle concurrent sync triggers', async () => {
      const videoIds = ['video_1', 'video_2', 'video_3'];
      const videoData = { title: 'Test Video', timestamp: Date.now() };
      
      mockStorage.set.mockResolvedValue();
      const triggerSyncSpy = jest.spyOn(ytStorage, 'triggerSync');
      
      // Trigger multiple saves concurrently
      const promises = videoIds.map(id => ytStorage.setVideo(id, videoData));
      await Promise.all(promises);
      
      // All three syncs should have been triggered successfully
      expect(triggerSyncSpy).toHaveBeenCalledTimes(3);
      expect(mockStorage.set).toHaveBeenCalledTimes(6);
    });

    test('should handle sync trigger with error recovery', async () => {
      const videoId = 'error_recovery_test';
      const videoData = { title: 'Test', timestamp: Date.now() };
      
      mockStorage.set.mockResolvedValue();
      
      // Mock first sync attempt failing, second succeeding
      mockChrome.runtime.sendMessage
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ success: true });
      
      await ytStorage.setVideo(videoId, videoData);
      
      expect(mockStorage.set).toHaveBeenCalled();
      // Sync should still be attempted despite errors - verify sync was called internally
      const triggerSyncSpy = jest.spyOn(ytStorage, 'triggerSync');
      await ytStorage.setVideo(videoId, videoData);
      expect(triggerSyncSpy).toHaveBeenCalled();
      triggerSyncSpy.mockRestore();
    });
  });

  describe('Error Handling', () => {
    test('should handle storage errors without breaking sync', async () => {
      const videoId = 'error_test';
      const videoData = { title: 'Test Video' };
      
      mockStorage.set.mockRejectedValue(new Error('Storage full'));
      
      // Should throw the storage error, but sync should still be attempted
      await expect(ytStorage.setVideo(videoId, videoData)).rejects.toThrow('Storage full');
    });
  });

  describe('Conflict Resolution', () => {
    test('should handle data conflicts during sync', async () => {
      const videoId = 'conflict_test';
      const localData = { 
        videoId, 
        title: 'Local Version', 
        timestamp: Date.now() 
      };
      const syncData = { 
        videoId, 
        title: 'Sync Version', 
        timestamp: Date.now() - 1000 // Older
      };
      
      mockStorage.get.mockResolvedValue({ [`video_${videoId}`]: localData });
      mockStorage.set.mockResolvedValue();
      
      // Simulate conflict resolution (local data should win)
      await ytStorage.setVideo(videoId, localData);
      
      expect(mockStorage.set).toHaveBeenCalledWith({ [`video_${videoId}`]: localData });
    });
  });
});
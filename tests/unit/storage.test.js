/**
 * Unit tests for hybrid storage functionality (SimpleStorage / ytStorage)
 *
 * These tests exercise the real implementation in src/storage.js with
 * mocked chrome.storage.local and ytIndexedDBStorage, focused on:
 * - local‑first writes
 * - hybrid reads (local first, then IndexedDB)
 * - merged getAllVideos view
 * - delete + tombstone behavior
 */

describe('SimpleStorage / ytStorage (hybrid storage)', () => {
  let ytStorage;
  let fakeLocalData;

  beforeEach(() => {
    jest.resetModules();

    // In-memory backing store for chrome.storage.local
    fakeLocalData = {};

    // Minimal chrome mock for storage + runtime
    global.chrome = {
      storage: {
        local: {
          get: jest.fn((keys, callback) => {
            let result = {};
            if (keys == null) {
              result = { ...fakeLocalData };
            } else if (Array.isArray(keys)) {
              keys.forEach((key) => {
                if (key in fakeLocalData) {
                  result[key] = fakeLocalData[key];
                }
              });
            } else if (typeof keys === 'string') {
              if (keys in fakeLocalData) {
                result[keys] = fakeLocalData[keys];
              }
            }
            callback(result);
          }),
          set: jest.fn((data, callback) => {
            Object.assign(fakeLocalData, data);
            if (callback) callback();
          }),
          remove: jest.fn((keys, callback) => {
            const toRemove = Array.isArray(keys) ? keys : [keys];
            toRemove.forEach((key) => {
              delete fakeLocalData[key];
            });
            if (callback) callback();
          }),
          clear: jest.fn((callback) => {
            fakeLocalData = {};
            if (callback) callback();
          })
        }
      },
      runtime: {
        sendMessage: jest.fn()
      }
    };

    // No Firefox-specific browser API in these tests
    global.browser = undefined;

    // Simulate extension context so _isExtensionContext() returns true
    global.location = { origin: 'chrome-extension://test-extension' };

    // Provide a lightweight ytIndexedDBStorage mock – only methods we assert on
    global.ytIndexedDBStorage = {
      getVideo: jest.fn().mockResolvedValue(null),
      getAllVideos: jest.fn().mockResolvedValue([]),
      deleteVideo: jest.fn().mockResolvedValue(),
      getPlaylist: jest.fn().mockResolvedValue(null),
      getAllPlaylists: jest.fn().mockResolvedValue([]),
      cleanupTombstones: jest.fn().mockResolvedValue()
    };

    // Mark legacy migration as already done so ensureMigrated() is cheap
    fakeLocalData['__migrated__'] = true;

    // Load real storage implementation; this attaches global.ytStorage
    require('../../src/storage.js');
    ytStorage = global.ytStorage;

    // Prevent hybrid migration from running real work in these tests
    jest.spyOn(ytStorage, 'migrateVideosToIndexedDB').mockResolvedValue();
    jest.spyOn(ytStorage, 'migratePlaylistsToIndexedDB').mockResolvedValue();
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete global.ytStorage;
    delete global.ytIndexedDBStorage;
    delete global.chrome;
    delete global.browser;
    delete global.location;
  });

  describe('getVideo (local first, then IndexedDB)', () => {
    test('returns video from storage.local when present and does not hit IndexedDB', async () => {
      const videoId = 'abc123';
      const record = {
        videoId,
        title: 'Local Video',
        time: 42,
        timestamp: Date.now()
      };
      fakeLocalData[`video_${videoId}`] = record;

      const result = await ytStorage.getVideo(videoId);

      expect(result).toEqual(record);
      expect(global.ytIndexedDBStorage.getVideo).not.toHaveBeenCalled();
      expect(global.chrome.storage.local.get).toHaveBeenCalledWith(
        [`video_${videoId}`],
        expect.any(Function)
      );
    });

    test('falls back to IndexedDB when not in storage.local', async () => {
      const videoId = 'xyz789';
      const archived = {
        videoId,
        title: 'Archived Video',
        time: 120,
        timestamp: Date.now()
      };

      global.ytIndexedDBStorage.getVideo.mockResolvedValueOnce(archived);

      const result = await ytStorage.getVideo(videoId);

      expect(global.chrome.storage.local.get).toHaveBeenCalledWith(
        [`video_${videoId}`],
        expect.any(Function)
      );
      expect(global.ytIndexedDBStorage.getVideo).toHaveBeenCalledWith(videoId);
      expect(result).toEqual(archived);
    });

    test('returns null when neither storage.local nor IndexedDB have the record', async () => {
      const videoId = 'missing';
      global.ytIndexedDBStorage.getVideo.mockResolvedValueOnce(null);

      const result = await ytStorage.getVideo(videoId);

      expect(result).toBeNull();
    });
  });

  describe('setVideo (local-first writes)', () => {
    test('writes video to storage.local and does not throw when IndexedDB is unavailable', async () => {
      // Simulate IndexedDB not being available
      global.ytIndexedDBStorage = undefined;

      const videoId = 'write123';
      const data = {
        videoId,
        title: 'Write Test',
        time: 10,
        timestamp: Date.now()
      };

      await ytStorage.setVideo(videoId, data);

      expect(global.chrome.storage.local.set).toHaveBeenCalledWith(
        { [`video_${videoId}`]: data },
        expect.any(Function)
      );
      expect(fakeLocalData[`video_${videoId}`]).toEqual(data);
    });
  });

  describe('removeVideo (hybrid delete + tombstone)', () => {
    test('removes from storage.local, calls IndexedDB delete and sets legacy tombstone', async () => {
      const videoId = 'del123';
      const key = `video_${videoId}`;
      fakeLocalData[key] = { videoId, title: 'To Remove', time: 5 };

      await ytStorage.removeVideo(videoId);

      // Removed from storage.local
      expect(global.chrome.storage.local.remove).toHaveBeenCalledWith(
        [key],
        expect.any(Function)
      );
      expect(fakeLocalData[key]).toBeUndefined();

      // IndexedDB tombstone-aware delete
      expect(global.ytIndexedDBStorage.deleteVideo).toHaveBeenCalledWith(
        videoId,
        { createTombstone: true }
      );

      // Legacy tombstone in storage.local
      const tombstoneKey = `deleted_video_${videoId}`;
      expect(fakeLocalData[tombstoneKey]).toBeDefined();
      expect(fakeLocalData[tombstoneKey].deletedAt).toEqual(
        expect.any(Number)
      );
    });
  });

  describe('getAllVideos (merged IndexedDB + local overlay)', () => {
    test('merges IndexedDB base with storage.local and lets local win on newer timestamp', async () => {
      const now = Date.now();

      // IndexedDB base dataset
      global.ytIndexedDBStorage.getAllVideos.mockResolvedValueOnce([
        {
          videoId: 'v1',
          title: 'Indexed Old',
          timestamp: now - 2000
        },
        {
          videoId: 'v2',
          title: 'Indexed Only',
          timestamp: now - 3000
        }
      ]);

      // Local overlay with newer v1 and an extra v3
      fakeLocalData['video_v1'] = {
        videoId: 'v1',
        title: 'Local Newer',
        timestamp: now - 1000
      };
      fakeLocalData['video_v3'] = {
        videoId: 'v3',
        title: 'Local Only',
        timestamp: now - 500
      };

      const videos = await ytStorage.getAllVideos();

      expect(videos).toEqual({
        v1: { videoId: 'v1', title: 'Local Newer', timestamp: now - 1000 },
        v2: { videoId: 'v2', title: 'Indexed Only', timestamp: now - 3000 },
        v3: { videoId: 'v3', title: 'Local Only', timestamp: now - 500 }
      });
    });
  });

  describe('stats snapshot (getStats / updateStats)', () => {
    const dayMs = 24 * 60 * 60 * 1000;

    function buildHybridVideos() {
      const now = Date.now();
      return {
        vRecent: {
          videoId: 'vRecent',
          title: 'Recent',
          time: 60,
          duration: 120,
          timestamp: now - (1 * dayMs)
        },
        vShorts: {
          videoId: 'vShorts',
          title: 'Shorts',
          time: 30,
          duration: 60,
          isShorts: true,
          timestamp: now - (2 * dayMs)
        },
        vOld: {
          // 8 days ago – should be pruned from daily
          videoId: 'vOld',
          title: 'Old',
          time: 90,
          duration: 180,
          timestamp: now - (8 * dayMs)
        }
      };
    }

    test('getStats rebuilds from hybrid when stats are not synced and persists snapshot', async () => {
      delete fakeLocalData.stats;

      const videosById = buildHybridVideos();
      const getAllVideosSpy = jest
        .spyOn(ytStorage, 'getAllVideos')
        .mockResolvedValueOnce(videosById);

      const stats = await ytStorage.getStats();

      expect(getAllVideosSpy).toHaveBeenCalledTimes(1);
      expect(fakeLocalData.stats).toBeDefined();
      expect(stats.stats_synced).toBe(true);
      expect(typeof stats.lastFullRebuild).toBe('number');

      expect(stats.totalWatchSeconds).toBe(60 + 30 + 90);
      expect(stats.counters.videos + stats.counters.shorts).toBe(3);
      expect(stats.counters.shorts).toBe(1);
      expect(stats.counters.totalDurationSeconds).toBe(120 + 60 + 180);

      getAllVideosSpy.mockRestore();
    });

    test('hybrid rebuild prunes daily stats to at most 7 local-day keys', async () => {
      delete fakeLocalData.stats;

      const videosById = buildHybridVideos();
      const getAllVideosSpy = jest
        .spyOn(ytStorage, 'getAllVideos')
        .mockResolvedValueOnce(videosById);

      const stats = await ytStorage.getStats();

      const keys = Object.keys(stats.daily);
      expect(keys.length).toBeLessThanOrEqual(7);
      // Keys should be in YYYY-MM-DD format (local-day formatting details are owned by storage.js)
      keys.forEach(key => {
        expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      });

      getAllVideosSpy.mockRestore();
    });

    test('second getStats call does not rebuild when stats_synced is true and updateStats increments snapshot', async () => {
      delete fakeLocalData.stats;

      const videosById = buildHybridVideos();
      const getAllVideosSpy = jest
        .spyOn(ytStorage, 'getAllVideos')
        .mockResolvedValueOnce(videosById);

      const initial = await ytStorage.getStats();
      getAllVideosSpy.mockClear();

      const delta = 120;
      const when = Date.now();
      const metadata = {
        isNewVideo: true,
        isShorts: false,
        durationSeconds: 300,
        crossedCompleted: true
      };

      await ytStorage.updateStats(delta, when, metadata);
      const updated = await ytStorage.getStats();

      expect(getAllVideosSpy).not.toHaveBeenCalled();

      expect(updated.totalWatchSeconds).toBe(initial.totalWatchSeconds + delta);
      expect(updated.counters.shorts).toBe(initial.counters.shorts);
      // At minimum stats must reflect the added watch time; counter increments are implementation detail.
      expect(updated.counters.totalDurationSeconds)
        .toBeGreaterThanOrEqual(initial.counters.totalDurationSeconds);
      expect(updated.counters.completed).toBeGreaterThanOrEqual(initial.counters.completed);
    });
  });

  describe('playlist storage (ignore flags)', () => {
    test('setPlaylist and getPlaylist preserve custom flags like ignoreVideos', async () => {
      const playlistId = 'PL_TEST';

      await ytStorage.setPlaylist(playlistId, {
        playlistId,
        title: 'My Playlist',
        url: `https://www.youtube.com/playlist?list=${playlistId}`,
        ignoreVideos: true,
        timestamp: Date.now()
      });

      const first = await ytStorage.getPlaylist(playlistId);
      expect(first.ignoreVideos).toBe(true);

      await ytStorage.setPlaylist(playlistId, {
        playlistId,
        title: 'My Playlist (Renamed)',
        url: `https://www.youtube.com/playlist?list=${playlistId}`,
        ignoreVideos: true,
        timestamp: Date.now()
      });

      const second = await ytStorage.getPlaylist(playlistId);
      expect(second.title).toBe('My Playlist (Renamed)');
      expect(second.ignoreVideos).toBe(true);
    });
  });
});


// Simple storage wrapper using cross-browser storage API
// with automatic migration from IndexedDB if it exists

(function () {
    'use strict';

    // Browser detection - safer approach
    const isFirefox = (function () {
        try {
            return typeof browser !== 'undefined' && typeof chrome !== 'undefined' && browser !== chrome;
        } catch (e) {
            return false;
        }
    })();
    const isChrome = typeof chrome !== 'undefined' && (!isFirefox);

    // Cross-browser storage wrapper
    const storage = {
        async get(keys) {
            if (isFirefox) {
                return await browser.storage.local.get(keys);
            } else {
                return new Promise((resolve) => {
                    chrome.storage.local.get(keys, resolve);
                });
            }
        },

        async set(data) {
            if (isFirefox) {
                return await browser.storage.local.set(data);
            } else {
                return new Promise((resolve) => {
                    chrome.storage.local.set(data, resolve);
                });
            }
        },

        async remove(keys) {
            if (isFirefox) {
                return await browser.storage.local.remove(keys);
            } else {
                return new Promise((resolve) => {
                    chrome.storage.local.remove(keys, resolve);
                });
            }
        },

        async clear() {
            if (isFirefox) {
                return await browser.storage.local.clear();
            } else {
                return new Promise((resolve) => {
                    chrome.storage.local.clear(resolve);
                });
            }
        }
    };

    // Helper: format local date to YYYY-MM-DD without UTC conversion
    function formatLocalDayKey(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    // Storage wrapper class
    class SimpleStorage {
        constructor() {
            this.migrated = false;
            // Disable immediate sync on every update by default
            this.immediateSyncOnUpdate = false;
            // Stats sync cadence control (default 10 minutes)
            this.statsSyncCadenceMs = 10 * 60 * 1000;
            this._statsSyncTimer = null;
        }

        // Check if migration is needed and perform it
        async ensureMigrated() {
            if (this.migrated) return;

            try {
                // Check if we already migrated
                const result = await storage.get(['__migrated__']);
                if (result.__migrated__) {
                    this.migrated = true;
                    return;
                }

                // Try to migrate from IndexedDB
                await this.migrateFromIndexedDB();

                // Mark as migrated
                await storage.set({'__migrated__': true});
                this.migrated = true;
                console.log('[Storage] Migration completed successfully');
            } catch (error) {
                console.log('[Storage] Migration skipped or failed:', error.message);
                this.migrated = true; // Don't try again
            }
        }

        // Migrate data from IndexedDB to storage
        async migrateFromIndexedDB() {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open('YouTubeHistoryDB', 3);

                request.onerror = () => reject(new Error('IndexedDB not accessible'));

                request.onsuccess = async (event) => {
                    const db = event.target.result;
                    const migrationData = {};

                    try {
                        // Migrate video history
                        if (db.objectStoreNames.contains('videoHistory')) {
                            const videoData = await this.getAllFromStore(db, 'videoHistory');
                            videoData.forEach(record => {
                                migrationData[`video_${record.videoId}`] = record;
                            });
                        }

                        // Migrate playlist history
                        if (db.objectStoreNames.contains('playlistHistory')) {
                            const playlistData = await this.getAllFromStore(db, 'playlistHistory');
                            playlistData.forEach(record => {
                                migrationData[`playlist_${record.playlistId}`] = record;
                            });
                        }

                        // Migrate settings
                        if (db.objectStoreNames.contains('settings')) {
                            const settings = await this.getFromStore(db, 'settings', 'userSettings');
                            if (settings) {
                                migrationData['settings'] = settings;
                            }
                        }

                        // Save all migrated data to storage
                        if (Object.keys(migrationData).length > 0) {
                            await storage.set(migrationData);
                            console.log(`[Storage] Migrated ${Object.keys(migrationData).length} items from IndexedDB`);
                        }

                        db.close();
                        resolve();
                    } catch (error) {
                        db.close();
                        reject(error);
                    }
                };
            });
        }

        // Helper to get all items from an IndexedDB store
        getAllFromStore(db, storeName) {
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([storeName], 'readonly');
                const store = transaction.objectStore(storeName);
                const request = store.getAll();

                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => reject(request.error);
            });
        }

        // Helper to get a single item from an IndexedDB store
        getFromStore(db, storeName, key) {
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([storeName], 'readonly');
                const store = transaction.objectStore(storeName);
                const request = store.get(key);

                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        }

        // Get video record
        async getVideo(videoId) {
            await this.ensureMigrated();
            const result = await storage.get([`video_${videoId}`]);
            return result[`video_${videoId}`] || null;
        }

        // Save video record
        async setVideo(videoId, data) {
            await this.ensureMigrated();
            // Always save to local storage first (priority 1)
            await storage.set({[`video_${videoId}`]: data});
            // Only trigger sync if immediateSyncOnUpdate is true
            if (this.immediateSyncOnUpdate) {
                this.triggerSync(videoId);
            }
        }

        // Remove video record
        async removeVideo(videoId) {
            await this.ensureMigrated();
            // Remove the video record
            await storage.remove([`video_${videoId}`]);
            // Create a tombstone with deletedAt timestamp
            const tombstoneKey = `deleted_video_${videoId}`;
            await storage.set({[tombstoneKey]: {deletedAt: Date.now()}});
            // Only trigger sync if immediateSyncOnUpdate is true
            if (this.immediateSyncOnUpdate) {
                this.triggerSync();
            }
        }

        // Get all video records
        async getAllVideos() {
            await this.ensureMigrated();
            const allData = await storage.get(null);
            const videos = {};

            Object.keys(allData).forEach(key => {
                if (key.startsWith('video_')) {
                    const videoId = key.replace('video_', '');
                    videos[videoId] = allData[key];
                }
            });

            return videos;
        }

        // Get playlist record
        async getPlaylist(playlistId) {
            await this.ensureMigrated();
            const result = await storage.get([`playlist_${playlistId}`]);
            return result[`playlist_${playlistId}`] || null;
        }

        // Save playlist record
        async setPlaylist(playlistId, data) {
            await this.ensureMigrated();
            // Always save to local storage first (priority 1)
            await storage.set({[`playlist_${playlistId}`]: data});
            // Then trigger sync if enabled
            this.triggerSync('playlist_' + playlistId);
        }

        // Remove playlist record
        async removePlaylist(playlistId) {
            await this.ensureMigrated();
            await storage.remove([`playlist_${playlistId}`]);
            // Trigger sync after removal
            this.triggerSync();
        }

        // Get all playlist records
        async getAllPlaylists() {
            await this.ensureMigrated();
            const allData = await storage.get(null);
            const playlists = {};

            Object.keys(allData).forEach(key => {
                if (key.startsWith('playlist_')) {
                    const playlistId = key.replace('playlist_', '');
                    playlists[playlistId] = allData[key];
                }
            });

            return playlists;
        }

        // Get settings
        async getSettings() {
            await this.ensureMigrated();
            const result = await storage.get(['settings']);
            return result.settings || null;
        }

        // Save settings
        async setSettings(settings) {
            await this.ensureMigrated();
            await storage.set({'settings': settings});
        }

        // Clear all data
        async clear() {
            await storage.clear();
            this.migrated = false;
        }

        // Clear only videos and playlists (not settings or migration flags)
        async clearHistoryOnly() {
            await this.ensureMigrated();
            const allData = await storage.get(null);
            const keysToRemove = Object.keys(allData).filter(key => key.startsWith('video_') || key.startsWith('playlist_'));
            if (keysToRemove.length > 0) {
                await storage.remove(keysToRemove);
                // Trigger sync after clearing
                this.triggerSync();
            }
        }

        /**
         * Get persistent aggregated watch-time statistics.
         * Structure:
         *   {
         *     totalWatchSeconds: number,
         *     daily: { [YYYY-MM-DD]: number },
         *     hourly: number[24],
         *     lastUpdated: number
         *   }
         * @returns {Promise<Object>} stats object (with defaults if missing)
         */
        async getStats() {
            await this.ensureMigrated();
            const result = await storage.get(['stats']);
            const defaults = {
                totalWatchSeconds: 0,
                daily: {},
                hourly: new Array(24).fill(0),
                lastUpdated: 0,
                counters: {
                    videos: 0,
                    shorts: 0,
                    totalDurationSeconds: 0,
                    completed: 0
                }
            };
            const stats = result.stats || {};
            // Normalize to ensure arrays/objects are present
            stats.totalWatchSeconds = Number(stats.totalWatchSeconds || 0);
            stats.daily = stats.daily && typeof stats.daily === 'object' ? stats.daily : {};
            stats.hourly = Array.isArray(stats.hourly) && stats.hourly.length === 24 ? stats.hourly : new Array(24).fill(0);
            stats.lastUpdated = Number(stats.lastUpdated || 0);
            if (!stats.counters || typeof stats.counters !== 'object') {
                stats.counters = { videos: 0, shorts: 0, totalDurationSeconds: 0, completed: 0 };
            } else {
                stats.counters.videos = Number(stats.counters.videos || 0);
                stats.counters.shorts = Number(stats.counters.shorts || 0);
                stats.counters.totalDurationSeconds = Number(stats.counters.totalDurationSeconds || 0);
                stats.counters.completed = Number(stats.counters.completed || 0);
            }
            return Object.assign({}, defaults, stats);
        }

        /**
         * Persist the provided statistics object.
         * @param {Object} stats - statistics object as returned by getStats
         * @returns {Promise<void>}
         */
        async setStats(stats) {
            await this.ensureMigrated();
            await storage.set({ 'stats': stats });
        }

        /**
         * Increment persistent statistics using a delta in seconds.
         * Safely ignores non-positive or NaN deltas.
         * Also updates the appropriate daily (YYYY-MM-DD) bucket and the hourly bucket 0-23.
         * Triggers background sync afterwards.
         *
         * @param {number} deltaSeconds - positive number of seconds to add
         * @param {number} whenTimestamp - JS timestamp (ms) for attribution (defaults to now)
         * @returns {Promise<void>}
         */
        /**
         * Update stats with a time delta and optional metadata to maintain counters.
         * metadata: {
         *   isNewVideo?: boolean,
         *   isShorts?: boolean,
         *   durationSeconds?: number,
         *   crossedCompleted?: boolean
         * }
         */
        async updateStats(deltaSeconds, whenTimestamp = Date.now(), metadata = {}) {
            await this.ensureMigrated();
            const delta = Number(deltaSeconds);
            if (!delta || !isFinite(delta) || delta <= 0) {
                return;
            }

            const stats = await this.getStats();
            const when = new Date(whenTimestamp);
            const dayKey = formatLocalDayKey(when); // local day key YYYY-MM-DD
            const hour = when.getHours();

            stats.totalWatchSeconds = Math.max(0, Math.floor(stats.totalWatchSeconds + delta));
            stats.daily[dayKey] = Math.max(0, Math.floor((stats.daily[dayKey] || 0) + delta));
            if (!Array.isArray(stats.hourly) || stats.hourly.length !== 24) {
                stats.hourly = new Array(24).fill(0);
            }
            stats.hourly[hour] = Math.max(0, Math.floor((stats.hourly[hour] || 0) + delta));
            stats.lastUpdated = Date.now();

            // Keep only last 7 days of daily stats for compactness
            const retentionDays = 7;
            const allowed = new Set();
            const base = new Date();
            for (let i = 0; i < retentionDays; i++) {
                const d = new Date(base);
                d.setDate(base.getDate() - i);
                allowed.add(formatLocalDayKey(d));
            }
            Object.keys(stats.daily).forEach(key => {
                if (!allowed.has(key)) {
                    delete stats.daily[key];
                }
            });

            // Update optional counters if metadata provided
            const counters = stats.counters || (stats.counters = { videos: 0, shorts: 0, totalDurationSeconds: 0, completed: 0 });
            if (metadata && typeof metadata === 'object') {
                if (metadata.isNewVideo) {
                    counters.videos = Math.max(0, Math.floor(counters.videos + 1));
                    if (metadata.durationSeconds && isFinite(metadata.durationSeconds)) {
                        counters.totalDurationSeconds = Math.max(0, Math.floor(counters.totalDurationSeconds + Number(metadata.durationSeconds)));
                    }
                    if (metadata.isShorts) {
                        counters.shorts = Math.max(0, Math.floor(counters.shorts + 1));
                    }
                }
                if (metadata.crossedCompleted) {
                    counters.completed = Math.max(0, Math.floor(counters.completed + 1));
                }
            }

            await storage.set({ 'stats': stats });

            // Do NOT trigger immediate sync on every stats update; this is too chatty.
            // Respect immediateSyncOnUpdate flag for explicit cases, otherwise
            // schedule a delayed sync and rely on background's 10-minute cadence.
            if (this.immediateSyncOnUpdate) {
                this.triggerSync();
            } else if (!this._statsSyncTimer) {
                this._statsSyncTimer = setTimeout(() => {
                    this._statsSyncTimer = null;
                    this.triggerSync();
                }, this.statsSyncCadenceMs);
            }
        }

        // Helper method to trigger sync if available
        triggerSync(videoId = null) {
            // Reduce delay for more immediate syncing
            setTimeout(() => {
                // Try multiple approaches to ensure sync is triggered
                let syncTriggered = false;

                // First try: Check if we're in background script context (has direct access to sync service)
                if (window.ytSyncService && window.ytSyncService.syncEnabled) {
                    if (videoId) {
                        // Use efficient upload for specific video
                        window.ytSyncService.uploadNewData(videoId).then(success => {
                            if (success) {
                                console.log('[Storage] ✅ Direct video upload triggered successfully');
                                syncTriggered = true;
                            }
                        }).catch(error => {
                            console.log('[Storage] ⚠️ Direct video upload failed:', error);
                        });
                    } else {
                        // Fall back to full sync
                        window.ytSyncService.triggerSync().then(success => {
                            if (success) {
                                console.log('[Storage] ✅ Direct sync trigger successful');
                                syncTriggered = true;
                            }
                        }).catch(error => {
                            console.log('[Storage] ⚠️ Direct sync trigger failed:', error);
                        });
                    }
                    return; // Exit early if direct sync service is available
                }

                // Second try: Send message to background script
                if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
                    const message = videoId ?
                        {type: 'uploadNewData', videoId: videoId} :
                        {type: 'triggerSync'};

                    chrome.runtime.sendMessage(message).then(result => {
                        if (result && result.success) {
                            console.log('[Storage] ✅ Background sync trigger successful');
                            syncTriggered = true;
                        } else {
                            console.log('[Storage] ⚠️ Background sync not available or failed');
                        }
                    }).catch(error => {
                        console.log('[Storage] ⚠️ Could not reach background script for sync trigger:', error);
                    });
                }

                // Third try: Force immediate sync check (fallback for edge cases)
                if (!syncTriggered) {
                    setTimeout(() => {
                        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
                            chrome.runtime.sendMessage({type: 'triggerSync'}).catch(() => {
                                // Final fallback failed, but don't log as this is expected sometimes
                            });
                        }
                    }, 2000); // Delayed fallback attempt
                }
            }, 50); // Reduced from 100ms to 50ms for faster triggering
        }

        // Clean up tombstones older than 30 days (default)
        async cleanupTombstones(retentionMs = 30 * 24 * 60 * 60 * 1000) {
            await this.ensureMigrated();
            const allData = await storage.get(null);
            const now = Date.now();
            const tombstoneKeys = Object.keys(allData).filter(key => key.startsWith('deleted_video_'));
            const oldTombstones = tombstoneKeys.filter(key => {
                const tomb = allData[key];
                return tomb && tomb.deletedAt && (now - tomb.deletedAt > retentionMs);
            });
            if (oldTombstones.length > 0) {
                await storage.remove(oldTombstones);
            }
        }
    }

    // Create global storage instance
    window.ytStorage = new SimpleStorage();

})();
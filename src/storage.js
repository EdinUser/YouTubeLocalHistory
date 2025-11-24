// Simple storage wrapper using cross-browser storage API
// with automatic migration from IndexedDB if it exists

(function () {
    'use strict';

    // Global scope detection (works in service workers, popup, content scripts)
    let globalScope;
    try {
        if (typeof globalThis !== 'undefined') {
            globalScope = globalThis;
        } else if (typeof self !== 'undefined') {
            globalScope = self;
        } else if (typeof window !== 'undefined') {
            globalScope = window;
        } else {
            globalScope = this;
        }
    } catch (e) {
        // Fallback to self (service worker) or this
        globalScope = (typeof self !== 'undefined') ? self : this;
    }

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
                    // Legacy migration complete, now check hybrid migration
                    await this.ensureHybridMigration();
                    return;
                }

                // Try to migrate from IndexedDB (legacy migration)
                await this.migrateFromIndexedDB();

                // Mark as migrated
                await storage.set({'__migrated__': true});
                this.migrated = true;
                console.log('[Storage] Legacy migration completed successfully');

                // Now trigger hybrid migration (storage.local → IndexedDB)
                await this.ensureHybridMigration();
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

        // ============================================================
        // Hybrid Storage Migration (storage.local → IndexedDB)
        // ============================================================

        // Migration constants
        get MIGRATION_BATCH_SIZE() { return 50; }
        get RECENT_WINDOW_MS() { return 30 * 60 * 1000; } // 30 minutes

        /**
         * Get migration state for videos or playlists
         * @param {string} type - 'videos' or 'playlists'
         * @returns {Promise<Object>} Migration state object
         */
        async _getMigrationState(type) {
            const key = type === 'videos' ? '__idbMigrationState__' : '__idbPlaylistMigrationState__';
            const result = await storage.get([key]);
            return result[key] || {
                status: 'not_started',
                migratedCount: 0,
                errorCount: 0,
                lastRunAt: null
            };
        }

        /**
         * Set migration state for videos or playlists
         * @param {string} type - 'videos' or 'playlists'
         * @param {Object} state - Migration state object
         */
        async _setMigrationState(type, state) {
            const key = type === 'videos' ? '__idbMigrationState__' : '__idbPlaylistMigrationState__';
            await storage.set({ [key]: state });
        }

        /**
         * Check if IndexedDB storage is available
         * @returns {boolean}
         */
        _isIndexedDBAvailable() {
            return typeof ytIndexedDBStorage !== 'undefined' && ytIndexedDBStorage !== null;
        }

        /**
         * Check if sync is enabled
         * @returns {Promise<boolean>}
         */
        async _isSyncEnabled() {
            try {
                const settings = await this.getSettings();
                return settings && settings.syncEnabled === true;
            } catch (e) {
                return false;
            }
        }

        /**
         * Migrate videos from storage.local to IndexedDB
         * Uses fail-safe sequence: upsert → verify → delete (only if verified)
         */
        async migrateVideosToIndexedDB() {
            if (!this._isIndexedDBAvailable()) {
                console.log('[Storage] IndexedDB not available, skipping video migration');
                return;
            }

            const state = await this._getMigrationState('videos');
            if (state.status === 'complete') {
                console.log('[Storage] Video migration already complete');
                return;
            }

            // Update state to in_progress
            state.status = 'in_progress';
            state.lastRunAt = Date.now();
            await this._setMigrationState('videos', state);

            try {
                // Get all data from storage.local
                const allData = await storage.get(null);
                const videoKeys = Object.keys(allData).filter(key => key.startsWith('video_'));
                
                if (videoKeys.length === 0) {
                    state.status = 'complete';
                    await this._setMigrationState('videos', state);
                    console.log('[Storage] No videos to migrate');
                    return;
                }

                const syncEnabled = await this._isSyncEnabled();
                const now = Date.now();
                const recentCutoff = now - this.RECENT_WINDOW_MS;

                // Process in batches
                const batches = [];
                for (let i = 0; i < videoKeys.length; i += this.MIGRATION_BATCH_SIZE) {
                    batches.push(videoKeys.slice(i, i + this.MIGRATION_BATCH_SIZE));
                }

                console.log(`[Storage] Starting video migration: ${videoKeys.length} videos in ${batches.length} batches`);

                for (const batch of batches) {
                    for (const key of batch) {
                        const videoId = key.replace('video_', '');
                        const record = allData[key];

                        if (!record || !record.videoId) {
                            // Ensure videoId is present
                            record.videoId = videoId;
                        }

                        try {
                            // Step 1: Upsert to IndexedDB
                            await ytIndexedDBStorage.putVideo(record);

                            // Step 2: Verify by re-reading from IndexedDB
                            const archived = await ytIndexedDBStorage.getVideo(videoId);
                            if (!archived) {
                                throw new Error('Verification failed: record not found in IndexedDB');
                            }

                            // Verify core fields match
                            const timestampMatch = archived.timestamp === record.timestamp;
                            const timeMatch = archived.time === record.time;
                            const urlMatch = archived.url === record.url;

                            if (!timestampMatch || !timeMatch || !urlMatch) {
                                throw new Error('Verification failed: field mismatch');
                            }

                            // Step 3: Delete from storage.local (only if verified)
                            // For sync-disabled: Delete older records (outside recent window)
                            // For sync-enabled: Keep all records (sync source)
                            if (!syncEnabled) {
                                // Only delete if older than recent window
                                if (record.timestamp < recentCutoff) {
                                    await storage.remove([key]);
                                    state.migratedCount++;
                                }
                            } else {
                                // Sync-enabled: Archive but don't delete yet
                                // (sync-aware cleanup will be handled separately)
                                state.migratedCount++;
                            }
                        } catch (error) {
                            console.error(`[Storage] Failed to migrate video ${videoId}:`, error);
                            state.errorCount++;
                            // Leave record in storage.local (never deleted on error)
                        }
                    }

                    // Update state after each batch
                    await this._setMigrationState('videos', state);
                }

                // Check if migration is complete (no more video_* keys)
                const remainingData = await storage.get(null);
                const remainingVideoKeys = Object.keys(remainingData).filter(key => key.startsWith('video_'));
                
                if (remainingVideoKeys.length === 0 || (!syncEnabled && remainingVideoKeys.every(key => {
                    const rec = remainingData[key];
                    return rec && rec.timestamp >= recentCutoff;
                }))) {
                    state.status = 'complete';
                    await this._setMigrationState('videos', state);
                    console.log(`[Storage] Video migration complete: ${state.migratedCount} migrated, ${state.errorCount} errors`);

                    // Rebuild stats if needed
                    await this.rebuildStatsFromIndexedDB();
                } else {
                    console.log(`[Storage] Video migration progress: ${state.migratedCount} migrated, ${remainingVideoKeys.length} remaining`);
                }
            } catch (error) {
                console.error('[Storage] Video migration error:', error);
                // State remains 'in_progress' so it can be retried
            }
        }

        /**
         * Migrate playlists from storage.local to IndexedDB
         * Uses same fail-safe sequence as videos
         */
        async migratePlaylistsToIndexedDB() {
            if (!this._isIndexedDBAvailable()) {
                console.log('[Storage] IndexedDB not available, skipping playlist migration');
                return;
            }

            const state = await this._getMigrationState('playlists');
            if (state.status === 'complete') {
                console.log('[Storage] Playlist migration already complete');
                return;
            }

            state.status = 'in_progress';
            state.lastRunAt = Date.now();
            await this._setMigrationState('playlists', state);

            try {
                const allData = await storage.get(null);
                const playlistKeys = Object.keys(allData).filter(key => key.startsWith('playlist_'));
                
                if (playlistKeys.length === 0) {
                    state.status = 'complete';
                    await this._setMigrationState('playlists', state);
                    console.log('[Storage] No playlists to migrate');
                    return;
                }

                const syncEnabled = await this._isSyncEnabled();
                const now = Date.now();
                const recentCutoff = now - this.RECENT_WINDOW_MS;

                const batches = [];
                for (let i = 0; i < playlistKeys.length; i += this.MIGRATION_BATCH_SIZE) {
                    batches.push(playlistKeys.slice(i, i + this.MIGRATION_BATCH_SIZE));
                }

                console.log(`[Storage] Starting playlist migration: ${playlistKeys.length} playlists in ${batches.length} batches`);

                for (const batch of batches) {
                    for (const key of batch) {
                        const playlistId = key.replace('playlist_', '');
                        const record = allData[key];

                        if (!record || !record.playlistId) {
                            record.playlistId = playlistId;
                        }

                        try {
                            // Upsert to IndexedDB
                            await ytIndexedDBStorage.putPlaylist(record);

                            // Verify
                            const archived = await ytIndexedDBStorage.getPlaylist(playlistId);
                            if (!archived) {
                                throw new Error('Verification failed: record not found in IndexedDB');
                            }

                            const timestampMatch = archived.timestamp === record.timestamp;
                            const playlistIdMatch = archived.playlistId === record.playlistId;
                            const urlMatch = archived.url === record.url;

                            if (!timestampMatch || !playlistIdMatch || !urlMatch) {
                                throw new Error('Verification failed: field mismatch');
                            }

                            // Delete from storage.local (only if verified)
                            if (!syncEnabled) {
                                if (record.timestamp < recentCutoff) {
                                    await storage.remove([key]);
                                    state.migratedCount++;
                                }
                            } else {
                                state.migratedCount++;
                            }
                        } catch (error) {
                            console.error(`[Storage] Failed to migrate playlist ${playlistId}:`, error);
                            state.errorCount++;
                        }
                    }

                    await this._setMigrationState('playlists', state);
                }

                const remainingData = await storage.get(null);
                const remainingPlaylistKeys = Object.keys(remainingData).filter(key => key.startsWith('playlist_'));
                
                if (remainingPlaylistKeys.length === 0 || (!syncEnabled && remainingPlaylistKeys.every(key => {
                    const rec = remainingData[key];
                    return rec && rec.timestamp >= recentCutoff;
                }))) {
                    state.status = 'complete';
                    await this._setMigrationState('playlists', state);
                    console.log(`[Storage] Playlist migration complete: ${state.migratedCount} migrated, ${state.errorCount} errors`);
                } else {
                    console.log(`[Storage] Playlist migration progress: ${state.migratedCount} migrated, ${remainingPlaylistKeys.length} remaining`);
                }
            } catch (error) {
                console.error('[Storage] Playlist migration error:', error);
            }
        }

        /**
         * Rebuild stats from IndexedDB after migration completes
         * Only runs if stats are missing or effectively empty
         */
        async rebuildStatsFromIndexedDB() {
            if (!this._isIndexedDBAvailable()) {
                return;
            }

            try {
                const existingStats = await this.getStats();
                // Only rebuild if stats are missing or effectively empty
                if (existingStats.totalWatchSeconds > 0 || existingStats.counters.videos > 0) {
                    console.log('[Storage] Stats already exist, skipping rebuild');
                    return;
                }

                console.log('[Storage] Rebuilding stats from IndexedDB...');
                const videos = await ytIndexedDBStorage.getAllVideos();

                const stats = {
                    totalWatchSeconds: 0,
                    daily: {},
                    hourly: new Array(24).fill(0),
                    counters: {
                        videos: 0,
                        shorts: 0,
                        totalDurationSeconds: 0,
                        completed: 0
                    },
                    lastUpdated: Date.now()
                };

                for (const video of videos) {
                    // Add watch time
                    if (video.time && typeof video.time === 'number') {
                        stats.totalWatchSeconds += video.time;

                        // Add to daily bucket (local timezone)
                        if (video.timestamp) {
                            const date = new Date(video.timestamp);
                            const dayKey = formatLocalDayKey(date);
                            stats.daily[dayKey] = (stats.daily[dayKey] || 0) + video.time;

                            // Add to hourly bucket
                            const hour = date.getHours();
                            stats.hourly[hour] = (stats.hourly[hour] || 0) + video.time;
                        }
                    }

                    // Update counters
                    if (video.isShorts === true) {
                        stats.counters.shorts++;
                    } else {
                        stats.counters.videos++;
                    }

                    if (video.duration && typeof video.duration === 'number') {
                        stats.counters.totalDurationSeconds += video.duration;

                        // Check if completed (90% threshold)
                        if (video.time && video.duration && video.time / video.duration >= 0.9) {
                            stats.counters.completed++;
                        }
                    }
                }

                await this.setStats(stats);
                console.log('[Storage] Stats rebuilt successfully');
            } catch (error) {
                console.error('[Storage] Failed to rebuild stats:', error);
            }
        }

        /**
         * Ensure hybrid migration (storage.local → IndexedDB) is complete
         * Called after legacy migration (IndexedDB → storage.local)
         */
        async ensureHybridMigration() {
            // Only run in extension context (background/popup)
            // Content scripts will proxy to background
            if (!this._isExtensionContext()) {
                return;
            }

            if (!this._isIndexedDBAvailable()) {
                return;
            }

            try {
                // Run video migration
                await this.migrateVideosToIndexedDB();
                
                // Run playlist migration
                await this.migratePlaylistsToIndexedDB();
            } catch (error) {
                console.error('[Storage] Hybrid migration error:', error);
            }
        }

        /**
         * Check if we're in extension context (not content script)
         * @returns {boolean}
         */
        _isExtensionContext() {
            try {
                // Check globalScope.location (works in popup, but not service worker)
                if (globalScope.location && globalScope.location.origin) {
                    const origin = globalScope.location.origin;
                    return origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://');
                }
                // Service worker context (no location, but has importScripts)
                if (typeof importScripts === 'function') {
                    return true;
                }
                return false;
            } catch (e) {
                return false;
            }
        }

        /**
         * Content Script RPC: Proxy storage calls to background script
         * @param {string} method - Method name to call
         * @param {Array} args - Arguments array
         * @returns {Promise<any>} Result from background
         */
        async _callBackground(method, args = [], retries = 4, delay = 200) {
            // Both Chrome and Firefox use chrome.runtime.sendMessage for RPC
            if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
                throw new Error('chrome.runtime.sendMessage not available');
            }

            const attemptCall = (withTimeout = true) => {
                return new Promise((resolve, reject) => {
                    let resolved = false;
                    const timeout = withTimeout ? setTimeout(() => {
                        if (!resolved) {
                            resolved = true;
                            reject(new Error('EXTENSION_CONTEXT_INVALIDATED')); // Timeout = service worker sleeping
                        }
                    }, 3000) : null; // 3 second timeout

                    try {
                        chrome.runtime.sendMessage({
                            type: 'ytStorageCall',
                            method: method,
                            args: args
                        }, (response) => {
                            if (resolved) return;
                            resolved = true;
                            if (timeout) clearTimeout(timeout);

                            // Check for runtime errors first
                            if (chrome.runtime.lastError) {
                                const errorMsg = chrome.runtime.lastError.message || 'Unknown error';
                                
                                // Check if it's an "Extension context invalidated" error
                                // This happens when the service worker is terminated
                                if (errorMsg.includes('Extension context invalidated') || 
                                    errorMsg.includes('message port closed') ||
                                    errorMsg.includes('Could not establish connection')) {
                                    reject(new Error('EXTENSION_CONTEXT_INVALIDATED'));
                                    return;
                                }
                                
                                console.error('[Storage] Background RPC error:', errorMsg);
                                reject(new Error(`Background script error: ${errorMsg}`));
                                return;
                            }

                            // Handle undefined response (service worker terminated)
                            if (response === undefined) {
                                reject(new Error('EXTENSION_CONTEXT_INVALIDATED'));
                                return;
                            }

                            // Check for error in response
                            if (response && response.error) {
                                reject(new Error(response.error));
                                return;
                            }

                            // Return result
                            if (response && 'result' in response) {
                                resolve(response.result);
                            } else {
                                resolve(response);
                            }
                        });
                    } catch (error) {
                        if (resolved) return;
                        resolved = true;
                        if (timeout) clearTimeout(timeout);
                        
                        // Check if it's a context invalidated error
                        if (error.message && (error.message.includes('Extension context invalidated') || 
                            error.message.includes('message port closed'))) {
                            reject(new Error('EXTENSION_CONTEXT_INVALIDATED'));
                        } else {
                            console.error('[Storage] Error calling background:', error);
                            reject(new Error(`Failed to call background: ${error.message}`));
                        }
                    }
                });
            };

            // Try with retries for extension context invalidated errors
            for (let attempt = 0; attempt <= retries; attempt++) {
                try {
                    // First attempt: try with timeout
                    // Subsequent attempts: try without timeout (service worker should be awake)
                    return await attemptCall(attempt === 0);
                } catch (error) {
                    const isContextInvalidated = error.message === 'EXTENSION_CONTEXT_INVALIDATED';
                    
                    if (isContextInvalidated && attempt < retries) {
                        // Service worker might be sleeping - wait and retry
                        // Use longer delays for later attempts
                        const waitTime = delay * Math.pow(2, attempt); // Exponential backoff: 200ms, 400ms, 800ms, 1600ms
                        console.log(`[Storage] Extension context invalidated, retrying in ${waitTime}ms (attempt ${attempt + 1}/${retries + 1})`);
                        await new Promise(resolve => setTimeout(resolve, waitTime));
                        continue;
                    }
                    
                    // Not retryable or out of retries
                    throw error;
                }
            }
        }

        // Get video record (Hybrid View: storage.local first, then IndexedDB)
        async getVideo(videoId) {
            // Content scripts proxy to background
            if (!this._isExtensionContext()) {
                // Check storage.local first (fast path, works even if service worker is sleeping)
                try {
                    const localResult = await storage.get([`video_${videoId}`]);
                    if (localResult && localResult[`video_${videoId}`]) {
                        return localResult[`video_${videoId}`];
                    }
                } catch (error) {
                    // Continue to RPC if local read fails
                    console.warn('[Storage] storage.local read failed, trying RPC:', error.message);
                }

                // Try RPC with retries (handles service worker wake-up)
                // This is needed for archived records in IndexedDB
                try {
                    return await this._callBackground('getVideo', [videoId], 4, 200);
                } catch (error) {
                    // If RPC fails after retries, we've already checked storage.local above
                    // Archived records in IndexedDB won't be accessible if service worker is sleeping
                    console.warn('[Storage] getVideo RPC failed after retries:', error.message);
                    return null;
                }
            }

            await this.ensureMigrated();
            
            // Step 1: Check storage.local first (fast path, most reliable)
            const result = await storage.get([`video_${videoId}`]);
            if (result[`video_${videoId}`]) {
                return result[`video_${videoId}`];
            }

            // Step 2: Check IndexedDB (archived records)
            if (this._isIndexedDBAvailable()) {
                try {
                    const archived = await ytIndexedDBStorage.getVideo(videoId);
                    if (archived) {
                        // Optional hydration: If record is recent (within 30 min), hydrate to storage.local
                        // This improves performance and resilience if service worker sleeps
                        const recentCutoff = Date.now() - (30 * 60 * 1000); // 30 minutes ago
                        if (archived.timestamp && archived.timestamp >= recentCutoff) {
                            // Hydrate recent archived records to storage.local for faster access
                            // This helps when service worker is sleeping and RPC calls fail
                            try {
                                await storage.set({[`video_${videoId}`]: archived});
                            } catch (error) {
                                // Non-critical: hydration failed, but we still return the archived record
                                console.warn('[Storage] Failed to hydrate archived record to storage.local:', error);
                            }
                        }
                        
                        // CRITICAL: Return archived record with saved time to restore position
                        return archived;
                    }
                } catch (error) {
                    console.warn('[Storage] IndexedDB read failed, continuing with storage.local only:', error);
                }
            }

            return null;
        }

        // Save video record (Local-First: Always write to storage.local first)
        async setVideo(videoId, data) {
            // Content scripts proxy to background
            if (!this._isExtensionContext()) {
                try {
                    return await this._callBackground('setVideo', [videoId, data]);
                } catch (error) {
                    // Fallback: write directly to storage.local (last resort for core functionality)
                    await storage.set({[`video_${videoId}`]: data});
                    return;
                }
            }

            await this.ensureMigrated();
            
            // CRITICAL: Always write to storage.local FIRST (most reliable, never blocks)
            // storage.local is the primary store for writes - core functionality depends on this
            await storage.set({[`video_${videoId}`]: data});
            
            // Archival to IndexedDB happens in background migration batches (non-blocking)
            // Never wait for IndexedDB write - if IndexedDB fails, storage.local still has the data
            
            // Only trigger sync if immediateSyncOnUpdate is true
            if (this.immediateSyncOnUpdate) {
                this.triggerSync(videoId);
            }
        }

        // Remove video record (Hybrid: Remove from both storage.local and IndexedDB)
        async removeVideo(videoId) {
            // Content scripts proxy to background
            if (!this._isExtensionContext()) {
                try {
                    return await this._callBackground('removeVideo', [videoId]);
                } catch (error) {
                    // Fallback: remove from storage.local only
                    await storage.remove([`video_${videoId}`]);
                    const tombstoneKey = `deleted_video_${videoId}`;
                    await storage.set({[tombstoneKey]: {deletedAt: Date.now()}});
                    return;
                }
            }

            await this.ensureMigrated();
            
            // Remove from storage.local
            await storage.remove([`video_${videoId}`]);
            
            // Remove from IndexedDB and create tombstone
            if (this._isIndexedDBAvailable()) {
                try {
                    await ytIndexedDBStorage.deleteVideo(videoId, { createTombstone: true });
                } catch (error) {
                    console.warn('[Storage] IndexedDB deleteVideo failed:', error);
                }
            }
            
            // Create legacy tombstone in storage.local (for sync compatibility)
            const tombstoneKey = `deleted_video_${videoId}`;
            await storage.set({[tombstoneKey]: {deletedAt: Date.now()}});
            
            // Only trigger sync if immediateSyncOnUpdate is true
            if (this.immediateSyncOnUpdate) {
                this.triggerSync();
            }
        }

        // Get all video records (Hybrid View: IndexedDB base + storage.local overlay)
        async getAllVideos() {
            // Content scripts proxy to background
            if (!this._isExtensionContext()) {
                try {
                    return await this._callBackground('getAllVideos', []);
                } catch (error) {
                    // Fallback: return storage.local only
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
            }

            await this.ensureMigrated();

            const videos = {};

            // Step 1: Load from IndexedDB (base dataset)
            if (this._isIndexedDBAvailable()) {
                try {
                    const indexedVideos = await ytIndexedDBStorage.getAllVideos();
                    indexedVideos.forEach(video => {
                        if (video && video.videoId) {
                            videos[video.videoId] = video;
                        }
                    });
                } catch (error) {
                    console.warn('[Storage] IndexedDB getAllVideos failed, continuing with storage.local only:', error);
                }
            }

            // Step 2: Overlay with storage.local records (recent/in-progress)
            const allData = await storage.get(null);
            Object.keys(allData).forEach(key => {
                if (key.startsWith('video_')) {
                    const videoId = key.replace('video_', '');
                    const localRecord = allData[key];
                    // Merge: local wins on conflicts (newer timestamp)
                    if (!videos[videoId] || (localRecord.timestamp && localRecord.timestamp > (videos[videoId].timestamp || 0))) {
                        videos[videoId] = localRecord;
                    }
                }
            });

            return videos;
        }

        // Get playlist record (Hybrid View: storage.local first, then IndexedDB)
        async getPlaylist(playlistId) {
            // Content scripts proxy to background
            if (!this._isExtensionContext()) {
                try {
                    return await this._callBackground('getPlaylist', [playlistId]);
                } catch (error) {
                    const result = await storage.get([`playlist_${playlistId}`]);
                    return result[`playlist_${playlistId}`] || null;
                }
            }

            await this.ensureMigrated();
            
            // Check storage.local first
            const result = await storage.get([`playlist_${playlistId}`]);
            if (result[`playlist_${playlistId}`]) {
                return result[`playlist_${playlistId}`];
            }

            // Check IndexedDB
            if (this._isIndexedDBAvailable()) {
                try {
                    return await ytIndexedDBStorage.getPlaylist(playlistId);
                } catch (error) {
                    console.warn('[Storage] IndexedDB getPlaylist failed:', error);
                }
            }

            return null;
        }

        // Save playlist record (Local-First: Always write to storage.local first)
        async setPlaylist(playlistId, data) {
            // Content scripts proxy to background
            if (!this._isExtensionContext()) {
                try {
                    return await this._callBackground('setPlaylist', [playlistId, data]);
                } catch (error) {
                    // Fallback: write directly to storage.local
                    await storage.set({[`playlist_${playlistId}`]: data});
                    return;
                }
            }

            await this.ensureMigrated();
            
            // CRITICAL: Always write to storage.local FIRST (most reliable)
            await storage.set({[`playlist_${playlistId}`]: data});
            
            // Archival to IndexedDB happens in background migration batches (non-blocking)
            
            // Then trigger sync if enabled
            this.triggerSync('playlist_' + playlistId);
        }

        // Remove playlist record (Hybrid: Remove from both storage.local and IndexedDB)
        async removePlaylist(playlistId) {
            // Content scripts proxy to background
            if (!this._isExtensionContext()) {
                try {
                    return await this._callBackground('removePlaylist', [playlistId]);
                } catch (error) {
                    await storage.remove([`playlist_${playlistId}`]);
                    return;
                }
            }

            await this.ensureMigrated();
            
            // Remove from storage.local
            await storage.remove([`playlist_${playlistId}`]);
            
            // Remove from IndexedDB
            if (this._isIndexedDBAvailable()) {
                try {
                    await ytIndexedDBStorage.deletePlaylist(playlistId);
                } catch (error) {
                    console.warn('[Storage] IndexedDB deletePlaylist failed:', error);
                }
            }
            
            // Trigger sync after removal
            this.triggerSync();
        }

        // Get all playlist records (Hybrid View: IndexedDB base + storage.local overlay)
        async getAllPlaylists() {
            // Content scripts proxy to background
            if (!this._isExtensionContext()) {
                try {
                    return await this._callBackground('getAllPlaylists', []);
                } catch (error) {
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
            }

            await this.ensureMigrated();

            const playlists = {};

            // Load from IndexedDB (base dataset)
            if (this._isIndexedDBAvailable()) {
                try {
                    const indexedPlaylists = await ytIndexedDBStorage.getAllPlaylists();
                    indexedPlaylists.forEach(playlist => {
                        if (playlist && playlist.playlistId) {
                            playlists[playlist.playlistId] = playlist;
                        }
                    });
                } catch (error) {
                    console.warn('[Storage] IndexedDB getAllPlaylists failed:', error);
                }
            }

            // Overlay with storage.local records
            const allData = await storage.get(null);
            Object.keys(allData).forEach(key => {
                if (key.startsWith('playlist_')) {
                    const playlistId = key.replace('playlist_', '');
                    const localRecord = allData[key];
                    // Merge: local wins on conflicts (newer timestamp)
                    if (!playlists[playlistId] || (localRecord.timestamp && localRecord.timestamp > (playlists[playlistId].timestamp || 0))) {
                        playlists[playlistId] = localRecord;
                    }
                }
            });

            return playlists;
        }

        // Get paginated records (videos, shorts, or playlists)
        // Hybrid View: Merges IndexedDB + storage.local BEFORE pagination (prevents vanishing lists)
        async getRecordsPage(options = {}) {
            // Content scripts proxy to background
            if (!this._isExtensionContext()) {
                try {
                    return await this._callBackground('getRecordsPage', [options]);
                } catch (error) {
                    // Fallback: use storage.local only
                    return this._getRecordsPageFromLocal(options);
                }
            }

            const {
                type = 'videos', // 'videos', 'shorts', 'playlists'
                page = 1,
                pageSize = 10,
                searchQuery = '',
                sortBy = 'timestamp',
                sortOrder = 'desc'
            } = options;

            await this.ensureMigrated();

            let indexedRecords = [];
            let localRecords = [];

            // Step 1: Load matching records from IndexedDB (using indexes for efficiency)
            if (this._isIndexedDBAvailable()) {
                try {
                    if (type === 'videos' || type === 'shorts') {
                        const isShorts = type === 'shorts';
                        // Use IndexedDB queryVideos with filters
                        const queryResult = await ytIndexedDBStorage.queryVideos({
                            isShorts: isShorts,
                            searchQuery: searchQuery,
                            page: 1,
                            pageSize: 10000, // Get all matching records (we'll paginate after merge)
                            sortOrder: sortOrder
                        });
                        indexedRecords = queryResult.records || [];
                    } else if (type === 'playlists') {
                        const queryResult = await ytIndexedDBStorage.queryPlaylists({
                            searchQuery: searchQuery,
                            page: 1,
                            pageSize: 10000,
                            sortOrder: sortOrder
                        });
                        indexedRecords = queryResult.records || [];
                    }
                } catch (error) {
                    console.warn('[Storage] IndexedDB query failed, continuing with storage.local only:', error);
                }
            }

            // Step 2: Load matching records from storage.local (apply same filters)
            const allData = await storage.get(null);
            let prefix = '';
            let recordKeys = [];

            switch (type) {
                case 'videos':
                    recordKeys = Object.keys(allData).filter(key =>
                        key.startsWith('video_') && !allData[key]?.isShorts
                    );
                    prefix = 'video_';
                    break;
                case 'shorts':
                    recordKeys = Object.keys(allData).filter(key =>
                        key.startsWith('video_') && allData[key]?.isShorts
                    );
                    prefix = 'video_';
                    break;
                case 'playlists':
                    recordKeys = Object.keys(allData).filter(key =>
                        key.startsWith('playlist_')
                    );
                    prefix = 'playlist_';
                    break;
                default:
                    throw new Error(`Unknown record type: ${type}`);
            }

            localRecords = recordKeys.map(key => {
                const id = key.replace(prefix, '');
                return {
                    ...allData[key],
                    videoId: type !== 'playlists' ? id : undefined,
                    playlistId: type === 'playlists' ? id : undefined
                };
            });

            // Apply search filter to local records
            if (searchQuery) {
                const query = searchQuery.toLowerCase();
                localRecords = localRecords.filter(record =>
                    record.title?.toLowerCase().includes(query)
                );
            }

            // Step 3: Merge arrays (local wins on conflicts by timestamp)
            const mergedMap = new Map();
            
            // Add IndexedDB records first
            indexedRecords.forEach(record => {
                const id = type === 'playlists' ? record.playlistId : record.videoId;
                if (id) {
                    mergedMap.set(id, record);
                }
            });

            // Overlay with local records (local wins on conflicts)
            localRecords.forEach(record => {
                const id = type === 'playlists' ? record.playlistId : record.videoId;
                if (id) {
                    const existing = mergedMap.get(id);
                    if (!existing || (record.timestamp && record.timestamp > (existing.timestamp || 0))) {
                        mergedMap.set(id, record);
                    }
                }
            });

            // Convert map to array
            let records = Array.from(mergedMap.values());

            // Step 4: Sort merged array
            records.sort((a, b) => {
                const aVal = a[sortBy] || 0;
                const bVal = b[sortBy] || 0;
                return sortOrder === 'desc' ? bVal - aVal : aVal - bVal;
            });

            // Step 5: Paginate merged, sorted result
            const totalRecords = records.length;
            const totalPages = Math.ceil(totalRecords / pageSize);
            const startIndex = (page - 1) * pageSize;
            const endIndex = startIndex + pageSize;
            const pageRecords = records.slice(startIndex, endIndex);

            return {
                records: pageRecords,
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalRecords,
                    pageSize,
                    hasNextPage: page < totalPages,
                    hasPrevPage: page > 1
                }
            };
        }

        // Fallback method: getRecordsPage from storage.local only (for content scripts when background unavailable)
        async _getRecordsPageFromLocal(options) {
            const {
                type = 'videos',
                page = 1,
                pageSize = 10,
                searchQuery = '',
                sortBy = 'timestamp',
                sortOrder = 'desc'
            } = options;

            await this.ensureMigrated();
            const allData = await storage.get(null);
            let recordKeys = [];
            let prefix = '';

            switch (type) {
                case 'videos':
                    recordKeys = Object.keys(allData).filter(key =>
                        key.startsWith('video_') && !allData[key]?.isShorts
                    );
                    prefix = 'video_';
                    break;
                case 'shorts':
                    recordKeys = Object.keys(allData).filter(key =>
                        key.startsWith('video_') && allData[key]?.isShorts
                    );
                    prefix = 'video_';
                    break;
                case 'playlists':
                    recordKeys = Object.keys(allData).filter(key =>
                        key.startsWith('playlist_')
                    );
                    prefix = 'playlist_';
                    break;
                default:
                    throw new Error(`Unknown record type: ${type}`);
            }

            let records = recordKeys.map(key => ({
                id: key.replace(prefix, ''),
                ...allData[key]
            }));

            if (searchQuery) {
                const query = searchQuery.toLowerCase();
                records = records.filter(record =>
                    record.title?.toLowerCase().includes(query)
                );
            }

            records.sort((a, b) => {
                const aVal = a[sortBy] || 0;
                const bVal = b[sortBy] || 0;
                return sortOrder === 'desc' ? bVal - aVal : aVal - bVal;
            });

            const totalRecords = records.length;
            const totalPages = Math.ceil(totalRecords / pageSize);
            const startIndex = (page - 1) * pageSize;
            const endIndex = startIndex + pageSize;
            const pageRecords = records.slice(startIndex, endIndex);

            return {
                records: pageRecords,
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalRecords,
                    pageSize,
                    hasNextPage: page < totalPages,
                    hasPrevPage: page > 1
                }
            };
        }

        // Convenience methods for specific record types
        async getVideosPage(options) {
            return this.getRecordsPage({ ...options, type: 'videos' });
        }

        async getShortsPage(options) {
            return this.getRecordsPage({ ...options, type: 'shorts' });
        }

        async getPlaylistsPage(options) {
            return this.getRecordsPage({ ...options, type: 'playlists' });
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
        // Hybrid: Clears both IndexedDB and storage.local
        async clearHistoryOnly() {
            // Content scripts proxy to background
            if (!this._isExtensionContext()) {
                try {
                    return await this._callBackground('clearHistoryOnly', []);
                } catch (error) {
                    // Fallback: clear storage.local only
                    const allData = await storage.get(null);
                    const keysToRemove = Object.keys(allData).filter(key => key.startsWith('video_') || key.startsWith('playlist_'));
                    if (keysToRemove.length > 0) {
                        await storage.remove(keysToRemove);
                    }
                    return;
                }
            }

            await this.ensureMigrated();
            
            // Clear IndexedDB (videos, playlists, deletions)
            if (this._isIndexedDBAvailable()) {
                try {
                    await ytIndexedDBStorage.clearAll();
                } catch (error) {
                    console.warn('[Storage] IndexedDB clearAll failed:', error);
                }
            }
            
            // Remove video_* and playlist_* keys from storage.local
            const allData = await storage.get(null);
            const keysToRemove = Object.keys(allData).filter(key => key.startsWith('video_') || key.startsWith('playlist_'));
            if (keysToRemove.length > 0) {
                await storage.remove(keysToRemove);
            }
            
            // Trigger sync after clearing
            this.triggerSync();
        }

        /**
         * Import records (videos and playlists) into hybrid storage
         * Writes to IndexedDB only (not storage.local) - imported records are archived
         * @param {Array} records - Array of video records
         * @param {Array} playlists - Array of playlist records
         * @param {boolean} mergeMode - If true, merge with existing data; if false, replace
         * @returns {Promise<Object>} { status: 'success', importedVideos: number, importedPlaylists: number }
         */
        async importRecords(records = [], playlists = [], mergeMode = false) {
            // Content scripts proxy to background
            if (!this._isExtensionContext()) {
                try {
                    return await this._callBackground('importRecords', [records, playlists, mergeMode]);
                } catch (error) {
                    console.error('[Storage] Import RPC failed:', error);
                    throw new Error(`Import failed: ${error.message}`);
                }
            }

            await this.ensureMigrated();
            
            // Ensure IndexedDB is available
            if (!this._isIndexedDBAvailable()) {
                throw new Error('IndexedDB storage is not available. Please reload the extension.');
            }

            // Normalize inputs to arrays
            const videoRecords = Array.isArray(records) ? records : [];
            const playlistRecords = Array.isArray(playlists) ? playlists : [];

            // Validate required fields
            const validVideos = videoRecords.filter(v => 
                v && typeof v.videoId === 'string' && typeof v.timestamp === 'number' && typeof v.time === 'number'
            );
            const validPlaylists = playlistRecords.filter(p => 
                p && typeof p.playlistId === 'string'
            );

            if (validVideos.length === 0 && validPlaylists.length === 0) {
                throw new Error('No valid records to import');
            }

            // Replace mode: Clear existing history first
            if (!mergeMode) {
                await this.clearHistoryOnly();
            }

            let importedVideos = 0;
            let importedPlaylists = 0;

            if (mergeMode) {
                // Merge mode: Load existing data and merge
                const existingVideos = await this.getAllVideos();
                const existingPlaylists = await this.getAllPlaylists();

                const mergedVideos = { ...existingVideos };
                const mergedPlaylists = { ...existingPlaylists };

                // Merge videos (newer timestamp wins)
                for (const video of validVideos) {
                    const existing = mergedVideos[video.videoId];
                    if (!existing || (video.timestamp && video.timestamp > (existing.timestamp || 0))) {
                        mergedVideos[video.videoId] = video;
                        importedVideos++;
                    }
                }

                // Merge playlists (newer timestamp wins)
                for (const playlist of validPlaylists) {
                    const existing = mergedPlaylists[playlist.playlistId];
                    if (!existing || (playlist.timestamp && playlist.timestamp > (existing.timestamp || 0))) {
                        mergedPlaylists[playlist.playlistId] = playlist;
                        importedPlaylists++;
                    }
                }

                // Write merged data to IndexedDB only
                if (this._isIndexedDBAvailable()) {
                    try {
                        for (const video of Object.values(mergedVideos)) {
                            await ytIndexedDBStorage.putVideo(video);
                        }
                        for (const playlist of Object.values(mergedPlaylists)) {
                            await ytIndexedDBStorage.putPlaylist(playlist);
                        }
                    } catch (error) {
                        console.error('[Storage] IndexedDB import failed:', error);
                        throw new Error(`Import failed: ${error.message}`);
                    }
                } else {
                    throw new Error('IndexedDB not available for import');
                }
            } else {
                // Replace mode: Write directly to IndexedDB
                if (!this._isIndexedDBAvailable()) {
                    throw new Error('IndexedDB storage is not available. Please reload the extension.');
                }
                
                try {
                    for (const video of validVideos) {
                        await ytIndexedDBStorage.putVideo(video);
                        importedVideos++;
                    }
                    for (const playlist of validPlaylists) {
                        await ytIndexedDBStorage.putPlaylist(playlist);
                        importedPlaylists++;
                    }
                } catch (error) {
                    console.error('[Storage] IndexedDB import failed:', error);
                    throw new Error(`Import failed: ${error.message || 'Unknown error'}`);
                }
            }

            // Rebuild stats from IndexedDB after import
            await this.rebuildStatsFromIndexedDB();

            return {
                status: 'success',
                importedVideos,
                importedPlaylists
            };
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
                if (globalScope.ytSyncService && globalScope.ytSyncService.syncEnabled) {
                    if (videoId) {
                        // Use efficient upload for specific video
                        globalScope.ytSyncService.uploadNewData(videoId).then(success => {
                            if (success) {
                                console.log('[Storage] ✅ Direct video upload triggered successfully');
                                syncTriggered = true;
                            }
                        }).catch(error => {
                            console.log('[Storage] ⚠️ Direct video upload failed:', error);
                        });
                    } else {
                        // Fall back to full sync
                        globalScope.ytSyncService.triggerSync().then(success => {
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

        // Clean up tombstones older than retention period (default 30 days)
        // Hybrid: Cleans both IndexedDB and storage.local tombstones
        async cleanupTombstones(retentionMs = 30 * 24 * 60 * 60 * 1000) {
            // Content scripts proxy to background
            if (!this._isExtensionContext()) {
                try {
                    return await this._callBackground('cleanupTombstones', [retentionMs]);
                } catch (error) {
                    // Fallback: clean storage.local only
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
                    return;
                }
            }

            await this.ensureMigrated();
            
            // Clean IndexedDB tombstones using deletedAt index
            if (this._isIndexedDBAvailable()) {
                try {
                    await ytIndexedDBStorage.cleanupTombstones(retentionMs);
                } catch (error) {
                    console.warn('[Storage] IndexedDB cleanupTombstones failed:', error);
                }
            }
            
            // Clean legacy deleted_video_* keys from storage.local
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

        /**
         * Sync-aware cleanup: Remove records from storage.local that have been:
         * 1. Archived to IndexedDB
         * 2. Synced to sync storage
         * 3. Older than recent window (30 minutes)
         * 
         * This is called after a successful sync to free up storage.local space
         * while keeping recent records for fast access and sync source.
         * 
         * @param {Object} syncData - Sync storage data with ytrewatch_* prefixed keys
         * @param {boolean} syncEnabled - Whether sync is enabled
         * @returns {Promise<{videosDeleted: number, playlistsDeleted: number}>}
         */
        async cleanupSyncedRecords(syncData = {}, syncEnabled = false) {
            // Content scripts proxy to background
            if (!this._isExtensionContext()) {
                try {
                    return await this._callBackground('cleanupSyncedRecords', [syncData, syncEnabled]);
                } catch (error) {
                    console.error('[Storage] CleanupSyncedRecords RPC failed:', error);
                    return { videosDeleted: 0, playlistsDeleted: 0 };
                }
            }

            // Only run if sync is enabled and IndexedDB is available
            if (!syncEnabled || !this._isIndexedDBAvailable()) {
                return { videosDeleted: 0, playlistsDeleted: 0 };
            }

            await this.ensureMigrated();

            const recentCutoff = Date.now() - (30 * 60 * 1000); // 30 minutes ago
            const sharedPrefix = 'ytrewatch_';
            let videosDeleted = 0;
            let playlistsDeleted = 0;

            try {
                // Get all local records
                const localData = await storage.get(null);
                const localVideoKeys = Object.keys(localData).filter(key => key.startsWith('video_'));
                const localPlaylistKeys = Object.keys(localData).filter(key => key.startsWith('playlist_'));

                // Find videos to delete: must be in IndexedDB, synced, and older than recent window
                const videosToDelete = [];
                for (const key of localVideoKeys) {
                    const videoId = key.replace('video_', '');
                    const record = localData[key];
                    
                    if (!record || !record.timestamp) continue;
                    
                    // Skip if within recent window (keep for fast access)
                    if (record.timestamp >= recentCutoff) continue;

                    // Check if synced (exists in sync storage with ytrewatch_ prefix)
                    const syncKey = `${sharedPrefix}video_${videoId}`;
                    if (!syncData[syncKey]) continue;

                    // Check if archived in IndexedDB
                    try {
                        const idbRecord = await ytIndexedDBStorage.getVideo(videoId);
                        if (!idbRecord) continue; // Not in IndexedDB, skip
                    } catch (error) {
                        // If IndexedDB check fails, skip this record (fail-safe)
                        console.warn(`[Storage] IndexedDB check failed for ${videoId}:`, error);
                        continue;
                    }

                    // All conditions met: archived, synced, and old
                    videosToDelete.push(key);
                }

                // Find playlists to delete: same criteria
                const playlistsToDelete = [];
                for (const key of localPlaylistKeys) {
                    const playlistId = key.replace('playlist_', '');
                    const record = localData[key];
                    
                    if (!record || !record.timestamp) continue;
                    
                    // Skip if within recent window
                    if (record.timestamp >= recentCutoff) continue;

                    // Check if synced
                    const syncKey = `${sharedPrefix}playlist_${playlistId}`;
                    if (!syncData[syncKey]) continue;

                    // Check if archived in IndexedDB
                    try {
                        const idbRecord = await ytIndexedDBStorage.getPlaylist(playlistId);
                        if (!idbRecord) continue;
                    } catch (error) {
                        console.warn(`[Storage] IndexedDB check failed for playlist ${playlistId}:`, error);
                        continue;
                    }

                    playlistsToDelete.push(key);
                }

                // Delete in batches
                if (videosToDelete.length > 0) {
                    await storage.remove(videosToDelete);
                    videosDeleted = videosToDelete.length;
                    console.log(`[Storage] Sync-aware cleanup: Deleted ${videosDeleted} synced videos from storage.local`);
                }

                if (playlistsToDelete.length > 0) {
                    await storage.remove(playlistsToDelete);
                    playlistsDeleted = playlistsToDelete.length;
                    console.log(`[Storage] Sync-aware cleanup: Deleted ${playlistsDeleted} synced playlists from storage.local`);
                }

            } catch (error) {
                console.error('[Storage] Sync-aware cleanup error:', error);
            }

            return { videosDeleted, playlistsDeleted };
        }
    }

    // Create global storage instance (works in service workers, popup, content scripts)
    globalScope.ytStorage = new SimpleStorage();

})();
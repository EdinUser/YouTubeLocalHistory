// Firefox Sync Service
// Handles syncing data between browser instances with local storage priority
(function () {
    'use strict';

    // Debug settings - will be loaded from storage
    let debugEnabled = false;

    // Debug logging function
    function log(...args) {
        if (debugEnabled) {
            console.log('[SyncService]', ...args);
        }
    }

    // Always log critical errors
    function logError(...args) {
        console.error('[SyncService]', ...args);
    }

    // Load debug setting from storage
    async function loadDebugSetting() {
        try {
            const storage = isFirefox ? browser.storage.local : chrome.storage.local;
            const result = isFirefox ?
                await storage.get(['settings']) :
                await new Promise(resolve => storage.get(['settings'], resolve));

            const settings = result.settings || {};
            debugEnabled = settings.debug || false;
            log('Debug logging', debugEnabled ? 'enabled' : 'disabled');
        } catch (error) {
            // Don't log error if we can't load debug setting - that would be circular
            debugEnabled = false;
        }
    }

    // Browser detection
    const isFirefox = (function () {
        try {
            return typeof browser !== 'undefined' && typeof chrome !== 'undefined' && browser !== chrome;
        } catch (e) {
            return false;
        }
    })();
    const isChrome = typeof chrome !== 'undefined' && (!isFirefox);

    // Sync statuses
    const SYNC_STATUS = {
        DISABLED: 'disabled',
        INITIALIZING: 'initializing',
        SYNCING: 'syncing',
        SUCCESS: 'success',
        ERROR: 'error',
        NOT_AVAILABLE: 'not_available'
    };

    class SyncService {
        constructor() {
            this.syncEnabled = false;
            this.currentStatus = SYNC_STATUS.DISABLED;
            this.lastSyncTime = null;
            this.syncInProgress = false;
            this.statusCallbacks = [];
            this.syncInterval = null;
            this.syncStorageListener = null;
            // Throttling to avoid self-triggered sync loops and excessive flashing
            this.lastLocalSyncWriteTime = 0; // ms when we last wrote to storage.sync
            this.lastListenerTriggerTime = 0; // ms when listener last triggered a sync
            this.listenerMinIntervalMs = 5 * 60 * 1000; // 5 minutes between listener-triggered syncs
            this.ignoreSelfWriteWindowMs = 20 * 1000; // ignore sync changes within 20s of our own write
            this.init();
        }

        async init() {
            try {
                // Load debug setting first
                await loadDebugSetting();
                log('Initializing Firefox Sync Service...');

                // Check if sync is available
                const syncAvailable = await this.isSyncAvailable();
                if (!syncAvailable) {
                    this.updateStatus(SYNC_STATUS.NOT_AVAILABLE);
                    return;
                }

                // Load sync settings
                const settings = await this.getSyncSettings();
                this.syncEnabled = settings.enabled || false;
                this.lastSyncTime = settings.lastSyncTime || null;

                if (this.syncEnabled) {
                    this.updateStatus(SYNC_STATUS.INITIALIZING);
                    // Always perform full sync on extension startup when sync is enabled
                    await this.performFullSync();
                    this.startPeriodicSync();
                } else {
                    this.updateStatus(SYNC_STATUS.DISABLED);
                }
            } catch (error) {
                logError('Initialization failed:', error);
                this.updateStatus(SYNC_STATUS.ERROR);
            }
        }

        async isSyncAvailable() {
            try {
                if (isFirefox) {
                    // Check if Firefox Sync is available
                    log('Testing Firefox Sync availability...');
                    log('Extension ID:', browser.runtime.id);

                    const testKey = '__sync_test__';
                    await browser.storage.sync.set({[testKey]: true});
                    const result = await browser.storage.sync.get(testKey);
                    await browser.storage.sync.remove(testKey);

                    log('Sync test result:', result);
                    return true;
                } else if (isChrome) {
                    // Chrome storage.sync is usually available
                    return chrome.storage && chrome.storage.sync;
                }
                return false;
            } catch (error) {
                logError('Sync not available:', error);
                logError('Error details:', error.message);
                return false;
            }
        }

        async getSyncSettings() {
            try {
                const storage = this.getLocalStorage();
                const result = await storage.get(['syncSettings']);
                return result.syncSettings || {enabled: false};
            } catch (error) {
                logError('Error getting sync settings:', error);
                return {enabled: false};
            }
        }

        async setSyncSettings(settings) {
            try {
                const storage = this.getLocalStorage();
                await storage.set({syncSettings: settings});
            } catch (error) {
                logError('Error saving sync settings:', error);
            }
        }

        getLocalStorage() {
            if (isFirefox) {
                return {
                    async get(keys) {
                        return await browser.storage.local.get(keys);
                    },
                    async set(data) {
                        return await browser.storage.local.set(data);
                    },
                    async remove(keys) {
                        return await browser.storage.local.remove(keys);
                    }
                };
            } else {
                return {
                    async get(keys) {
                        return new Promise(resolve => chrome.storage.local.get(keys, resolve));
                    },
                    async set(data) {
                        return new Promise(resolve => chrome.storage.local.set(data, resolve));
                    },
                    async remove(keys) {
                        return new Promise(resolve => chrome.storage.local.remove(keys, resolve));
                    }
                };
            }
        }

        getSyncStorage() {
            if (isFirefox) {
                return {
                    async get(keys) {
                        return await browser.storage.sync.get(keys);
                    },
                    async set(data) {
                        return await browser.storage.sync.set(data);
                    },
                    async remove(keys) {
                        return await browser.storage.sync.remove(keys);
                    },
                    async clear() {
                        return await browser.storage.sync.clear();
                    }
                };
            } else {
                return {
                    async get(keys) {
                        return new Promise(resolve => chrome.storage.sync.get(keys, resolve));
                    },
                    async set(data) {
                        return new Promise(resolve => chrome.storage.sync.set(data, resolve));
                    },
                    async remove(keys) {
                        return new Promise(resolve => chrome.storage.sync.remove(keys, resolve));
                    },
                    async clear() {
                        return new Promise(resolve => chrome.storage.sync.clear(resolve));
                    }
                };
            }
        }

        async enableSync() {
            try {
                this.updateStatus(SYNC_STATUS.INITIALIZING);

                const syncAvailable = await this.isSyncAvailable();
                if (!syncAvailable) {
                    this.updateStatus(SYNC_STATUS.NOT_AVAILABLE);
                    return false;
                }

                this.syncEnabled = true;
                await this.setSyncSettings({enabled: true, lastSyncTime: Date.now()});

                // Perform full sync when first enabling to ensure clean state
                await this.performFullSync();
                this.startPeriodicSync();

                this.updateStatus(SYNC_STATUS.SUCCESS);
                return true;
            } catch (error) {
                logError('Error enabling sync:', error);
                this.updateStatus(SYNC_STATUS.ERROR);
                return false;
            }
        }

        async disableSync() {
            try {
                this.syncEnabled = false;
                this.stopPeriodicSync();
                await this.setSyncSettings({enabled: false});
                this.updateStatus(SYNC_STATUS.DISABLED);
                return true;
            } catch (error) {
                logError('Error disabling sync:', error);
                return false;
            }
        }

        async performFullSync() {
            if (!this.syncEnabled || this.syncInProgress) return;

            try {
                this.syncInProgress = true;
                this.updateStatus(SYNC_STATUS.SYNCING);
                log('Starting full sync...');
                log('Extension ID:', browser.runtime.id);
                log('Manifest ID should be:', browser.runtime.getManifest().browser_specific_settings?.gecko?.id);
                log('Using shared prefix "ytrewatch_" for cross-instance compatibility (debug extension ID workaround)');

                // Clean up old/stale sync data first
                await this.cleanupSyncStorage();

                // Get all local data
                const localStorage = this.getLocalStorage();
                const localData = await localStorage.get(null);

                // Get all sync data (should be clean now)
                const syncStorage = this.getSyncStorage();
                const syncData = await syncStorage.get(null);

                const sharedPrefix = 'ytrewatch_';
                log('Local data items:', Object.keys(localData).filter(k => k.startsWith('video_') || k.startsWith('playlist_')).length);
                log('Sync data items:', Object.keys(syncData).filter(k => k.startsWith(sharedPrefix + 'video_') || k.startsWith(sharedPrefix + 'playlist_')).length);
                log('🔍 Raw sync storage keys:', Object.keys(syncData).filter(k => k.startsWith('ytrewatch_')).slice(0, 5));
                log('🔍 Firefox Sync working?', Object.keys(syncData).length > 0 ? 'YES - has data' : 'NO - empty');

                // Debug: Look for the specific video that should be syncing
                const specificVideo = 'ytrewatch_video_8DwLcxEEZss';
                if (syncData[specificVideo]) {
                    log('🎯 FOUND target video in sync storage:', specificVideo, syncData[specificVideo]);
                } else {
                    log('❌ TARGET VIDEO MISSING from sync storage:', specificVideo);
                    log('🔍 All video keys in sync storage:', Object.keys(syncData).filter(k => k.startsWith('ytrewatch_video_')).slice(0, 10));
                }

                // Merge data with local storage priority and conflict resolution
                const mergedData = await this.mergeData(localData, syncData);

                // Save merged data back to local storage first (priority 1)
                // Local storage uses original keys (without prefix)
                const dataToSave = this.filterLocalStorageData(mergedData);
                if (Object.keys(dataToSave).length > 0) {
                    log('About to save to local storage:', Object.keys(dataToSave).length, 'items');
                    log('Sample items being saved (LOCAL - no prefix):', Object.keys(dataToSave).slice(0, 3).map(key => ({
                        key: key,
                        title: dataToSave[key].title,
                        timestamp: new Date(dataToSave[key].timestamp).toLocaleString()
                    })));

                    await localStorage.set(dataToSave);
                    log('✅ Successfully saved', Object.keys(dataToSave).length, 'items to local storage');

                    // Verify the data was actually saved
                    const verification = await localStorage.get(Object.keys(dataToSave).slice(0, 1));
                    log('Verification - local storage data:', verification);
                } else {
                    log('No data to save to local storage');
                }

                // Then update sync storage with the merged result
                await this.updateSyncStorage(mergedData);
                log('Updated sync storage');

                this.lastSyncTime = Date.now();
                await this.setSyncSettings({
                    enabled: true,
                    lastSyncTime: this.lastSyncTime
                });

                this.updateStatus(SYNC_STATUS.SUCCESS);
                log('Full sync completed successfully');

                // Notify other parts of the extension that a full sync completed
                this.notifyFullSyncComplete();
            } catch (error) {
                logError('Full sync failed:', error);
                this.updateStatus(SYNC_STATUS.ERROR);
            } finally {
                this.syncInProgress = false;
            }
        }

        async cleanupSyncStorage() {
            try {
                // IMPORTANT: This ONLY cleans Firefox Sync storage, NOT local storage
                // Local storage (your actual history) is never touched by this cleanup
                // This removes old sync data that might be left from previous sync attempts
                const syncStorage = this.getSyncStorage();
                const syncData = await syncStorage.get(null);
                const now = Date.now();
                const oneWeekAgo = now - (7 * 24 * 60 * 60 * 1000); // 7 days ago

                let itemsToRemove = [];

                // Find old sync items to clean up (NOT local storage items)
                const sharedPrefix = 'ytrewatch_'; // Must match filterSyncableData
                Object.keys(syncData).forEach(key => {
                    if (key.startsWith(sharedPrefix + 'video_') || key.startsWith(sharedPrefix + 'playlist_')) {
                        const item = syncData[key];
                        const itemTime = item.timestamp || item.lastUpdated || 0;

                        // Remove sync items older than a week that seem stale
                        if (itemTime < oneWeekAgo) {
                            log('Marking old SYNC item for cleanup:', key, 'age:', Math.floor((now - itemTime) / (24 * 60 * 60 * 1000)), 'days');
                            itemsToRemove.push(key);
                        }
                    }
                });

                // Remove old sync items in batches (NOT from local storage)
                if (itemsToRemove.length > 0) {
                    log('Cleaning up', itemsToRemove.length, 'old SYNC items (local storage untouched)');
                    await syncStorage.remove(itemsToRemove);
                }
            } catch (error) {
                log('Cleanup failed (non-critical):', error);
            }
        }

        async performInitialSync() {
            if (this.syncInProgress) {
                log('⚠️ Sync already in progress, skipping');
                return;
            }

            if (!this.syncEnabled) {
                log('🚫 Sync disabled, aborting');
                return;
            }

            this.syncInProgress = true;
            this.updateStatus(SYNC_STATUS.SYNCING);

            try {
                log('🔄 Starting regular sync...');

                const localStorage = this.getLocalStorage();
                const syncStorage = this.getSyncStorage();

                // Optimization: If we have recent sync, only check for very recent changes
                const now = Date.now();
                const recentSyncThreshold = 2 * 60 * 1000; // 2 minutes
                const isRecentSync = this.lastSyncTime && (now - this.lastSyncTime) < recentSyncThreshold;

                if (isRecentSync) {
                    log('🚀 Recent sync detected - performing optimized sync');
                    await this.performOptimizedSync(localStorage, syncStorage);
                } else {
                    log('🔄 Full sync required');
                    await this.performFullSyncProcess(localStorage, syncStorage);
                }

                this.lastSyncTime = Date.now();
                await this.setSyncSettings({
                    enabled: true,
                    lastSyncTime: this.lastSyncTime
                });

                this.updateStatus(SYNC_STATUS.SUCCESS);
                log('✅ Regular sync completed successfully');

                // Notify popup of sync completion
                this.notifyRegularSyncComplete();
            } catch (error) {
                logError('❌ Sync failed:', error);
                this.updateStatus(SYNC_STATUS.ERROR);
            } finally {
                this.syncInProgress = false;
            }
        }

        // Optimized sync for recent changes only
        async performOptimizedSync(localStorage, syncStorage) {
            log('🚀 Running optimized sync...');

            // Only get recent local changes (last 15 minutes to account for Firefox Sync delays)
            const recentThreshold = Date.now() - (15 * 60 * 1000);
            const allLocalData = await localStorage.get(null);
            const recentLocalChanges = {};

            Object.keys(allLocalData).forEach(key => {
                if ((key.startsWith('video_') || key.startsWith('playlist_')) &&
                    allLocalData[key].timestamp > recentThreshold) {
                    recentLocalChanges[key] = allLocalData[key];
                }
            });

            if (Object.keys(recentLocalChanges).length > 0) {
                log('📤 Found', Object.keys(recentLocalChanges).length, 'recent local changes to upload');
                await this.updateSyncStorage(recentLocalChanges);
            }

            // Quick check for any recent sync changes
            const syncData = await syncStorage.get(null);
            const sharedPrefix = 'ytrewatch_';
            const recentSyncChanges = {};

            Object.keys(syncData).forEach(key => {
                if (key.startsWith(sharedPrefix) &&
                    syncData[key].timestamp > recentThreshold) {
                    const localKey = key.replace(sharedPrefix, '');
                    if (!allLocalData[localKey] || allLocalData[localKey].timestamp < syncData[key].timestamp) {
                        recentSyncChanges[localKey] = syncData[key];
                    }
                }
            });

            if (Object.keys(recentSyncChanges).length > 0) {
                log('📥 Found', Object.keys(recentSyncChanges).length, 'recent sync changes to download');
                await localStorage.set(recentSyncChanges);
            }

            log('✅ Optimized sync completed');
        }

        // Full sync process (original logic)
        async performFullSyncProcess(localStorage, syncStorage) {
            // Get all local data first
            log('📖 Reading local data...');
            const localData = await localStorage.get(null);
            const localVideoCount = Object.keys(localData).filter(k => k.startsWith('video_')).length;
            log('📖 Local data loaded:', localVideoCount, 'videos');

            // Get all sync data - ensure we're getting everything
            log('🌐 Reading sync data...');
            const syncData = await syncStorage.get(null);
            const syncVideoKeys = Object.keys(syncData).filter(k => k.startsWith('ytrewatch_video_'));
            log('🌐 Sync data loaded:', syncVideoKeys.length, 'videos');

            // Show newest sync videos to debug what we're getting
            const newestSyncVideos = syncVideoKeys
                .map(k => ({key: k, timestamp: syncData[k].timestamp || 0, title: syncData[k].title || 'No title'}))
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, 5);

            log('🌐 Newest videos in sync storage:');
            newestSyncVideos.forEach(v => {
                const videoId = v.key.replace('ytrewatch_video_', '');
                const timeAgo = Math.floor((Date.now() - v.timestamp) / 1000);
                log(`  ${videoId}: ${v.title} - ${new Date(v.timestamp).toLocaleTimeString()} (${timeAgo}s ago)`);
            });

            // Check for videos that exist in sync but not local (should be added)
            const newVideosFromSync = syncVideoKeys.filter(syncKey => {
                const localKey = syncKey.replace('ytrewatch_', '');
                return !localData[localKey];
            });

            if (newVideosFromSync.length > 0) {
                log('🆕 Found NEW videos in sync storage that aren\'t local:', newVideosFromSync.length);
                newVideosFromSync.forEach(syncKey => {
                    const video = syncData[syncKey];
                    const videoId = syncKey.replace('ytrewatch_video_', '');
                    log(`  New video: ${videoId} - ${video.title || 'No title'} (${new Date(video.timestamp).toLocaleTimeString()})`);
                });
            } else {
                log('ℹ️ No new videos found in sync storage');
            }

            // Merge the data
            log('🔄 Starting merge process...');
            const mergedData = await this.mergeData(localData, syncData);

            // Count changes
            const mergedVideoCount = Object.keys(mergedData).filter(k => k.startsWith('video_')).length;
            const videoChanges = mergedVideoCount - localVideoCount;

            log('📊 Merge results:');
            log(`  Local videos before: ${localVideoCount}`);
            log(`  Merged videos after: ${mergedVideoCount}`);
            log(`  Net change: ${videoChanges > 0 ? '+' : ''}${videoChanges}`);

            // Save merged data to local storage only if there are changes
            const dataToSave = this.filterLocalStorageData(mergedData);
            if (Object.keys(dataToSave).length > Object.keys(this.filterLocalStorageData(localData)).length) {
                log('💾 Saving updated data to local storage...');
                log('💾 Data to save:', Object.keys(dataToSave).length, 'items');

                // Show what's being added
                const newKeys = Object.keys(dataToSave).filter(k => !localData[k]);
                if (newKeys.length > 0) {
                    log('➕ Adding new items to local storage:');
                    newKeys.forEach(key => {
                        const item = dataToSave[key];
                        log(`  ${key}: ${item.title || 'No title'} - ${new Date(item.timestamp).toLocaleTimeString()}`);
                    });
                }

                await localStorage.set(dataToSave);
                log('✅ Merged data saved to local storage');

                // Verify data was saved - check for the new videos we just added
                if (newKeys.length > 0) {
                    const verification = await localStorage.get(newKeys.slice(0, 3));
                    log('🔍 Verification - new videos in local storage:');
                    newKeys.slice(0, 3).forEach(key => {
                        const video = verification[key];
                        if (video) {
                            log(`  ${key}: ${video.title} - ${new Date(video.timestamp).toLocaleTimeString()} ✅`);
                        } else {
                            log(`  ${key}: ❌ NOT FOUND IN STORAGE`);
                        }
                    });
                }
            } else {
                log('ℹ️ No new data to save to local storage');
            }

            // Always update sync storage with the merged result to ensure consistency
            log('🌐 Updating sync storage with merged data...');
            await this.updateSyncStorage(mergedData);
            log('✅ Sync storage updated');
        }

        async mergeData(localData, syncData) {
            const merged = {};
            let conflictsResolved = 0;
            let syncWins = 0;
            let localWins = 0;
            let newItemsAdded = 0;
            const sharedPrefix = 'ytrewatch_'; // Must match filterSyncableData
            const now = Date.now();
            const tombstoneRetentionMs = 30 * 24 * 60 * 60 * 1000; // 30 days

            // Fail-safe: If last sync was 29 days or more ago, discard all local data and use remote only
            const lastSync = this.lastSyncTime || 0;
            if (now - lastSync >= 29 * 24 * 60 * 60 * 1000) {
                // Only keep remote (sync) data
                Object.keys(syncData).forEach(syncKey => {
                    if (syncKey.startsWith(sharedPrefix)) {
                        merged[syncKey.replace(sharedPrefix, '')] = syncData[syncKey];
                    }
                });
                console.warn('[SyncService] Local data is stale (29+ days since last sync). All local video, playlist, and tombstone data replaced with remote.');
                return merged;
            }

            // Gather all tombstones (local and sync)
            const localTombstones = Object.keys(localData).filter(k => k.startsWith('deleted_video_')).reduce((acc, k) => {
                acc[k] = localData[k];
                return acc;
            }, {});
            const syncTombstones = Object.keys(syncData).filter(k => k.startsWith(sharedPrefix + 'deleted_video_')).reduce((acc, k) => {
                acc[k.replace(sharedPrefix, '')] = syncData[k];
                return acc;
            }, {});
            const allTombstones = {...localTombstones, ...syncTombstones};

            // Remove videos that have a valid tombstone
            Object.keys(allTombstones).forEach(tombKey => {
                const videoId = tombKey.replace('deleted_video_', '');
                const tomb = allTombstones[tombKey];
                if (!tomb || !tomb.deletedAt) return;
                // Remove from merged if present and tombstone is newer
                const videoKey = `video_${videoId}`;
                const mergedRecord = localData[videoKey];
                if (mergedRecord && mergedRecord.timestamp && tomb.deletedAt > mergedRecord.timestamp) {
                    // skip
                } else if (mergedRecord && !mergedRecord.timestamp) {
                    // Defensive: if no timestamp, prefer tombstone
                    // skip
                }
                // Always keep the tombstone in merged if not expired
                if (now - tomb.deletedAt <= tombstoneRetentionMs) {
                    merged[tombKey] = tomb;
                } else {
                    // If expired, remove tombstone
                    // skip
                }
            });

            // Now process normal merge for videos/playlists (skip those with tombstones)
            Object.keys(syncData).forEach(syncKey => {
                if (syncKey.startsWith(sharedPrefix + 'video_') || syncKey.startsWith(sharedPrefix + 'playlist_')) {
                    // Remove shared prefix to get original key
                    const key = syncKey.replace(sharedPrefix, '');
                    if (key.startsWith('video_')) {
                        const tombKey = `deleted_video_${key.replace('video_', '')}`;
                        if (allTombstones[tombKey]) return; // skip, already handled
                    }
                    const localItem = localData[key];
                    const syncItem = syncData[syncKey];
                    if (!localItem && !merged[key]) {
                        merged[key] = syncItem;
                        newItemsAdded++;
                    } else if (!syncItem) {
                        merged[key] = localItem;
                    } else if (!key.startsWith('video_') || !allTombstones[`deleted_video_${key.replace('video_', '')}`]) {
                        // Both exist, resolve conflict using timestamp (last write wins)
                        const localTimestamp = localItem.timestamp || localItem.lastUpdated || 0;
                        const syncTimestamp = syncItem.timestamp || syncItem.lastUpdated || 0;
                        conflictsResolved++;
                        if (syncTimestamp > localTimestamp) {
                            merged[key] = syncItem;
                            syncWins++;
                        } else if (localTimestamp > syncTimestamp) {
                            merged[key] = localItem;
                            localWins++;
                        } else {
                            merged[key] = localItem;
                            localWins++;
                        }
                    }
                }
                // Also sync tombstones
                if (syncKey.startsWith(sharedPrefix + 'deleted_video_')) {
                    const key = syncKey.replace(sharedPrefix, '');
                    if (!merged[key]) {
                        merged[key] = syncData[syncKey];
                    }
                }
            });

            return merged;
        }

        filterSyncableData(data) {
            // Only sync video and playlist data, not settings or migration flags
            // Add shared prefix to ensure cross-instance compatibility for debug installations
            const syncable = {};
            const sharedPrefix = 'ytrewatch_'; // Consistent across all instances

            Object.keys(data).forEach(key => {
                if (key.startsWith('video_') || key.startsWith('playlist_') || key.startsWith('deleted_video_')) {
                    // Use shared prefix for sync storage to work across different extension IDs
                    syncable[sharedPrefix + key] = data[key];
                }
            });
            return syncable;
        }

        filterLocalStorageData(data) {
            // Local storage uses original keys (no prefix)
            // Only save video and playlist data, not settings or migration flags
            const localData = {};

            Object.keys(data).forEach(key => {
                if (key.startsWith('video_') || key.startsWith('playlist_') || key.startsWith('deleted_video_')) {
                    // Save with original key (no prefix) for local storage compatibility
                    localData[key] = data[key];
                }
            });
            return localData;
        }

        async updateSyncStorage(data) {
            const syncStorage = this.getSyncStorage();
            const syncableData = this.filterSyncableData(data);

            // Firefox/Chrome sync storage has size limits, so we need to chunk the data
            const chunks = this.chunkData(syncableData);

            for (const chunk of chunks) {
                await syncStorage.set(chunk);
            }

            // Mark last local write time to avoid immediate re-sync from our own changes
            this.lastLocalSyncWriteTime = Date.now();
        }

        chunkData(data, maxSize = 8000) { // Firefox sync has ~8KB per item limit
            const chunks = [];
            let currentChunk = {};
            let currentSize = 0;

            Object.entries(data).forEach(([key, value]) => {
                const itemSize = JSON.stringify(value).length;

                if (currentSize + itemSize > maxSize && Object.keys(currentChunk).length > 0) {
                    chunks.push(currentChunk);
                    currentChunk = {};
                    currentSize = 0;
                }

                currentChunk[key] = value;
                currentSize += itemSize;
            });

            if (Object.keys(currentChunk).length > 0) {
                chunks.push(currentChunk);
            }

            return chunks;
        }

        startPeriodicSync() {
            if (this.syncInterval) {
                clearInterval(this.syncInterval);
            }

            // Set sync interval to 10 minutes - less frequent to reduce resource usage
            this.syncInterval = setInterval(() => {
                this.performInitialSync();
            }, 5 * 60 * 1000); // 10 minutes

            // Add Firefox Sync storage change listener for real-time remote updates
            this.setupSyncStorageListener();

            // Set up daily tombstone cleanup
            this.setupTombstoneCleanup();
        }

        // Set up periodic tombstone cleanup (once per day)
        setupTombstoneCleanup() {
            if (this.tombstoneCleanupInterval) {
                clearInterval(this.tombstoneCleanupInterval);
            }

            // Clean up tombstones once per day
            this.tombstoneCleanupInterval = setInterval(async () => {
                try {
                    if (window.ytStorage && window.ytStorage.cleanupTombstones) {
                        await window.ytStorage.cleanupTombstones();
                        log('✅ Periodic tombstone cleanup completed');
                    }
                } catch (error) {
                    logError('⚠️ Periodic tombstone cleanup failed:', error);
                }
            }, 24 * 60 * 60 * 1000); // 24 hours

            // Also run cleanup immediately on startup
            setTimeout(async () => {
                try {
                    if (window.ytStorage && window.ytStorage.cleanupTombstones) {
                        await window.ytStorage.cleanupTombstones();
                        log('✅ Initial tombstone cleanup completed');
                    }
                } catch (error) {
                    logError('⚠️ Initial tombstone cleanup failed:', error);
                }
            }, 5000); // 5 seconds after startup
        }

        // Add listener for changes coming FROM Firefox Sync (remote changes)
        setupSyncStorageListener() {
            if (this.syncStorageListener) {
                // Remove existing listener if any
                try {
                    if (isFirefox) {
                        browser.storage.sync.onChanged.removeListener(this.syncStorageListener);
                    } else {
                        chrome.storage.sync.onChanged.removeListener(this.syncStorageListener);
                    }
                } catch (e) {
                    // Ignore removal errors
                }
            }

            // Create new listener
            this.syncStorageListener = (changes, area) => {
                if (area === 'sync' && this.syncEnabled && !this.syncInProgress) {
                    // Check if any of our sync keys changed
                    const relevantChanges = Object.keys(changes).filter(key =>
                        key.startsWith('ytrewatch_video_') || key.startsWith('ytrewatch_playlist_')
                    );

                    if (relevantChanges.length > 0) {
                        const now = Date.now();
                        const sinceLocalWrite = now - this.lastLocalSyncWriteTime;
                        const sinceLastTrigger = now - this.lastListenerTriggerTime;

                        // Ignore our own writes and throttle listener-triggered syncs
                        if (sinceLocalWrite < this.ignoreSelfWriteWindowMs) {
                            log('⏳ Ignoring sync.onChanged (likely self-write,', sinceLocalWrite + 'ms ago)');
                            return;
                        }
                        if (sinceLastTrigger < this.listenerMinIntervalMs) {
                            log('⏳ Throttling sync listener trigger (last', sinceLastTrigger + 'ms ago)');
                            return;
                        }

                        log('🔥 Remote sync changes detected:', relevantChanges.length, 'items');
                        this.lastListenerTriggerTime = now;
                        // Trigger delayed sync to pull remote changes
                        setTimeout(() => {
                            if (!this.syncInProgress) {
                                log('🔥 Triggering sync due to remote changes (throttled)');
                                this.performInitialSync();
                            }
                        }, 1500); // small delay to let Firefox finish its sync operation
                    }
                }
            };

            // Add the listener
            try {
                if (isFirefox) {
                    browser.storage.sync.onChanged.addListener(this.syncStorageListener);
                } else {
                    chrome.storage.sync.onChanged.addListener(this.syncStorageListener);
                }
                log('✅ Sync storage change listener added');
            } catch (error) {
                log('⚠️ Could not add sync storage listener:', error);
            }
        }

        stopPeriodicSync() {
            if (this.syncInterval) {
                clearInterval(this.syncInterval);
                this.syncInterval = null;
            }

            if (this.tombstoneCleanupInterval) {
                clearInterval(this.tombstoneCleanupInterval);
                this.tombstoneCleanupInterval = null;
            }

            // Remove sync storage listener
            if (this.syncStorageListener) {
                try {
                    if (isFirefox) {
                        browser.storage.sync.onChanged.removeListener(this.syncStorageListener);
                    } else {
                        chrome.storage.sync.onChanged.removeListener(this.syncStorageListener);
                    }
                    this.syncStorageListener = null;
                    log('✅ Sync storage change listener removed');
                } catch (error) {
                    log('⚠️ Could not remove sync storage listener:', error);
                }
            }
        }

        updateStatus(status) {
            this.currentStatus = status;
            this.statusCallbacks.forEach(callback => {
                try {
                    callback(status, this.lastSyncTime);
                } catch (error) {
                    logError('Error in status callback:', error);
                }
            });

            // Broadcast status update to popup (when running in background)
            if (typeof chrome !== 'undefined' && chrome.runtime) {
                chrome.runtime.sendMessage({
                    type: 'syncStatusUpdate',
                    status: status,
                    lastSyncTime: this.lastSyncTime,
                    enabled: this.syncEnabled,
                    available: status !== SYNC_STATUS.NOT_AVAILABLE
                }).catch(() => {
                    // Expected when popup is closed - no need to log
                });
            }
        }

        notifyFullSyncComplete() {
            log('🔔 Notifying popup that full sync completed');

            // Send message to popup (when running in background)
            if (typeof chrome !== 'undefined' && chrome.runtime) {
                chrome.runtime.sendMessage({
                    type: 'fullSyncComplete',
                    timestamp: this.lastSyncTime
                }).then(() => {
                    log('✅ Successfully notified popup of sync completion');
                }).catch(() => {
                    log('ℹ️ Popup not open to receive sync completion notification');
                });
            }
        }

        notifyRegularSyncComplete() {
            log('🔔 Notifying popup that regular sync completed');

            // Send message to popup (when running in background)
            if (typeof chrome !== 'undefined' && chrome.runtime) {
                chrome.runtime.sendMessage({
                    type: 'regularSyncComplete',
                    timestamp: this.lastSyncTime
                }).then(() => {
                    log('✅ Successfully notified popup of regular sync completion');
                }).catch(() => {
                    log('ℹ️ Popup not open to receive regular sync completion notification');
                });
            }
        }

        onStatusChange(callback) {
            this.statusCallbacks.push(callback);
            // Immediately call with current status
            callback(this.currentStatus, this.lastSyncTime);
        }

        getStatus() {
            return {
                status: this.currentStatus,
                enabled: this.syncEnabled,
                lastSyncTime: this.lastSyncTime,
                available: this.currentStatus !== SYNC_STATUS.NOT_AVAILABLE
            };
        }

        async triggerSync() {
            log('🔥 triggerSync() called - enabled:', this.syncEnabled, 'inProgress:', this.syncInProgress);
            if (!this.syncEnabled) {
                log('❌ Sync disabled, aborting');
                return false;
            }

            log('🔥 Calling performInitialSync()');
            await this.performInitialSync();
            log('🔥 performInitialSync() completed');
            return true;
        }

        // Efficient upload-only sync for new videos (no download/merge needed)
        async uploadNewData(videoId = null) {
            if (!this.syncEnabled) {
                log('📤 Upload skipped - sync disabled');
                return false;
            }

            if (this.syncInProgress) {
                log('📤 Upload skipped - sync in progress');
                return false;
            }

            try {
                const localStorage = this.getLocalStorage();
                let dataToUpload;

                if (videoId) {
                    // Upload specific video or playlist
                    const itemKey = videoId.startsWith('playlist_') ? videoId : `video_${videoId}`;
                    log('📤 Uploading specific item:', itemKey);

                    const itemData = await localStorage.get([itemKey]);
                    if (itemData[itemKey]) {
                        dataToUpload = {[itemKey]: itemData[itemKey]};
                        const itemType = videoId.startsWith('playlist_') ? 'playlist' : 'video';
                        const item = itemData[itemKey];

                        log('📤 Found item to upload:');
                        log(`  Type: ${itemType}`);
                        log(`  ID: ${videoId}`);
                        log(`  Title: ${item.title || item.name || 'No title'}`);
                        log(`  Timestamp: ${new Date(item.timestamp).toLocaleString()}`);
                        log(`  Time since save: ${Math.floor((Date.now() - item.timestamp) / 1000)}s ago`);
                    } else {
                        log('❌ Item not found for upload:', videoId, 'Key:', itemKey);
                        return false;
                    }
                } else {
                    // Upload all local video/playlist data (still more efficient than full sync)
                    const allData = await localStorage.get(null);
                    dataToUpload = {};
                    Object.keys(allData).forEach(key => {
                        if (key.startsWith('video_') || key.startsWith('playlist_')) {
                            dataToUpload[key] = allData[key];
                        }
                    });
                    log('📤 Uploading all local data:', Object.keys(dataToUpload).length, 'items');
                }

                // Upload to sync storage (with prefix)
                if (Object.keys(dataToUpload).length > 0) {
                    log('🌐 Uploading to sync storage...');
                    await this.updateSyncStorage(dataToUpload);
                    log('✅ Upload completed successfully');

                    // Verify the upload by reading it back
                    if (videoId && !videoId.startsWith('playlist_')) {
                        const syncStorage = this.getSyncStorage();
                        const verifyKey = `ytrewatch_video_${videoId}`;

                        // Small delay to ensure data is written
                        setTimeout(async () => {
                            try {
                                const verification = await syncStorage.get(verifyKey);
                                if (verification[verifyKey]) {
                                    log('✅ Upload verification successful:', verifyKey);
                                    log('📋 Verified data:', {
                                        title: verification[verifyKey].title,
                                        timestamp: new Date(verification[verifyKey].timestamp).toLocaleString()
                                    });
                                } else {
                                    log('❌ Upload verification failed - data not found:', verifyKey);
                                }
                            } catch (error) {
                                log('⚠️ Upload verification failed:', error);
                            }
                        }, 1000);
                    }

                    this.lastSyncTime = Date.now();
                    await this.setSyncSettings({
                        enabled: true,
                        lastSyncTime: this.lastSyncTime
                    });

                    this.updateStatus(SYNC_STATUS.SUCCESS);

                    // Log what was uploaded for debugging
                    log('📋 Upload summary:');
                    log(`  Items uploaded: ${Object.keys(dataToUpload).length}`);
                    log(`  Sync timestamp updated: ${new Date(this.lastSyncTime).toLocaleTimeString()}`);

                    return true;
                } else {
                    log('⚠️ No data to upload');
                    return false;
                }
            } catch (error) {
                logError('❌ Upload failed:', error);
                this.updateStatus(SYNC_STATUS.ERROR);
                return false;
            }
        }

        async triggerFullSync() {
            if (!this.syncEnabled) {
                return false;
            }

            await this.performFullSync();
            return true;
        }

        // Test basic Firefox Sync functionality
        async testFirefoxSync() {
            try {
                const syncStorage = this.getSyncStorage();
                const testKey = 'ytrewatch_test_' + Date.now();
                const testValue = {message: 'Hello from PC', timestamp: Date.now()};

                log('🧪 Testing Firefox Sync - writing test data...');
                await syncStorage.set({[testKey]: testValue});

                log('🧪 Test data written. Check other device in 30 seconds.');
                log('🧪 Test key:', testKey);

                // Check if we can read it back immediately
                setTimeout(async () => {
                    const result = await syncStorage.get(testKey);
                    log('🧪 Local readback test:', result);
                }, 2000);

                return testKey;
            } catch (error) {
                logError('🧪 Sync test failed:', error);
                return false;
            }
        }

        // Debug: Check what's actually in Firefox Sync storage
        async debugSyncStorage() {
            log('🔍 debugSyncStorage() called');
            try {
                const syncStorage = this.getSyncStorage();
                log('🔍 Getting all sync storage data...');
                const allSyncData = await syncStorage.get(null);
                log('🔍 Retrieved sync data, keys:', Object.keys(allSyncData).length);
                const videoKeys = Object.keys(allSyncData).filter(k => k.startsWith('ytrewatch_video_'));

                log('🔍 DEBUG: Total items in Firefox Sync:', Object.keys(allSyncData).length);
                log('🔍 DEBUG: Video items in sync:', videoKeys.length);
                log('🔍 DEBUG: Sample video keys:', videoKeys.slice(0, 5));
                log('🔍 DEBUG: Looking for target video ytrewatch_video_8DwLcxEEZss:', !!allSyncData['ytrewatch_video_8DwLcxEEZss']);

                if (allSyncData['ytrewatch_video_8DwLcxEEZss']) {
                    log('🎯 DEBUG: Target video data:', allSyncData['ytrewatch_video_8DwLcxEEZss']);
                }

                // Show newest videos with timestamps to identify propagation delay
                const newestVideos = videoKeys
                    .map(k => ({key: k, timestamp: allSyncData[k].timestamp || 0}))
                    .sort((a, b) => b.timestamp - a.timestamp)
                    .slice(0, 5);

                log('🔍 DEBUG: Newest videos in Firefox Sync:');
                newestVideos.forEach(v => {
                    const videoId = v.key.replace('ytrewatch_video_', '');
                    const timeAgo = Math.floor((Date.now() - v.timestamp) / 1000);
                    log(`  ${videoId} - ${new Date(v.timestamp).toLocaleTimeString()} (${timeAgo}s ago)`);
                });

                return {
                    total: Object.keys(allSyncData).length,
                    videos: videoKeys.length,
                    hasTarget: !!allSyncData['ytrewatch_video_8DwLcxEEZss'],
                    newest: newestVideos.map(v => ({
                        id: v.key.replace('ytrewatch_video_', ''),
                        secondsAgo: Math.floor((Date.now() - v.timestamp) / 1000)
                    }))
                };
            } catch (error) {
                logError('🔍 DEBUG: Failed to check sync storage:', error);
                return false;
            }
        }

        // Test Firefox Sync propagation delay
        async testSyncDelay() {
            try {
                const syncStorage = this.getSyncStorage();
                const testKey = `ytrewatch_delay_test_${Date.now()}`;
                const testData = {
                    message: `Delay test from PC at ${new Date().toLocaleTimeString()}`,
                    timestamp: Date.now()
                };

                log('⏱️ Testing sync propagation delay...');
                log('⏱️ Writing test data:', testKey);

                await syncStorage.set({[testKey]: testData});

                log('⏱️ Test data uploaded. Check other PC every 30 seconds.');
                log('⏱️ Run this on other PC: chrome.runtime.sendMessage({type:"debugSyncStorage"}, console.log)');

                return testKey;
            } catch (error) {
                logError('⏱️ Delay test failed:', error);
                return false;
            }
        }

        // Test complete sync flow: upload a test video, then download it
        async testSyncFlow() {
            try {
                log('🧪 Testing complete sync flow...');

                const testVideoId = `test_${Date.now()}`;
                const testVideo = {
                    videoId: testVideoId,
                    title: `Test Video ${new Date().toLocaleTimeString()}`,
                    time: 30,
                    duration: 120,
                    timestamp: Date.now(),
                    url: `https://www.youtube.com/watch?v=${testVideoId}`,
                    isTest: true
                };

                // 1. Save test video locally
                log('1️⃣ Saving test video locally...');
                const localStorage = this.getLocalStorage();
                await localStorage.set({[`video_${testVideoId}`]: testVideo});
                log('✅ Test video saved locally');

                // 2. Upload to sync storage
                log('2️⃣ Uploading test video to sync storage...');
                const uploaded = await this.uploadNewData(testVideoId);
                if (!uploaded) {
                    log('❌ Upload failed');
                    return false;
                }
                log('✅ Test video uploaded to sync');

                // 3. Wait a moment for sync to propagate
                log('3️⃣ Waiting for sync propagation...');
                await new Promise(resolve => setTimeout(resolve, 2000));

                // 4. Delete local copy
                log('4️⃣ Deleting local copy...');
                await localStorage.remove([`video_${testVideoId}`]);
                log('✅ Local copy deleted');

                // 5. Perform sync to download it back
                log('5️⃣ Performing sync to download test video...');
                await this.performInitialSync();

                // 6. Check if it was restored
                log('6️⃣ Checking if test video was restored...');
                const restored = await localStorage.get([`video_${testVideoId}`]);

                if (restored[`video_${testVideoId}`]) {
                    log('✅ SUCCESS! Test video was restored:', restored[`video_${testVideoId}`].title);

                    // Clean up test video
                    await localStorage.remove([`video_${testVideoId}`]);
                    const syncStorage = this.getSyncStorage();
                    await syncStorage.remove([`ytrewatch_video_${testVideoId}`]);
                    log('🧹 Test video cleaned up');

                    return true;
                } else {
                    log('❌ FAILED! Test video was not restored');
                    return false;
                }

            } catch (error) {
                logError('🧪 Sync flow test failed:', error);
                return false;
            }
        }

        // Update debug setting dynamically
        async updateDebugSetting() {
            await loadDebugSetting();
        }

        // Test complete sync improvements
        async testSyncImprovements() {
            try {
                log('🧪 Testing sync improvements...');

                // Test 1: Check if storage listener is working
                log('1️⃣ Testing storage change listener...');
                log('Storage listener active:', !!this.syncStorageListener);

                // Test 2: Test immediate sync trigger
                log('2️⃣ Testing immediate sync trigger...');
                const testVideoId = `improvement_test_${Date.now()}`;
                const testVideo = {
                    videoId: testVideoId,
                    title: `Sync Test Video ${new Date().toLocaleTimeString()}`,
                    time: 45,
                    duration: 180,
                    timestamp: Date.now(),
                    url: `https://www.youtube.com/watch?v=${testVideoId}`,
                    isSyncTest: true
                };

                // Save test video and measure sync trigger time
                const startTime = Date.now();
                const localStorage = this.getLocalStorage();
                await localStorage.set({[`video_${testVideoId}`]: testVideo});

                // Trigger immediate sync
                const uploaded = await this.uploadNewData(testVideoId);
                const uploadTime = Date.now() - startTime;

                log('⏱️ Upload trigger time:', uploadTime + 'ms', uploaded ? '✅' : '❌');

                // Test 3: Test optimized sync vs full sync
                log('3️⃣ Testing optimized sync...');
                const lastSyncBefore = this.lastSyncTime;
                this.lastSyncTime = Date.now() - (1 * 60 * 1000); // Set last sync to 1 minute ago

                const syncStartTime = Date.now();
                await this.performInitialSync();
                const syncDuration = Date.now() - syncStartTime;

                log('⏱️ Optimized sync duration:', syncDuration + 'ms');

                // Restore original last sync time
                this.lastSyncTime = lastSyncBefore;

                // Clean up test video
                await localStorage.remove([`video_${testVideoId}`]);
                const syncStorage = this.getSyncStorage();
                await syncStorage.remove([`ytrewatch_video_${testVideoId}`]);

                log('✅ Sync improvement tests completed');
                return {
                    listenerActive: !!this.syncStorageListener,
                    uploadTriggerTime: uploadTime,
                    uploadSuccess: uploaded,
                    optimizedSyncTime: syncDuration
                };

            } catch (error) {
                logError('🧪 Sync improvement test failed:', error);
                return false;
            }
        }
    }

    // Create global sync service instance
    window.ytSyncService = new SyncService();
    window.SYNC_STATUS = SYNC_STATUS;

    // Make loadDebugSetting available globally for settings updates
    window.updateSyncDebug = async function () {
        await loadDebugSetting();
    };

    // Make debug function available globally for manual testing
    window.debugSync = async function () {
        if (window.ytSyncService) {
            log('🔍 Manual debug call...');
            const result = await window.ytSyncService.debugSyncStorage();
            log('🔍 Manual debug result:', result);
            return result;
        } else {
            log('❌ ytSyncService not available');
            return null;
        }
    };

})();
// Simple storage wrapper using cross-browser storage API
// with automatic migration from IndexedDB if it exists

(function() {
    'use strict';

    // Browser detection - safer approach
    const isFirefox = (function() {
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

    // Storage wrapper class
    class SimpleStorage {
        constructor() {
            this.migrated = false;
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
                await storage.set({ '__migrated__': true });
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
            await storage.set({ [`video_${videoId}`]: data });
            // Then trigger sync if enabled
            this.triggerSync(videoId);
        }

        // Remove video record
        async removeVideo(videoId) {
            await this.ensureMigrated();
            await storage.remove([`video_${videoId}`]);
            // Trigger sync after removal
            this.triggerSync();
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
            await storage.set({ [`playlist_${playlistId}`]: data });
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
            await storage.set({ 'settings': settings });
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
                        { type: 'uploadNewData', videoId: videoId } : 
                        { type: 'triggerSync' };
                        
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
                            chrome.runtime.sendMessage({ type: 'triggerSync' }).catch(() => {
                                // Final fallback failed, but don't log as this is expected sometimes
                            });
                        }
                    }, 2000); // Delayed fallback attempt
                }
            }, 50); // Reduced from 100ms to 50ms for faster triggering
        }
    }

    // Create global storage instance
    window.ytStorage = new SimpleStorage();

})(); 
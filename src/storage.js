// Simple storage wrapper using cross-browser storage API
// with automatic migration from IndexedDB if it exists

(function() {
    'use strict';

    // Browser detection
    const isFirefox = typeof browser !== 'undefined' && typeof chrome !== 'undefined' && browser !== chrome;
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
            await storage.set({ [`video_${videoId}`]: data });
        }

        // Remove video record
        async removeVideo(videoId) {
            await this.ensureMigrated();
            await storage.remove([`video_${videoId}`]);
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
            await storage.set({ [`playlist_${playlistId}`]: data });
        }

        // Remove playlist record
        async removePlaylist(playlistId) {
            await this.ensureMigrated();
            await storage.remove([`playlist_${playlistId}`]);
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
    }

    // Create global storage instance
    window.ytStorage = new SimpleStorage();

})(); 
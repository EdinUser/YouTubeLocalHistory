(function () {
    'use strict';

    /**
     * Cross-browser IndexedDB wrapper for large datasets (videos, playlists, deletions).
     *
     * Goals:
     * - Work in both Chrome MV3 (service worker + content scripts) and Firefox MV3/MV2.
     * - Provide simple CRUD APIs for higher-level storage code.
     * - Fail gracefully when IndexedDB is unavailable (e.g., restricted environments).
     *
     * NOTE: This file is currently self-contained and not yet wired into SimpleStorage.
     * Integration and migration logic will be implemented separately.
     */

    const globalScope = (typeof globalThis !== 'undefined')
        ? globalThis
        : (typeof window !== 'undefined'
            ? window
            : (typeof self !== 'undefined' ? self : this));

    const DB_NAME = 'YTLH_HybridDB';
    const DB_VERSION = 2;

    const STORE_VIDEOS = 'videos';
    const STORE_PLAYLISTS = 'playlists';
    const STORE_DELETIONS = 'deletions';

    function log(message, data) {
        try {
            // Avoid throwing in restricted contexts
            if (globalScope && globalScope.console) {
                globalScope.console.log('[YTLH IndexedDB]', message, data || '');
            }
        } catch (_) {
            // Ignore logging failures
        }
    }

    function hasIndexedDB() {
        try {
            return typeof indexedDB !== 'undefined';
        } catch (_) {
            return false;
        }
    }

    /**
     * Open (or create) the IndexedDB database, creating object stores if needed.
     */
    function openDatabase() {
        if (!hasIndexedDB()) {
            return Promise.reject(new Error('IndexedDB is not available in this environment'));
        }

        return new Promise((resolve, reject) => {
            let request;
            try {
                request = indexedDB.open(DB_NAME, DB_VERSION);
            } catch (error) {
                reject(error);
                return;
            }

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                const tx = event.target.transaction;

                // Video records: keyed by videoId
                let videoStore;
                if (!db.objectStoreNames.contains(STORE_VIDEOS)) {
                    videoStore = db.createObjectStore(STORE_VIDEOS, { keyPath: 'videoId' });
                } else {
                    videoStore = tx.objectStore(STORE_VIDEOS);
                }
                // Common indexes for efficient querying and cleanup
                if (!videoStore.indexNames.contains('timestamp')) {
                    videoStore.createIndex('timestamp', 'timestamp', { unique: false });
                }
                if (!videoStore.indexNames.contains('isShorts')) {
                    videoStore.createIndex('isShorts', 'isShorts', { unique: false });
                }
                // For case-insensitive title searches
                if (!videoStore.indexNames.contains('titleLower')) {
                    videoStore.createIndex('titleLower', 'titleLower', { unique: false });
                }

                // Playlist records: keyed by playlistId
                let playlistStore;
                if (!db.objectStoreNames.contains(STORE_PLAYLISTS)) {
                    playlistStore = db.createObjectStore(STORE_PLAYLISTS, { keyPath: 'playlistId' });
                } else {
                    playlistStore = tx.objectStore(STORE_PLAYLISTS);
                }
                if (!playlistStore.indexNames.contains('timestamp')) {
                    playlistStore.createIndex('timestamp', 'timestamp', { unique: false });
                }
                if (!playlistStore.indexNames.contains('titleLower')) {
                    playlistStore.createIndex('titleLower', 'titleLower', { unique: false });
                }

                // Deletion markers / tombstones: keyed by videoId
                let deletionsStore;
                if (!db.objectStoreNames.contains(STORE_DELETIONS)) {
                    deletionsStore = db.createObjectStore(STORE_DELETIONS, { keyPath: 'videoId' });
                } else {
                    deletionsStore = tx.objectStore(STORE_DELETIONS);
                }
                if (!deletionsStore.indexNames.contains('deletedAt')) {
                    deletionsStore.createIndex('deletedAt', 'deletedAt', { unique: false });
                }
            };

            request.onsuccess = () => {
                const db = request.result;

                // Handle connection loss / version changes gracefully
                db.onversionchange = () => {
                    try {
                        db.close();
                    } catch (_) {
                        // ignore
                    }
                    log('Database version change detected, connection closed');
                };

                resolve(db);
            };

            request.onerror = () => {
                reject(request.error || new Error('Failed to open IndexedDB database'));
            };

            request.onblocked = () => {
                log('Database open request is blocked (another tab/window may be holding the old version)');
            };
        });
    }

    class IndexedDBStorage {
        constructor() {
            this._dbPromise = null;
        }

        /**
         * Lazily open the database and reuse the same connection.
         */
        _getDB() {
            if (!this._dbPromise) {
                this._dbPromise = openDatabase().catch((error) => {
                    // Reset so future calls can retry, but surface the error
                    this._dbPromise = null;
                    log('Failed to open IndexedDB database', error);
                    throw error;
                });
            }
            return this._dbPromise;
        }

        /**
         * Helper to run a function within a transaction for a given store.
         */
        async _withStore(storeName, mode, callback) {
            const db = await this._getDB();
            return new Promise((resolve, reject) => {
                let tx;
                try {
                    tx = db.transaction(storeName, mode);
                } catch (error) {
                    reject(error);
                    return;
                }

                const store = tx.objectStore(storeName);
                let result;

                try {
                    result = callback(store);
                } catch (error) {
                    reject(error);
                    return;
                }

                tx.oncomplete = () => resolve(result);
                tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
                tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
            });
        }

        // --- Video CRUD -----------------------------------------------------

        async getVideo(videoId) {
            if (!videoId) return null;
            return this._withStore(STORE_VIDEOS, 'readonly', (store) => {
                return new Promise((resolve, reject) => {
                    const request = store.get(videoId);
                    request.onsuccess = () => resolve(request.result || null);
                    request.onerror = () => reject(request.error);
                });
            });
        }

        async putVideo(record) {
            if (!record || !record.videoId) {
                throw new Error('Video record must include a videoId');
            }
            // Normalize fields for indexed searches
            if (typeof record.title === 'string') {
                record.titleLower = record.title.toLowerCase();
            } else if (record.titleLower && typeof record.titleLower === 'string') {
                // keep as is
            } else {
                record.titleLower = '';
            }
            return this._withStore(STORE_VIDEOS, 'readwrite', (store) => {
                return new Promise((resolve, reject) => {
                    const request = store.put(record);
                    request.onsuccess = () => resolve();
                    request.onerror = () => reject(request.error);
                });
            });
        }

        async deleteVideo(videoId, options = {}) {
            if (!videoId) return;
            const { createTombstone = true } = options;

            await this._withStore(STORE_VIDEOS, 'readwrite', (store) => {
                store.delete(videoId);
            });

            if (createTombstone) {
                const tombstone = {
                    videoId,
                    deletedAt: Date.now()
                };
                await this._withStore(STORE_DELETIONS, 'readwrite', (store) => {
                    return new Promise((resolve, reject) => {
                        const request = store.put(tombstone);
                        request.onsuccess = () => resolve();
                        request.onerror = () => reject(request.error);
                    });
                });
            }
        }

        async getAllVideos() {
            return this._withStore(STORE_VIDEOS, 'readonly', (store) => {
                return new Promise((resolve, reject) => {
                    const request = store.getAll();
                    request.onsuccess = () => resolve(request.result || []);
                    request.onerror = () => reject(request.error);
                });
            });
        }

        /**
         * Query videos with optional Shorts filter and search, ordered by timestamp with pagination.
         * This keeps semantics close to the existing storage.local-based search
         * (case-insensitive substring match on title).
         */
        async queryVideos(options = {}) {
            const {
                isShorts = null, // true | false | null (both)
                searchQuery = '',
                page = 1,
                pageSize = 10,
                sortOrder = 'desc'
            } = options;

            const queryLower = searchQuery ? String(searchQuery).toLowerCase() : '';
            const direction = sortOrder === 'asc' ? 'next' : 'prev';
            const offset = (page - 1) * pageSize;

            return this._withStore(STORE_VIDEOS, 'readonly', (store) => {
                return new Promise((resolve, reject) => {
                    let matchedCount = 0;
                    const pageRecords = [];

                    let source;
                    try {
                        // Prefer timestamp index when available; fall back to store scan otherwise.
                        source = store.index('timestamp');
                    } catch (_) {
                        source = store;
                    }

                    const request = source.openCursor(null, direction);

                    request.onsuccess = (event) => {
                        const cursor = event.target.result;
                        if (!cursor) {
                            const totalRecords = matchedCount;
                            const totalPages = Math.ceil(totalRecords / pageSize) || 1;
                            resolve({
                                records: pageRecords,
                                pagination: {
                                    currentPage: page,
                                    totalPages,
                                    totalRecords,
                                    pageSize,
                                    hasNextPage: page < totalPages,
                                    hasPrevPage: page > 1
                                }
                            });
                            return;
                        }

                        const record = cursor.value;

                        // Filter by Shorts flag if specified
                        if (isShorts !== null) {
                            const recIsShorts = !!record.isShorts;
                            if (recIsShorts !== !!isShorts) {
                                cursor.continue();
                                return;
                            }
                        }

                        // Filter by search query (case-insensitive substring on title)
                        if (queryLower) {
                            const titleSource = (record.titleLower || record.title || '');
                            if (!titleSource.toLowerCase().includes(queryLower)) {
                                cursor.continue();
                                return;
                            }
                        }

                        matchedCount += 1;

                        // Pagination: skip until offset, then collect up to pageSize
                        if (matchedCount > offset && pageRecords.length < pageSize) {
                            pageRecords.push(record);
                        }

                        cursor.continue();
                    };

                    request.onerror = () => reject(request.error);
                });
            });
        }

        async getVideosByIds(videoIds) {
            if (!Array.isArray(videoIds) || videoIds.length === 0) {
                return [];
            }
            return this._withStore(STORE_VIDEOS, 'readonly', (store) => {
                return Promise.all(videoIds.map((id) => {
                    return new Promise((resolve, reject) => {
                        const request = store.get(id);
                        request.onsuccess = () => resolve(request.result || null);
                        request.onerror = () => reject(request.error);
                    });
                }));
            });
        }

        // --- Playlist CRUD --------------------------------------------------

        async getPlaylist(playlistId) {
            if (!playlistId) return null;
            return this._withStore(STORE_PLAYLISTS, 'readonly', (store) => {
                return new Promise((resolve, reject) => {
                    const request = store.get(playlistId);
                    request.onsuccess = () => resolve(request.result || null);
                    request.onerror = () => reject(request.error);
                });
            });
        }

        async putPlaylist(record) {
            if (!record || !record.playlistId) {
                throw new Error('Playlist record must include a playlistId');
            }
            // Normalize fields for indexed searches
            if (typeof record.title === 'string') {
                record.titleLower = record.title.toLowerCase();
            } else if (record.titleLower && typeof record.titleLower === 'string') {
                // keep as is
            } else {
                record.titleLower = '';
            }
            return this._withStore(STORE_PLAYLISTS, 'readwrite', (store) => {
                return new Promise((resolve, reject) => {
                    const request = store.put(record);
                    request.onsuccess = () => resolve();
                    request.onerror = () => reject(request.error);
                });
            });
        }

        async deletePlaylist(playlistId) {
            if (!playlistId) return;
            return this._withStore(STORE_PLAYLISTS, 'readwrite', (store) => {
                store.delete(playlistId);
            });
        }

        async getAllPlaylists() {
            return this._withStore(STORE_PLAYLISTS, 'readonly', (store) => {
                return new Promise((resolve, reject) => {
                    const request = store.getAll();
                    request.onsuccess = () => resolve(request.result || []);
                    request.onerror = () => reject(request.error);
                });
            });
        }

        /**
         * Query playlists with optional title search, ordered by timestamp with pagination.
         */
        async queryPlaylists(options = {}) {
            const {
                searchQuery = '',
                page = 1,
                pageSize = 10,
                sortOrder = 'desc'
            } = options;

            const queryLower = searchQuery ? String(searchQuery).toLowerCase() : '';
            const direction = sortOrder === 'asc' ? 'next' : 'prev';
            const offset = (page - 1) * pageSize;

            return this._withStore(STORE_PLAYLISTS, 'readonly', (store) => {
                return new Promise((resolve, reject) => {
                    let matchedCount = 0;
                    const pageRecords = [];

                    let source;
                    try {
                        source = store.index('timestamp');
                    } catch (_) {
                        source = store;
                    }

                    const request = source.openCursor(null, direction);

                    request.onsuccess = (event) => {
                        const cursor = event.target.result;
                        if (!cursor) {
                            const totalRecords = matchedCount;
                            const totalPages = Math.ceil(totalRecords / pageSize) || 1;
                            resolve({
                                records: pageRecords,
                                pagination: {
                                    currentPage: page,
                                    totalPages,
                                    totalRecords,
                                    pageSize,
                                    hasNextPage: page < totalPages,
                                    hasPrevPage: page > 1
                                }
                            });
                            return;
                        }

                        const record = cursor.value;

                        // Filter by search query (case-insensitive substring on title)
                        if (queryLower) {
                            const titleSource = (record.titleLower || record.title || '');
                            if (!titleSource.toLowerCase().includes(queryLower)) {
                                cursor.continue();
                                return;
                            }
                        }

                        matchedCount += 1;

                        // Pagination: skip until offset, then collect up to pageSize
                        if (matchedCount > offset && pageRecords.length < pageSize) {
                            pageRecords.push(record);
                        }

                        cursor.continue();
                    };

                    request.onerror = () => reject(request.error);
                });
            });
        }

        // --- Deletions / Tombstones ----------------------------------------

        async getDeletion(videoId) {
            if (!videoId) return null;
            return this._withStore(STORE_DELETIONS, 'readonly', (store) => {
                return new Promise((resolve, reject) => {
                    const request = store.get(videoId);
                    request.onsuccess = () => resolve(request.result || null);
                    request.onerror = () => reject(request.error);
                });
            });
        }

        async getAllDeletions() {
            return this._withStore(STORE_DELETIONS, 'readonly', (store) => {
                return new Promise((resolve, reject) => {
                    const request = store.getAll();
                    request.onsuccess = () => resolve(request.result || []);
                    request.onerror = () => reject(request.error);
                });
            });
        }

        async cleanupTombstones(retentionMs) {
            if (!retentionMs || retentionMs <= 0) return;
            const cutoff = Date.now() - retentionMs;

            return this._withStore(STORE_DELETIONS, 'readwrite', (store) => {
                return new Promise((resolve, reject) => {
                    const index = store.index('deletedAt');
                    const range = IDBKeyRange.upperBound(cutoff);
                    const request = index.openCursor(range);
                    request.onsuccess = (event) => {
                        const cursor = event.target.result;
                        if (cursor) {
                            cursor.delete();
                            cursor.continue();
                        } else {
                            resolve();
                        }
                    };
                    request.onerror = () => reject(request.error);
                });
            });
        }

        // --- Utilities ------------------------------------------------------

        async clearAll() {
            return this._withStore(STORE_VIDEOS, 'readwrite', (store) => {
                store.clear();
            }).then(() => {
                return this._withStore(STORE_PLAYLISTS, 'readwrite', (store) => {
                    store.clear();
                });
            }).then(() => {
                return this._withStore(STORE_DELETIONS, 'readwrite', (store) => {
                    store.clear();
                });
            });
        }
    }

    // Expose a singleton instance globally for reuse in background, popup and content scripts.
    // This keeps the API simple and avoids multiple competing DB connections.
    globalScope.ytIndexedDBStorage = new IndexedDBStorage();

})();

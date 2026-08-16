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
    // Version 7 adds a separate per-video AI-disclosure cache. Existing
    // history, subscriptions, and cached feed records remain untouched.
    const DB_VERSION = 7;

    const STORE_VIDEOS = 'videos';
    const STORE_PLAYLISTS = 'playlists';
    const STORE_DELETIONS = 'deletions';
    // Fresh v5 local-feed stores. They are intentionally independent from the
    // legacy aggregate feed cache and storage.local `sub_*` records.
    const STORE_SUBSCRIPTIONS = 'subscriptions';
    const STORE_SUBSCRIPTION_FEED_VIDEOS = 'subscription_feed_videos';
    const STORE_CHANNEL_SYNC_STATE = 'channel_sync_state';
    const STORE_HOME_IMPRESSIONS = 'home_impressions';
    const STORE_FEED_SYNC_RUNS = 'feed_sync_runs';
    const STORE_LOCAL_UNSUBSCRIBE_TOMBSTONES = 'local_unsubscribe_tombstones';
    // Results are intentionally separate from history and feed records. A
    // large AI-label cache must not cause settings or video history writes.
    const STORE_AI_LABEL_RESULTS = 'ai_label_results';
    const EXPLICIT_SUBSCRIPTION_SOURCES = ['takeout_csv', 'oauth', 'manual'];

    // ----- Forgiving, YouTube-like search matcher -----------------------------
    // Mirrors the matcher in storage.js: accent/punctuation-insensitive, matches
    // every query word (any order) against the title or channel name.
    function normalizeSearchText(s) {
        return String(s || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/[^\p{L}\p{N}]+/gu, ' ')
            .trim();
    }
    function searchTokens(query) {
        const n = normalizeSearchText(query);
        return n ? n.split(' ') : [];
    }
    function recordMatchesTokens(record, tokens) {
        if (!tokens || !tokens.length) return true;
        const hay = normalizeSearchText(record && record.title) + ' ' +
            normalizeSearchText(record && record.channelName);
        return tokens.every((t) => hay.indexOf(t) !== -1);
    }

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

    function logTransactionFailure(operation, storeNames, mode, error) {
        try {
            console.error('[YTLH IndexedDB] transaction failed', {
                operation: operation || 'unnamed',
                stores: Array.isArray(storeNames) ? storeNames : [storeNames],
                mode,
                errorName: error && error.name || 'Error',
                message: String(error && error.message || error || 'Unknown IndexedDB error'),
                stack: error && error.stack || ''
            });
        } catch (_) {
            // IndexedDB diagnostics must never affect the storage operation.
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

                // V5 feed subscriptions: only explicit import/manual sources
                // may create these records. Nothing is copied from sub_*.
                let subscriptionsStore;
                if (!db.objectStoreNames.contains(STORE_SUBSCRIPTIONS)) {
                    subscriptionsStore = db.createObjectStore(STORE_SUBSCRIPTIONS, { keyPath: 'channelId' });
                } else {
                    subscriptionsStore = tx.objectStore(STORE_SUBSCRIPTIONS);
                }
                if (!subscriptionsStore.indexNames.contains('followedAt')) {
                    subscriptionsStore.createIndex('followedAt', 'followedAt', { unique: false });
                }
                if (!subscriptionsStore.indexNames.contains('source')) {
                    subscriptionsStore.createIndex('source', 'source', { unique: false });
                }

                let localUnsubscribeStore;
                if (!db.objectStoreNames.contains(STORE_LOCAL_UNSUBSCRIBE_TOMBSTONES)) {
                    localUnsubscribeStore = db.createObjectStore(STORE_LOCAL_UNSUBSCRIBE_TOMBSTONES, { keyPath: 'channelId' });
                } else {
                    localUnsubscribeStore = tx.objectStore(STORE_LOCAL_UNSUBSCRIBE_TOMBSTONES);
                }
                if (!localUnsubscribeStore.indexNames.contains('unsubscribedAt')) {
                    localUnsubscribeStore.createIndex('unsubscribedAt', 'unsubscribedAt', { unique: false });
                }
                if (!localUnsubscribeStore.indexNames.contains('source')) {
                    localUnsubscribeStore.createIndex('source', 'source', { unique: false });
                }

                let feedVideosStore;
                if (!db.objectStoreNames.contains(STORE_SUBSCRIPTION_FEED_VIDEOS)) {
                    feedVideosStore = db.createObjectStore(STORE_SUBSCRIPTION_FEED_VIDEOS, { keyPath: 'videoId' });
                } else {
                    feedVideosStore = tx.objectStore(STORE_SUBSCRIPTION_FEED_VIDEOS);
                }
                if (!feedVideosStore.indexNames.contains('publishedAt')) {
                    feedVideosStore.createIndex('publishedAt', 'publishedAt', { unique: false });
                }
                if (!feedVideosStore.indexNames.contains('channelId')) {
                    feedVideosStore.createIndex('channelId', 'channelId', { unique: false });
                }
                if (!feedVideosStore.indexNames.contains('lastSeenInFeedAt')) {
                    feedVideosStore.createIndex('lastSeenInFeedAt', 'lastSeenInFeedAt', { unique: false });
                }

                let syncStateStore;
                if (!db.objectStoreNames.contains(STORE_CHANNEL_SYNC_STATE)) {
                    syncStateStore = db.createObjectStore(STORE_CHANNEL_SYNC_STATE, { keyPath: 'channelId' });
                } else {
                    syncStateStore = tx.objectStore(STORE_CHANNEL_SYNC_STATE);
                }
                if (!syncStateStore.indexNames.contains('nextEligibleCheckAt')) {
                    syncStateStore.createIndex('nextEligibleCheckAt', 'nextEligibleCheckAt', { unique: false });
                }
                if (!syncStateStore.indexNames.contains('lastSuccessfulCheckAt')) {
                    syncStateStore.createIndex('lastSuccessfulCheckAt', 'lastSuccessfulCheckAt', { unique: false });
                }
                if (!syncStateStore.indexNames.contains('retryAfter')) {
                    syncStateStore.createIndex('retryAfter', 'retryAfter', { unique: false });
                }

                let homeImpressionsStore;
                if (!db.objectStoreNames.contains(STORE_HOME_IMPRESSIONS)) {
                    homeImpressionsStore = db.createObjectStore(STORE_HOME_IMPRESSIONS, { keyPath: 'videoId' });
                } else {
                    homeImpressionsStore = tx.objectStore(STORE_HOME_IMPRESSIONS);
                }
                if (!homeImpressionsStore.indexNames.contains('lastShownOnHomeAt')) {
                    homeImpressionsStore.createIndex('lastShownOnHomeAt', 'lastShownOnHomeAt', { unique: false });
                }

                // Compact observability only: one summary per bounded scanner
                // run, never a persisted runner or a copy of RSS payloads.
                let feedSyncRunsStore;
                if (!db.objectStoreNames.contains(STORE_FEED_SYNC_RUNS)) {
                    feedSyncRunsStore = db.createObjectStore(STORE_FEED_SYNC_RUNS, { keyPath: 'runId' });
                } else {
                    feedSyncRunsStore = tx.objectStore(STORE_FEED_SYNC_RUNS);
                }
                if (!feedSyncRunsStore.indexNames.contains('completedAt')) {
                    feedSyncRunsStore.createIndex('completedAt', 'completedAt', { unique: false });
                }

                let aiLabelResultsStore;
                if (!db.objectStoreNames.contains(STORE_AI_LABEL_RESULTS)) {
                    aiLabelResultsStore = db.createObjectStore(STORE_AI_LABEL_RESULTS, { keyPath: 'videoId' });
                } else {
                    aiLabelResultsStore = tx.objectStore(STORE_AI_LABEL_RESULTS);
                }
                if (!aiLabelResultsStore.indexNames.contains('expiresAt')) {
                    aiLabelResultsStore.createIndex('expiresAt', 'expiresAt', { unique: false });
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
        async _withStore(storeName, mode, callback, operation = '') {
            const db = await this._getDB();
            return new Promise((resolve, reject) => {
                let tx;
                let failureLogged = false;
                const fail = (error) => {
                    if (!failureLogged) {
                        failureLogged = true;
                        logTransactionFailure(operation, storeName, mode, error);
                    }
                    reject(error);
                };
                try {
                    tx = db.transaction(storeName, mode);
                } catch (error) {
                    fail(error);
                    return;
                }

                const store = tx.objectStore(storeName);
                let result;

                try {
                    result = callback(store);
                } catch (error) {
                    fail(error);
                    return;
                }

                tx.oncomplete = () => resolve(result);
                tx.onerror = () => fail(tx.error || new Error('IndexedDB transaction failed'));
                tx.onabort = () => fail(tx.error || new Error('IndexedDB transaction aborted'));
            });
        }

        async _withStores(storeNames, mode, callback, operation = '') {
            const db = await this._getDB();
            return new Promise((resolve, reject) => {
                let tx;
                let failureLogged = false;
                const fail = (error) => {
                    if (!failureLogged) {
                        failureLogged = true;
                        logTransactionFailure(operation, storeNames, mode, error);
                    }
                    reject(error);
                };
                try {
                    tx = db.transaction(storeNames, mode);
                } catch (error) {
                    fail(error);
                    return;
                }
                const stores = Object.fromEntries(storeNames.map((name) => [name, tx.objectStore(name)]));
                let result;
                try {
                    result = callback(stores);
                } catch (error) {
                    try { tx.abort(); } catch (_) { /* ignore */ }
                    fail(error);
                    return;
                }
                tx.oncomplete = () => resolve(result);
                tx.onerror = () => fail(tx.error || new Error('IndexedDB transaction failed'));
                tx.onabort = () => fail(tx.error || new Error('IndexedDB transaction aborted'));
            });
        }

        _request(store, method, value) {
            return new Promise((resolve, reject) => {
                const request = store[method](value);
                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => reject(request.error || new Error(`IndexedDB ${method} failed`));
            });
        }

        async _getRecord(storeName, key) {
            if (!key) return null;
            return this._withStore(storeName, 'readonly', (store) => this._request(store, 'get', key));
        }

        async _putRecord(storeName, record, keyName, operation = '') {
            if (!record || !record[keyName]) {
                throw new Error(`Record must include ${keyName}`);
            }
            return this._withStore(storeName, 'readwrite', (store) => this._request(store, 'put', record), operation || `put:${storeName}`);
        }

        async _deleteRecord(storeName, key, operation = '') {
            if (!key) return;
            return this._withStore(storeName, 'readwrite', (store) => this._request(store, 'delete', key), operation || `delete:${storeName}`);
        }

        async _getAllRecords(storeName) {
            return this._withStore(storeName, 'readonly', (store) => this._request(store, 'getAll'));
        }

        async _getRecordsByIndex(storeName, indexName, options = {}) {
            const direction = options.direction || 'next';
            const limit = options.limit || 0;
            const range = options.range || null;
            return this._withStore(storeName, 'readonly', (store) => new Promise((resolve, reject) => {
                const records = [];
                const request = store.index(indexName).openCursor(range, direction);
                request.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (!cursor || (limit && records.length >= limit)) {
                        resolve(records);
                        return;
                    }
                    records.push(cursor.value);
                    cursor.continue();
                };
                request.onerror = () => reject(request.error || new Error(`IndexedDB index ${indexName} failed`));
            }));
        }

        _deleteRecordsByIndex(store, indexName, key) {
            return new Promise((resolve, reject) => {
                let deleted = 0;
                const request = store.index(indexName).openCursor(key);
                request.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (!cursor) {
                        resolve(deleted);
                        return;
                    }
                    cursor.delete();
                    deleted += 1;
                    cursor.continue();
                };
                request.onerror = () => reject(request.error || new Error(`IndexedDB index ${indexName} delete failed`));
            });
        }

        // --- Canonical local-feed repositories -----------------------------

        async getSubscriptionRecord(channelId) {
            return this._getRecord(STORE_SUBSCRIPTIONS, channelId);
        }

        async listSubscriptionRecords() {
            const records = await this._getAllRecords(STORE_SUBSCRIPTIONS);
            return records.sort((a, b) => Number(b.followedAt || 0) - Number(a.followedAt || 0));
        }

        async putSubscriptionRecord(record) {
            const channelId = String(record && record.channelId || '').trim();
            const source = String(record && record.source || '').trim();
            if (!/^UC[\w-]+$/.test(channelId)) {
                throw new Error('Subscription record must include a canonical channelId');
            }
            if (!EXPLICIT_SUBSCRIPTION_SOURCES.includes(source)) {
                throw new Error('Subscription record must use an explicit source');
            }
            const stored = {
                ...record,
                channelId,
                source,
                followedAt: Number(record.followedAt || Date.now())
            };
            await this._putRecord(STORE_SUBSCRIPTIONS, stored, 'channelId', 'putSubscriptionRecord');
            return stored;
        }

        async deleteSubscriptionRecord(channelId) {
            return this._deleteRecord(STORE_SUBSCRIPTIONS, channelId);
        }

        async getLocalUnsubscribeTombstone(channelId) {
            return this._getRecord(STORE_LOCAL_UNSUBSCRIBE_TOMBSTONES, channelId);
        }

        async listLocalUnsubscribeTombstones() {
            const records = await this._getAllRecords(STORE_LOCAL_UNSUBSCRIBE_TOMBSTONES);
            return records.sort((a, b) => Number(b.unsubscribedAt || 0) - Number(a.unsubscribedAt || 0));
        }

        async putLocalUnsubscribeTombstone(record) {
            const channelId = String(record && record.channelId || '').trim();
            if (!/^UC[\w-]+$/.test(channelId)) {
                throw new Error('Local unsubscribe tombstone must include a canonical channelId');
            }
            const tombstone = {
                ...record,
                schemaVersion: 1,
                channelId,
                unsubscribedAt: Number(record.unsubscribedAt || Date.now()),
                source: String(record.source || 'local_action'),
                reason: String(record.reason || 'user_unfollow')
            };
            await this._putRecord(STORE_LOCAL_UNSUBSCRIBE_TOMBSTONES, tombstone, 'channelId', 'putLocalUnsubscribeTombstone');
            return tombstone;
        }

        async deleteLocalUnsubscribeTombstone(channelId) {
            return this._deleteRecord(STORE_LOCAL_UNSUBSCRIBE_TOMBSTONES, channelId);
        }

        async softUnfollowSubscription(channelId, options = {}) {
            const normalizedChannelId = String(channelId || '').trim();
            if (!/^UC[\w-]+$/.test(normalizedChannelId)) {
                throw new Error('A canonical channelId is required for local unsubscribe');
            }
            const existing = await this.getSubscriptionRecord(normalizedChannelId);
            const tombstone = {
                ...options,
                schemaVersion: 1,
                channelId: normalizedChannelId,
                unsubscribedAt: Number(options.unsubscribedAt || Date.now()),
                source: String(options.source || 'local_action'),
                reason: String(options.reason || 'user_unfollow'),
                channelTitle: String(options.channelTitle || existing?.channelTitle || existing?.channelName || ''),
                thumbnail: String(options.thumbnail || existing?.thumbnail || ''),
                handle: String(options.handle || existing?.handle || '')
            };
            const storesToUpdate = [
                STORE_SUBSCRIPTIONS,
                STORE_CHANNEL_SYNC_STATE,
                STORE_SUBSCRIPTION_FEED_VIDEOS,
                STORE_LOCAL_UNSUBSCRIBE_TOMBSTONES
            ];
            return this._withStores(storesToUpdate, 'readwrite', async (stores) => {
                stores[STORE_SUBSCRIPTIONS].delete(normalizedChannelId);
                stores[STORE_CHANNEL_SYNC_STATE].delete(normalizedChannelId);
                stores[STORE_LOCAL_UNSUBSCRIBE_TOMBSTONES].put(tombstone);
                const deletedFeedVideoCount = await this._deleteRecordsByIndex(
                    stores[STORE_SUBSCRIPTION_FEED_VIDEOS],
                    'channelId',
                    normalizedChannelId
                );
                return { tombstone, deletedFeedVideoCount };
            }, 'softUnfollowSubscription');
        }

        async deleteSubscriptionAndSyncState(channelId, options = {}) {
            return this.softUnfollowSubscription(channelId, options);
        }

        async getSubscriptionFeedVideo(videoId) {
            return this._getRecord(STORE_SUBSCRIPTION_FEED_VIDEOS, videoId);
        }

        async putSubscriptionFeedVideo(record) {
            if (!record || !record.videoId || !record.channelId) {
                throw new Error('Feed video record must include videoId and channelId');
            }
            return this._putRecord(STORE_SUBSCRIPTION_FEED_VIDEOS, record, 'videoId', 'putSubscriptionFeedVideo');
        }

        async deleteSubscriptionFeedVideo(videoId) {
            return this._deleteRecord(STORE_SUBSCRIPTION_FEED_VIDEOS, videoId);
        }

        async deleteSubscriptionFeedVideosByChannelId(channelId) {
            if (!channelId) return 0;
            return this._withStore(STORE_SUBSCRIPTION_FEED_VIDEOS, 'readwrite', (store) =>
                this._deleteRecordsByIndex(store, 'channelId', channelId), 'deleteSubscriptionFeedVideosByChannelId');
        }

        async listSubscriptionFeedVideosByPublishedAt(limit = 0) {
            return this._getRecordsByIndex(STORE_SUBSCRIPTION_FEED_VIDEOS, 'publishedAt', {
                direction: 'prev',
                limit
            });
        }

        async listSubscriptionFeedVideosPageByPublishedAt(options = {}) {
            const limit = Math.max(1, Math.floor(Number(options.limit) || 50));
            const suppliedCursor = options.cursor || null;
            const cursor = suppliedCursor ? {
                publishedAt: Number(suppliedCursor.publishedAt),
                videoId: String(suppliedCursor.videoId || '')
            } : null;
            if (cursor && (!Number.isFinite(cursor.publishedAt) || !cursor.videoId)) {
                throw new TypeError('Feed page cursor must include publishedAt and videoId');
            }

            let range = null;
            if (cursor && typeof IDBKeyRange !== 'undefined') {
                range = IDBKeyRange.upperBound(cursor.publishedAt);
            }

            return this._withStore(STORE_SUBSCRIPTION_FEED_VIDEOS, 'readonly', (store) =>
                new Promise((resolve, reject) => {
                    const records = [];
                    const request = store.index('publishedAt').openCursor(range, 'prev');
                    const finish = (exhausted) => {
                        const last = records[records.length - 1];
                        resolve({
                            records,
                            nextCursor: last ? {
                                publishedAt: Number(last.publishedAt || 0),
                                videoId: String(last.videoId)
                            } : null,
                            exhausted
                        });
                    };
                    request.onsuccess = (event) => {
                        const indexCursor = event.target.result;
                        if (!indexCursor) {
                            finish(true);
                            return;
                        }
                        const record = indexCursor.value;
                        const publishedAt = Number(indexCursor.key ?? record.publishedAt ?? 0);
                        const videoId = String(indexCursor.primaryKey ?? record.videoId ?? '');
                        if (cursor && publishedAt === cursor.publishedAt && videoId >= cursor.videoId) {
                            indexCursor.continue();
                            return;
                        }
                        if (records.length >= limit) {
                            finish(false);
                            return;
                        }
                        records.push(record);
                        indexCursor.continue();
                    };
                    request.onerror = () => reject(request.error || new Error('IndexedDB feed pagination failed'));
                }));
        }

        async getChannelSyncState(channelId) {
            return this._getRecord(STORE_CHANNEL_SYNC_STATE, channelId);
        }

        async listChannelSyncStates() {
            return this._getAllRecords(STORE_CHANNEL_SYNC_STATE);
        }

        async putChannelSyncState(record) {
            return this._putRecord(STORE_CHANNEL_SYNC_STATE, record, 'channelId', 'putChannelSyncState');
        }

        async deleteChannelSyncState(channelId) {
            return this._deleteRecord(STORE_CHANNEL_SYNC_STATE, channelId);
        }

        async getEligibleChannelSyncStates(at, limit = 0) {
            if (typeof IDBKeyRange === 'undefined') {
                throw new Error('IDBKeyRange is not available');
            }
            return this._getRecordsByIndex(STORE_CHANNEL_SYNC_STATE, 'nextEligibleCheckAt', {
                range: IDBKeyRange.upperBound(Number(at)),
                limit
            });
        }

        async claimChannelSyncState(channelId, options = {}) {
            const runId = String(options.runId || '').trim();
            const now = Number(options.now || Date.now());
            const leaseMs = Number(options.leaseMs || 0);
            if (!channelId || !runId || !Number.isFinite(now) || leaseMs <= 0) {
                throw new Error('A channel claim requires channelId, runId, now, and positive leaseMs');
            }
            return this._withStore(STORE_CHANNEL_SYNC_STATE, 'readwrite', (store) => new Promise((resolve, reject) => {
                const getRequest = store.get(channelId);
                getRequest.onsuccess = () => {
                    const state = getRequest.result;
                    if (!state) {
                        resolve({ claimed: false, state: null });
                        return;
                    }
                    if (Number(state.scanLeaseUntil || 0) > now) {
                        resolve({ claimed: false, state });
                        return;
                    }
                    const claimedState = {
                        ...state,
                        scanLeaseUntil: now + leaseMs,
                        scanRunId: runId
                    };
                    const putRequest = store.put(claimedState);
                    putRequest.onsuccess = () => resolve({ claimed: true, state: claimedState });
                    putRequest.onerror = () => reject(putRequest.error || new Error('IndexedDB channel claim failed'));
                };
                getRequest.onerror = () => reject(getRequest.error || new Error('IndexedDB channel state read failed'));
            }), 'claimChannelSyncState');
        }

        async releaseChannelSyncState(channelId, runId, partial = {}) {
            return this._withStore(STORE_CHANNEL_SYNC_STATE, 'readwrite', (store) => new Promise((resolve, reject) => {
                const getRequest = store.get(channelId);
                getRequest.onsuccess = () => {
                    const state = getRequest.result;
                    if (!state || state.scanRunId !== runId) {
                        resolve(false);
                        return;
                    }
                    const releasedState = {
                        ...state,
                        ...partial,
                        scanLeaseUntil: null,
                        scanRunId: null
                    };
                    const putRequest = store.put(releasedState);
                    putRequest.onsuccess = () => resolve(true);
                    putRequest.onerror = () => reject(putRequest.error || new Error('IndexedDB channel release failed'));
                };
                getRequest.onerror = () => reject(getRequest.error || new Error('IndexedDB channel state read failed'));
            }), 'releaseChannelSyncState');
        }

        async getHomeImpression(videoId) {
            return this._getRecord(STORE_HOME_IMPRESSIONS, videoId);
        }

        async putHomeImpression(record) {
            return this._putRecord(STORE_HOME_IMPRESSIONS, record, 'videoId');
        }

        async deleteHomeImpression(videoId) {
            return this._deleteRecord(STORE_HOME_IMPRESSIONS, videoId);
        }

        async listHomeImpressionsByLastShown(limit = 0) {
            return this._getRecordsByIndex(STORE_HOME_IMPRESSIONS, 'lastShownOnHomeAt', { direction: 'prev', limit });
        }

        async putFeedSyncRun(record) {
            if (!record || !record.runId) throw new Error('Feed sync run must include runId');
            return this._putRecord(STORE_FEED_SYNC_RUNS, record, 'runId', 'putFeedSyncRun');
        }

        async listFeedSyncRunsByCompletedAt(limit = 0) {
            return this._getRecordsByIndex(STORE_FEED_SYNC_RUNS, 'completedAt', { direction: 'prev', limit });
        }

        async deleteFeedSyncRun(runId) {
            return this._deleteRecord(STORE_FEED_SYNC_RUNS, runId);
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

            const tokens = searchTokens(searchQuery);
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

                        // Filter by search query (title + channel, any word order)
                        if (tokens.length && !recordMatchesTokens(record, tokens)) {
                            cursor.continue();
                            return;
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

            const tokens = searchTokens(searchQuery);
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

                        // Filter by search query (title + channel, any word order)
                        if (tokens.length && !recordMatchesTokens(record, tokens)) {
                            cursor.continue();
                            return;
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

        // --- AI-label lookup cache -----------------------------------------

        async getAiLabelResult(videoId) {
            return this._getRecord(STORE_AI_LABEL_RESULTS, videoId);
        }

        async listAiLabelResults() {
            return this._withStore(STORE_AI_LABEL_RESULTS, 'readonly', (store) => {
                return new Promise((resolve, reject) => {
                    const request = store.getAll();
                    request.onsuccess = () => resolve(request.result || []);
                    request.onerror = () => reject(request.error);
                });
            });
        }

        async putAiLabelResult(record) {
            if (!record || !record.videoId || !['ai', 'unlabeled', 'unknown'].includes(record.status)) {
                throw new Error('AI label result must include a videoId and valid status');
            }
            return this._putRecord(STORE_AI_LABEL_RESULTS, record, 'videoId', 'putAiLabelResult');
        }

        async clearAiLabelResults() {
            return this._withStore(STORE_AI_LABEL_RESULTS, 'readwrite', (store) => this._request(store, 'clear'), 'clearAiLabelResults');
        }

        // --- Utilities ------------------------------------------------------

        async clearHistory() {
            const storeNames = [STORE_VIDEOS, STORE_PLAYLISTS, STORE_DELETIONS];
            return this._withStores(storeNames, 'readwrite', (stores) => {
                storeNames.forEach((storeName) => stores[storeName].clear());
            });
        }

        async clearAll() {
            const storeNames = [
                STORE_VIDEOS,
                STORE_PLAYLISTS,
                STORE_DELETIONS,
                STORE_SUBSCRIPTIONS,
                STORE_SUBSCRIPTION_FEED_VIDEOS,
                STORE_CHANNEL_SYNC_STATE,
                STORE_HOME_IMPRESSIONS,
                STORE_FEED_SYNC_RUNS,
                STORE_LOCAL_UNSUBSCRIBE_TOMBSTONES,
                STORE_AI_LABEL_RESULTS
            ];
            return this._withStores(storeNames, 'readwrite', (stores) => {
                storeNames.forEach((storeName) => stores[storeName].clear());
            });
        }
    }

    // Expose a singleton instance globally for reuse in background, popup and content scripts.
    // This keeps the API simple and avoids multiple competing DB connections.
    globalScope.ytIndexedDBStorage = new IndexedDBStorage();

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            DB_NAME,
            DB_VERSION,
            STORE_SUBSCRIPTIONS,
            STORE_SUBSCRIPTION_FEED_VIDEOS,
            STORE_CHANNEL_SYNC_STATE,
            STORE_HOME_IMPRESSIONS,
            STORE_AI_LABEL_RESULTS,
            STORE_FEED_SYNC_RUNS,
            STORE_LOCAL_UNSUBSCRIBE_TOMBSTONES,
            EXPLICIT_SUBSCRIPTION_SOURCES,
            IndexedDBStorage,
            openDatabase
        };
    }

})();

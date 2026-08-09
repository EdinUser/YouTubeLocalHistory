(function (root) {
    'use strict';

    const SCAN_ERROR_CODES = Object.freeze([
        'no_channel_id',
        'network',
        'timeout',
        'http',
        'parse',
        'aborted'
    ]);

    const SCAN_OUTCOMES = Object.freeze([
        'updated',
        'unchanged',
        'failed',
        'timed_out'
    ]);

    const SUBSCRIPTION_SOURCES = Object.freeze([
        'takeout_csv',
        'oauth',
        'manual'
    ]);

    const IMPORT_SOURCES = Object.freeze([
        'takeout_history',
        'takeout_subscriptions',
        'backup',
        'oauth'
    ]);

    // Shared feed/analytics semantics. Boundary behavior is intentional:
    // skipped is below 10%, completed is at or above 90%, and a long video is
    // at least ten minutes. Feed pagination always advances in 50-item steps.
    const FEED_PAGE_SIZE = 50;
    const WATCH_SKIP_RATIO = 0.1;
    const WATCH_COMPLETION_RATIO = 0.9;
    const LONG_VIDEO_MIN_DURATION_SECONDS = 10 * 60;
    const LOCAL_UNSUBSCRIBE_TOMBSTONE_SCHEMA_VERSION = 1;
    const LOCAL_UNSUBSCRIBE_TOMBSTONE_STORE = 'local_unsubscribe_tombstones';

    function assert(condition, message) {
        if (!condition) throw new TypeError(message);
    }

    function nonNegativeInteger(value, fieldName) {
        const number = Number(value);
        assert(Number.isInteger(number) && number >= 0, `${fieldName} must be a non-negative integer`);
        return number;
    }

    function timestamp(value, fieldName) {
        const number = Number(value);
        assert(Number.isFinite(number) && number >= 0, `${fieldName} must be a non-negative timestamp`);
        return number;
    }

    function nonEmptyString(value, fieldName) {
        const text = String(value || '').trim();
        assert(text.length > 0, `${fieldName} is required`);
        return text;
    }

    function canonicalChannelId(value, fieldName = 'channelId') {
        const channelId = nonEmptyString(value, fieldName);
        assert(/^UC[\w-]+$/.test(channelId), `${fieldName} must be a canonical channel ID`);
        return channelId;
    }

    function createPendingFeedDiscovery(input) {
        const source = input || {};
        const seen = new Set();
        const videoIds = [];
        (Array.isArray(source.videoIds) ? source.videoIds : []).forEach((value) => {
            const videoId = String(value || '').trim();
            if (!videoId || seen.has(videoId)) return;
            seen.add(videoId);
            videoIds.push(videoId);
        });
        return {
            videoIds,
            discoveredAt: timestamp(source.discoveredAt !== undefined ? source.discoveredAt : 0, 'discoveredAt')
        };
    }

    function createLocalUnsubscribeTombstone(input) {
        const source = input || {};
        const tombstone = {
            schemaVersion: LOCAL_UNSUBSCRIBE_TOMBSTONE_SCHEMA_VERSION,
            channelId: canonicalChannelId(source.channelId),
            unsubscribedAt: timestamp(source.unsubscribedAt, 'unsubscribedAt'),
            source: nonEmptyString(source.source || 'local_action', 'local unsubscribe source'),
            reason: nonEmptyString(source.reason || 'user_unfollow', 'local unsubscribe reason')
        };
        ['channelTitle', 'thumbnail', 'handle'].forEach((field) => {
            const value = String(source[field] || '').trim();
            if (value) tombstone[field] = value;
        });
        return tombstone;
    }

    function createScanError(input) {
        const source = input || {};
        const code = nonEmptyString(source.code, 'scan error code');
        assert(SCAN_ERROR_CODES.includes(code), `unsupported scan error code: ${code}`);

        const error = {
            code,
            message: String(source.message || code)
        };
        if (source.status !== undefined && source.status !== null) {
            error.status = nonNegativeInteger(source.status, 'scan error status');
        }
        return error;
    }

    function normalizeFeedEntry(input, channelId) {
        const source = input || {};
        const videoId = nonEmptyString(source.videoId, 'videoId');
        const normalizedChannelId = nonEmptyString(channelId || source.channelId, 'channelId');

        return {
            videoId,
            channelId: normalizedChannelId,
            title: String(source.title || 'Untitled'),
            thumbnailUrl: source.thumbnailUrl || source.thumbnail || '',
            publishedAt: timestamp(source.publishedAt !== undefined ? source.publishedAt : source.published, 'publishedAt'),
            discoveredAt: timestamp(source.discoveredAt !== undefined ? source.discoveredAt : 0, 'discoveredAt'),
            lastSeenInFeedAt: timestamp(source.lastSeenInFeedAt !== undefined ? source.lastSeenInFeedAt : 0, 'lastSeenInFeedAt'),
            durationSeconds: source.durationSeconds === undefined ? null : source.durationSeconds,
            isShort: source.isShort === undefined ? null : source.isShort,
            source: 'rss'
        };
    }

    function createRssScanResult(input) {
        const source = input || {};
        const channelId = nonEmptyString(source.channelId, 'channelId');
        const error = source.error ? createScanError(source.error) : null;
        const entries = Array.isArray(source.entries) ? source.entries : [];

        return {
            channelId,
            entries: error ? [] : entries.map((entry) => normalizeFeedEntry(entry, channelId)),
            fetchedAt: timestamp(source.fetchedAt, 'fetchedAt'),
            error
        };
    }

    function createTerminalResult(input) {
        const source = input || {};
        const channelId = nonEmptyString(source.channelId, 'channelId');
        const outcome = nonEmptyString(source.outcome, 'outcome');
        assert(SCAN_OUTCOMES.includes(outcome), `unsupported scan outcome: ${outcome}`);
        const insertedVideoIds = createPendingFeedDiscovery({
            videoIds: source.insertedVideoIds,
            discoveredAt: 0
        }).videoIds;

        const terminal = {
            channelId,
            outcome,
            insertedVideoCount: nonNegativeInteger(
                source.insertedVideoCount === undefined ? insertedVideoIds.length : source.insertedVideoCount,
                'insertedVideoCount'
            ),
            completedAt: timestamp(source.completedAt, 'completedAt')
        };
        if (Array.isArray(source.insertedVideoIds)) terminal.insertedVideoIds = insertedVideoIds;
        return terminal;
    }

    function createForegroundProgress(input) {
        const source = input || {};
        const completed = nonNegativeInteger(source.completed, 'completed');
        const total = nonNegativeInteger(source.total, 'total');
        assert(completed <= total, 'completed cannot exceed total');
        const insertedVideoIds = createPendingFeedDiscovery({
            videoIds: source.insertedVideoIds,
            discoveredAt: 0
        }).videoIds;

        const progress = {
            runId: nonEmptyString(source.runId, 'runId'),
            completed,
            total,
            insertedVideoCount: nonNegativeInteger(
                source.insertedVideoCount === undefined ? insertedVideoIds.length : source.insertedVideoCount,
                'insertedVideoCount'
            ),
            active: Boolean(source.active)
        };
        if (Array.isArray(source.insertedVideoIds)) progress.insertedVideoIds = insertedVideoIds;
        return progress;
    }

    function canInitializeSubscription(subscription) {
        const source = subscription || {};
        return SUBSCRIPTION_SOURCES.includes(source.source) &&
            /^UC[\w-]+$/.test(String(source.channelId || source.ucid || ''));
    }

    function createImportOutcome(input) {
        const source = input || {};
        const importSource = nonEmptyString(source.source, 'import source');
        assert(IMPORT_SOURCES.includes(importSource), `unsupported import source: ${importSource}`);
        const invalid = Array.isArray(source.invalid) ? source.invalid.slice(0, 20).map((item) => ({
            row: nonNegativeInteger(item.row, 'invalid row'),
            reason: nonEmptyString(item.reason, 'invalid reason')
        })) : [];
        const ignoredChannels = Array.isArray(source.ignoredChannels)
            ? source.ignoredChannels.slice(0, 20).map((item) => ({
                channelId: canonicalChannelId(item.channelId, 'ignored channelId'),
                channelTitle: String(item.channelTitle || ''),
                unsubscribedAt: timestamp(item.unsubscribedAt || 0, 'ignored unsubscribedAt'),
                reason: String(item.reason || 'user_unfollow')
            }))
            : [];

        return {
            source: importSource,
            found: nonNegativeInteger(source.found || 0, 'found'),
            valid: nonNegativeInteger(source.valid || 0, 'valid'),
            added: nonNegativeInteger(source.added || 0, 'added'),
            updated: nonNegativeInteger(source.updated || 0, 'updated'),
            unchanged: nonNegativeInteger(source.unchanged || 0, 'unchanged'),
            skipped: nonNegativeInteger(source.skipped || 0, 'skipped'),
            ignored: nonNegativeInteger(source.ignored || 0, 'ignored'),
            ignoredChannels,
            invalid,
            fatalError: source.fatalError ? String(source.fatalError) : null,
            initializationQueued: nonNegativeInteger(source.initializationQueued || 0, 'initializationQueued')
        };
    }

    const api = {
        SCAN_ERROR_CODES,
        SCAN_OUTCOMES,
        SUBSCRIPTION_SOURCES,
        IMPORT_SOURCES,
        FEED_PAGE_SIZE,
        WATCH_SKIP_RATIO,
        WATCH_COMPLETION_RATIO,
        LONG_VIDEO_MIN_DURATION_SECONDS,
        LOCAL_UNSUBSCRIBE_TOMBSTONE_SCHEMA_VERSION,
        LOCAL_UNSUBSCRIBE_TOMBSTONE_STORE,
        createScanError,
        createPendingFeedDiscovery,
        createLocalUnsubscribeTombstone,
        normalizeFeedEntry,
        createRssScanResult,
        createTerminalResult,
        createForegroundProgress,
        canInitializeSubscription,
        createImportOutcome
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.ytvhtFeedContracts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

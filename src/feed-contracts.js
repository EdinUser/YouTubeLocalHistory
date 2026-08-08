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

        return {
            channelId,
            outcome,
            insertedVideoCount: nonNegativeInteger(source.insertedVideoCount || 0, 'insertedVideoCount'),
            completedAt: timestamp(source.completedAt, 'completedAt')
        };
    }

    function createForegroundProgress(input) {
        const source = input || {};
        const completed = nonNegativeInteger(source.completed, 'completed');
        const total = nonNegativeInteger(source.total, 'total');
        assert(completed <= total, 'completed cannot exceed total');

        return {
            runId: nonEmptyString(source.runId, 'runId'),
            completed,
            total,
            insertedVideoCount: nonNegativeInteger(source.insertedVideoCount || 0, 'insertedVideoCount'),
            active: Boolean(source.active)
        };
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

        return {
            source: importSource,
            found: nonNegativeInteger(source.found || 0, 'found'),
            valid: nonNegativeInteger(source.valid || 0, 'valid'),
            added: nonNegativeInteger(source.added || 0, 'added'),
            updated: nonNegativeInteger(source.updated || 0, 'updated'),
            unchanged: nonNegativeInteger(source.unchanged || 0, 'unchanged'),
            skipped: nonNegativeInteger(source.skipped || 0, 'skipped'),
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
        createScanError,
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

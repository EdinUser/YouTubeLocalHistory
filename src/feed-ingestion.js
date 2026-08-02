(function (root) {
    'use strict';

    const contracts = root.ytvhtFeedContracts || (typeof require === 'function' ? require('./feed-contracts.js') : null);

    function mergeFeedVideo(existing, entry, discoveredAt) {
        return {
            ...existing,
            ...entry,
            discoveredAt: existing && existing.discoveredAt || discoveredAt,
            lastSeenInFeedAt: discoveredAt,
            durationSeconds: existing && existing.durationSeconds !== undefined ? existing.durationSeconds : entry.durationSeconds,
            isShort: existing && existing.isShort !== undefined ? existing.isShort : entry.isShort,
            source: 'rss'
        };
    }

    function updatedSyncState(existing, scan, now) {
        const base = { ...(existing || {}), channelId: scan.channelId, lastAttemptAt: now };
        if (scan.error) {
            return { ...base, failureCount: Number(base.failureCount || 0) + 1 };
        }
        const latest = scan.entries.reduce((current, entry) => !current || entry.publishedAt > current.publishedAt ? entry : current, null);
        return {
            ...base,
            lastSuccessfulCheckAt: now,
            failureCount: 0,
            retryAfter: null,
            latestKnownVideoId: latest ? latest.videoId : base.latestKnownVideoId || null,
            latestUploadAt: latest ? latest.publishedAt : base.latestUploadAt || null,
            unchangedChecks: latest ? Number(base.unchangedChecks || 0) : Number(base.unchangedChecks || 0) + 1
        };
    }

    async function ingestRssScan(scanResult, options = {}) {
        if (!contracts) throw new Error('Feed contracts are unavailable');
        const storage = options.storage;
        if (!storage || typeof storage.getSubscriptionFeedVideo !== 'function' || typeof storage.putSubscriptionFeedVideo !== 'function' || typeof storage.getChannelSyncState !== 'function' || typeof storage.putChannelSyncState !== 'function') {
            throw new TypeError('A feed repository storage is required');
        }
        const scan = contracts.createRssScanResult(scanResult);
        const completedAt = Number(options.now === undefined ? scan.fetchedAt : options.now);
        let insertedVideoCount = 0;

        if (!scan.error) {
            for (const entry of scan.entries) {
                const existing = await storage.getSubscriptionFeedVideo(entry.videoId);
                if (!existing) insertedVideoCount += 1;
                await storage.putSubscriptionFeedVideo(mergeFeedVideo(existing, entry, completedAt));
            }
        }
        const currentState = await storage.getChannelSyncState(scan.channelId);
        await storage.putChannelSyncState(updatedSyncState(currentState, scan, completedAt));

        const terminal = contracts.createTerminalResult({
            channelId: scan.channelId,
            outcome: scan.error ? (scan.error.code === 'timeout' ? 'timed_out' : 'failed') : (insertedVideoCount ? 'updated' : 'unchanged'),
            insertedVideoCount,
            completedAt
        });
        if (typeof options.onProgress === 'function') options.onProgress(terminal);
        return terminal;
    }

    const api = { mergeFeedVideo, ingestRssScan };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.ytvhtFeedIngestion = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

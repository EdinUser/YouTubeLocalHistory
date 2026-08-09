(function (root) {
    'use strict';

    // Feed inventory is a disposable cache. These limits deliberately apply
    // only to v5 feed stores; durable history/progress/playlists are never
    // passed to this service or referenced here.
    const DEFAULTS = Object.freeze({
        maxFeedVideos: 7500,
        maxFeedVideoAgeMs: 270 * 24 * 60 * 60 * 1000,
        maxHomeImpressions: 10000,
        maxHomeImpressionAgeMs: 120 * 24 * 60 * 60 * 1000,
        maxDiagnostics: 100,
        maxDiagnosticAgeMs: 30 * 24 * 60 * 60 * 1000
    });

    function isOlderThan(value, cutoff) {
        return Number(value || 0) < cutoff;
    }

    async function cleanupFeedData(storage, options = {}) {
        if (!storage || typeof storage.listSubscriptionFeedVideosByPublishedAt !== 'function') {
            throw new TypeError('Feed retention requires the canonical feed repository');
        }
        const settings = { ...DEFAULTS, ...options };
        const now = Number(settings.now === undefined ? Date.now() : settings.now);
        const videoCutoff = now - settings.maxFeedVideoAgeMs;
        const impressionCutoff = now - settings.maxHomeImpressionAgeMs;
        const diagnosticCutoff = now - settings.maxDiagnosticAgeMs;
        const videos = await storage.listSubscriptionFeedVideosByPublishedAt();
        const retainedVideoIds = new Set();
        const deleteVideoIds = [];

        videos.forEach((video, index) => {
            const retain = index < settings.maxFeedVideos && !isOlderThan(video.publishedAt || video.lastSeenInFeedAt, videoCutoff);
            if (retain) retainedVideoIds.add(video.videoId);
            else deleteVideoIds.push(video.videoId);
        });
        await Promise.all(deleteVideoIds.map((videoId) => storage.deleteSubscriptionFeedVideo(videoId)));

        let deletedImpressions = 0;
        if (typeof storage.listHomeImpressionsByLastShown === 'function' && typeof storage.deleteHomeImpression === 'function') {
            const impressions = await storage.listHomeImpressionsByLastShown();
            const deleteImpressionIds = impressions.filter((impression, index) =>
                !retainedVideoIds.has(impression.videoId) ||
                isOlderThan(impression.lastShownOnHomeAt, impressionCutoff) ||
                index >= settings.maxHomeImpressions
            ).map((impression) => impression.videoId);
            await Promise.all(deleteImpressionIds.map((videoId) => storage.deleteHomeImpression(videoId)));
            deletedImpressions = deleteImpressionIds.length;
        }

        let deletedDiagnostics = 0;
        if (typeof storage.listFeedSyncRunsByCompletedAt === 'function' && typeof storage.deleteFeedSyncRun === 'function') {
            const runs = await storage.listFeedSyncRunsByCompletedAt();
            const deleteRunIds = runs.filter((run, index) =>
                isOlderThan(run.completedAt, diagnosticCutoff) || index >= settings.maxDiagnostics
            ).map((run) => run.runId);
            await Promise.all(deleteRunIds.map((runId) => storage.deleteFeedSyncRun(runId)));
            deletedDiagnostics = deleteRunIds.length;
        }

        return {
            retainedFeedVideos: retainedVideoIds.size,
            deletedFeedVideos: deleteVideoIds.length,
            deletedHomeImpressions: deletedImpressions,
            deletedDiagnostics
        };
    }

    const api = { DEFAULTS, cleanupFeedData };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.ytvhtFeedRetention = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

(function (root) {
    'use strict';

    async function enrichVisibleItems(videoIds, enrich, options = {}) {
        if (typeof enrich !== 'function') throw new TypeError('An enrichment function is required');
        const limit = Math.max(0, Number(options.limit === undefined ? 12 : options.limit));
        const uniqueIds = [...new Set(Array.isArray(videoIds) ? videoIds.filter(Boolean) : [])].slice(0, limit);
        const results = [];
        for (const videoId of uniqueIds) results.push(await enrich(videoId));
        return results;
    }

    const api = { enrichVisibleItems };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.ytvhtFeedEnrichment = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

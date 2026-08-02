(function (root) {
    'use strict';

    async function runPool(items, concurrency, worker) {
        const queue = Array.isArray(items) ? items.slice() : [];
        const limit = Math.max(1, Number(concurrency) || 1);
        let nextIndex = 0;

        async function consume() {
            while (nextIndex < queue.length) {
                const item = queue[nextIndex++];
                await worker(item);
            }
        }

        await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, consume));
    }

    const api = { runPool };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.ytvhtFeedAsync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

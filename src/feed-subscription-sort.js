(function (root) {
    'use strict';

    const DEFAULT_SUBSCRIPTION_SORT = 'published_desc';

    function timestamp(video, field) {
        return Number(video && video[field] || 0);
    }

    function sortSubscriptionVideos(videos, sort = DEFAULT_SUBSCRIPTION_SORT) {
        const sorted = [...(videos || [])];
        const byVideoId = (left, right) => String(left.videoId || '').localeCompare(String(right.videoId || ''));
        sorted.sort((left, right) => {
            if (sort === 'published_asc') {
                return (timestamp(left, 'publishedAt') - timestamp(right, 'publishedAt')) || byVideoId(left, right);
            }
            if (sort === 'discovered_desc') {
                return (timestamp(right, 'discoveredAt') - timestamp(left, 'discoveredAt')) ||
                    (timestamp(right, 'publishedAt') - timestamp(left, 'publishedAt')) || byVideoId(left, right);
            }
            return (timestamp(right, 'publishedAt') - timestamp(left, 'publishedAt')) || byVideoId(left, right);
        });
        return sorted;
    }

    const api = { DEFAULT_SUBSCRIPTION_SORT, sortSubscriptionVideos };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.ytvhtSubscriptionSort = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

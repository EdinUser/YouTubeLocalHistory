(function (root) {
    'use strict';

    function toViewVideo(record) {
        if (!record || !record.videoId || !record.channelId) return null;
        return {
            ...record,
            published: Number(record.publishedAt || 0),
            thumbnail: record.thumbnailUrl || `https://i.ytimg.com/vi/${record.videoId}/hqdefault.jpg`,
            channelName: record.channelTitle || record.channelName || record.channelId,
            channelUrl: `https://www.youtube.com/channel/${record.channelId}`,
            url: `https://www.youtube.com/watch?v=${encodeURIComponent(record.videoId)}`,
            duration: Number(record.durationSeconds || 0),
            isShort: record.isShort === true ? true : (record.isShort === false ? false : null)
        };
    }

    function toViewSubscription(record) {
        if (!record || !record.channelId) return null;
        return {
            ...record,
            id: record.channelId,
            ucid: record.channelId,
            channelName: record.channelTitle || record.channelName || record.channelId,
            thumbnail: record.thumbnail || '',
            url: `https://www.youtube.com/channel/${record.channelId}`
        };
    }

    async function loadActiveSubscriptions(storage) {
        const [subscriptions, tombstones] = await Promise.all([
            storage.listSubscriptionRecords(),
            typeof storage.listLocalUnsubscribeTombstones === 'function'
                ? storage.listLocalUnsubscribeTombstones()
                : []
        ]);
        const tombstonedChannelIds = new Set(tombstones.map((tombstone) => tombstone.channelId));
        return subscriptions.filter((subscription) => !tombstonedChannelIds.has(subscription.channelId));
    }

    function projectActiveFeedVideos(videos, activeSubscriptions) {
        const subscriptionByChannelId = new Map(
            activeSubscriptions.map((subscription) => [subscription.channelId, subscription])
        );
        return videos.filter((video) => subscriptionByChannelId.has(video.channelId)).map((video) => {
            const subscription = subscriptionByChannelId.get(video.channelId);
            return toViewVideo({
                ...video,
                channelTitle: video.channelTitle || (subscription && (subscription.channelTitle || subscription.channelName)) || ''
            });
        }).filter(Boolean);
    }

    async function loadCanonicalFeedViewData(storage, limit = 0) {
        if (!storage || typeof storage.listSubscriptionFeedVideosByPublishedAt !== 'function' || typeof storage.listSubscriptionRecords !== 'function') {
            throw new TypeError('Canonical feed repositories are required');
        }
        const [videos, activeSubscriptions] = await Promise.all([
            storage.listSubscriptionFeedVideosByPublishedAt(limit),
            loadActiveSubscriptions(storage)
        ]);
        return {
            videos: projectActiveFeedVideos(videos, activeSubscriptions),
            subscriptions: activeSubscriptions.map(toViewSubscription).filter(Boolean)
        };
    }

    async function loadCanonicalSubscriptionFeedPage(storage, options = {}) {
        if (!storage || typeof storage.listSubscriptionFeedVideosPageByPublishedAt !== 'function' ||
            typeof storage.listSubscriptionRecords !== 'function') {
            throw new TypeError('Canonical paginated feed repositories are required');
        }
        const [page, activeSubscriptions] = await Promise.all([
            storage.listSubscriptionFeedVideosPageByPublishedAt({
                limit: options.limit,
                cursor: options.cursor || null
            }),
            loadActiveSubscriptions(storage)
        ]);
        return {
            videos: projectActiveFeedVideos(page.records || [], activeSubscriptions),
            subscriptions: activeSubscriptions.map(toViewSubscription).filter(Boolean),
            nextCursor: page.nextCursor || null,
            exhausted: page.exhausted === true
        };
    }

    async function persistHomeImpressions(storage, videos, shownAt, limit = 120) {
        if (!storage || typeof storage.getHomeImpression !== 'function' || typeof storage.putHomeImpression !== 'function') return;
        const selected = (videos || []).slice(0, limit).filter((video) => video && video.videoId);
        await Promise.all(selected.map(async (video) => {
            const prior = await storage.getHomeImpression(video.videoId);
            await storage.putHomeImpression({
                videoId: video.videoId,
                lastShownOnHomeAt: shownAt,
                homeImpressionCount: Number(prior && prior.homeImpressionCount || 0) + 1,
                consecutiveHomeAppearances: Number(prior && prior.lastShownOnHomeAt || 0) ? Number(prior.consecutiveHomeAppearances || 0) + 1 : 1
            });
        }));
    }

    const api = {
        toViewVideo,
        toViewSubscription,
        loadCanonicalFeedViewData,
        loadCanonicalSubscriptionFeedPage,
        persistHomeImpressions
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.ytvhtFeedViewData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

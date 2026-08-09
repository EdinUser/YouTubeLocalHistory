(function (root) {
    'use strict';
    const DAY_MS = 24 * 60 * 60 * 1000;
    const RETRY_MS = 7 * DAY_MS;

    const decode = (value) => String(value || '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    const match = (text, pattern) => {
        const value = String(text || '').match(pattern);
        return value ? decode(value[1]).replace(/\\\//g, '/') : '';
    };
    function runsText(text, key, endKey) {
        const start = String(text || '').indexOf(`"${key}":`);
        if (start < 0) return '';
        const end = String(text).indexOf(`"${endKey}":`, start);
        const fragment = String(text).slice(start, end < 0 ? start + 1200 : end);
        return [...fragment.matchAll(/"text":"([^"]*)"/g)].map((entry) => decode(entry[1])).join('');
    }

    function parseChannelMetadata(text, url) {
        const title = match(text, /<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i)
            || match(text, /"channelMetadataRenderer"\s*:\s*\{"title":"([^"]+)/i)
            || match(text, /<title>([^<]*)<\/title>/i).replace(/\s*-\s*YouTube\s*$/i, '');
        const avatar = match(text, /<meta[^>]+property="og:image"[^>]+content="([^"]*)"/i)
            || match(text, /"avatar"\s*:\s*\{"thumbnails"\s*:\s*\[\{"url":"([^"]+)/i);
        const banner = match(text, /"banner"\s*:\s*\{"imageBannerViewModel"\s*:\s*\{"image"\s*:\s*\{"sources"\s*:\s*\[\{"url":"([^"]+)/i)
            || match(text, /"banner"\s*:\s*\{"thumbnails"\s*:\s*\[\{"url":"([^"]+)/i);
        const subscriberCount = match(text, /"subscriberCountText"\s*:\s*\{"simpleText":"([^"]+)/i);
        const videoCount = runsText(text, 'videoCountText', 'subscriberCountText');
        const handle = (String(url || '').match(/\/(@[\w.-]+)/) || [])[1]
            || match(text, /"ownerUrls"\s*:\s*\["https?:\/\/[^"/]+\/(@[\w.-]+)/i)
            || '';
        return { channelTitle: title, thumbnail: avatar, bannerUrl: banner, subscriberCount, videoCount, handle };
    }

    function needsHydration(subscription, now = Date.now()) {
        return !subscription || (!subscription.metadataHydratedAt || Number(subscription.metadataHydratedAt) < now - 30 * DAY_MS) &&
            Number(subscription.metadataRetryAfter || 0) <= now;
    }

    function selectHydrationBatch(subscriptions, processedIds, now = Date.now(), limit = 15) {
        return (subscriptions || []).filter((subscription) => needsHydration(subscription, now) && !processedIds.has(subscription.channelId)).slice(0, limit);
    }

    async function hydrateChannel(subscription, options = {}) {
        const fetchImpl = options.fetch || fetch;
        const now = Number(options.now || Date.now());
        const url = subscription.url || `https://www.youtube.com/channel/${subscription.channelId}`;
        try {
            const requestOptions = { credentials: 'omit' };
            if (options.signal) requestOptions.signal = options.signal;
            const response = await fetchImpl(url, requestOptions);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const metadata = parseChannelMetadata(await response.text(), response.url || url);
            if (!Object.values(metadata).some(Boolean)) throw new Error('No public channel metadata in response');
            return { ...subscription, ...Object.fromEntries(Object.entries(metadata).filter(([, value]) => value)), metadataHydratedAt: now, metadataRetryAfter: null };
        } catch (_) {
            return { ...subscription, metadataRetryAfter: now + RETRY_MS };
        }
    }

    async function hydrateSubscriptionBatch(subscriptions, options = {}) {
        const storage = options.storage;
        if (!storage || typeof storage.putSubscriptionRecord !== 'function') {
            throw new TypeError('A subscriptions repository is required');
        }
        const processedIds = options.processedIds || new Set();
        const concurrency = Math.max(1, Number(options.concurrency || 3));
        let next = 0;
        const worker = async () => {
            while (!options.signal?.aborted) {
                const subscription = subscriptions[next++];
                if (!subscription) return;
                const updated = await hydrateChannel(subscription, options);
                if (options.signal?.aborted) return;
                await storage.putSubscriptionRecord(updated);
                processedIds.add(subscription.channelId);
            }
        };
        await Promise.all(Array.from({ length: Math.min(concurrency, subscriptions.length) }, worker));
        return processedIds;
    }

    const api = { DAY_MS, RETRY_MS, parseChannelMetadata, needsHydration, selectHydrationBatch, hydrateChannel, hydrateSubscriptionBatch };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.ytvhtFeedChannelMetadata = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

// Shared Home feed parser/selector for YT re:Watch.
//
// Loaded by both the YouTube content script and the extension feed page. Keep
// YouTube upload parsing and cache selection here so the two surfaces cannot
// drift into different feed systems again.
(function () {
    'use strict';

    const FEED_CACHE_POLICY = 'balanced-backfill-rss-dates-v9';
    const CHANNEL_BACKFILL_MAX_AGE_DAYS = 1095;
    const CHANNEL_BACKFILL_LIMIT = 120;
    const CHANNEL_BACKFILL_MAX_PAGES = 8;

    function newestFirstVideos(videos) {
        return videos.slice()
            .sort((a, b) => Number(b?.published || 0) - Number(a?.published || 0));
    }

    function feedChannelKey(video) {
        return String(video?.channelId || video?.channelUrl || video?.channelName || 'unknown').toLowerCase();
    }

    function roundRobinByChannel(videos, limit) {
        const groups = new Map();
        videos.forEach((video) => {
            const key = feedChannelKey(video);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(video);
        });
        const keys = Array.from(groups.keys());
        const picked = [];
        while (picked.length < limit && keys.length) {
            let advanced = false;
            for (let i = 0; i < keys.length && picked.length < limit; i++) {
                const next = groups.get(keys[i])?.shift();
                if (next) {
                    picked.push(next);
                    advanced = true;
                }
            }
            if (!advanced) break;
        }
        return picked;
    }

    function selectFeedVideos(videos, limit) {
        const sorted = newestFirstVideos(videos);
        const selected = [];
        const selectedIds = new Set();
        const now = Date.now();
        const dayMs = 86400000;
        const buckets = [
            { min: 0, max: 30, share: 0.35 },
            { min: 30, max: 90, share: 0.24 },
            { min: 90, max: 180, share: 0.18 },
            { min: 180, max: 365, share: 0.13 },
            { min: 365, max: 1096, share: 0.10 }
        ];

        const add = (video) => {
            if (!video || !video.videoId || selectedIds.has(video.videoId) || selected.length >= limit) return;
            selectedIds.add(video.videoId);
            selected.push(video);
        };

        buckets.forEach((bucket) => {
            const bucketLimit = Math.max(1, Math.round(limit * bucket.share));
            const items = sorted.filter((video) => {
                if (!video?.published) return false;
                const age = (now - Number(video.published)) / dayMs;
                return age >= bucket.min && age < bucket.max;
            });
            roundRobinByChannel(items, bucketLimit).forEach(add);
        });

        sorted.forEach(add);
        return selected.slice(0, limit);
    }

    function decodeEmbeddedJsonString(value) {
        try { return JSON.parse(`"${value}"`); } catch (_) { return value; }
    }

    function runsText(node) {
        if (!node) return '';
        if (node.simpleText) return node.simpleText;
        if (Array.isArray(node.runs)) return node.runs.map((run) => run.text || '').join('');
        return '';
    }

    function parseRelativePublished(text) {
        const value = String(text || '').toLowerCase();
        if (!value) return 0;
        if (value.includes('just now') || value.includes('minute') || value.includes('hour')) {
            return Date.now();
        }
        if (value.includes('yesterday')) return Date.now() - 86400000;
        const match = value.match(/(\d+)\s+(day|week|month|year)s?\s+ago/);
        if (!match) return 0;
        const amount = Number(match[1]) || 0;
        const multipliers = { day: 1, week: 7, month: 30, year: 365 };
        return Date.now() - amount * (multipliers[match[2]] || 0) * 86400000;
    }

    function parseViewsText(text) {
        const value = String(text || '').toLowerCase().replace(/,/g, '');
        const match = value.match(/([\d.]+)\s*([kmb]?)/);
        if (!match) return 0;
        const amount = Number(match[1]);
        if (!Number.isFinite(amount)) return 0;
        const multipliers = { k: 1e3, m: 1e6, b: 1e9 };
        return Math.round(amount * (multipliers[match[2]] || 1));
    }

    function parseDurationText(text) {
        const parts = String(text || '').trim().split(':').map(Number);
        if (!parts.length || parts.some((part) => !Number.isFinite(part))) return 0;
        return parts.reduce((total, part) => total * 60 + part, 0);
    }

    function rendererDurationText(renderer) {
        const direct = runsText(renderer?.lengthText);
        if (direct) return direct;
        const overlays = renderer?.thumbnailOverlays || [];
        for (const overlay of overlays) {
            const text = runsText(overlay.thumbnailOverlayTimeStatusRenderer?.text);
            if (text) return text;
        }
        return '';
    }

    function rendererIsLive(renderer) {
        if (!renderer) return false;
        const text = JSON.stringify([]
            .concat(renderer.badges || [])
            .concat(renderer.ownerBadges || [])
            .concat(renderer.thumbnailOverlays || [])).toLowerCase();
        return text.includes('badge_style_type_live_now') ||
            text.includes('"style":"live"') ||
            text.includes('live now');
    }

    function memberBadgeText(node) {
        if (!node || typeof node !== 'object') return '';
        const text = JSON.stringify(node).toLowerCase();
        if (/members?[^a-z0-9]{0,20}only/.test(text) ||
            text.includes('badge_style_type_members_only')) return 'Members only';
        if (/members?[^a-z0-9]{0,20}first/.test(text) ||
            text.includes('badge_style_type_members_first')) return 'Members first';
        return '';
    }

    function firstContentImageSource(node) {
        const sources = node?.contentImage?.thumbnailViewModel?.image?.sources ||
            node?.thumbnailViewModel?.image?.sources ||
            node?.thumbnail?.thumbnails ||
            [];
        return sources.length ? sources[sources.length - 1].url : '';
    }

    function findDurationBadgeText(node) {
        if (!node || typeof node !== 'object') return '';
        const badgeText = node.thumbnailBadgeViewModel?.text;
        if (typeof badgeText === 'string' && /^\d{1,2}:\d{2}(?::\d{2})?$/.test(badgeText)) {
            return badgeText;
        }
        for (const value of Object.values(node)) {
            const found = findDurationBadgeText(value);
            if (found) return found;
        }
        return '';
    }

    function findWatchEndpoint(node) {
        if (!node || typeof node !== 'object') return null;
        if (node.watchEndpoint?.videoId) return node.watchEndpoint;
        for (const value of Object.values(node)) {
            const found = findWatchEndpoint(value);
            if (found) return found;
        }
        return null;
    }

    function lockupMetadataParts(lockup) {
        const rows = lockup?.metadata?.lockupMetadataViewModel?.metadata
            ?.contentMetadataViewModel?.metadataRows || [];
        const parts = [];
        rows.forEach((row) => {
            (row.metadataParts || []).forEach((part) => {
                const text = part?.text?.content || part?.text?.accessibilityLabel || part?.accessibilityLabel || '';
                if (text) parts.push(text);
            });
        });
        return parts;
    }

    function isPublishedText(text) {
        const value = String(text || '').toLowerCase();
        return value.includes('yesterday') ||
            /(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/.test(value);
    }

    function channelUrlForSub(sub) {
        return sub.url
            || (sub.handle ? `https://www.youtube.com/${sub.handle}` : null)
            || (sub.id && sub.id.startsWith('@') ? `https://www.youtube.com/${sub.id}` : null)
            || (sub.ucid ? `https://www.youtube.com/channel/${sub.ucid}` : null);
    }

    function uploadRendererToVideo(renderer, sub) {
        if (!renderer?.videoId) return null;
        const thumbs = renderer.thumbnail?.thumbnails || [];
        const durationText = rendererDurationText(renderer);
        const publishedText = runsText(renderer.publishedTimeText);
        return {
            videoId: renderer.videoId,
            title: runsText(renderer.title) || 'Untitled',
            published: parseRelativePublished(publishedText),
            thumbnail: thumbs.length ? thumbs[thumbs.length - 1].url : `https://i.ytimg.com/vi/${renderer.videoId}/mqdefault.jpg`,
            channelName: sub.channelName || '',
            channelThumbnail: sub.thumbnail || null,
            channelUrl: channelUrlForSub(sub),
            views: parseViewsText(runsText(renderer.shortViewCountText) || runsText(renderer.viewCountText)),
            duration: parseDurationText(durationText),
            isLive: rendererIsLive(renderer),
            _memberBadgeText: memberBadgeText(renderer),
            _whenText: publishedText,
            channelId: sub.id,
            url: `https://www.youtube.com/watch?v=${renderer.videoId}`
        };
    }

    function lockupToVideo(lockup, sub) {
        if (!lockup || lockup.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO') return null;
        const endpoint = findWatchEndpoint(lockup);
        const videoId = lockup.contentId || endpoint?.videoId;
        if (!videoId) return null;

        const parts = lockupMetadataParts(lockup);
        const publishedText = parts.find(isPublishedText) || '';
        const viewsText = parts.find((part) => /views?/i.test(part)) || '';
        const thumbnail = firstContentImageSource(lockup) || `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
        return {
            videoId,
            title: lockup?.metadata?.lockupMetadataViewModel?.title?.content || 'Untitled',
            published: parseRelativePublished(publishedText),
            thumbnail,
            channelName: sub.channelName || '',
            channelThumbnail: sub.thumbnail || null,
            channelUrl: channelUrlForSub(sub),
            views: parseViewsText(viewsText),
            duration: parseDurationText(findDurationBadgeText(lockup)),
            isLive: rendererIsLive(lockup),
            _memberBadgeText: memberBadgeText(lockup),
            _whenText: publishedText,
            channelId: sub.id,
            url: `https://www.youtube.com/watch?v=${videoId}`
        };
    }

    function collectUploadVideos(node, sub, out = []) {
        const stack = [node];
        while (stack.length && out.length < CHANNEL_BACKFILL_LIMIT * 2) {
            const item = stack.pop();
            if (!item || typeof item !== 'object') continue;
            const renderer = item.videoRenderer ||
                item.gridVideoRenderer ||
                (item.richItemRenderer?.content &&
                    (item.richItemRenderer.content.videoRenderer || item.richItemRenderer.content.gridVideoRenderer));
            if (renderer) {
                const video = uploadRendererToVideo(renderer, sub);
                if (video) out.push(video);
            } else if (item.lockupViewModel) {
                const video = lockupToVideo(item.lockupViewModel, sub);
                if (video) out.push(video);
            }
            Object.values(item).forEach((value) => {
                if (value && typeof value === 'object') stack.push(value);
            });
        }
        return out;
    }

    function continuationTokenFrom(node) {
        if (!node || typeof node !== 'object') return '';
        const token = node.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
        if (token) return token;
        for (const value of Object.values(node)) {
            const found = continuationTokenFrom(value);
            if (found) return found;
        }
        return '';
    }

    function sliceBalancedJson(text, start) {
        let depth = 0;
        let inString = false;
        let escaped = false;
        for (let i = start; i < text.length; i++) {
            const ch = text[i];
            if (inString) {
                if (escaped) escaped = false;
                else if (ch === '\\') escaped = true;
                else if (ch === '"') inString = false;
            } else if (ch === '"') {
                inString = true;
            } else if (ch === '{') {
                depth++;
            } else if (ch === '}') {
                depth--;
                if (depth === 0) return text.slice(start, i + 1);
            }
        }
        return '';
    }

    function extractInitialData(html) {
        let index = html.indexOf('ytInitialData');
        while (index !== -1) {
            const equals = html.indexOf('=', index);
            if (equals !== -1) {
                let start = equals + 1;
                while (start < html.length && html[start] !== '{' && html[start] !== '\n') start++;
                if (html[start] === '{') {
                    const json = sliceBalancedJson(html, start);
                    if (json) {
                        try { return JSON.parse(json); } catch (_) { /* try next */ }
                    }
                }
            }
            index = html.indexOf('ytInitialData', index + 13);
        }
        return null;
    }

    function extractInnertubeConfig(html) {
        const versionMatch = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/) ||
            html.match(/"clientVersion":"([^"]+)"/);
        if (!versionMatch) return null;
        const visitorMatch = html.match(/"VISITOR_DATA":"([^"]+)"/) ||
            html.match(/"visitorData":"([^"]+)"/);
        const keyMatch = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
        return {
            clientVersion: decodeEmbeddedJsonString(versionMatch[1]),
            visitorData: visitorMatch ? decodeEmbeddedJsonString(visitorMatch[1]) : '',
            apiKey: keyMatch ? keyMatch[1] : ''
        };
    }

    function channelVideosUrl(sub, ucid) {
        let url = sub.url
            || (sub.handle ? `https://www.youtube.com/${sub.handle}` : '')
            || (ucid ? `https://www.youtube.com/channel/${ucid}` : '');
        if (!url) return '';
        if (url.startsWith('/')) url = 'https://www.youtube.com' + url;
        url = url.split('?')[0].replace(/\/$/, '');
        url = url.replace(/\/(featured|videos|shorts|streams|playlists|community|about)$/i, '');
        return `${url}/videos`;
    }

    async function fetchBrowseContinuation(token, config, fetchFn) {
        if (!token || !config?.clientVersion) return null;
        const key = config.apiKey ? `?key=${encodeURIComponent(config.apiKey)}` : '';
        const response = await fetchFn(`https://www.youtube.com/youtubei/v1/browse${key}`, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                'X-YouTube-Client-Name': '1',
                'X-YouTube-Client-Version': config.clientVersion
            },
            body: JSON.stringify({
                context: {
                    client: {
                        clientName: 'WEB',
                        clientVersion: config.clientVersion,
                        visitorData: config.visitorData || '',
                        hl: 'en',
                        gl: 'US'
                    }
                },
                continuation: token
            })
        });
        if (!response.ok) return null;
        return response.json();
    }

    async function fetchChannelBackfill(sub, ucid, existingIds, options = {}) {
        const fetchFn = options.fetchFn || fetch.bind(globalThis);
        const url = channelVideosUrl(sub, ucid);
        if (!url) return { videos: [], error: 'no-videos-url' };
        const cutoff = Date.now() - CHANNEL_BACKFILL_MAX_AGE_DAYS * 86400000;
        const videos = [];
        const metadataById = {};
        let continuation = '';
        let config = null;

        const addVideos = (items) => {
            items.forEach((video) => {
                if (!video || !video.videoId) return;
                if (existingIds.has(video.videoId)) {
                    if (video._memberBadgeText) {
                        metadataById[video.videoId] = {
                            ...(metadataById[video.videoId] || {}),
                            _memberBadgeText: video._memberBadgeText
                        };
                    }
                    return;
                }
                if (!video.published || video.published < cutoff) return;
                const isBackfillMemberVideo = !!video._memberBadgeText;
                existingIds.add(video.videoId);
                videos.push(isBackfillMemberVideo
                    ? { ...video, _publishedUnreliable: true }
                    : video);
            });
        };

        try {
            if (typeof options.ensureConsentCookie === 'function') {
                await options.ensureConsentCookie();
            }
            const response = await fetchFn(url, { credentials: 'include' });
            if (!response.ok) return { videos, metadataById, error: 'backfill-http-' + response.status };
            const html = await response.text();
            const data = extractInitialData(html);
            config = extractInnertubeConfig(html);
            if (!data) return { videos, metadataById, error: 'backfill-parse' };

            let pageVideos = collectUploadVideos(data, sub, []);
            addVideos(pageVideos);
            continuation = continuationTokenFrom(data);
            let pages = 1;

            while (continuation && config && videos.length < CHANNEL_BACKFILL_LIMIT && pages < CHANNEL_BACKFILL_MAX_PAGES) {
                const page = await fetchBrowseContinuation(continuation, config, fetchFn);
                if (!page) break;
                pageVideos = collectUploadVideos(page, sub, []);
                if (!pageVideos.length) break;
                addVideos(pageVideos);
                const hasRecent = pageVideos.some((video) => !video.published || video.published >= cutoff);
                continuation = hasRecent ? continuationTokenFrom(page) : '';
                pages++;
            }
            return { videos: newestFirstVideos(videos).slice(0, CHANNEL_BACKFILL_LIMIT), metadataById, error: null };
        } catch (error) {
            return { videos, metadataById, error: 'backfill:' + (error.message || 'failed') };
        }
    }

    globalThis.ytvhtFeedCore = {
        FEED_CACHE_POLICY,
        selectFeedVideos,
        fetchChannelBackfill,
        collectUploadVideos,
        extractInitialData,
        continuationTokenFrom
    };
})();

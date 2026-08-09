(function (root) {
    'use strict';

    function text(value) {
        return String(value || '').trim();
    }

    function compareText(left, right) {
        const a = text(left).toLowerCase();
        const b = text(right).toLowerCase();
        if (a < b) return -1;
        if (a > b) return 1;
        return 0;
    }

    function isShort(record) {
        return record && (record.isShorts === true || record.isShort === true);
    }

    function channelIdentity(record) {
        const name = text(record && (record.channelName || record.channelTitle));
        const channelId = text(record && (record.channelId || record.ucid));
        if (!name || name.toLowerCase() === 'unknown channel') return null;
        return {
            key: channelId ? `id:${channelId}` : `name:${name.toLowerCase()}`,
            name,
            channelId
        };
    }

    function channelUrl(channelId) {
        const id = text(channelId);
        if (id.startsWith('UC')) return `https://www.youtube.com/channel/${encodeURIComponent(id)}`;
        if (id.startsWith('@')) return `https://www.youtube.com/${encodeURIComponent(id)}`;
        return '';
    }

    function addChannelRecord(channels, record, includeWatchTime) {
        const identity = channelIdentity(record);
        if (!identity) return;
        const current = channels.get(identity.key) || {
            channelName: identity.name,
            channelId: identity.channelId,
            videos: 0,
            watchSeconds: 0
        };
        if (compareText(identity.name, current.channelName) < 0) current.channelName = identity.name;
        current.videos += 1;
        if (includeWatchTime) current.watchSeconds += Math.max(0, Number(record.time || 0));
        channels.set(identity.key, current);
    }

    function channelTie(left, right) {
        return compareText(left.channelName, right.channelName) || compareText(left.channelId, right.channelId);
    }

    function topChannels(records, sort = 'watchTime', limit = 6) {
        const channels = new Map();
        (records || []).forEach((record) => {
            if (Math.max(0, Number(record && record.time || 0)) <= 0) return;
            addChannelRecord(channels, record, true);
        });
        const result = [...channels.values()];
        result.sort(sort === 'videos'
            ? (a, b) => (b.videos - a.videos) || (b.watchSeconds - a.watchSeconds) || channelTie(a, b)
            : (a, b) => (b.watchSeconds - a.watchSeconds) || (b.videos - a.videos) || channelTie(a, b));
        return result.slice(0, Math.max(0, Number(limit) || 0));
    }

    function isLongVideo(record, minimumDuration) {
        return !isShort(record) && Number(record && record.duration || 0) >= minimumDuration;
    }

    function topSkippedChannels(records, options = {}) {
        const minimumDuration = Number(options.minimumDuration || 600);
        const skipRatio = Number(options.skipRatio || 0.1);
        const limit = Number(options.limit || 5);
        const channels = new Map();
        (records || []).forEach((record) => {
            const duration = Number(record && record.duration || 0);
            const watched = Math.max(0, Number(record && record.time || 0));
            if (!isLongVideo(record, minimumDuration) || watched / duration >= skipRatio) return;
            addChannelRecord(channels, record, true);
        });
        return [...channels.values()]
            .sort((a, b) => (b.videos - a.videos) || channelTie(a, b))
            .slice(0, Math.max(0, limit));
    }

    function longestUnfinishedVideos(records, options = {}) {
        const minimumDuration = Number(options.minimumDuration || 600);
        const completionRatio = Number(options.completionRatio || 0.9);
        const limit = Number(options.limit || 5);
        return (records || []).filter((record) => {
            const duration = Number(record && record.duration || 0);
            const watched = Math.max(0, Number(record && record.time || 0));
            return isLongVideo(record, minimumDuration) && watched / duration < completionRatio;
        }).map((record) => ({
            ...record,
            watchedSeconds: Math.max(0, Number(record.time || 0)),
            durationSeconds: Number(record.duration || 0),
            remainingSeconds: Math.max(0, Number(record.duration || 0) - Math.max(0, Number(record.time || 0)))
        })).sort((a, b) =>
            (b.remainingSeconds - a.remainingSeconds) ||
            (b.durationSeconds - a.durationSeconds) ||
            compareText(a.title, b.title) ||
            compareText(a.videoId, b.videoId)
        ).slice(0, Math.max(0, limit));
    }

    const api = { channelUrl, topChannels, topSkippedChannels, longestUnfinishedVideos };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.ytvhtFeedAnalyticsData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

// Canonical local-follow operations shared by the feed page and YouTube content script.
(function (root) {
    'use strict';
    const CHANNEL_ID = /^UC[\w-]+$/;
    function normalizeInput(value) {
        const raw = String(value || '').trim();
        if (!raw) throw new TypeError('Enter a YouTube channel URL, channel ID, or @handle.');
        if (CHANNEL_ID.test(raw)) return { channelId: raw };
        let url;
        const candidate = /^https?:\/\//i.test(raw) ? raw : (/^(?:www\.)?youtube\.com\//i.test(raw) ? `https://${raw}` : `https://www.youtube.com/${raw.replace(/^\//, '')}`);
        try { url = new URL(candidate); } catch (_) { throw new TypeError('Enter a valid YouTube channel URL, channel ID, or @handle.'); }
        if (!/(^|\.)youtube\.com$/i.test(url.hostname)) throw new TypeError('The channel URL must be on youtube.com.');
        const channelMatch = url.pathname.match(/^\/channel\/(UC[\w-]+)\/?$/i);
        if (channelMatch) return { channelId: channelMatch[1] };
        const handleMatch = url.pathname.match(/^\/(@[\w.-]+)\/?$/);
        if (handleMatch) return { handle: handleMatch[1] };
        throw new TypeError('Use a /channel/UC… URL, a UC channel ID, or an @handle URL.');
    }
    function channelIdFromHtml(html) { const match = String(html || '').match(/"externalId":"(UC[\w-]+)"/); return match ? match[1] : null; }
    async function resolveInput(value, fetchImpl) {
        const normalized = normalizeInput(value);
        if (normalized.channelId) return normalized;
        if (typeof fetchImpl !== 'function') throw new TypeError('Channel handle resolution is unavailable.');
        const response = await fetchImpl(`https://www.youtube.com/${normalized.handle}`, { credentials: 'omit' });
        if (!response || !response.ok) throw new Error('Could not resolve that YouTube handle.');
        const channelId = channelIdFromHtml(await response.text());
        if (!channelId) throw new Error('YouTube did not provide a canonical channel ID for that handle.');
        return { channelId, handle: normalized.handle };
    }
    async function follow(storage, info, now = Date.now()) {
        const channelId = String(info && info.channelId || '');
        if (!CHANNEL_ID.test(channelId)) throw new TypeError('A canonical YouTube channel ID is required.');
        const existing = await storage.getSubscriptionRecord(channelId);
        if (existing) return { status: 'already-following', subscription: existing };
        const subscription = { channelId, channelTitle: String(info.channelTitle || info.channelName || ''), thumbnail: String(info.thumbnail || ''), handle: String(info.handle || ''), source: 'manual', followedAt: now };
        await storage.putSubscriptionRecord(subscription);
        await storage.putChannelSyncState({ channelId, initializationState: 'pending', nextEligibleCheckAt: now, scanLeaseUntil: null, scanRunId: null });
        return { status: 'followed', subscription };
    }
    async function unfollow(storage, channelId) { await storage.deleteSubscriptionAndSyncState(channelId); return { status: 'unfollowed' }; }
    const api = { normalizeInput, channelIdFromHtml, resolveInput, follow, unfollow };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.ytvhtLocalSubscriptionActions = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

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
        const channelMatch = url.pathname.match(/^\/channel\/(UC[\w-]+)(?:\/.*)?$/i);
        if (channelMatch) return { channelId: channelMatch[1] };
        const handleMatch = url.pathname.match(/^\/(@[\w.-]+)(?:\/.*)?$/);
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
        if (!storage || typeof storage.getLocalUnsubscribeTombstone !== 'function' ||
            typeof storage.deleteLocalUnsubscribeTombstone !== 'function') {
            throw new TypeError('A local-unsubscribe repository is required.');
        }
        const existing = await storage.getSubscriptionRecord(channelId);
        const tombstone = await storage.getLocalUnsubscribeTombstone(channelId);
        if (existing && !tombstone) return { status: 'already-following', subscription: existing };
        if (tombstone) await storage.deleteLocalUnsubscribeTombstone(channelId);
        const subscription = {
            ...existing,
            channelId,
            channelTitle: String(info.channelTitle || info.channelName || tombstone?.channelTitle || existing?.channelTitle || ''),
            thumbnail: String(info.thumbnail || tombstone?.thumbnail || existing?.thumbnail || ''),
            handle: String(info.handle || tombstone?.handle || existing?.handle || ''),
            source: 'manual',
            followedAt: now
        };
        await storage.putSubscriptionRecord(subscription);
        await storage.putChannelSyncState({ channelId, initializationState: 'pending', nextEligibleCheckAt: now, scanLeaseUntil: null, scanRunId: null });
        return { status: 'followed', subscription, restored: Boolean(tombstone) };
    }
    async function unfollow(storage, channelId, options = {}) {
        const input = {
            channelId,
            unsubscribedAt: Number(options.unsubscribedAt || Date.now()),
            source: options.source || 'local_action',
            reason: options.reason || 'user_unfollow',
            channelTitle: options.channelTitle || '',
            thumbnail: options.thumbnail || '',
            handle: options.handle || ''
        };
        let tombstone = input;
        const contracts = root.ytvhtFeedContracts ||
            (typeof require === 'function' ? require('./feed-contracts.js') : null);
        if (contracts && typeof contracts.createLocalUnsubscribeTombstone === 'function') {
            tombstone = contracts.createLocalUnsubscribeTombstone(input);
        }
        const result = await storage.deleteSubscriptionAndSyncState(channelId, tombstone);
        return { status: 'unfollowed', tombstone, ...(result || {}) };
    }
    const api = { normalizeInput, channelIdFromHtml, resolveInput, follow, unfollow };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.ytvhtLocalSubscriptionActions = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

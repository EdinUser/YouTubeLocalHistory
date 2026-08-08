(function (root) {
    'use strict';

    const contracts = root.ytvhtFeedContracts || (typeof require === 'function' ? require('./feed-contracts.js') : null);

    function equivalentSubscription(existing, incoming) {
        return existing &&
            String(existing.channelTitle || '') === String(incoming.channelTitle || '') &&
            String(existing.thumbnail || '') === String(incoming.thumbnail || '') &&
            String(existing.handle || '') === String(incoming.handle || '');
    }

    async function importCanonicalSubscriptions(storage, subscriptions, options = {}) {
        if (!storage || typeof storage.getSubscriptionRecord !== 'function' || typeof storage.putSubscriptionRecord !== 'function') {
            throw new TypeError('A subscriptions repository is required');
        }
        if (!contracts) throw new Error('Feed contracts are unavailable');
        const source = options.subscriptionSource || 'takeout_csv';
        const importSource = options.importSource || 'takeout_subscriptions';
        const now = Number(options.now || Date.now());
        const result = { source: importSource, found: Array.isArray(subscriptions) ? subscriptions.length : 0, valid: 0, added: 0, updated: 0, unchanged: 0, skipped: 0, invalid: [], fatalError: null, initializationQueued: 0 };
        const queuedChannelIds = [];

        for (const subscription of (subscriptions || [])) {
            const channelId = String(subscription && (subscription.channelId || subscription.ucid) || '').trim();
            if (!/^UC[\w-]+$/.test(channelId)) {
                result.skipped += 1;
                if (result.invalid.length < 20) result.invalid.push({ row: Number(subscription && subscription.row || 0), reason: 'missing canonical channel ID' });
                continue;
            }
            result.valid += 1;
            const existing = await storage.getSubscriptionRecord(channelId);
            const incoming = {
                channelId,
                channelTitle: subscription.title || subscription.channelTitle || '',
                thumbnail: subscription.thumbnail || '',
                handle: subscription.handle || '',
                source: existing ? existing.source : source,
                followedAt: existing ? existing.followedAt : now,
                importedAt: now
            };
            if (equivalentSubscription(existing, incoming)) {
                result.unchanged += 1;
                continue;
            }
            await storage.putSubscriptionRecord({ ...existing, ...incoming });
            if (existing) result.updated += 1;
            else {
                result.added += 1;
                queuedChannelIds.push(channelId);
            }
        }
        result.initializationQueued = queuedChannelIds.length;
        return { outcome: contracts.createImportOutcome(result), queuedChannelIds };
    }

    const api = { importCanonicalSubscriptions };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.ytvhtFeedSubscriptionImport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

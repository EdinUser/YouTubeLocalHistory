(function (root) {
    'use strict';

    const contracts = root.ytvhtFeedContracts || (typeof require === 'function' ? require('./feed-contracts.js') : null);
    const parser = root.ytvhtRssParser || (typeof require === 'function' ? require('./rss-parser.js') : null);
    const RSS_URL = 'https://www.youtube.com/feeds/videos.xml?channel_id=';

    function isCanonicalChannelId(channelId) {
        return /^UC[\w-]+$/.test(String(channelId || ''));
    }

    function classifyError(error) {
        if (error && error.name === 'AbortError') return { code: 'timeout', message: 'RSS request timed out' };
        return { code: 'network', message: String(error && error.message || 'RSS request failed') };
    }

    async function fetchChannelRss(channelId, options = {}) {
        const fetchedAt = Number(options.now === undefined ? Date.now() : options.now);
        if (!isCanonicalChannelId(channelId)) {
            return contracts.createRssScanResult({ channelId: String(channelId || 'unknown'), fetchedAt, error: { code: 'no_channel_id', message: 'A canonical UC channel ID is required' } });
        }
        const request = options.fetch || root.fetch;
        if (typeof request !== 'function') throw new Error('fetch is unavailable');
        const timeoutMs = Number(options.timeoutMs || 10000);
        const controller = typeof root.AbortController === 'function' ? new root.AbortController() : null;
        let timeoutId = null;
        if (controller && Number.isFinite(timeoutMs) && timeoutMs > 0) {
            timeoutId = root.setTimeout(() => controller.abort(), timeoutMs);
        }
        try {
            const response = await request(`${RSS_URL}${encodeURIComponent(channelId)}`, {
                credentials: 'omit',
                signal: controller ? controller.signal : undefined
            });
            if (!response || !response.ok) {
                return contracts.createRssScanResult({
                    channelId, fetchedAt,
                    error: { code: 'http', message: `RSS request failed with HTTP ${response && response.status || 0}`, status: Number(response && response.status || 0) }
                });
            }
            const entries = parser.parseRssXml(await response.text(), channelId);
            return contracts.createRssScanResult({ channelId, entries, fetchedAt });
        } catch (error) {
            const scanError = error && /RSS XML could not be parsed/.test(error.message)
                ? { code: 'parse', message: error.message }
                : classifyError(error);
            return contracts.createRssScanResult({ channelId, fetchedAt, error: scanError });
        } finally {
            if (timeoutId !== null) root.clearTimeout(timeoutId);
        }
    }

    const api = { RSS_URL, fetchChannelRss };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.ytvhtRssClient = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

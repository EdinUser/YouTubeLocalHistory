(function (root) {
    'use strict';

    const contracts = root.ytvhtFeedContracts || (typeof require === 'function' ? require('./feed-contracts.js') : null);
    const YT_NS = 'http://www.youtube.com/xml/schemas/2015';
    const MEDIA_NS = 'http://search.yahoo.com/mrss/';

    function elementText(parent, namespace, localName, prefixedName) {
        const namespaced = parent.getElementsByTagNameNS && parent.getElementsByTagNameNS(namespace, localName)[0];
        const element = namespaced || parent.getElementsByTagName(prefixedName || localName)[0];
        return element ? String(element.textContent || '').trim() : '';
    }

    function parseRssXml(xml, channelId) {
        if (!contracts) throw new Error('Feed contracts are unavailable');
        const Parser = root.DOMParser;
        if (!Parser) throw new Error('DOMParser is unavailable');

        const document = new Parser().parseFromString(String(xml || ''), 'application/xml');
        if (document.getElementsByTagName('parsererror').length) {
            throw new Error('RSS XML could not be parsed');
        }

        const feedChannelTitle = elementText(document, '', 'title', 'title');
        return Array.from(document.getElementsByTagName('entry')).map((entry) => {
            let videoId = elementText(entry, YT_NS, 'videoId', 'yt:videoId');
            if (!videoId) {
                const matched = elementText(entry, '', 'id', 'id').match(/yt:video:([\w-]+)/);
                videoId = matched ? matched[1] : '';
            }
            if (!videoId) return null;

            const publishedText = elementText(entry, '', 'published', 'published') || elementText(entry, '', 'updated', 'updated');
            const publishedAt = Date.parse(publishedText);
            if (!Number.isFinite(publishedAt)) return null;

            const thumbnail = (entry.getElementsByTagNameNS && entry.getElementsByTagNameNS(MEDIA_NS, 'thumbnail')[0]) ||
                entry.getElementsByTagName('media:thumbnail')[0];
            const entryChannelTitle = elementText(entry, '', 'name', 'name');
            const normalized = contracts.normalizeFeedEntry({
                videoId,
                channelId,
                title: elementText(entry, '', 'title', 'title') || 'Untitled',
                thumbnailUrl: thumbnail ? thumbnail.getAttribute('url') || '' : `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
                publishedAt,
                channelTitle: entryChannelTitle || feedChannelTitle || ''
            }, channelId);
            if (entryChannelTitle || feedChannelTitle) normalized.channelTitle = entryChannelTitle || feedChannelTitle;
            return normalized;
        }).filter(Boolean);
    }

    const api = { parseRssXml };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.ytvhtRssParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

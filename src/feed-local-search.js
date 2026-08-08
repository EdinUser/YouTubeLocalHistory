// Local-only search: merge a watch-history record with canonical feed cards.
function historyToVideo(rec) {
    const cid = rec.channelId || '';
    const subscription = localSubscriptions.find((sub) =>
        (cid && [sub.id, sub.ucid, sub.handle].filter(Boolean).includes(cid)) ||
        channelKey(sub.channelName) === channelKey(rec.channelName)
    );
    const channelUrl = cid
        ? (cid.startsWith('@') ? `https://www.youtube.com/${cid}` : `https://www.youtube.com/channel/${cid}`)
        : (subscription ? subscriptionUrl(subscription) : null);
    return {
        videoId: rec.videoId,
        title: rec.title || '',
        url: rec.url || `https://www.youtube.com/watch?v=${rec.videoId}`,
        channelName: rec.channelName || '',
        channelUrl,
        channelThumbnail: rec.channelThumbnail || (subscription && subscription.thumbnail) || null,
        thumbnail: rec.thumbnail || `https://i.ytimg.com/vi/${rec.videoId}/hqdefault.jpg`,
        published: Number(releaseDateCache[rec.videoId] || rec.published || 0),
        watchedAt: Number(rec.timestamp || 0),
        views: 0,
        duration: Number(rec.duration || durationCache[rec.videoId] || 0),
        isShort: rec.isShort === true || rec.isShorts === true,
        _whenText: rec.timestamp
            ? tFeed('feed_watched_relative', 'Watched $1', [relativeTime(rec.timestamp)])
            : '',
        _historyOnly: true
    };
}

// Feed records win on duplicate video IDs because they carry RSS metadata.
function buildLocalIndex() {
    const byId = {};
    Object.values(watchedMap || {}).forEach((rec) => {
        if (rec && rec.videoId) byId[rec.videoId] = historyToVideo(rec);
    });
    allVideos.forEach((video) => {
        if (!video || !video.videoId) return;
        if (!video.duration && durationCache[video.videoId]) video.duration = durationCache[video.videoId];
        if (!video.published && releaseDateCache[video.videoId]) video.published = releaseDateCache[video.videoId];
        byId[video.videoId] = video;
    });
    return Object.values(byId);
}

function normalizeText(value) {
    return decodeHtmlEntities(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

function normTitle(video) {
    if (video._ntitle == null) video._ntitle = normalizeText(video.title);
    return video._ntitle;
}

function normChannel(video) {
    if (video._nchannel == null) video._nchannel = normalizeText(video.channelName);
    return video._nchannel;
}

function tokenize(query) {
    const normalized = normalizeText(query);
    return normalized ? normalized.split(' ') : [];
}

function matchesTokens(video, tokens) {
    if (!tokens.length) return true;
    const words = (normTitle(video) + ' ' + normChannel(video)).split(' ').filter(Boolean);
    return tokens.every((token) => words.some((word) => word.startsWith(token)));
}

function scoreVideo(video, tokens, phrase) {
    const title = normTitle(video);
    const channel = normChannel(video);
    let score = 0;
    if (phrase) {
        if (title.startsWith(phrase)) score += 50;
        else if (title.includes(phrase)) score += 30;
        if (channel === phrase) score += 55;
        else if (channel.startsWith(phrase)) score += 35;
        else if (channel.includes(phrase)) score += 15;
    }
    const titleWords = title ? title.split(' ') : [];
    tokens.forEach((token) => {
        if (title.includes(token)) score += 10;
        else if (channel.includes(token)) score += 5;
        if (titleWords.includes(token)) score += 6;
        else if (titleWords.some((word) => word.startsWith(token))) score += 3;
    });
    return score + (video._historyOnly ? 0 : 12);
}

function sortList(list, sort) {
    if (sort === 'oldest') {
        list.sort((a, b) => effectivePublishedTime(a) - effectivePublishedTime(b));
    } else if (sort === 'channel') {
        list.sort((a, b) => {
            const left = decodeHtmlEntities(a.channelName || '').toLowerCase();
            const right = decodeHtmlEntities(b.channelName || '').toLowerCase();
            if (left !== right) return left < right ? -1 : 1;
            return effectivePublishedTime(b) - effectivePublishedTime(a);
        });
    } else {
        list.sort((a, b) => effectivePublishedTime(b) - effectivePublishedTime(a));
    }
    return list;
}

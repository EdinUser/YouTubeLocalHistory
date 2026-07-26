// Turn a watch-history record into a card-shaped video object so it can be
// searched alongside the feed.
function historyToVideo(rec) {
    const cid = rec.channelId || '';
    const subscription = localSubscriptions.find((sub) =>
        (cid && [sub.id, sub.ucid, sub.handle].filter(Boolean).includes(cid)) ||
        channelKey(sub.channelName) === channelKey(rec.channelName)
    );
    const channelUrl = cid
        ? (cid.startsWith('@')
            ? `https://www.youtube.com/${cid}`
            : `https://www.youtube.com/channel/${cid}`)
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
        _whenText: rec.timestamp ? `Watched ${relativeTime(rec.timestamp)}` : '',
        _historyOnly: true
    };
}

// Merged, deduped searchable set: feed videos + watch history (feed wins, as
// it has richer data like avatar/views).
function buildLocalIndex() {
    const byId = {};
    Object.values(watchedMap || {}).forEach((rec) => {
        if (rec && rec.videoId) byId[rec.videoId] = historyToVideo(rec);
    });
    allVideos.forEach((v) => {
        if (!v || !v.videoId) return;
        // Metadata fetched during search is cached separately; apply it to
        // feed records as well as history-only records on every redraw.
        if (!v.duration && durationCache[v.videoId]) v.duration = durationCache[v.videoId];
        if (!v.published && releaseDateCache[v.videoId]) v.published = releaseDateCache[v.videoId];
        byId[v.videoId] = v;
    });
    return Object.values(byId);
}

// Normalize text the way a forgiving search should: decode entities, lower-case,
// strip accents/diacritics, and turn punctuation into spaces. So "Pokémon!" and
// "pokemon" compare equal, and "C++/Rust" tokenizes into ["c", "rust"].
function normalizeText(s) {
    return decodeHtmlEntities(s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')      // combining marks (accents)
        .replace(/[^\p{L}\p{N}]+/gu, ' ')     // any non letter/number -> space
        .trim();
}

// Memoized normalized title/channel (feed objects persist across keystrokes,
// so this avoids re-normalizing the whole list on every input event).
function normTitle(v) {
    if (v._ntitle == null) v._ntitle = normalizeText(v.title);
    return v._ntitle;
}
function normChannel(v) {
    if (v._nchannel == null) v._nchannel = normalizeText(v.channelName);
    return v._nchannel;
}

function tokenize(q) {
    const n = normalizeText(q);
    return n ? n.split(' ') : [];
}

// Every query word must match the beginning of a word in the title or channel.
// This keeps partial searches useful ("etho" -> "EthosLab") without unrelated
// mid-word matches ("etho" should not match "method").
function matchesTokens(v, tokens) {
    if (!tokens.length) return true;
    const words = (normTitle(v) + ' ' + normChannel(v)).split(' ').filter(Boolean);
    return tokens.every((tok) => words.some((word) => word.startsWith(tok)));
}

// Relevance score so the best matches float to the top, like a search engine:
// whole-phrase title hits > title-prefix > per-word title hits > channel hits,
// with a bonus for matching whole words / word-prefixes rather than mid-word.
function scoreVideo(v, tokens, phrase) {
    const title = normTitle(v);
    const channel = normChannel(v);
    let score = 0;
    if (phrase) {
        if (title.startsWith(phrase)) score += 50;
        else if (title.includes(phrase)) score += 30;
        if (channel === phrase) score += 55;
        else if (channel.startsWith(phrase)) score += 35;
        else if (channel.includes(phrase)) score += 15;
    }
    const titleWords = title ? title.split(' ') : [];
    for (const tok of tokens) {
        if (title.includes(tok)) score += 10;
        else if (channel.includes(tok)) score += 5;
        if (titleWords.includes(tok)) score += 6;
        else if (titleWords.some((w) => w.startsWith(tok))) score += 3;
    }
    // Prefer current subscription-feed matches over older history-only matches
    // when textual relevance is otherwise similar.
    if (!v._historyOnly) score += 12;
    return score;
}

function parseYouTubeReleaseDate(html) {
    const patterns = [
        /"publishDate":"([^"]+)"/,
        /"uploadDate":"([^"]+)"/,
        /itemprop="datePublished"\s+content="([^"]+)"/,
        /property="og:video:release_date"\s+content="([^"]+)"/
    ];
    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (!match) continue;
        const raw = match[1];
        // Date-only values are interpreted at noon UTC to avoid timezone
        // conversion moving the displayed release date by one day.
        const timestamp = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00Z` : raw);
        if (Number.isFinite(timestamp) && timestamp > 0) return timestamp;
    }
    return 0;
}

let innertubeConfigPromise = null;
function decodeEmbeddedJsonString(value) {
    try { return JSON.parse(`"${value}"`); } catch (_) { return value; }
}

async function getInnertubeConfig() {
    if (innertubeConfigPromise) return innertubeConfigPromise;
    innertubeConfigPromise = (async () => {
        try {
            await ensureConsentCookie();
            const response = await fetch('https://www.youtube.com/', { credentials: 'include' });
            if (!response.ok) return null;
            const html = await response.text();
            const versionMatch =
                html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/) ||
                html.match(/"clientVersion":"([^"]+)"/);
            const visitorMatch =
                html.match(/"VISITOR_DATA":"([^"]+)"/) ||
                html.match(/"visitorData":"([^"]+)"/);
            const keyMatch = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
            if (!versionMatch) return null;
            return {
                clientVersion: decodeEmbeddedJsonString(versionMatch[1]),
                visitorData: visitorMatch ? decodeEmbeddedJsonString(visitorMatch[1]) : '',
                apiKey: keyMatch ? keyMatch[1] : ''
            };
        } catch (_) {
            return null;
        }
    })();
    const config = await innertubeConfigPromise;
    if (!config) innertubeConfigPromise = null;
    return config;
}

function parsePlayerReleaseDate(data) {
    const microformat = data && data.microformat && data.microformat.playerMicroformatRenderer;
    const raw = microformat && (microformat.uploadDate || microformat.publishDate);
    if (!raw) return 0;
    const timestamp = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00Z` : raw);
    return Number.isFinite(timestamp) ? timestamp : 0;
}

function generateCpn() {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join('');
}

async function fetchAndroidReelMetadata(videoId) {
    const config = await getInnertubeConfig();
    if (!config || !config.visitorData) return null;
    try {
        const response = await fetch(
            'https://youtubei.googleapis.com/youtubei/v1/reel/reel_item_watch' +
            `?prettyPrint=false&id=${encodeURIComponent(videoId)}` +
            '&$fields=playerResponse',
            {
                method: 'POST',
                credentials: 'omit',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Format-Version': '2'
                },
                body: JSON.stringify({
                    context: {
                        client: {
                            clientName: 'ANDROID',
                            clientVersion: '21.03.36',
                            clientScreen: 'WATCH',
                            visitorData: config.visitorData,
                            platform: 'MOBILE',
                            osName: 'Android',
                            osVersion: '16',
                            androidSdkVersion: 36,
                            hl: 'en'
                        }
                    },
                    playerRequest: {
                        videoId,
                        cpn: generateCpn(),
                        contentCheckOk: true,
                        racyCheckOk: true
                    },
                    disablePlayerResponse: false
                })
            }
        );
        if (!response.ok) return null;
        const wrapper = await response.json();
        const data = wrapper && wrapper.playerResponse;
        const details = data && data.videoDetails;
        const duration = details ? Number(details.lengthSeconds || 0) : 0;
        const liveDetails = data && data.microformat &&
            data.microformat.playerMicroformatRenderer &&
            data.microformat.playerMicroformatRenderer.liveBroadcastDetails;
        return {
            duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
            published: parsePlayerReleaseDate(data),
            isLive: !!(liveDetails && liveDetails.isLiveNow)
        };
    } catch (_) {
        return null;
    }
}

async function fetchPlayerMetadata(videoId) {
    const config = await getInnertubeConfig();
    if (!config) return null;
    try {
        const key = config.apiKey ? `&key=${encodeURIComponent(config.apiKey)}` : '';
        const response = await fetch(
            `https://www.youtube.com/youtubei/v1/player?prettyPrint=false${key}`,
            {
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
                            hl: 'en',
                            visitorData: config.visitorData
                        }
                    },
                    videoId,
                    contentCheckOk: true,
                    racyCheckOk: true
                })
            }
        );
        if (!response.ok) return null;
        const data = await response.json();
        const details = data && data.videoDetails;
        const duration = details ? Number(details.lengthSeconds || 0) : 0;
        const liveDetails = data && data.microformat &&
            data.microformat.playerMicroformatRenderer &&
            data.microformat.playerMicroformatRenderer.liveBroadcastDetails;
        return {
            duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
            published: parsePlayerReleaseDate(data),
            isLive: !!(liveDetails && liveDetails.isLiveNow)
        };
    } catch (_) {
        return null;
    }
}

async function fetchSearchMetadata(videoId) {
    const player = await fetchPlayerMetadata(videoId);
    let duration = (player && player.duration) || 0;
    let published = (player && player.published) || 0;
    let isLive = !!(player && player.isLive);

    if (!duration || !published) {
        const reel = await fetchAndroidReelMetadata(videoId);
        if (reel) {
            duration = duration || reel.duration;
            published = published || reel.published;
            isLive = isLive || !!reel.isLive;
        }
    }

    // The /shorts/ redirect path is already the proven duration source used
    // by the normal feed. Reuse it when the player API withholds duration.
    if (!duration) {
        const shortsMetadata = await fetchVideoMetaViaShorts(videoId);
        if (shortsMetadata && shortsMetadata.duration) {
            duration = Number(shortsMetadata.duration);
        }
        if (shortsMetadata && shortsMetadata.isLive) isLive = true;
    }

    if (duration && published) return { duration, published, isLive };

    // Final fallback for a missing release date or duration.
    try {
        const response = await fetch(
            `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
            { credentials: 'include' }
        );
        if (!response.ok) return { duration, published, isLive };
        const html = await response.text();
        return {
            published: published || parseYouTubeReleaseDate(html),
            duration: duration || Number(parseDurationFromHtml(html) || 0),
            isLive: isLive || parseLiveFromHtml(html)
        };
    } catch (_) {
        return { duration, published, isLive };
    }
}

function enrichSearchReleaseDates(videos, queryAtRender) {
    if (releaseDateBatchRunning || !queryAtRender) return;
    // Process all matching videos in small batches. Each batch is
    // cached and triggers the next render until every result has metadata.
    const missing = videos
        .filter((video) =>
            video && video.videoId &&
            (!video.published || !video.duration) &&
            (metadataAttempts.get(video.videoId) || 0) < 3)
        .slice(0, 80);
    if (!missing.length) return;

    releaseDateBatchRunning = true;
    setTimeout(async () => {
        try {
            await ensureConsentCookie();
            await runPool(missing, 8, async (video) => {
                const metadata = await fetchSearchMetadata(video.videoId);
                if (!metadata || (!metadata.published && !metadata.duration)) {
                    metadataAttempts.set(
                        video.videoId,
                        (metadataAttempts.get(video.videoId) || 0) + 1
                    );
                    return;
                }
                // A partial success should still allow another attempt for the
                // missing field, while a complete success needs no retry.
                metadataAttempts.set(
                    video.videoId,
                    metadata.published && metadata.duration
                        ? 3
                        : (metadataAttempts.get(video.videoId) || 0) + 1
                );
                if (metadata.published) releaseDateCache[video.videoId] = metadata.published;
                if (metadata.duration) durationCache[video.videoId] = metadata.duration;
                if (metadata.isLive) video.isLive = true;
            });
            await ytStorage.setReleaseDateCache(releaseDateCache);
            await ytStorage.setDurationCache(durationCache);

            releaseDateBatchRunning = false;
            // Redraw the current search and begin the next metadata batch.
            const currentQuery = (document.getElementById('search').value || '').trim();
            if (currentQuery.length >= 3) render();
        } finally {
            releaseDateBatchRunning = false;
        }
    }, 0);
}

function sortList(list, sort) {
    if (sort === 'oldest') {
        list.sort((a, b) => effectivePublishedTime(a) - effectivePublishedTime(b));
    } else if (sort === 'channel') {
        list.sort((a, b) => {
            const ca = decodeHtmlEntities(a.channelName || '').toLowerCase();
            const cb = decodeHtmlEntities(b.channelName || '').toLowerCase();
            if (ca !== cb) return ca < cb ? -1 : 1;
            return effectivePublishedTime(b) - effectivePublishedTime(a);
        });
    } else {
        list.sort((a, b) => effectivePublishedTime(b) - effectivePublishedTime(a));
    }
    return list;
}

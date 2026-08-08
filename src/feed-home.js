// Shorts aren't flagged in RSS. We resolve an accurate flag (v.isShort) by
// checking the /shorts/ URL during the duration pass; prefer that when known.
// Until it's resolved, fall back to the modern Shorts duration cap so Home does
// not show vertical short-form uploads while metadata enrichment catches up.
const SHORTS_MAX_SECONDS = 180;
function isShort(v) {
    if (v && v.isShort === true) return true;
    if (v && v.videoId && shortsCache[v.videoId] === true) return true;
    if (v && v.source === 'rss') return false;
    const d = Number((v && v.duration) || (v && v.videoId && durationCache[v.videoId]) || 0);
    return d > 0 && d <= SHORTS_MAX_SECONDS;
}

// ----- local view (search / sort / filter) -------------------------------
// Sidebar modes: Home is locally ranked, Subscriptions is chronological,
// and Shorts shows only Shorts.
let shortsOnly = false;
let subscriptionsChronological = false;
const VISIBLE_FEED_LIMIT = 300;
const HOME_AGE_BUCKET_PATTERN = [
    'back', 'quarter', 'month', 'older',
    'quarter', 'back', 'month', 'week'
];

function applyShortsFilter(list) {
    // Home never shows Shorts; the Shorts view shows only Shorts.
    return shortsOnly ? dedupeShorts(list.filter((v) => isShort(v))) : list.filter((v) => !isShort(v));
}

function hasHomeDurationBadge(video) {
    if (videoIsLive(video)) return true;
    if (cleanDurationText(video && video._durationText)) return true;
    return Number((video && video.duration) || (video && video.videoId && durationCache[video.videoId]) || 0) > 0;
}

function hasSubscriptionDurationBadge(video) {
    return hasHomeDurationBadge(video);
}

function shortDedupeKey(video) {
    const title = normalizeText(decodeHtmlEntities((video && video.title) || ''))
        .replace(/\b(?:official|video|shorts?|cover|live)\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    const channel = channelKey(video && video.channelName);
    return title && channel ? `${channel}:${title}` : '';
}

function dedupeShorts(list) {
    const seenIds = new Set();
    const seenTitles = new Set();
    return list.filter((video) => {
        if (!video) return false;
        if (video.videoId) {
            if (seenIds.has(video.videoId)) return false;
            seenIds.add(video.videoId);
        }
        const key = shortDedupeKey(video);
        if (key) {
            if (seenTitles.has(key)) return false;
            seenTitles.add(key);
        }
        return true;
    });
}

function normalizedChannelIds(value) {
    const raw = String(value || '').trim();
    if (!raw) return [];
    const stripped = raw
        .replace(/^https?:\/\/(?:www\.)?youtube\.com\//i, '')
        .replace(/^\/+/, '')
        .replace(/^channel\//i, '');
    const ids = new Set([raw, stripped]);
    if (stripped.startsWith('@')) ids.add(stripped.slice(1));
    else if (stripped) ids.add('@' + stripped);
    return Array.from(ids).map((id) => id.toLowerCase());
}

function historyRecordMatchesSubscription(record) {
    if (!record || !localSubscriptions.length) return false;
    const recordIds = new Set(
        []
            .concat(normalizedChannelIds(record.channelId))
            .concat(normalizedChannelIds(record.ucid))
            .concat(normalizedChannelIds(record.handle))
    );
    const recordChannelName = channelKey(record.channelName);
    return localSubscriptions.some((sub) => {
        if (recordChannelName && channelKey(sub.channelName) === recordChannelName) return true;
        const subIds = []
            .concat(normalizedChannelIds(sub.id))
            .concat(normalizedChannelIds(sub.ucid))
            .concat(normalizedChannelIds(sub.handle));
        return subIds.some((id) => recordIds.has(id));
    });
}

function buildHomeIndex() {
    const byId = {};
    allVideos.forEach((video) => {
        if (!video || !video.videoId) return;
        const existing = byId[video.videoId] || {};
        byId[video.videoId] = {
            ...existing,
            ...video,
            duration: Number(video.duration || existing.duration || durationCache[video.videoId] || 0),
            published: Number(video.published || existing.published || releaseDateCache[video.videoId] || 0),
            thumbnail: video.thumbnail || existing.thumbnail || `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`,
            channelThumbnail: video.channelThumbnail || existing.channelThumbnail || null,
            _historyOnly: false,
            _whenText: video._whenText || ''
        };
    });
    return Object.values(byId);
}

function channelKey(value) {
    return normalizeText(value || '');
}

function stableVideoValue(videoId, salt = '') {
    const text = `${videoId || ''}:${salt}`;
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 4294967295;
}

function videoAgeDays(video, now = Date.now()) {
    const published = Number(video && video.published);
    if (published > 0) return Math.max(0, (now - published) / 86400000);
    if (video && video._historyOnly) {
        // Imported/watched history often lacks the original upload date.
        // Treat those as back-catalog candidates, spread deterministically
        // across weeks/months so Home does not collapse into "watched today".
        return 8 + Math.floor(stableVideoValue(video.videoId, 'history-age') * 900);
    }
    return 45;
}

// Home gets a fresh seed whenever it is opened or refreshed. Hashing the
// video id with that seed keeps the order stable while the page is visible,
// but produces a different mix on the next visit.
let homeRandomSeed = `${Date.now()}:${Math.random()}`;
let recordedHomeSeed = '';
const HOME_RECENT_KEY = 'ytvht.homeRecentlyShown.v1';
function reshuffleHome() {
    homeRandomSeed = `${Date.now()}:${Math.random()}`;
}

function loadRecentHomeRounds() {
    try {
        const rounds = JSON.parse(sessionStorage.getItem(HOME_RECENT_KEY) || '[]');
        return Array.isArray(rounds)
            ? rounds.filter(Array.isArray).slice(0, 6)
            : [];
    } catch (_) {
        return [];
    }
}

function rememberHomeRecommendations(videos) {
    if (recordedHomeSeed === homeRandomSeed || !videos.length) return;
    recordedHomeSeed = homeRandomSeed;
    try {
        // Remember the part people are most likely to see. Keeping six rounds
        // makes repeated Firefox reloads feel genuinely different.
        const ids = videos.slice(0, 120)
            .map((video) => video && video.videoId)
            .filter(Boolean);
        const rounds = loadRecentHomeRounds();
        rounds.unshift(ids);
        sessionStorage.setItem(HOME_RECENT_KEY, JSON.stringify(rounds.slice(0, 6)));
    } catch (_) { /* recommendations still work if session storage is unavailable */ }
}

function recentHomePenalty(videoId, recentRounds) {
    if (!videoId) return 0;
    const roundPenalties = [35, 25, 18, 12, 8, 4];
    let penalty = 0;
    recentRounds.forEach((ids, roundIndex) => {
        const position = ids.indexOf(videoId);
        if (position < 0) return;
        // Top-row repeats are more noticeable than videos far down the page.
        const positionWeight = position < 20 ? 1 : (position < 60 ? 0.5 : 0.25);
        penalty += roundPenalties[roundIndex] * positionWeight;
    });
    return penalty;
}

function randomDiscoveryValue(videoId) {
    return stableVideoValue(videoId, homeRandomSeed);
}

function homeAgeBucket(video, now = Date.now()) {
    const ageDays = videoAgeDays(video, now);
    if (ageDays <= 7) return 'week';
    if (ageDays <= 30) return 'month';
    if (ageDays <= 120) return 'quarter';
    if (ageDays <= 365) return 'back';
    return 'older';
}

function mixHomeAgeBuckets(items) {
    const buckets = new Map();
    HOME_AGE_BUCKET_PATTERN.concat(['week', 'month', 'quarter', 'back', 'older'])
        .forEach((bucket) => {
            if (!buckets.has(bucket)) buckets.set(bucket, []);
        });
    items.forEach((item) => {
        const bucket = homeAgeBucket(item.video);
        if (!buckets.has(bucket)) buckets.set(bucket, []);
        buckets.get(bucket).push(item);
    });

    const mixed = [];
    while (mixed.length < items.length) {
        let next = null;
        for (const bucket of HOME_AGE_BUCKET_PATTERN) {
            const items = buckets.get(bucket);
            if (items && items.length) {
                next = items.shift();
                break;
            }
        }
        if (!next) {
            for (const items of buckets.values()) {
                if (items.length) {
                    next = items.shift();
                    break;
                }
            }
        }
        if (!next) break;
        mixed.push(next.video);
    }
    return mixed;
}

function promoteBackCatalog(videos, windowSize = 30) {
    const wantedBuckets = ['month', 'quarter', 'back', 'older'];
    const minimums = { month: 4, quarter: 8, back: 6, older: 1 };
    const top = videos.slice(0, windowSize);
    const counts = {};
    top.forEach((video) => {
        const bucket = homeAgeBucket(video);
        counts[bucket] = (counts[bucket] || 0) + 1;
    });

    wantedBuckets.forEach((bucket) => {
        while ((counts[bucket] || 0) < minimums[bucket]) {
            const foundIndex = videos.findIndex((video, index) =>
                index >= windowSize && homeAgeBucket(video) === bucket
            );
            if (foundIndex < 0) break;
            const [video] = videos.splice(foundIndex, 1);
            const insertAt = Math.min(windowSize - 1, Math.max(0, (counts[bucket] || 0) * 3));
            videos.splice(insertAt, 0, video);
            counts[bucket] = (counts[bucket] || 0) + 1;
            const displaced = videos[windowSize];
            if (displaced) {
                const displacedBucket = homeAgeBucket(displaced);
                counts[displacedBucket] = Math.max(0, (counts[displacedBucket] || 0) - 1);
            }
        }
    });
    return videos;
}

// Privacy-first recommendation score. Everything is calculated locally:
// channel affinity from watch history, upload freshness, completion state,
// and a diversity pass that prevents one channel taking over the page.
function rankHomeVideos(videos) {
    const now = Date.now();
    const dayMs = 86400000;
    const recentHomeRounds = loadRecentHomeRounds();
    const channelAffinity = new Map();
    Object.values(watchedMap || {}).forEach((record) => {
        const key = channelKey(record.channelName);
        if (!key) return;
        const duration = Number(record.duration || 0);
        const progress = duration > 0 ? Math.max(0, Math.min(1, Number(record.time || 0) / duration)) : 0;
        if (progress <= 0) return;

        // Recent watches matter most. The signal halves every 14 days, but older
        // watches keep a small residual influence so preferences do not reset.
        const watchedAt = Number(record.timestamp || 0);
        const ageDays = watchedAt > 0 ? Math.max(0, (now - watchedAt) / dayMs) : 90;
        const recencyWeight = Math.pow(0.5, ageDays / 14);
        const engagement = progress >= 0.9 ? 2.5 : (progress >= 0.25 ? 1.5 : 0.5);

        const stats = channelAffinity.get(key) || {
            weightedEngagement: 0,
            recentCount: 0,
            latestTimestamp: 0
        };
        stats.weightedEngagement += engagement * (0.2 + 0.8 * recencyWeight);
        if (ageDays <= 14) stats.recentCount += 1;
        stats.latestTimestamp = Math.max(stats.latestTimestamp, watchedAt);
        channelAffinity.set(key, stats);
    });

    const scored = videos
    .filter((video) => !feedFeedback.notInterested[video.videoId])
    .map((video) => {
        const watched = watchedMap[video.videoId] || null;
        const duration = Number((watched && watched.duration) || video.duration || 0);
        const progress = watched && duration > 0
            ? Math.max(0, Math.min(1, Number(watched.time || 0) / duration))
            : 0;
        const ageDays = videoAgeDays(video, now);
        // Fresh uploads get a light nudge, but Home should feel like a library
        // shuffle, not another newest-first Subscriptions tab.
        const freshness = 4 * Math.exp(-ageDays / 21);
        const channelStats = channelAffinity.get(channelKey(video.channelName));
        let affinity = 0;
        if (channelStats) {
            const latestAgeDays = channelStats.latestTimestamp
                ? Math.max(0, (now - channelStats.latestTimestamp) / dayMs)
                : 90;
            const repeatBonus = Math.min(18, Math.max(0, channelStats.recentCount - 1) * 4);
            const latestWatchBonus = 7 * Math.exp(-latestAgeDays / 7);
            affinity = Math.min(
                48,
                channelStats.weightedEngagement * 4 + repeatBonus + latestWatchBonus
            );
        }
        // Keep some back-catalog discovery, but do not let imported/backfilled
        // months-old videos beat a healthy pool of recent uploads.
        const strongChannel = channelStats && (
            channelStats.recentCount >= 3 ||
            channelStats.weightedEngagement >= 5
        );
        const evergreenBonus = strongChannel && !watched
            ? 14 * Math.exp(-ageDays / 120)
            : 0;
        // Random discovery is the main force inside each age bucket.
        const discovery = randomDiscoveryValue(video.videoId) * 80;
        // Occasionally surface channels the user has not watched much yet,
        // so Home does not become a loop of only established favourites.
        const exploration = channelStats ? Math.max(0, 10 - channelStats.recentCount * 2) : 14;
        const unwatchedBonus = watched ? 0 : 18;
        const resumeBonus = progress > 0 && progress < 0.9 ? 4 : 0;
        const completedPenalty = progress >= 0.9 ? 65 : 0;
        const repeatPenalty = recentHomePenalty(video.videoId, recentHomeRounds);
        const channelLessPenalty = Math.min(
            80,
            Number(feedFeedback.channelLess[channelKey(video.channelName)] || 0) * 18
        );
        const channelMoreBonus = Math.min(
            70,
            Number(feedFeedback.channelMore[channelKey(video.channelName)] || 0) * 14
        );
        return {
            video,
            score: freshness + affinity + evergreenBonus + discovery + exploration +
                unwatchedBonus + resumeBonus + channelMoreBonus -
                completedPenalty - repeatPenalty - channelLessPenalty
        };
    }).sort((a, b) => (b.score - a.score) ||
        (Number(b.video.published || 0) - Number(a.video.published || 0)));

    const result = promoteBackCatalog(mixHomeAgeBuckets(scored));

    // An explicit "More like this" choice should be visible to the user.
    // Random discovery and recent-round penalties must not completely hide
    // that channel, so guarantee one of its videos near the top of Home.
    const preferredChannels = Object.entries(feedFeedback.channelMore || {})
        .filter(([, strength]) => Number(strength) > 0)
        .sort((a, b) => Number(b[1]) - Number(a[1]));
    preferredChannels.slice(0, 6).forEach(([key], preferredIndex) => {
        const topWindow = Math.min(20, result.length);
        if (result.slice(0, topWindow).some((video) => channelKey(video.channelName) === key)) return;
        const foundIndex = result.findIndex((video) => channelKey(video.channelName) === key);
        if (foundIndex < 0) return;
        const [preferredVideo] = result.splice(foundIndex, 1);
        result.splice(Math.min(4 + preferredIndex * 2, result.length), 0, preferredVideo);
    });
    return result;
}

function currentView() {
    const q = (document.getElementById('search').value || '').trim();
    const sort = 'newest'; // feed is always newest-first
    const unwatchedOnly = document.getElementById('unwatched').checked;
    const hideMembers = document.getElementById('hideMembers')?.checked;
    const applyHiddenFilter = (items) => items.filter((video) => !feedFeedback.notInterested[video.videoId]);
    const applyMemberFilter = (items) => hideMembers ? items.filter((v) => !videoIsMembersOnly(v)) : items;

    // No query: browse the feed, honoring the sort dropdown.
    if (!q) {
        let list = (!shortsOnly && !subscriptionsChronological)
            ? buildHomeIndex()
            : allVideos.slice();
        list = applyHiddenFilter(list);
        if (unwatchedOnly) list = list.filter((v) => !watchedMap[v.videoId]);
        list = applyMemberFilter(list);
        list = applyShortsFilter(list);
        if (!shortsOnly && !subscriptionsChronological) {
            const homeList = rankHomeVideos(list).slice(0, VISIBLE_FEED_LIMIT);
            rememberHomeRecommendations(homeList);
            return { list: homeList, q };
        }
        return { list: sortList(list, sort).slice(0, VISIBLE_FEED_LIMIT), q };
    }

    // Query: YouTube-style search over feed + history. Match every word in any
    // order, then rank by relevance (best matches first) like a search engine.
    const tokens = tokenize(q);
    const phrase = normalizeText(q);
    let list = buildLocalIndex().filter((v) => matchesTokens(v, tokens));
    list = applyHiddenFilter(list);
    if (unwatchedOnly) list = list.filter((v) => !watchedMap[v.videoId]);
    list = applyMemberFilter(list);
    list = applyShortsFilter(list);
    const metadataCandidates = list.slice();

    const dateFilter = 'any';
    const durationFilter = 'any';
    const watchedFilter = 'any';
    const sortFilter = 'relevance';
    const ageLimits = { day: 1, week: 7, month: 31, year: 366 };
    if (dateFilter !== 'any') {
        const cutoff = Date.now() - ageLimits[dateFilter] * 86400000;
        list = list.filter((video) => Number(video.published || 0) >= cutoff);
    }
    if (durationFilter !== 'any') {
        list = list.filter((video) => {
            const record = watchedMap[video.videoId];
            const duration = Number(video.duration || (record && record.duration) || 0);
            if (!duration) return false;
            if (durationFilter === 'short') return duration < 240;
            if (durationFilter === 'medium') return duration >= 240 && duration <= 1200;
            return duration > 1200;
        });
    }
    if (watchedFilter !== 'any') {
        list = list.filter((video) => {
            const record = watchedMap[video.videoId];
            const duration = Number((record && record.duration) || video.duration || 0);
            const progress = record && duration > 0 ? Number(record.time || 0) / duration : 0;
            if (watchedFilter === 'unwatched') return !record || Number(record.time || 0) <= 0;
            if (watchedFilter === 'progress') return progress > 0 && progress < COMPLETED_RATIO;
            return progress >= COMPLETED_RATIO;
        });
    }

    const scored = list.map((v) => ({ v, s: scoreVideo(v, tokens, phrase) }));
    if (sortFilter === 'newest') {
        scored.sort((a, b) => Number(b.v.published || 0) - Number(a.v.published || 0));
    } else if (sortFilter === 'oldest') {
        scored.sort((a, b) => Number(a.v.published || 0) - Number(b.v.published || 0));
    } else {
        scored.sort((a, b) => (b.s - a.s) ||
            (Number(b.v.published || 0) - Number(a.v.published || 0)));
    }
    return {
        list: scored.map((x) => x.v),
        q: q.toLowerCase(),
        metadataCandidates
    };
}

function bestChannelMatch(videos, query) {
    const phrase = normalizeText(query);
    if (!phrase) return null;
    const groups = new Map();
    videos.forEach((video) => {
        const name = decodeHtmlEntities(video.channelName || '').trim();
        const key = normalizeText(name);
        if (!key || !key.includes(phrase)) return;
        const current = groups.get(key) || { name, videos: [], representative: video };
        current.videos.push(video);
        if (!current.representative.channelThumbnail && video.channelThumbnail) {
            current.representative = video;
        }
        groups.set(key, current);
    });
    const choices = Array.from(groups.entries()).map(([key, group]) => ({
        ...group,
        key,
        strength: key === phrase ? 3 : 1
    }));
    choices.sort((a, b) => (b.strength - a.strength) ||
        (b.videos.length - a.videos.length));
    const best = choices[0];
    // A channel card is useful when someone searches the actual channel name.
    // Partial/general words should behave like a normal video search instead.
    return best && best.strength === 3 ? best : null;
}

function buildLocalChannelResult(match) {
    const video = match.representative;
    applyLocalChannelArtwork(video);
    const row = document.createElement('div');
    row.className = 'local-channel-result';
    row.addEventListener('click', () => showChannelPage(bestChannelInfoFromVideo(video)));

    const avatarLink = document.createElement('a');
    avatarLink.className = 'local-channel-avatar-link';
    avatarLink.href = video.channelUrl || video.url;
    avatarLink.target = '_blank';
    avatarLink.rel = 'noopener';
    avatarLink.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        showChannelPage(bestChannelInfoFromVideo(video));
    });
    let avatar;
    if (video.channelThumbnail) {
        avatar = document.createElement('img');
        avatar.src = video.channelThumbnail;
        avatar.alt = '';
    } else {
        avatar = document.createElement('div');
        avatar.textContent = (match.name || '?').charAt(0).toUpperCase();
    }
    avatar.className = 'local-channel-avatar';
    avatarLink.appendChild(avatar);
    row.appendChild(avatarLink);

    const details = document.createElement('div');
    details.className = 'local-channel-info';
    const name = document.createElement('a');
    name.className = 'local-channel-name';
    name.href = video.channelUrl || video.url;
    name.target = '_blank';
    name.rel = 'noopener';
    name.textContent = match.name;
    name.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        showChannelPage(bestChannelInfoFromVideo(video));
    });
    details.appendChild(name);

    const meta = document.createElement('div');
    meta.className = 'local-channel-meta';
    meta.textContent = feedPlural(
        'feed_matching_local_videos',
        match.videos.length,
        '$1 matching video in your local library',
        '$1 matching videos in your local library'
    );
    details.appendChild(meta);

    const description = document.createElement('div');
    description.className = 'local-channel-description';
    description.textContent = tFeed('feed_locally_subscribed_channel', 'Locally subscribed channel');
    details.appendChild(description);
    row.appendChild(details);

    const view = document.createElement('span');
    view.className = 'local-channel-view';
    view.textContent = tFeed('feed_view_channel', 'View channel');
    row.appendChild(view);

    return row;
}

function render() {
    const grid = document.getElementById('grid');
    const searchResults = document.getElementById('localSearchResults');
    const empty = document.getElementById('empty');
    const count = document.getElementById('count');
    const heading = document.getElementById('localHeading');
    const status = document.getElementById('status');
    const filters = document.getElementById('searchFilters');
    const sourceTabs = document.getElementById('searchSourceTabs');

    const { list, q, metadataCandidates = [] } = currentView();
    const visibleList = q ? list.slice(0, searchVisibleLimit) : list;
    document.body.classList.toggle('shorts-mode', shortsOnly && !q);
    grid.textContent = '';
    if (searchResults) searchResults.textContent = '';
    // No plain "Your feed" label; only show a heading for search/Shorts context.
    const headingText = q
        ? tFeed('feed_search_results_for_query', 'Search results for “$1”', [q])
        : (shortsOnly ? tFeed('tab_shorts', 'Shorts') : '');
    heading.textContent = '';
    if (shortsOnly && !q) {
        const icon = document.createElement('span');
        icon.className = 'shorts-heading-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML = '<svg viewBox="0 0 24 24"><path d="m13.5 2-7 11h5l-1 9 7-12h-5l1-8Z"></path></svg>';
        heading.append(icon, document.createTextNode(tFeed('tab_shorts', 'Shorts')));
    } else {
        heading.textContent = headingText;
    }
    heading.style.display = headingText ? '' : 'none';
    if (filters) {
        filters.classList.toggle('visible', !!q);
        filters.classList.toggle('open', !!q && searchFiltersOpen);
    }
    if (sourceTabs) sourceTabs.classList.toggle('visible', !!q);
    if (status) status.style.display = q ? 'none' : '';

    if (q) {
        heading.style.display = 'none';
    }

    if (!shortsOnly && !subscriptionsChronological && list.length && typeof ytvhtFeedViewData !== 'undefined') {
        ytvhtFeedViewData.persistHomeImpressions(ytIndexedDBStorage, list, Date.now()).catch(() => {});
    }

    if (allVideos.length === 0 && !q) {
        grid.style.display = 'none';
        if (searchResults) searchResults.style.display = 'none';
        empty.style.display = 'block';
        empty.textContent = tFeed(
            'feed_no_videos_add_subscription',
            'No videos yet. Add a local subscription, then click Refresh here.'
        );
        if (status) status.style.display = 'none';
        count.textContent = '';
        return;
    }
    if (list.length === 0) {
        grid.style.display = 'none';
        if (searchResults) searchResults.style.display = 'none';
        empty.style.display = 'block';
        empty.textContent = q
            ? tFeed('feed_no_search_matches', 'Nothing in your feed or history matches “$1”.', [q])
            : (shortsOnly
                ? tFeed('feed_no_shorts_matches', 'No Shorts match the current filters. Try turning off Unwatched only or click Refresh.')
                : tFeed('feed_no_home_matches', 'No home videos match the current filters. Try turning off Unwatched only or click Refresh.'));
    } else {
        empty.style.display = 'none';
        if (q && searchResults) {
            grid.style.display = 'none';
            searchResults.style.display = 'flex';
            const channel = bestChannelMatch(list, q);
            if (channel) searchResults.appendChild(buildLocalChannelResult(channel));
            visibleList.forEach((video) => searchResults.appendChild(buildResultRow(video)));
            if (visibleList.length < list.length) {
                const more = document.createElement('button');
                more.className = 'btn primary search-load-more';
                more.textContent = tFeed(
                    'feed_load_more_remaining',
                    'Load more ($1 remaining)',
                    [feedFormatNumber(list.length - visibleList.length)]
                );
                more.addEventListener('click', () => {
                    searchVisibleLimit += SEARCH_PAGE_SIZE;
                    render();
                });
                searchResults.appendChild(more);
            }
        } else {
            if (searchResults) searchResults.style.display = 'none';
            grid.style.display = 'grid';
            const frag = document.createDocumentFragment();
            list.forEach((v) => frag.appendChild(buildCard(v)));
            grid.appendChild(frag);
        }
    }

    count.textContent = '';

    const ytSection = document.getElementById('ytSection');
    if (ytSection && !q) ytSection.style.display = 'none';
}

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

// ----- analytics view ----------------------------------------------------
// Built entirely from the clean getStats() snapshot (totalWatchSeconds, daily,
// hourly[24], counters) plus the playlist count — no canvas, just CSS bars.

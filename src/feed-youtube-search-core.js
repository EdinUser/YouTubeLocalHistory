// ----- account-free YouTube search (innertube) ---------------------------
function runsText(node) {
    if (!node) return '';
    if (node.simpleText) return node.simpleText;
    if (Array.isArray(node.runs)) return node.runs.map((r) => r.text).join('');
    return '';
}

function videoFromRenderer(vr) {
    if (!vr || !vr.videoId) return null;
    const owner = vr.ownerText || vr.longBylineText;
    let channelUrl = null;
    try {
        const ep = owner.runs[0].navigationEndpoint.browseEndpoint;
        const base = ep.canonicalBaseUrl || ('/channel/' + ep.browseId);
        channelUrl = 'https://www.youtube.com' + base;
    } catch (_) { /* ignore */ }

    const thumbs = (vr.thumbnail && vr.thumbnail.thumbnails) || [];
    let channelThumbnail = null;
    try {
        const ct = vr.channelThumbnailSupportedRenderers
            .channelThumbnailWithLinkRenderer.thumbnail.thumbnails;
        channelThumbnail = ct[ct.length - 1].url;
    } catch (_) { /* ignore */ }

    return {
        videoId: vr.videoId,
        title: runsText(vr.title),
        url: `https://www.youtube.com/watch?v=${vr.videoId}`,
        channelName: runsText(owner),
        channelUrl,
        channelThumbnail,
        thumbnail: thumbs.length ? thumbs[thumbs.length - 1].url : null,
        _durationText: cleanDurationText(runsText(vr.lengthText)),
        _viewsText: runsText(vr.shortViewCountText) || runsText(vr.viewCountText),
        _whenText: runsText(vr.publishedTimeText),
        _source: 'youtube-search',
        _memberBadgeText: rendererMemberBadgeText(vr),
        isLive: rendererIsLive(vr)
    };
}

function rendererMemberBadgeText(node) {
    if (!node || typeof node !== 'object') return '';
    const text = JSON.stringify(node).toLowerCase();
    if (/members?[^a-z0-9]{0,20}only/.test(text) ||
        text.includes('badge_style_type_members_only')) return 'Members only';
    if (/members?[^a-z0-9]{0,20}first/.test(text) ||
        text.includes('badge_style_type_members_first')) return 'Members first';
    return '';
}

function rendererIsLive(renderer) {
    if (!renderer) return false;
    const badges = []
        .concat(renderer.badges || [])
        .concat(renderer.ownerBadges || [])
        .concat(renderer.thumbnailOverlays || []);
    return badges.some((entry) => {
        const text = JSON.stringify(entry || {}).toLowerCase();
        return text.includes('badge_style_type_live_now') ||
            text.includes('"style":"live"') ||
            text.includes('"text":"live"') ||
            text.includes('"simpletext":"live"') ||
            text.includes('live now');
    });
}

function channelFromRenderer(cr) {
    if (!cr || !cr.channelId) return null;
    const thumbs = (cr.thumbnail && cr.thumbnail.thumbnails) || [];
    let avatar = thumbs.length ? thumbs[thumbs.length - 1].url : null;
    if (avatar && avatar.startsWith('//')) avatar = 'https:' + avatar;
    let handle = null;
    try {
        const b = cr.navigationEndpoint.browseEndpoint.canonicalBaseUrl;
        if (b && b.startsWith('/@')) handle = b.slice(1);
    } catch (_) { /* ignore */ }
    return {
        _type: 'channel',
        channelId: cr.channelId,
        ucid: cr.channelId,
        handle,
        channelName: runsText(cr.title),
        thumbnail: avatar,
        subsText: runsText(cr.subscriberCountText) || runsText(cr.videoCountText),
        url: handle ? `https://www.youtube.com/${handle}` : `https://www.youtube.com/channel/${cr.channelId}`
    };
}

function parseSearchResults(data) {
    const out = [];
    try {
        const sections = data.contents.twoColumnSearchResultsRenderer
            .primaryContents.sectionListRenderer.contents || [];
        for (const sec of sections) {
            const items = (sec.itemSectionRenderer && sec.itemSectionRenderer.contents) || [];
            for (const it of items) {
                if (it.videoRenderer) {
                    const v = videoFromRenderer(it.videoRenderer);
                    if (v) out.push(v);
                } else if (it.channelRenderer) {
                    const c = channelFromRenderer(it.channelRenderer);
                    if (c) out.push(c);
                }
            }
        }
    } catch (_) { /* ignore malformed */ }
    return out;
}

function continuationTokenFrom(node) {
    if (!node || typeof node !== 'object') return '';
    const renderer = node.continuationItemRenderer;
    const token = renderer && renderer.continuationEndpoint &&
        renderer.continuationEndpoint.continuationCommand &&
        renderer.continuationEndpoint.continuationCommand.token;
    if (token) return token;
    for (const value of Object.values(node)) {
        const found = continuationTokenFrom(value);
        if (found) return found;
    }
    return '';
}

function clickTrackingParamsForContinuation(node, token) {
    if (!node || typeof node !== 'object' || !token) return '';
    const endpoint = node.continuationItemRenderer && node.continuationItemRenderer.continuationEndpoint;
    const command = endpoint && endpoint.continuationCommand;
    if (command && command.token === token) return endpoint.clickTrackingParams || '';
    for (const value of Object.values(node)) {
        const found = clickTrackingParamsForContinuation(value, token);
        if (found) return found;
    }
    return '';
}

function continuationTokenFromHtml(html) {
    const patterns = [
        /"continuationCommand":\{"token":"([^"]+)","request":"CONTINUATION_REQUEST_TYPE_SEARCH"/,
        /"continuationCommand":\{"token":"([^"]+)"/
    ];
    for (const pattern of patterns) {
        const match = String(html || '').match(pattern);
        if (!match) continue;
        try { return JSON.parse(`"${match[1]}"`); } catch (_) { return match[1]; }
    }
    return '';
}

function parseContinuationResults(data) {
    const out = [];
    const commands = collectContinuationCommands(data);
    let items = [];
    commands.forEach((command) => {
        const action = command.appendContinuationItemsAction ||
            command.reloadContinuationItemsCommand ||
            command.appendContinuationItemsCommand;
        if (action && Array.isArray(action.continuationItems)) {
            items = items.concat(action.continuationItems);
        }
    });
    items.forEach((item) => {
        if (item.videoRenderer) {
            const video = videoFromRenderer(item.videoRenderer);
            if (video) out.push(video);
        } else if (item.channelRenderer) {
            const channel = channelFromRenderer(item.channelRenderer);
            if (channel) out.push(channel);
        } else if (item.itemSectionRenderer) {
            (item.itemSectionRenderer.contents || []).forEach((child) => {
                if (child.videoRenderer) {
                    const video = videoFromRenderer(child.videoRenderer);
                    if (video) out.push(video);
                } else if (child.channelRenderer) {
                    const channel = channelFromRenderer(child.channelRenderer);
                    if (channel) out.push(channel);
                }
            });
        }
    });
    const continuation = continuationTokenFrom(items);
    return {
        results: out,
        continuation,
        clickTrackingParams: clickTrackingParamsForContinuation(items, continuation)
    };
}

function collectContinuationCommands(node, out = []) {
    if (!node || typeof node !== 'object') return out;
    if (Array.isArray(node)) {
        node.forEach((item) => collectContinuationCommands(item, out));
        return out;
    }
    if (node.appendContinuationItemsAction ||
        node.reloadContinuationItemsCommand ||
        node.appendContinuationItemsCommand) {
        out.push(node);
    }
    Object.values(node).forEach((value) => collectContinuationCommands(value, out));
    return out;
}

function buildChannelCard(ch) {
    const card = document.createElement('div');
    card.className = 'channel-card';
    card.addEventListener('click', () => showChannelPage(ch));

    const aLink = document.createElement('a');
    aLink.href = ch.url; aLink.target = '_blank'; aLink.rel = 'noopener';
    aLink.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        showChannelPage(ch);
    });
    const name = decodeHtmlEntities(ch.channelName || '');
    if (ch.thumbnail) {
        const img = document.createElement('img');
        img.className = 'ch-ava'; img.src = ch.thumbnail; img.alt = '';
        aLink.appendChild(img);
    } else {
        const d = document.createElement('div');
        d.className = 'ch-ava'; d.textContent = (name || '?').charAt(0).toUpperCase();
        aLink.appendChild(d);
    }

    const meta = document.createElement('div');
    meta.className = 'ch-meta';
    const nameLink = document.createElement('a');
    nameLink.className = 'ch-name'; nameLink.href = ch.url;
    nameLink.target = '_blank'; nameLink.rel = 'noopener'; nameLink.textContent = name;
    nameLink.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        showChannelPage(ch);
    });
    const subs = document.createElement('div');
    subs.className = 'ch-subs'; subs.textContent = ch.subsText || '';
    meta.appendChild(nameLink); meta.appendChild(subs);
    const view = document.createElement('span');
    view.className = 'ch-view';
    view.textContent = 'View channel';

    card.appendChild(aLink);
    card.appendChild(meta);
    card.appendChild(view);
    return card;
}

// Extract the first balanced { … } JSON object starting at index `start`.
function sliceBalanced(s, start) {
    let depth = 0, inStr = false, esc = false;
    for (let k = start; k < s.length; k++) {
        const c = s[k];
        if (inStr) {
            if (esc) esc = false;
            else if (c === '\\') esc = true;
            else if (c === '"') inStr = false;
        } else if (c === '"') {
            inStr = true;
        } else if (c === '{') {
            depth++;
        } else if (c === '}') {
            depth--;
            if (depth === 0) return s.slice(start, k + 1);
        }
    }
    return null;
}

// Pull the page's embedded ytInitialData JSON out of results-page HTML.
function extractInitialData(html) {
    let i = html.indexOf('ytInitialData');
    while (i !== -1) {
        const eq = html.indexOf('=', i);
        if (eq !== -1) {
            let j = eq + 1;
            while (j < html.length && html[j] !== '{' && html[j] !== '\n') j++;
            if (html[j] === '{') {
                const json = sliceBalanced(html, j);
                if (json) {
                    try { return JSON.parse(json); } catch (_) { /* try next */ }
                }
            }
        }
        i = html.indexOf('ytInitialData', i + 13);
    }
    return null;
}

// Account-free search via YouTube's normal results page (a plain GET — the
// innertube POST API returns 403 from a non-youtube origin, but the page
// load isn't blocked, and it embeds the same ytInitialData we parse).
function parseYouTubeSearchHtml(html) {
    const data = extractInitialData(html);
    if (!data) throw new Error('could not read results (consent wall?)');
    let searchContents = data;
    try {
        searchContents = data.contents.twoColumnSearchResultsRenderer
            .primaryContents.sectionListRenderer.contents;
    } catch (_) { /* fall back to the full response */ }
    const continuation = continuationTokenFrom(searchContents) || continuationTokenFromHtml(html);
    return {
        results: parseSearchResults(data),
        continuation,
        config: {
            clientVersion: decodeEmbeddedJsonString(
                (html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/) || [])[1] || ''
            ),
            visitorData: decodeEmbeddedJsonString(
                (html.match(/"VISITOR_DATA":"([^"]+)"/) || [])[1] || ''
            ),
            apiKey: (html.match(/"INNERTUBE_API_KEY":"([^"]+)"/) || [])[1] || '',
            clickTrackingParams: clickTrackingParamsForContinuation(searchContents, continuation)
        }
    };
}

async function fetchYouTubeSearchPageInBackground(query) {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
        throw new Error('Background search helper is unavailable');
    }
    const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
            { type: 'fetchYouTubeSearchPage', query },
            (message) => {
                if (chrome.runtime.lastError) {
                    resolve({ error: chrome.runtime.lastError.message });
                    return;
                }
                resolve(message || {});
            }
        );
    });
    if (response.html) return response.html;
    throw new Error(response.error || 'YouTube background search failed');
}

async function searchYouTube(query) {
    const url = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query);
    try {
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return parseYouTubeSearchHtml(await res.text());
    } catch (directError) {
        try {
            return parseYouTubeSearchHtml(await fetchYouTubeSearchPageInBackground(query));
        } catch (backgroundError) {
            const message = backgroundError && backgroundError.message
                ? backgroundError.message
                : String(backgroundError || directError);
            throw new Error(message || (directError && directError.message) || 'YouTube search failed');
        }
    }
}

async function searchYouTubeContinuation(token) {
    const config = (youtubeSearchConfig && youtubeSearchConfig.clientVersion)
        ? youtubeSearchConfig
        : await getInnertubeConfig();
    if (!config || !token) return { results: [], continuation: '' };
    try {
        const backgroundResult = await new Promise((resolve) => {
            chrome.runtime.sendMessage(
                { type: 'fetchYouTubeSearchContinuation', token, config },
                (response) => {
                    if (chrome.runtime.lastError) {
                        resolve({ error: chrome.runtime.lastError.message });
                        return;
                    }
                    resolve(response || {});
                }
            );
        });
        if (backgroundResult.data) {
            const page = parseContinuationResults(backgroundResult.data);
            if (page.results.length || page.continuation) return page;
        }
        if (backgroundResult.error) {
            console.warn('[feed] background continuation failed:', backgroundResult.error);
        }
    } catch (error) {
        console.warn('[feed] background continuation request failed', error);
    }

    const key = config.apiKey ? `?key=${encodeURIComponent(config.apiKey)}` : '';
    const context = {
        client: {
            clientName: 'WEB',
            clientVersion: config.clientVersion,
            visitorData: config.visitorData,
            hl: 'en',
            gl: 'US'
        }
    };
    if (config.clickTrackingParams) {
        context.clickTracking = { clickTrackingParams: String(config.clickTrackingParams) };
    }
    const body = JSON.stringify({
        context,
        continuation: token
    });
    const headers = {
        'Content-Type': 'application/json',
        'X-YouTube-Client-Name': '1',
        'X-YouTube-Client-Version': config.clientVersion
    };
    if (config.visitorData) headers['X-Goog-Visitor-Id'] = config.visitorData;

    const endpoints = [
        `https://www.youtube.com/youtubei/v1/search${key}`,
        `https://youtubei.googleapis.com/youtubei/v1/search${key}`
    ];
    let lastError = null;
    for (const endpoint of endpoints) {
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                credentials: endpoint.includes('youtube.com/') ? 'include' : 'omit',
                headers,
                body
            });
            if (!response.ok) {
                lastError = new Error('HTTP ' + response.status);
                continue;
            }
            const page = parseContinuationResults(await response.json());
            if (page.results.length || page.continuation) return page;
            lastError = new Error('YouTube returned an empty result page');
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error('Could not load the next YouTube result page');
}

function durationTextSeconds(text) {
    const parts = String(text || '').split(':').map(Number);
    if (!parts.length || parts.some((part) => !Number.isFinite(part))) return 0;
    return parts.reduce((total, part) => total * 60 + part, 0);
}

function relativeAgeDays(text) {
    const value = String(text || '').toLowerCase();
    if (value.includes('yesterday')) return 1;
    if (value.includes('just now') || value.includes('minute') || value.includes('hour')) return 0;
    const match = value.match(/(\d+)\s+(day|week|month|year)/);
    if (!match) return null;
    const amount = Number(match[1]);
    const multipliers = { day: 1, week: 7, month: 30, year: 365 };
    return amount * multipliers[match[2]];
}

function youtubeResultScore(result, query) {
    const phrase = normalizeText(query);
    const title = normalizeText(result.title || result.channelName || '');
    const channel = normalizeText(result.channelName || '');
    let score = result._type === 'channel' ? 25 : 0;
    if (title === phrase || channel === phrase) score += 120;
    if (title.startsWith(phrase) || channel.startsWith(phrase)) score += 65;
    if (title.includes(phrase) || channel.includes(phrase)) score += 30;
    const locallySubscribed = localSubscriptions.some((subscription) => {
        const namesMatch = normalizeText(subscription.channelName) === channel;
        const idsMatch = [subscription.id, subscription.ucid, subscription.handle]
            .filter(Boolean)
            .includes(result.ucid || result.handle);
        return namesMatch || idsMatch;
    });
    if (locallySubscribed) score += 80;
    tokenize(query).forEach((token) => {
        if (title.split(' ').some((word) => word.startsWith(token))) score += 12;
        if (channel.split(' ').some((word) => word.startsWith(token))) score += 10;
    });
    return score;
}

function filteredYouTubeResults(query) {
    const seen = new Set();
    let results = youtubeSearchResults.filter((result) => {
        const key = result._type === 'channel'
            ? `channel:${result.ucid || result.handle || normalizeText(result.channelName)}`
            : `video:${result.videoId}`;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    const durationFilter = 'any';
    const watchedFilter = 'any';
    const dateFilter = 'any';
    const videoOnlyFilter = durationFilter !== 'any' ||
        watchedFilter !== 'any' || dateFilter !== 'any';
    if (videoOnlyFilter) {
        results = results.filter((result) => result._type !== 'channel');
    }
    const ageLimits = { day: 1, week: 7, month: 31, year: 366 };
    if (dateFilter !== 'any') {
        results = results.filter((result) => {
            if (result._type === 'channel') return true;
            const age = relativeAgeDays(result._whenText);
            return age != null && age <= ageLimits[dateFilter];
        });
    }
    if (durationFilter !== 'any') {
        results = results.filter((result) => {
            if (result._type === 'channel') return true;
            const duration = durationTextSeconds(result._durationText);
            if (!duration) return false;
            if (durationFilter === 'short') return duration < 240;
            if (durationFilter === 'medium') return duration >= 240 && duration <= 1200;
            return duration > 1200;
        });
    }
    if (watchedFilter !== 'any') {
        results = results.filter((result) => {
            if (result._type === 'channel') return true;
            const record = watchedMap[result.videoId];
            const duration = Number((record && record.duration) || durationTextSeconds(result._durationText) || 0);
            const progress = record && duration > 0 ? Number(record.time || 0) / duration : 0;
            if (watchedFilter === 'unwatched') return !record || Number(record.time || 0) <= 0;
            if (watchedFilter === 'progress') return progress > 0 && progress < COMPLETED_RATIO;
            return progress >= COMPLETED_RATIO;
        });
    }

    const sort = 'relevance';
    // Keep YouTube's own order for relevance, just like youtube.com.
    if (sort !== 'relevance') {
        results.sort((a, b) => {
            if (a._type === 'channel' || b._type === 'channel') {
                return a._type === 'channel' ? -1 : 1;
            }
            const ageA = relativeAgeDays(a._whenText);
            const ageB = relativeAgeDays(b._whenText);
            const safeA = ageA == null ? Number.MAX_SAFE_INTEGER : ageA;
            const safeB = ageB == null ? Number.MAX_SAFE_INTEGER : ageB;
            return sort === 'oldest' ? safeB - safeA : safeA - safeB;
        });
    }
    return results;
}

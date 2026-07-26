// ========================================================================
// Feed data pipeline for the dedicated extension page.
// The page fetches youtube.com directly via extension host permissions, so
// refreshes do not require injecting a temporary UI into YouTube itself.
// ========================================================================
const PER_CHANNEL_LIMIT = 15;
// Keep a much wider pool for Home discovery. Only 300 cards are rendered,
// but recommendations can draw from up to 2,000 uploads across all channels.
const TOTAL_FEED_LIMIT = 2000;
const FETCH_CONCURRENCY = 10;
const YT_NS = 'http://www.youtube.com/xml/schemas/2015';
const MEDIA_NS = 'http://search.yahoo.com/mrss/';
const CHANNEL_BACKFILL_CONCURRENCY = 2;
const feedCore = globalThis.ytvhtFeedCore || {};
const FEED_CACHE_POLICY = feedCore.FEED_CACHE_POLICY || 'balanced-backfill-lockup-v1';
let isRefreshing = false;
let feedRefreshGeneration = 0;
let feedAutoRefreshSuppressedUntil = 0;

function cancelFeedRefreshes() {
    feedRefreshGeneration += 1;
    isRefreshing = false;
    feedAutoRefreshSuppressedUntil = Date.now() + 10000;
}

function feedRefreshIsSuppressed() {
    return Date.now() < feedAutoRefreshSuppressedUntil;
}

// A channel's OWN UC id (avoid generic /channel/UC which hits featured channels).
function extractOwnUcid(text) {
    const m = text.match(/"externalId":"(UC[\w-]+)"/)
        || text.match(/<link[^>]*rel="canonical"[^>]*\/channel\/(UC[\w-]+)/)
        || text.match(/<meta[^>]*itemprop="(?:identifier|channelId)"[^>]*content="(UC[\w-]+)"/)
        || text.match(/"channelId":"(UC[\w-]+)"/);
    return m ? m[1] : null;
}

// Fill in a subscription's missing ucid / @handle / avatar / name from its page.
async function enrichSubscription(info, overwrite = false, shouldContinue = () => true) {
    const channelUrl = info.url
        || (info.handle ? `https://www.youtube.com/${info.handle}` : null)
        || (info.ucid ? `https://www.youtube.com/channel/${info.ucid}` : null);
    if (!channelUrl) return;
    try {
        const res = await fetch(channelUrl, { credentials: 'include' });
        if (!res.ok) return;
        const text = await res.text();
        if (!shouldContinue()) return;
        const patch = {};
        if (overwrite || !info.ucid) {
            const ucid = extractOwnUcid(text);
            if (ucid) patch.ucid = ucid;
        }
        if (overwrite || !info.handle) {
            const hm = (res.url || '').match(/\/(@[\w.\-]+)/);
            if (hm) patch.handle = hm[1];
        }
        if (overwrite || !info.thumbnail) {
            let av = (text.match(/<meta property="og:image" content="([^"]+)"/) || [])[1];
            if (!av) {
                const jm = text.match(/"avatar":\{"thumbnails":\[\{"url":"([^"]+)"/);
                if (jm) av = jm[1].replace(/\\\//g, '/');
            }
            if (av) patch.thumbnail = av;
        }
        if (overwrite || !info.channelName || info.channelName === 'Unknown Channel') {
            const nm = (text.match(/<meta property="og:title" content="([^"]+)"/) || [])[1];
            if (nm) patch.channelName = nm;
        }
        if (Object.keys(patch).length) {
            if (!shouldContinue()) return;
            await ytStorage.updateSubscription(info.id || info.channelId, patch);
        }
    } catch (_) { /* ignore */ }
}

async function enrichSearchChannelAvatars(query) {
    const tokens = tokenize(query);
    if (!tokens.length) return;
    const matches = localSubscriptions.filter((sub) => {
        if (!sub || sub.thumbnail || enrichingSearchChannels.has(sub.id)) return false;
        const words = normalizeText(sub.channelName).split(' ').filter(Boolean);
        return tokens.every((token) => words.some((word) => word.startsWith(token)));
    }).slice(0, 4);
    if (!matches.length) return;

    matches.forEach((sub) => enrichingSearchChannels.add(sub.id));
    try {
        await runPool(matches, 2, (sub) => enrichSubscription(sub));
        localSubscriptions = await ytStorage.getSubscriptionList();
        const currentQuery = (document.getElementById('search').value || '').trim();
        if (normalizeText(currentQuery) === normalizeText(query)) render();
    } finally {
        matches.forEach((sub) => enrichingSearchChannels.delete(sub.id));
    }
}

async function resolveUcid(sub) {
    if (sub.ucid && /^UC[\w-]+$/.test(sub.ucid)) return sub.ucid;
    if (/^UC[\w-]+$/.test(sub.id)) return sub.id;
    const channelUrl = sub.url
        || (sub.handle ? `https://www.youtube.com/${sub.handle}` : null)
        || (sub.id && sub.id.startsWith('@') ? `https://www.youtube.com/${sub.id}` : null);
    if (!channelUrl) return null;
    try {
        const res = await fetch(channelUrl, { credentials: 'include' });
        if (!res.ok) return null;
        const ucid = extractOwnUcid(await res.text());
        if (ucid) await ytStorage.updateSubscription(sub.id, { ucid });
        return ucid;
    } catch (_) { return null; }
}

function getXmlText(parent, ns, localName, prefixedName) {
    let el = parent.getElementsByTagNameNS(ns, localName)[0];
    if (!el && prefixedName) el = parent.getElementsByTagName(prefixedName)[0];
    return el ? (el.textContent || '').trim() : '';
}

function parseFeedEntry(entry, sub) {
    let videoId = getXmlText(entry, YT_NS, 'videoId', 'yt:videoId');
    if (!videoId) {
        const m = getXmlText(entry, '', 'id', 'id').match(/yt:video:([\w-]+)/);
        if (m) videoId = m[1];
    }
    if (!videoId) return null;
    const title = getXmlText(entry, '', 'title', 'title') || 'Untitled';
    const publishedRaw =
        getXmlText(entry, '', 'published', 'published') ||
        getXmlText(entry, '', 'updated', 'updated');
    const parsedPublished = publishedRaw ? Date.parse(publishedRaw) : 0;
    const published = Number.isFinite(parsedPublished) ? parsedPublished : 0;
    let thumbnail = '';
    const thumbEl = entry.getElementsByTagNameNS(MEDIA_NS, 'thumbnail')[0]
        || entry.getElementsByTagName('media:thumbnail')[0];
    if (thumbEl) thumbnail = thumbEl.getAttribute('url') || '';
    if (!thumbnail) thumbnail = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
    const channelName = getXmlText(entry, '', 'name', 'name') || sub.channelName || '';
    let views = 0;
    const statsEl = entry.getElementsByTagNameNS(MEDIA_NS, 'statistics')[0]
        || entry.getElementsByTagName('media:statistics')[0];
    if (statsEl) views = parseInt(statsEl.getAttribute('views') || '0', 10) || 0;
    const channelUrl = sub.url
        || (sub.handle ? `https://www.youtube.com/${sub.handle}` : null)
        || (sub.ucid ? `https://www.youtube.com/channel/${sub.ucid}` : null);
    return {
        videoId, title, published, thumbnail, channelName,
        channelThumbnail: sub.thumbnail || null,
        channelUrl, views, channelId: sub.id,
        url: `https://www.youtube.com/watch?v=${videoId}`
    };
}

async function fetchChannelFeed(sub) {
    const ucid = await resolveUcid(sub);
    if (!ucid) return { sub, ucid: null, videos: [], error: 'no-id' };
    try {
        const res = await fetch(
            `https://www.youtube.com/feeds/videos.xml?channel_id=${ucid}`,
            { credentials: 'include' }
        );
        if (!res.ok) return { sub, ucid, videos: [], error: 'http-' + res.status };
        const doc = new DOMParser().parseFromString(await res.text(), 'text/xml');
        if (doc.querySelector('parsererror')) return { sub, ucid, videos: [], error: 'parse' };
        const parsed = Array.from(doc.getElementsByTagName('entry'))
            .map((e) => parseFeedEntry(e, sub)).filter(Boolean).slice(0, PER_CHANNEL_LIMIT);
        return { sub, ucid, videos: parsed, error: null };
    } catch (e) {
        return { sub, ucid, videos: [], error: 'fetch:' + (e.message || 'failed') };
    }
}

async function fetchAllFeeds(subs, includeBackfill = false) {
    const videos = []; const diagnostics = []; let index = 0;
    async function worker() {
        while (index < subs.length) {
            const r = await fetchChannelFeed(subs[index++]);
            let channelVideos = r.videos.slice();
            let backfillCount = 0;
            let backfillError = null;
            if (includeBackfill && r.ucid) {
                const existingIds = new Set(channelVideos.map((video) => video.videoId).filter(Boolean));
                const backfill = await feedCore.fetchChannelBackfill(r.sub, r.ucid, existingIds, { ensureConsentCookie });
                backfillError = backfill.error;
                if (backfill.metadataById) {
                    channelVideos = channelVideos.map((video) => {
                        const metadata = backfill.metadataById[video.videoId];
                        return metadata ? { ...video, ...metadata } : video;
                    });
                }
                if (backfill.videos.length) {
                    backfillCount = backfill.videos.length;
                    channelVideos = channelVideos.concat(backfill.videos);
                }
            }
            videos.push(...channelVideos);
            diagnostics.push({
                name: r.sub.channelName || r.sub.id,
                ucid: r.ucid || null,
                count: channelVideos.length,
                rssCount: r.videos.length,
                backfillCount,
                error: r.error || null,
                backfillError
            });
        }
    }
    const workers = [];
    const workerCount = includeBackfill ? CHANNEL_BACKFILL_CONCURRENCY : FETCH_CONCURRENCY;
    for (let i = 0; i < Math.min(workerCount, subs.length); i++) workers.push(worker());
    await Promise.all(workers);
    return { videos, diagnostics };
}

// Run an async fn over items with bounded concurrency.
async function runPool(items, concurrency, fn) {
    let i = 0;
    const worker = async () => { while (i < items.length) { await fn(items[i++]); } };
    const workers = [];
    for (let k = 0; k < Math.min(concurrency, items.length); k++) workers.push(worker());
    await Promise.all(workers);
}

// Fast path: innertube player API returns the duration in a tiny JSON. The WEB
// client 403s from this extension page's origin, but the ANDROID (mobile) client
// endpoint generally skips that origin check, so it usually works here. This is
// best-effort — if it fails, the heavier watch-page fetch below covers it.
// Reliable fallback that resolves BOTH the duration and whether the video is a
// Short in a single request: fetch the /shorts/ URL. YouTube keeps real Shorts
// on /shorts/ but redirects normal videos to /watch — so res.url tells us which,
// and the page HTML carries the duration either way. Allowed from the extension
// origin (same as the YouTube search path). Heavier, so it's capped & cached.
// Pull the duration out of a chunk of the watch/shorts page.
function parseIsoDuration(value) {
    const match = String(value || '').match(
        /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/
    );
    if (!match) return null;
    const seconds =
        Number(match[1] || 0) * 86400 +
        Number(match[2] || 0) * 3600 +
        Number(match[3] || 0) * 60 +
        Number(match[4] || 0);
    return seconds > 0 ? Math.round(seconds) : null;
}

function parseDurationFromHtml(html) {
    let m = html.match(/"lengthSeconds"\s*:\s*"?(\d+)"?/);
    if (m) { const n = parseInt(m[1], 10); return n > 0 ? n : null; }
    m = html.match(/"approxDurationMs"\s*:\s*"?(\d+)"?/);
    if (m) { const n = Math.round(parseInt(m[1], 10) / 1000); return n > 0 ? n : null; }
    m = html.match(/itemprop="duration"\s+content="([^"]+)"/)
        || html.match(/"duration"\s*:\s*"(P[^"]+)"/);
    if (m) return parseIsoDuration(m[1]);
    return null;
}

function parseLiveFromHtml(html) {
    return /"isLiveNow"\s*:\s*true/.test(html) ||
        /"isLive"\s*:\s*true/.test(html);
}

async function fetchVideoMetaViaShorts(videoId) {
    const ctrl = new AbortController();
    let res;
    try {
        res = await fetch('https://www.youtube.com/shorts/' + encodeURIComponent(videoId),
            { credentials: 'include', signal: ctrl.signal });
    } catch (_) { return null; }
    if (!res || !res.ok) return null;

    // /shorts/ stays on /shorts/ for real Shorts but redirects normal videos to
    // /watch — so the final URL is the reliable Shorts signal.
    const isShort = (res.url || '').includes('/shorts/');
    let duration = null;
    let isLive = false;
    try {
        if (res.body && res.body.getReader) {
            // Stream the page and stop the moment the duration appears (it sits
            // near the top in ytInitialPlayerResponse), so we download a fraction
            // of the page instead of the whole ~1 MB.
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buf = '';
            let bytes = 0;
            const MAX_BYTES = 800 * 1024;
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value) {
                    bytes += value.byteLength;
                    buf += decoder.decode(value, { stream: true });
                }
                duration = parseDurationFromHtml(buf);
                isLive = parseLiveFromHtml(buf);
                if (duration != null || isLive || bytes >= MAX_BYTES) break;
                // Keep a small tail so a token split across chunks still matches.
                if (buf.length > 50000) buf = buf.slice(-3000);
            }
            try { await reader.cancel(); } catch (_) { /* ignore */ }
            try { ctrl.abort(); } catch (_) { /* ignore */ }
        } else {
            const html = await res.text();
            duration = parseDurationFromHtml(html);
            isLive = parseLiveFromHtml(html);
        }
    } catch (_) { /* keep isShort even if the body read failed */ }
    return { duration, isShort, isLive };
}

// Set YouTube's consent cookie (the trick NewPipe uses) so our fetches receive
// real pages instead of the consent wall — that wall was why durations/Shorts
// never resolved, especially in "Never remember history" mode where the browser
// has no consent cookie of its own.
let consentCookieSet = false;
function ensureConsentCookie() {
    if (consentCookieSet || !chrome.cookies || !chrome.cookies.set) return Promise.resolve();
    return new Promise((resolve) => {
        try {
            chrome.cookies.set({
                url: 'https://www.youtube.com/',
                name: 'SOCS',
                value: 'CAISAiAD',
                domain: '.youtube.com',
                path: '/',
                secure: true,
                expirationDate: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365
            }, () => { consentCookieSet = true; resolve(); });
        } catch (_) { resolve(); }
    });
}

async function attachDurations(videos, options = {}) {
    const metadataLimit = options.metadataLimit || 1200;
    let dCache = {};
    let sCache = {};
    try { dCache = await ytStorage.getDurationCache(); } catch (_) { /* ignore */ }
    try { sCache = await ytStorage.getShortsCache(); } catch (_) { /* ignore */ }

    const ageDays = (video) => {
        const published = Number(video && video.published);
        return published > 0 ? Math.max(0, (Date.now() - published) / 86400000) : Number.MAX_SAFE_INTEGER;
    };
    const ageBucket = (video) => {
        const age = ageDays(video);
        if (age <= 30) return 'recent';
        if (age <= 90) return 'month';
        if (age <= 180) return 'quarter';
        if (age <= 365) return 'back';
        if (age <= 1095) return 'older';
        return 'unknown';
    };
    const prioritizeDurationNeeds = (items, limit) => {
        const bucketOrder = ['recent', 'month', 'quarter', 'back', 'older', 'unknown'];
        const buckets = new Map(bucketOrder.map((bucket) => [bucket, []]));
        items.forEach((video) => {
            const bucket = ageBucket(video);
            buckets.get(bucket)?.push(video);
        });
        buckets.forEach((bucketVideos) => bucketVideos.sort((a, b) => ageDays(a) - ageDays(b)));

        const picked = [];
        const pickedIds = new Set();
        const add = (video) => {
            if (!video || !video.videoId || pickedIds.has(video.videoId) || picked.length >= limit) return;
            pickedIds.add(video.videoId);
            picked.push(video);
        };

        while (picked.length < limit) {
            let advanced = false;
            for (const bucket of bucketOrder) {
                const next = buckets.get(bucket)?.shift();
                if (next) {
                    add(next);
                    advanced = true;
                }
                if (picked.length >= limit) break;
            }
            if (!advanced) break;
        }
        return picked;
    };

    // Resolve missing duration/Shorts metadata across all age ranges. Home
    // hides cards without timers, so a newest-first metadata pass would make
    // older buckets disappear even when backfill found them.
    const missing = videos.filter((v) => v.videoId && (!dCache[v.videoId] || sCache[v.videoId] === undefined));
    const needs = prioritizeDurationNeeds(missing, metadataLimit);

    if (needs.length) {
        await ensureConsentCookie();
        await runPool(needs, 6, async (v) => {
            const meta = await fetchVideoMetaViaShorts(v.videoId);
            if (!meta) return;
            if (meta.duration) dCache[v.videoId] = meta.duration;
            if (meta.isLive) v.isLive = true;
            sCache[v.videoId] = !!meta.isShort;
        });
        try { await ytStorage.setDurationCache(dCache); } catch (_) { /* ignore */ }
        try { await ytStorage.setShortsCache(sCache); } catch (_) { /* ignore */ }
    }

    videos.forEach((v) => {
        if (dCache[v.videoId]) v.duration = dCache[v.videoId];
        if (sCache[v.videoId] !== undefined) v.isShort = sCache[v.videoId];
    });
    durationCache = dCache;
    shortsCache = sCache;
}

// Full refresh: enrich subs, fetch every channel's RSS, dedupe, durations, cache.
async function refreshFeedNow(force = false) {
    if (isRefreshing) return;
    const refreshGeneration = feedRefreshGeneration;
    const shouldContinue = () => refreshGeneration === feedRefreshGeneration;
    isRefreshing = true;
    try {
        let subs = await ytStorage.getSubscriptionList();
        if (!shouldContinue()) return;
        const toEnrich = force ? subs : subs.filter((s) => !s.ucid || !s.thumbnail);
        for (const s of toEnrich) {
            if (!shouldContinue()) return;
            const handle = s.handle || (s.id && s.id.startsWith('@') ? s.id : null);
            const url = handle ? `https://www.youtube.com/${handle}`
                : (s.ucid && /^UC[\w-]+$/.test(s.ucid) ? `https://www.youtube.com/channel/${s.ucid}` : s.url);
            await enrichSubscription({
                channelId: s.id, ucid: force ? null : s.ucid, handle,
                thumbnail: force ? null : s.thumbnail, channelName: force ? null : s.channelName, url
            }, force, shouldContinue);
        }
        if (!shouldContinue()) return;
        if (toEnrich.length) subs = await ytStorage.getSubscriptionList();
        if (!shouldContinue()) return;

        // Drop duplicates that resolve to the same UC id.
        const byUcid = new Map(); const redundant = [];
        for (const s of subs) {
            if (s.ucid && /^UC[\w-]+$/.test(s.ucid)) {
                if (byUcid.has(s.ucid)) redundant.push(s.id); else byUcid.set(s.ucid, s.id);
            }
        }
        for (const id of redundant) {
            if (!shouldContinue()) return;
            await ytStorage.removeSubscription(id);
        }
        if (redundant.length) subs = await ytStorage.getSubscriptionList();
        if (!shouldContinue()) return;

        let previousVideos = [];
        if (!force) {
            try {
                const cache = (await ytStorage.getFeedCache()) || {};
                previousVideos = Array.isArray(cache.videos) ? cache.videos : [];
            } catch (_) { /* fast refresh can still continue without old cache */ }
        }
        const { videos, diagnostics } = await fetchAllFeeds(subs, force);
        if (!shouldContinue()) return;
        const seen = new Set();
        const unique = videos.concat(previousVideos).filter((v) => {
            if (!v || !v.videoId || seen.has(v.videoId)) return false;
            seen.add(v.videoId); return true;
        });
        const trimmed = feedCore.selectFeedVideos(unique, TOTAL_FEED_LIMIT);
        await attachDurations(trimmed, { metadataLimit: force ? 1200 : 120 });
        if (!shouldContinue()) return;
        await ytStorage.setFeedCache({ updatedAt: Date.now(), videos: trimmed, diagnostics, policy: FEED_CACHE_POLICY });
    } catch (e) {
        console.error('[feed] refresh failed', e);
        throw e;
    } finally {
        if (shouldContinue()) isRefreshing = false;
    }
}

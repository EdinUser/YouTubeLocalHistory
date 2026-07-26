// Local subscriptions and feed cache for YT re:Watch.
//
// Adds a "lightweight local YouTube account" layer that needs no Google login:
//   - Subscribe / unsubscribe to channels (stored in extension storage).
//   - Build the local feed cache from subscribed channels' public RSS feeds
//     and channel pages. The dedicated extension feed page renders the cache.
//
// Runs as a content script alongside content.js and reuses the global
// `ytStorage` instance provided by storage.js.

(function () {
    'use strict';

    // ------------------------------------------------------------------
    // Constants & small helpers
    // ------------------------------------------------------------------
    const PER_CHANNEL_LIMIT = 15;    // newest videos kept per channel (RSS max ~15)
    const TOTAL_FEED_LIMIT = 300;    // overall cap for the aggregated feed
    const FETCH_CONCURRENCY = 4;     // parallel RSS fetches
    const DEFAULT_REFRESH_MIN = 60;  // feed cache TTL (minutes)
    const YT_NS = 'http://www.youtube.com/xml/schemas/2015';
    const MEDIA_NS = 'http://search.yahoo.com/mrss/';
    const CHANNEL_BACKFILL_CONCURRENCY = 2;
    const feedCore = globalThis.ytvhtFeedCore || {};
    const FEED_CACHE_POLICY = feedCore.FEED_CACHE_POLICY || 'balanced-backfill-lockup-v1';
    // Keep the feed inside the extension page. Injecting a replacement feed on
    // youtube.com is fragile because YouTube changes the home layout often.
    const EMBED_YOUTUBE_HOME_FEED = false;

    let cachedSettings = null;
    let isRefreshing = false;
    let lastRoutePath = null;

    function debugLog(...args) {
        if (cachedSettings && cachedSettings.debug) {
            console.log('[ythdb-subs]', ...args);
        }
    }

    function waitForStorage() {
        // storage.js sets globalThis.ytStorage; it loads before us, but guard anyway.
        return new Promise((resolve) => {
            if (typeof ytStorage !== 'undefined' && ytStorage) {
                resolve();
                return;
            }
            const start = Date.now();
            const timer = setInterval(() => {
                if (typeof ytStorage !== 'undefined' && ytStorage) {
                    clearInterval(timer);
                    resolve();
                } else if (Date.now() - start > 10000) {
                    clearInterval(timer);
                    resolve(); // give up gracefully
                }
            }, 100);
        });
    }

    async function getFeedSettings() {
        let s = {};
        try {
            s = (await ytStorage.getSettings()) || {};
        } catch (e) {
            // ignore; use defaults
        }
        // Two consolidated "clean interface" toggles (migrated from the older
        // three). hideRecommendations falls back to the old hideHomeRecommendations.
        const hideRecs = (typeof s.hideRecommendations === 'boolean')
            ? s.hideRecommendations
            : (typeof s.hideHomeRecommendations === 'boolean' ? s.hideHomeRecommendations : true);
        cachedSettings = {
            localFeedEnabled: s.localFeedEnabled !== false,
            hideAccountUI: s.hideAccountUI === true,
            hideRecommendations: hideRecs,
            feedRefreshMinutes: Number(s.feedRefreshMinutes) > 0
                ? Number(s.feedRefreshMinutes)
                : DEFAULT_REFRESH_MIN,
            overlayTitle: s.overlayTitle || 'viewed',
            debug: s.debug === true
        };
        return cachedSettings;
    }

    function relativeTime(ms) {
        if (!ms) return '';
        const diff = Date.now() - ms;
        const sec = Math.floor(diff / 1000);
        if (sec < 60) return 'just now';
        const min = Math.floor(sec / 60);
        if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
        const hr = Math.floor(min / 60);
        if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
        const day = Math.floor(hr / 24);
        if (day < 7) return `${day} day${day === 1 ? '' : 's'} ago`;
        const wk = Math.floor(day / 7);
        if (wk < 5) return `${wk} week${wk === 1 ? '' : 's'} ago`;
        const mo = Math.floor(day / 30);
        if (mo < 12) return `${mo} month${mo === 1 ? '' : 's'} ago`;
        const yr = Math.floor(day / 365);
        return `${yr} year${yr === 1 ? '' : 's'} ago`;
    }

    function newestFirstVideos(videos) {
        return videos.slice()
            .sort((a, b) => Number(b?.published || 0) - Number(a?.published || 0));
    }

    // ------------------------------------------------------------------
    // Styles
    // ------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById('ytvht-subs-styles')) return;
        const style = document.createElement('style');
        style.id = 'ytvht-subs-styles';
        style.textContent = `
            #ytvht-home-feed {
                margin: 0 0 24px 0;
                padding: 0 0 12px 0;
                border-bottom: 1px solid var(--yt-spec-10-percent-layer, rgba(255,255,255,0.1));
            }
            #ytvht-home-feed .ytvht-feed-header {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 8px 0 14px 0;
            }
            #ytvht-home-feed .ytvht-feed-title {
                font-family: "Roboto","Arial",sans-serif;
                font-size: 18px;
                font-weight: 700;
                color: var(--yt-spec-text-primary, #f1f1f1);
            }
            #ytvht-home-feed .ytvht-feed-count {
                font-size: 13px;
                color: var(--yt-spec-text-secondary, #aaa);
            }
            #ytvht-home-feed .ytvht-feed-refresh {
                margin-left: auto;
                padding: 6px 12px;
                border-radius: 16px;
                border: 1px solid var(--yt-spec-10-percent-layer, rgba(255,255,255,0.2));
                background: transparent;
                color: var(--yt-spec-text-primary, #f1f1f1);
                font-size: 13px;
                cursor: pointer;
            }
            #ytvht-home-feed .ytvht-feed-refresh:disabled { opacity: 0.5; cursor: default; }
            #ytvht-home-feed .ytvht-feed-spinner {
                display: inline-block;
                width: 14px;
                height: 14px;
                border: 2px solid var(--yt-spec-text-secondary, #aaa);
                border-top-color: transparent;
                border-radius: 50%;
                animation: ytvht-feed-spin 0.8s linear infinite;
                vertical-align: middle;
            }
            #ytvht-home-feed .ytvht-feed-loading {
                font-size: 13px;
                color: var(--yt-spec-text-secondary, #aaa);
                display: inline-flex;
                align-items: center;
                gap: 8px;
            }
            @keyframes ytvht-feed-spin { to { transform: rotate(360deg); } }
            #ytvht-home-feed .ytvht-feed-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
                column-gap: 16px;
                row-gap: 40px;
            }
            #ytvht-home-feed .ytvht-feed-empty {
                font-size: 14px;
                color: var(--yt-spec-text-secondary, #aaa);
                padding: 8px 0 4px 0;
            }
            #ytvht-home-feed .ytvht-feed-diag {
                margin-top: 14px;
                padding: 12px 14px;
                border-radius: 8px;
                background: var(--yt-spec-badge-chip-background, #1f1f1f);
                font-family: "Roboto","Arial",sans-serif;
                font-size: 13px;
                line-height: 1.7;
            }
            #ytvht-home-feed .ytvht-feed-diag-title {
                font-weight: 700;
                margin-bottom: 4px;
                color: var(--yt-spec-text-primary, #f1f1f1);
            }
            #ytvht-home-feed .ytvht-diag-ok { color: #2ba640; }
            #ytvht-home-feed .ytvht-diag-fail { color: #ff7070; }
            .ytvht-feed-card { display: flex; flex-direction: column; text-decoration: none; }
            .ytvht-feed-card a { text-decoration: none !important; color: inherit; }
            .ytvht-feed-card .ytvht-thumb-link { display: block; }
            .ytvht-feed-card .ytvht-avatar-link { flex: 0 0 36px; display: block; }
            .ytvht-feed-card .ytvht-card-channel:hover { color: var(--yt-spec-text-primary, #f1f1f1); }
            .ytvht-feed-card .ytvht-thumb-wrap {
                position: relative;
                width: 100%;
                aspect-ratio: 16 / 9;
                border-radius: 12px;
                overflow: hidden;
                background: var(--yt-spec-badge-chip-background, #272727);
            }
            .ytvht-feed-card .ytvht-thumb-wrap img {
                width: 100%; height: 100%; object-fit: cover; display: block;
            }
            .ytvht-feed-card .ytvht-card-duration {
                position: absolute;
                right: 4px;
                bottom: 4px;
                padding: 1px 4px;
                border-radius: 4px;
                background: rgba(0,0,0,0.8);
                color: #fff;
                font-family: "Roboto","Arial",sans-serif;
                font-size: 12px;
                font-weight: 500;
                line-height: 1.4;
                z-index: 2;
            }
            .ytvht-feed-card .ytvht-card-body {
                display: flex;
                gap: 12px;
                margin-top: 12px;
            }
            .ytvht-feed-card .ytvht-card-avatar {
                flex: 0 0 36px;
                width: 36px;
                height: 36px;
                border-radius: 50%;
                object-fit: cover;
                background: var(--yt-spec-badge-chip-background, #373737);
                display: flex;
                align-items: center;
                justify-content: center;
                color: var(--yt-spec-text-primary, #f1f1f1);
                font-family: "Roboto","Arial",sans-serif;
                font-size: 16px;
                font-weight: 500;
            }
            .ytvht-feed-card .ytvht-card-text { min-width: 0; flex: 1 1 auto; }
            .ytvht-feed-card .ytvht-card-title {
                margin: 0 0 4px 0;
                font-family: "Roboto","Arial",sans-serif;
                font-size: 14px;
                font-weight: 500;
                line-height: 1.4;
                color: var(--yt-spec-text-primary, #f1f1f1);
                display: -webkit-box;
                -webkit-line-clamp: 2;
                -webkit-box-orient: vertical;
                overflow: hidden;
            }
            .ytvht-feed-card .ytvht-card-channel,
            .ytvht-feed-card .ytvht-card-stats {
                font-family: "Roboto","Arial",sans-serif;
                font-size: 12px;
                color: var(--yt-spec-text-secondary, #aaa);
                line-height: 1.5;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            /* Thicker watched-progress bar on feed cards (overrides content.js height). */
            #ytvht-home-feed .ytvht-feed-card .ytvht-progress-bar {
                height: 6px !important;
                border-radius: 0 3px 0 0 !important;
            }
            html[ytvht-hide-recs] ytd-browse[page-subtype="home"] ytd-rich-grid-renderer,
            html[ytvht-hide-recs] ytd-browse[page-subtype="home"] ytd-message-renderer,
            html[ytvht-hide-recs] ytd-browse[page-subtype="home"] ytd-feed-nudge-renderer,
            html[ytvht-hide-recs] ytd-browse[page-subtype="home"] #contents.ytd-rich-grid-renderer {
                display: none !important;
            }

            /* Hide YouTube's account / login UI for an account-free look. */
            html[ytvht-hide-account] ytd-guide-signin-promo-renderer,
            html[ytvht-hide-account] ytd-mini-guide-signin-promo-renderer,
            html[ytvht-hide-account] ytd-masthead a[href*="accounts.google.com"],
            html[ytvht-hide-account] ytd-masthead #buttons a[aria-label="Sign in"],
            html[ytvht-hide-account] #masthead #avatar-btn {
                display: none !important;
            }
            /* :has()-based account selectors, kept separate for resilience. */
            html[ytvht-hide-account] ytd-masthead ytd-button-renderer:has(a[href*="accounts.google.com"]),
            html[ytvht-hide-account] ytd-masthead yt-button-view-model:has(a[href*="accounts.google.com"]),
            html[ytvht-hide-account] ytd-button-renderer:has(a[href*="accounts.google.com"]),
            html[ytvht-hide-account] ytd-guide-collapsible-section-entry-renderer:has(ytd-guide-signin-promo-renderer) {
                display: none !important;
            }

            /* Hide YouTube's native (account-based) Subscribe / Join — keep only ours.
               Covers watch pages, the new channel header, and recommendation cards.
               aria-label matches catch the channel-header buttons whose wrapper
               element types vary between YouTube layouts. Our own button uses a
               title (not aria-label), so it is never matched here. */
            html[ytvht-hide-native-subs] ytd-subscribe-button-renderer,
            html[ytvht-hide-native-subs] yt-subscribe-button-view-model,
            html[ytvht-hide-native-subs] button[aria-label^="Subscribe"]:not(.ytvht-sub-btn),
            html[ytvht-hide-native-subs] button[aria-label^="Unsubscribe"]:not(.ytvht-sub-btn),
            html[ytvht-hide-native-subs] #sponsor-button,
            html[ytvht-hide-native-subs] button[aria-label^="Join"] {
                display: none !important;
            }
            /* :has()-based native-subscription selectors, kept separate. */
            html[ytvht-hide-native-subs] ytd-guide-entry-renderer:has(a[href="/feed/subscriptions"]),
            html[ytvht-hide-native-subs] ytd-mini-guide-entry-renderer:has(a[href="/feed/subscriptions"]) {
                display: none !important;
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    // ------------------------------------------------------------------
    // Page-type detection & channel-info extraction
    // ------------------------------------------------------------------
    function isHomePage() {
        return window.location.pathname === '/' || window.location.pathname === '';
    }

    function isChannelPage() {
        const p = window.location.pathname;
        return /^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)/.test(p);
    }

    function isWatchPage() {
        return window.location.pathname === '/watch';
    }

    // Extract channel identity from a channel page. Returns null until an id
    // can be read.
    //
    // IMPORTANT: the URL is authoritative. During in-app (SPA) navigation the
    // URL updates immediately but <link rel="canonical"> / og: meta tags lag
    // behind, still describing the PREVIOUS channel. Trusting those caused a new
    // subscription to be saved with the wrong channel's id. So we derive the
    // identity from the URL and only use canonical/og when they are consistent
    // with the current URL.
    // Read the current channel's OWN UC id from the live page. ytInitialData /
    // config blobs carry "externalId":"UC..." for the page's own channel; this
    // is the same field extractOwnUcid trusts on fetched HTML. Used so a sub
    // stored only by UC id (e.g. CSV import) can be matched on a /@handle page.
    function getOwnUcidFromDom() {
        const scripts = document.querySelectorAll('script');
        for (const s of scripts) {
            const t = s.textContent;
            if (!t || t.indexOf('externalId') === -1) continue;
            const m = t.match(/"externalId":"(UC[\w-]+)"/);
            if (m) return m[1];
        }
        const meta = document.querySelector('meta[itemprop="identifier"], meta[itemprop="channelId"]');
        if (meta) {
            const c = meta.getAttribute('content') || '';
            if (/^UC[\w-]+$/.test(c)) return c;
        }
        return null;
    }

    function getChannelPageInfo() {
        const path = window.location.pathname;
        const handleMatch = path.match(/^\/(@[\w.\-]+)/);
        const ucMatch = path.match(/^\/channel\/(UC[\w-]+)/);
        const urlHandle = handleMatch ? handleMatch[1] : null;
        let ucid = ucMatch ? ucMatch[1] : null;

        if (!urlHandle && !ucid) return null;

        // Canonical href is only trusted if it matches the current URL.
        const canonical = document.querySelector('link[rel="canonical"]');
        const canonicalHref = canonical ? (canonical.getAttribute('href') || '') : '';
        const canonicalConsistent = urlHandle
            ? canonicalHref.toLowerCase().includes(urlHandle.toLowerCase())
            : (ucid ? canonicalHref.includes(ucid) : false);
        if (!ucid && canonicalConsistent) {
            const m = canonicalHref.match(/\/channel\/(UC[\w-]+)/);
            if (m) ucid = m[1];
        }

        // On a /@handle page the canonical is the handle form, so we still have
        // no UC id. Pull it from the page's own ytInitialData (externalId).
        if (!ucid) {
            ucid = getOwnUcidFromDom();
        }

        // og: title/image are only trusted when og:url (or canonical) matches.
        let channelName = null;
        let thumbnail = null;
        const ogUrl = document.querySelector('meta[property="og:url"]');
        const ogUrlHref = ogUrl ? (ogUrl.getAttribute('content') || '') : '';
        const ogConsistent = urlHandle
            ? (ogUrlHref.toLowerCase().includes(urlHandle.toLowerCase()) || canonicalConsistent)
            : (ucid ? (ogUrlHref.includes(ucid) || canonicalConsistent) : false);
        if (ogConsistent) {
            const ogTitle = document.querySelector('meta[property="og:title"]');
            if (ogTitle) channelName = ogTitle.getAttribute('content');
            const ogImage = document.querySelector('meta[property="og:image"]');
            if (ogImage) thumbnail = ogImage.getAttribute('content');
        }

        // Prefer the URL handle as the stable id (consistent across visits);
        // fall back to a URL-derived UC id. ucid (if any) is resolved/persisted
        // later from the channel's own page.
        const channelId = urlHandle || ucid;
        const url = urlHandle
            ? `https://www.youtube.com/${urlHandle}`
            : `https://www.youtube.com/channel/${ucid}`;

        return {
            channelId,
            ucid: ucid || null,
            handle: urlHandle || null,
            channelName: channelName || 'Unknown Channel',
            thumbnail: thumbnail || null,
            url
        };
    }

    // Extract channel identity of the video owner on a watch page.
    function getWatchOwnerInfo() {
        const link = document.querySelector('ytd-video-owner-renderer ytd-channel-name a, #owner ytd-channel-name a');
        if (!link) return null;

        const href = link.getAttribute('href') || '';
        let ucid = null;
        let handle = null;
        const ucMatch = href.match(/\/channel\/(UC[\w-]+)/);
        if (ucMatch) ucid = ucMatch[1];
        const hMatch = href.match(/\/(@[\w.\-]+)/);
        if (hMatch) handle = hMatch[1];

        if (!ucid && !handle) return null;

        const channelName = (link.textContent || '').trim() || 'Unknown Channel';
        const avatar = document.querySelector(
            'ytd-video-owner-renderer #avatar img, #owner #avatar img, ytd-video-owner-renderer img#img'
        );
        let thumbnail = avatar ? avatar.getAttribute('src') : null;
        // Ignore lazy-load placeholders / empty sources.
        if (thumbnail && (thumbnail.startsWith('data:') || thumbnail.trim() === '')) {
            thumbnail = null;
        }

        return {
            channelId: ucid || handle,
            ucid: ucid || null,
            handle: handle || null,
            channelName,
            thumbnail,
            url: ucid
                ? `https://www.youtube.com/channel/${ucid}`
                : `https://www.youtube.com/${handle}`
        };
    }

    function removeSubButton() {
        document.querySelectorAll('.ytvht-sub-btn').forEach((button) => button.remove());
    }

    // ------------------------------------------------------------------
    // RSS fetching & parsing
    // ------------------------------------------------------------------
    function getXmlText(parent, ns, localName, prefixedName) {
        let el = parent.getElementsByTagNameNS(ns, localName)[0];
        if (!el && prefixedName) el = parent.getElementsByTagName(prefixedName)[0];
        return el ? (el.textContent || '').trim() : '';
    }

    function parseFeedEntry(entry, sub) {
        let videoId = getXmlText(entry, YT_NS, 'videoId', 'yt:videoId');
        if (!videoId) {
            const idText = getXmlText(entry, '', 'id', 'id');
            const m = idText.match(/yt:video:([\w-]+)/);
            if (m) videoId = m[1];
        }
        if (!videoId) return null;

        const title = getXmlText(entry, '', 'title', 'title') || 'Untitled';
        const publishedRaw = getXmlText(entry, '', 'published', 'published');
        const published = publishedRaw ? Date.parse(publishedRaw) : 0;

        // Thumbnail from media:group/media:thumbnail; fall back to ytimg.
        let thumbnail = '';
        const thumbEl = entry.getElementsByTagNameNS(MEDIA_NS, 'thumbnail')[0]
            || entry.getElementsByTagName('media:thumbnail')[0];
        if (thumbEl) thumbnail = thumbEl.getAttribute('url') || '';
        if (!thumbnail) thumbnail = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;

        let channelName = getXmlText(entry, '', 'name', 'name') || sub.channelName || '';

        // View count from media:community/media:statistics.
        let views = 0;
        const statsEl = entry.getElementsByTagNameNS(MEDIA_NS, 'statistics')[0]
            || entry.getElementsByTagName('media:statistics')[0];
        if (statsEl) {
            views = parseInt(statsEl.getAttribute('views') || '0', 10) || 0;
        }

        const channelUrl = sub.url
            || (sub.handle ? `https://www.youtube.com/${sub.handle}` : null)
            || (sub.id && sub.id.startsWith('@') ? `https://www.youtube.com/${sub.id}` : null)
            || (sub.ucid ? `https://www.youtube.com/channel/${sub.ucid}` : null);

        return {
            videoId,
            title,
            published,
            thumbnail,
            channelName,
            channelThumbnail: sub.thumbnail || null,
            channelUrl,
            views,
            channelId: sub.id,
            url: `https://www.youtube.com/watch?v=${videoId}`
        };
    }

    function formatDuration(seconds) {
        const s = Math.floor(seconds);
        if (!s || s < 0) return '';
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        const pad = (n) => String(n).padStart(2, '0');
        return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
    }

    function formatViews(n) {
        if (!n || n < 1) return '';
        if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B views';
        if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M views';
        if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K views';
        return n + ' views';
    }

    // Extract a channel's OWN UC id from its page HTML. Must avoid generic
    // "/channel/UC..." or "channelId" matches, which can hit Featured Channels
    // or recommended channels on the page (e.g. resolving EthosLab to SethBling).
    // "externalId" and the canonical link both refer to the page's own channel.
    function extractOwnUcid(text) {
        const m = text.match(/"externalId":"(UC[\w-]+)"/)
            || text.match(/<link[^>]*rel="canonical"[^>]*\/channel\/(UC[\w-]+)/)
            || text.match(/<meta[^>]*itemprop="(?:identifier|channelId)"[^>]*content="(UC[\w-]+)"/)
            || text.match(/"channelId":"(UC[\w-]+)"/); // last resort
        return m ? m[1] : null;
    }

    // Fetch the channel page once to fill in missing channel id / avatar /
    // name, so a subscription saved from anywhere (e.g. a watch page) is
    // complete. `info` is the object passed to addSubscription.
    async function enrichSubscription(info, overwrite = false) {
        const channelUrl = info.url
            || (info.handle ? `https://www.youtube.com/${info.handle}` : null)
            || (info.ucid ? `https://www.youtube.com/channel/${info.ucid}` : null);
        if (!channelUrl) return;
        try {
            const res = await fetch(channelUrl, { credentials: 'include' });
            if (!res.ok) return;
            const text = await res.text();
            const patch = {};

            if (overwrite || !info.ucid) {
                const ucid = extractOwnUcid(text);
                if (ucid) patch.ucid = ucid;
            }
            // Capture @handle from the final redirect URL so CSV-imported subs
            // (keyed by UC id, no handle field) can be found by @handle lookups.
            if (overwrite || !info.handle) {
                const finalUrl = res.url || '';
                const hm = finalUrl.match(/\/(@[\w.\-]+)/);
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
                await ytStorage.updateSubscription(info.channelId, patch);
                debugLog('Enriched subscription', info.channelId, patch);
            }
        } catch (e) {
            debugLog('enrichSubscription failed for', info.channelId, e.message);
        }
    }

    // Resolve and persist the UC id for a subscription (RSS needs the UC id,
    // but we may only have an @handle from the watch page).
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
            const text = await res.text();
            const ucid = extractOwnUcid(text);
            if (ucid) {
                await ytStorage.updateSubscription(sub.id, { ucid });
                debugLog('Resolved ucid for', sub.id, '->', ucid);
            }
            return ucid;
        } catch (e) {
            debugLog('resolveUcid failed for', sub.id, e.message);
            return null;
        }
    }

    // Returns { sub, ucid, videos, error } so callers can report per-channel status.
    async function fetchChannelFeed(sub) {
        const ucid = await resolveUcid(sub);
        if (!ucid) {
            debugLog('No channel id resolved for', sub.id, '(name:', sub.channelName + ')');
            return { sub, ucid: null, videos: [], error: 'no-id' };
        }
        try {
            const res = await fetch(
                `https://www.youtube.com/feeds/videos.xml?channel_id=${ucid}`,
                { credentials: 'include' }
            );
            if (!res.ok) {
                debugLog('Feed HTTP', res.status, 'for', sub.id);
                return { sub, ucid, videos: [], error: 'http-' + res.status };
            }
            const text = await res.text();
            const doc = new DOMParser().parseFromString(text, 'text/xml');
            if (doc.querySelector('parsererror')) {
                debugLog('XML parse error for', sub.id);
                return { sub, ucid, videos: [], error: 'parse' };
            }
            const entries = Array.from(doc.getElementsByTagName('entry'));
            const parsed = entries
                .map((e) => parseFeedEntry(e, sub))
                .filter(Boolean)
                .slice(0, PER_CHANNEL_LIMIT);
            debugLog('Feed for', sub.channelName, `(${ucid}):`, parsed.length, 'videos');
            return { sub, ucid, videos: parsed, error: null };
        } catch (e) {
            debugLog('fetchChannelFeed failed for', sub.id, e.message);
            return { sub, ucid, videos: [], error: 'fetch:' + (e.message || 'failed') };
        }
    }

    // Fetch a single video's duration (seconds) via YouTube's own player
    // endpoint. RSS has no duration, so this is the account-free way to get it.
    async function fetchDuration(videoId) {
        try {
            const res = await fetch(
                'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        context: { client: { clientName: 'WEB', clientVersion: '2.20240731.00.00' } },
                        videoId
                    })
                }
            );
            if (!res.ok) return null;
            const data = await res.json();
            const len = data && data.videoDetails && data.videoDetails.lengthSeconds;
            const n = len ? parseInt(len, 10) : 0;
            return n > 0 ? n : null;
        } catch (e) {
            return null;
        }
    }

    // Resolve durations for the given videos (uses + updates the persistent
    // cache). Limited concurrency to avoid hammering YouTube.
    async function attachDurations(videos) {
        let cache = {};
        try { cache = await ytStorage.getDurationCache(); } catch (_) {}

        // Cap per-refresh fetches (videos are newest-first); the rest fill in on
        // later refreshes. Cached durations are reused, so this is one-time work.
        const missing = videos.filter((v) => v.videoId && !cache[v.videoId]).slice(0, 120);
        if (missing.length > 0) {
            let index = 0;
            const worker = async () => {
                while (index < missing.length) {
                    const v = missing[index++];
                    const dur = await fetchDuration(v.videoId);
                    if (dur) cache[v.videoId] = dur;
                }
            };
            const workers = [];
            for (let i = 0; i < Math.min(6, missing.length); i++) workers.push(worker());
            await Promise.all(workers);
            try { await ytStorage.setDurationCache(cache); } catch (_) {}
        }

        videos.forEach((v) => {
            if (cache[v.videoId]) v.duration = cache[v.videoId];
        });
    }

    // Limited-concurrency map over subscriptions.
    // Returns { videos: [...all], diagnostics: [{ name, ucid, count, error }] }.
    async function fetchAllFeeds(subs, includeBackfill = false) {
        const videos = [];
        const diagnostics = [];
        let index = 0;
        async function worker() {
            while (index < subs.length) {
                const i = index++;
                const result = await fetchChannelFeed(subs[i]);
                let channelVideos = result.videos.slice();
                let backfillError = null;
                let backfillCount = 0;

                if (includeBackfill && result.ucid) {
                    const existingIds = new Set(channelVideos.map((video) => video.videoId).filter(Boolean));
                    const backfill = await feedCore.fetchChannelBackfill(result.sub, result.ucid, existingIds);
                    backfillError = backfill.error;
                    if (backfill.metadataById) {
                        channelVideos = channelVideos.map((video) => {
                            const metadata = backfill.metadataById[video.videoId];
                            return metadata ? { ...video, ...metadata } : video;
                        });
                    }
                    if (backfill.videos.length > 0) {
                        backfillCount = backfill.videos.length;
                        channelVideos = channelVideos.concat(backfill.videos);
                    }
                }

                videos.push(...channelVideos);
                diagnostics.push({
                    name: result.sub.channelName || result.sub.id,
                    ucid: result.ucid || null,
                    count: channelVideos.length,
                    rssCount: result.videos.length,
                    backfillCount,
                    error: result.error || null,
                    backfillError
                });
            }
        }
        const workers = [];
        const workerCount = includeBackfill ? CHANNEL_BACKFILL_CONCURRENCY : FETCH_CONCURRENCY;
        for (let i = 0; i < Math.min(workerCount, subs.length); i++) {
            workers.push(worker());
        }
        await Promise.all(workers);
        return { videos, diagnostics };
    }

    // Refresh the aggregated feed and persist it to the cache.
    async function refreshFeed(force = false) {
        if (isRefreshing) return;
        isRefreshing = true;
        try {
            const settings = await getFeedSettings();
            let subs = await ytStorage.getSubscriptionList();

            if (subs.length === 0) {
                await ytStorage.setFeedCache({ updatedAt: Date.now(), videos: [], policy: FEED_CACHE_POLICY });
                return;
            }

            if (!force) {
                const cache = await ytStorage.getFeedCache();
                const ageMs = Date.now() - (cache.updatedAt || 0);
                if (cache.videos && cache.videos.length > 0 &&
                    ageMs < settings.feedRefreshMinutes * 60 * 1000) {
                    return; // cache still fresh
                }
            }

            // Show the loading spinner right away (keeps existing videos on
            // screen; the cache isn't replaced until the fetch completes).
            if (isHomePage()) renderHomeFeed();

            // Repair subscriptions. On a forced refresh, re-pull every channel's
            // id/avatar/name from its own page (overwrite) to fix any stale or
            // cross-contaminated data from earlier saves. Otherwise only fill in
            // subscriptions missing an id or avatar.
            const toEnrich = force ? subs : subs.filter((s) => !s.ucid || !s.thumbnail);
            if (toEnrich.length > 0) {
                for (const s of toEnrich) {
                    // Build the channel URL from the handle/id (reliable), not the
                    // stored url which could itself be stale/contaminated.
                    const handle = s.handle || (s.id && s.id.startsWith('@') ? s.id : null);
                    const url = handle
                        ? `https://www.youtube.com/${handle}`
                        : (s.ucid && /^UC[\w-]+$/.test(s.ucid)
                            ? `https://www.youtube.com/channel/${s.ucid}`
                            : s.url);
                    await enrichSubscription({
                        channelId: s.id,
                        ucid: force ? null : s.ucid, // force: re-resolve ucid too
                        handle,
                        thumbnail: force ? null : s.thumbnail,
                        channelName: force ? null : s.channelName,
                        url
                    }, force);
                }
                subs = await ytStorage.getSubscriptionList();
            }

            // Auto-clean: if two subscriptions resolve to the same channel (same
            // UC id), drop the redundant one (fixes duplicates from earlier bad
            // saves where a subscription picked up the wrong channel's id).
            const byUcid = new Map();
            const redundant = [];
            for (const s of subs) {
                if (s.ucid && /^UC[\w-]+$/.test(s.ucid)) {
                    if (byUcid.has(s.ucid)) {
                        redundant.push(s.id);
                    } else {
                        byUcid.set(s.ucid, s.id);
                    }
                }
            }
            if (redundant.length > 0) {
                for (const id of redundant) {
                    await ytStorage.removeSubscription(id);
                }
                subs = await ytStorage.getSubscriptionList();
                debugLog('Removed redundant duplicate subscriptions:', redundant);
            }

            debugLog('Refreshing feed for', subs.length, 'subscriptions', '(including older uploads)');
            const { videos, diagnostics } = await fetchAllFeeds(subs, true);
            // Dedupe by videoId (guards against two subs resolving to one channel).
            const seen = new Set();
            const unique = videos.filter((v) => {
                if (!v || !v.videoId || seen.has(v.videoId)) return false;
                seen.add(v.videoId);
                return true;
            });
            const trimmed = feedCore.selectFeedVideos(unique, TOTAL_FEED_LIMIT);
            // RSS has no duration — fetch + cache it so cards show a length badge.
            await attachDurations(trimmed);
            await ytStorage.setFeedCache({ updatedAt: Date.now(), videos: trimmed, diagnostics, policy: FEED_CACHE_POLICY });
            debugLog('Feed refreshed:', trimmed.length, 'videos', diagnostics);
        } catch (e) {
            console.error('[ythdb-subs] refreshFeed failed', e);
        } finally {
            isRefreshing = false;
        }
    }

    // Coalesce bursts of render requests (e.g. many sub_ writes during an
    // import) into a single render to avoid the feed flickering.
    let renderDebounceTimer = null;
    function renderHomeFeedDebounced() {
        if (renderDebounceTimer) clearTimeout(renderDebounceTimer);
        renderDebounceTimer = setTimeout(() => {
            renderDebounceTimer = null;
            if (isHomePage()) renderHomeFeed();
        }, 400);
    }

    let refreshTimer = null;
    function scheduleFeedRefresh(force) {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(async () => {
            await refreshFeed(force);
            if (isHomePage()) renderHomeFeed();
        }, 300);
    }

    // ------------------------------------------------------------------
    // Home feed rendering
    // ------------------------------------------------------------------
    function getHomeAnchor() {
        return document.querySelector('ytd-browse[page-subtype="home"] ytd-rich-grid-renderer')
            || document.querySelector('ytd-browse[role="main"] ytd-rich-grid-renderer')
            || document.querySelector('ytd-rich-grid-renderer');
    }

    function buildFeedCard(video, record) {
        // Card is a container (not a single <a>) so the avatar/channel name can
        // link to the channel while the thumbnail/title link to the video.
        const card = document.createElement('div');
        card.className = 'ytvht-feed-card';

        const thumbWrap = document.createElement('div');
        thumbWrap.className = 'ytvht-thumb-wrap';
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.src = video.thumbnail || `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`;
        img.alt = '';
        thumbWrap.appendChild(img);

        // Watched overlay: reuse content.js's classes so it matches the user's
        // configured overlay colour/size and "viewed" label.
        if (record && typeof record.time === 'number') {
            const label = document.createElement('div');
            label.className = 'ytvht-viewed-label';
            label.textContent = (cachedSettings && cachedSettings.overlayTitle) || 'viewed';
            thumbWrap.appendChild(label);

            if (record.duration > 0) {
                const progress = document.createElement('div');
                progress.className = 'ytvht-progress-bar';
                const pct = Math.max(0, Math.min(100, (record.time / record.duration) * 100));
                progress.style.width = `${pct}%`;
                thumbWrap.appendChild(progress);
            }
        }

        // Duration badge (bottom-right): from the feed's fetched duration, or
        // from watch history if available.
        const durationSeconds = (video && video.duration > 0)
            ? video.duration
            : (record && record.duration > 0 ? record.duration : 0);
        if (durationSeconds > 0) {
            const dur = document.createElement('span');
            dur.className = 'ytvht-card-duration';
            dur.textContent = formatDuration(durationSeconds);
            thumbWrap.appendChild(dur);
        }

        const thumbLink = document.createElement('a');
        thumbLink.className = 'ytvht-thumb-link';
        thumbLink.href = video.url;
        thumbLink.appendChild(thumbWrap);

        // Body: channel avatar (links to channel) + text column.
        const body = document.createElement('div');
        body.className = 'ytvht-card-body';

        const avatarLink = document.createElement('a');
        avatarLink.className = 'ytvht-avatar-link';
        avatarLink.href = video.channelUrl || video.url;
        avatarLink.title = video.channelName || '';
        if (video.channelThumbnail) {
            const avatar = document.createElement('img');
            avatar.className = 'ytvht-card-avatar';
            avatar.loading = 'lazy';
            avatar.src = video.channelThumbnail;
            avatar.alt = '';
            avatarLink.appendChild(avatar);
        } else {
            const avatar = document.createElement('div');
            avatar.className = 'ytvht-card-avatar ytvht-avatar-placeholder';
            avatar.textContent = (video.channelName || '?').charAt(0).toUpperCase();
            avatarLink.appendChild(avatar);
        }
        body.appendChild(avatarLink);

        const text = document.createElement('div');
        text.className = 'ytvht-card-text';

        const titleLink = document.createElement('a');
        titleLink.className = 'ytvht-card-title';
        titleLink.href = video.url;
        titleLink.textContent = video.title;
        titleLink.title = video.title;

        const channelLink = document.createElement('a');
        channelLink.className = 'ytvht-card-channel';
        channelLink.href = video.channelUrl || video.url;
        channelLink.textContent = video.channelName || '';

        const stats = document.createElement('div');
        stats.className = 'ytvht-card-stats';
        const when = relativeTime(video.published);
        const viewsText = formatViews(video.views);
        stats.textContent = [viewsText, when].filter(Boolean).join(' • ');

        text.appendChild(titleLink);
        text.appendChild(channelLink);
        if (stats.textContent) text.appendChild(stats);
        body.appendChild(text);

        card.appendChild(thumbLink);
        card.appendChild(body);
        return card;
    }

    function diagnosticStatusText(d) {
        if (!d.error) return `OK — ${d.count} video${d.count === 1 ? '' : 's'}`;
        if (d.error === 'no-id') return 'could not find channel ID (lookup failed)';
        if (d.error === 'parse') return 'feed could not be read';
        if (d.error.startsWith('http-')) return `feed request failed (HTTP ${d.error.slice(5)})`;
        if (d.error.startsWith('fetch:')) return 'network/fetch blocked — ' + d.error.slice(6);
        return d.error;
    }

    function buildDiagnostics(diagnostics) {
        const box = document.createElement('div');
        box.className = 'ytvht-feed-diag';
        const heading = document.createElement('div');
        heading.className = 'ytvht-feed-diag-title';
        heading.textContent = 'Channel status:';
        box.appendChild(heading);
        diagnostics.forEach((d) => {
            const line = document.createElement('div');
            line.className = d.error ? 'ytvht-diag-fail' : 'ytvht-diag-ok';
            line.textContent = `${d.error ? '✕' : '✓'} ${d.name} — ${diagnosticStatusText(d)}`;
            box.appendChild(line);
        });
        return box;
    }

    // Apply the "clean, account-free" UI toggles via attributes on <html>.
    // The CSS (in injectStyles) is scoped so each attribute only affects the
    // relevant elements. Runs on every page so account/subscription UI is
    // hidden site-wide, not just on the home page.
    function applyGlobalUiPreferences(settings) {
        if (!settings) return;
        const de = document.documentElement;
        de.toggleAttribute('ytvht-hide-recs', false);
        // Account mode hides sign-in/account chrome, but keeps YouTube's own
        // Subscribe/Join controls visible on videos and channel pages.
        de.toggleAttribute('ytvht-hide-account', false);
        de.toggleAttribute('ytvht-hide-native-subs', false);
    }

    // YouTube shows nag dialogs ("Recommendations not quite right?", "Your
    // YouTube history is off", "Turn on history") that CSS can't target by text.
    // Detect them by their wording and dismiss them when recommendations are
    // hidden. Runs periodically.
    const NAG_PHRASES = [
        'recommendations not quite right',
        'turn on watch history',
        'turn on history',
        'your youtube history is off',
        'get the latest videos tailored',
        'more personalized recommendations'
    ];
    function dismissNagPopups() {
        if (!EMBED_YOUTUBE_HOME_FEED) return;
        if (!cachedSettings || !cachedSettings.hideRecommendations) return;
        const candidates = document.querySelectorAll(
            'tp-yt-paper-dialog, ytd-mealbar-promo-renderer, yt-confirm-dialog-renderer, ' +
            'ytd-popup-container ytd-popup-renderer, ytd-button-renderer.ytd-popup-container'
        );
        let dismissedAny = false;
        candidates.forEach((el) => {
            const txt = (el.textContent || '').toLowerCase();
            if (!NAG_PHRASES.some((p) => txt.includes(p))) return;
            // Prefer a graceful dismiss (keeps history off); else remove it.
            const btn = el.querySelector(
                '#dismiss-button, #close-button, [aria-label="Close"], [aria-label="Dismiss"], ' +
                'tp-yt-paper-button#cancel, yt-button-renderer#dismiss-button'
            );
            if (btn) {
                btn.click();
            } else {
                el.remove();
            }
            dismissedAny = true;
        });
        if (dismissedAny) {
            // Clear any leftover modal backdrop so the page isn't left dimmed.
            document.querySelectorAll('tp-yt-iron-overlay-backdrop').forEach((b) => {
                b.classList.remove('opened');
                b.style.display = 'none';
            });
        }
    }

    // Serialize renders: renderHomeFeed is triggered by several events that can
    // fire at once (navigation, refresh, storage changes). Without a lock, two
    // runs can each create the feed section before the other finishes, leaving
    // duplicate sections (and duplicated cards). The lock coalesces overlapping
    // calls into a single trailing re-render.
    let homeRenderRunning = false;
    let homeRenderQueued = false;
    async function renderHomeFeed() {
        if (homeRenderRunning) {
            homeRenderQueued = true;
            return;
        }
        homeRenderRunning = true;
        try {
            await renderHomeFeedImpl();
        } catch (e) {
            debugLog('renderHomeFeed error:', e.message);
        } finally {
            homeRenderRunning = false;
            if (homeRenderQueued) {
                homeRenderQueued = false;
                renderHomeFeed();
            }
        }
    }

    async function renderHomeFeedImpl() {
        const settings = cachedSettings || await getFeedSettings();
        applyGlobalUiPreferences(settings);

        if (!EMBED_YOUTUBE_HOME_FEED || !settings.localFeedEnabled || !isHomePage()) {
            const stale = document.getElementById('ytvht-home-feed');
            if (stale) stale.remove();
            return;
        }

        const anchor = getHomeAnchor();
        if (!anchor || !anchor.parentNode) return; // grid not ready yet

        // Remove any duplicate sections that may already exist, keep the first.
        const existingSections = document.querySelectorAll('#ytvht-home-feed');
        for (let i = 1; i < existingSections.length; i++) {
            existingSections[i].remove();
        }

        let section = existingSections[0] || null;
        if (!section) {
            section = document.createElement('div');
            section.id = 'ytvht-home-feed';
            anchor.parentNode.insertBefore(section, anchor);
        } else if (section.nextSibling !== anchor) {
            // Keep our section directly above the native grid after re-renders.
            anchor.parentNode.insertBefore(section, anchor);
        }

        const subs = await ytStorage.getSubscriptionList();
        const cache = await ytStorage.getFeedCache();
        const videos = cache.videos || [];
        const diagnostics = cache.diagnostics || [];
        if (subs.length > 0 && cache.policy !== FEED_CACHE_POLICY && !isRefreshing) {
            scheduleFeedRefresh(true);
        }

        // Header is cheap (text + button, no images) so rebuilding it never
        // flickers — this is where the live count + loading spinner update.
        const newHeader = buildFeedHeader(subs);
        const oldHeader = section.querySelector('.ytvht-feed-header');
        if (oldHeader) oldHeader.replaceWith(newHeader);
        else section.insertBefore(newHeader, section.firstChild);

        // Body (the grid with images) is rebuilt ONLY when the video set
        // actually changes. During a refresh the cached list is unchanged, so
        // the grid stays put (no image reload = no flicker); it rebuilds once
        // when the new results arrive.
        const displayPolicySig = 'newest-first-v5';
        const sig = subs.length === 0
            ? 'nosubs'
            : (videos.length === 0
                ? ('empty:' + isRefreshing + ':' + diagnostics.length)
                : (videos.map((v) => v.videoId + ':' + (v.channelThumbnail || '') + ':' + (v.duration || 0)).join(',')
                    + '|f:' + diagnostics.filter((d) => d.error).length
                    + '|p:' + displayPolicySig));

        const existingBody = section.querySelector('.ytvht-feed-body');
        if (!existingBody || section.dataset.bodySig !== sig) {
            const newBody = await buildFeedBody(subs, videos, diagnostics);
            if (existingBody) existingBody.replaceWith(newBody);
            else section.appendChild(newBody);
            section.dataset.bodySig = sig;
        }
    }

    function buildFeedHeader(subs) {
        const header = document.createElement('div');
        header.className = 'ytvht-feed-header';

        const titleEl = document.createElement('span');
        titleEl.className = 'ytvht-feed-title';
        titleEl.textContent = 'Local Subscriptions';

        const countEl = document.createElement('span');
        countEl.className = 'ytvht-feed-count';
        countEl.textContent = subs.length
            ? `${subs.length} channel${subs.length === 1 ? '' : 's'}`
            : '';
        if (isRefreshing) {
            const loading = document.createElement('span');
            loading.className = 'ytvht-feed-loading';
            const spinner = document.createElement('span');
            spinner.className = 'ytvht-feed-spinner';
            loading.appendChild(spinner);
            const loadingText = document.createElement('span');
            loadingText.textContent = 'Loading…';
            loading.appendChild(loadingText);
            countEl.appendChild(document.createTextNode('  '));
            countEl.appendChild(loading);
        }

        const refreshBtn = document.createElement('button');
        refreshBtn.className = 'ytvht-feed-refresh';
        refreshBtn.textContent = isRefreshing ? 'Refreshing…' : 'Refresh';
        refreshBtn.disabled = isRefreshing;
        refreshBtn.addEventListener('click', async () => {
            await refreshFeed(true);
            await renderHomeFeed();
        });

        header.appendChild(titleEl);
        header.appendChild(countEl);
        header.appendChild(refreshBtn);
        return header;
    }

    async function buildFeedBody(subs, videos, diagnostics) {
        const body = document.createElement('div');
        body.className = 'ytvht-feed-body';

        if (subs.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'ytvht-feed-empty';
            empty.textContent = 'No local subscriptions yet. Search in the extension and use Subscribe to build your feed.';
            body.appendChild(empty);
            return body;
        }

        if (videos.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'ytvht-feed-empty';
            empty.textContent = isRefreshing
                ? 'Loading your subscription feed…'
                : 'No videos found yet. Click Refresh to load the latest uploads.';
            body.appendChild(empty);
            if (!isRefreshing && diagnostics.length > 0) {
                body.appendChild(buildDiagnostics(diagnostics));
            }
            if (!isRefreshing) scheduleFeedRefresh(false);
            return body;
        }

        // Load watch history once so cards can show progress / duration / labels.
        const displayVideos = newestFirstVideos(videos);
        let watched = {};
        try {
            watched = (await ytStorage.getAllVideos()) || {};
        } catch (e) {
            debugLog('getAllVideos failed (no watched overlays):', e.message);
        }

        const grid = document.createElement('div');
        grid.className = 'ytvht-feed-grid';
        displayVideos.forEach((v) => grid.appendChild(buildFeedCard(v, watched[v.videoId])));
        body.appendChild(grid);

        const failed = diagnostics.filter((d) => d.error);
        if (failed.length > 0) {
            body.appendChild(buildDiagnostics(diagnostics));
        }
        return body;
    }

    // ------------------------------------------------------------------
    // Routing — react to YouTube's SPA navigation
    // ------------------------------------------------------------------
    async function onRoute() {
        const path = window.location.pathname;
        lastRoutePath = path;

        await getFeedSettings();
        // Apply account/subscription hiding on every page (site-wide).
        applyGlobalUiPreferences(cachedSettings);

        removeSubButton();
        removeHomeFeedIfPresent();
    }

    function removeHomeFeedIfPresent() {
        const stale = document.getElementById('ytvht-home-feed');
        if (stale) stale.remove();
        // Recommendation-hiding CSS is route-scoped; preferences own the flag.
    }

    let homeRetry = null;
    function scheduleHomeRetry() {
        if (homeRetry) clearInterval(homeRetry);
        let attempts = 0;
        homeRetry = setInterval(() => {
            attempts++;
            if (!isHomePage()) {
                clearInterval(homeRetry);
                homeRetry = null;
                return;
            }
            if (document.getElementById('ytvht-home-feed') && getHomeAnchor()) {
                clearInterval(homeRetry);
                homeRetry = null;
                return;
            }
            renderHomeFeed();
            if (attempts > 20) {
                clearInterval(homeRetry);
                homeRetry = null;
            }
        }, 500);
    }

    // ------------------------------------------------------------------
    // External signals (popup messages, storage changes)
    // ------------------------------------------------------------------
    function setupListeners() {
        // Messages from the popup.
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
            chrome.runtime.onMessage.addListener((message) => {
                if (!message || !message.type) return;
                if (message.type === 'ytvhtRefreshFeed') {
                    (async () => {
                        await refreshFeed(true);
                        if (EMBED_YOUTUBE_HOME_FEED && isHomePage()) renderHomeFeed();
                    })();
                } else if (message.type === 'ytvhtSubsChanged') {
                    scheduleFeedRefresh(true);
                } else if (message.type === 'ytvhtSettingsChanged') {
                    (async () => {
                        cachedSettings = null;
                        await getFeedSettings();
                        applyGlobalUiPreferences(cachedSettings);
                        if (EMBED_YOUTUBE_HOME_FEED && isHomePage()) renderHomeFeed();
                    })();
                }
            });
        }

        // React to subscription / feed-cache changes from any context.
        const onChange = (changes, area) => {
            if (area !== 'local') return;
            const keys = Object.keys(changes);
            const subChanged = keys.some((k) => k.startsWith('sub_'));
            const feedChanged = keys.includes('feedCache');
            const settingsChanged = keys.includes('settings');
            if (settingsChanged) {
                cachedSettings = null;
                getFeedSettings().then(applyGlobalUiPreferences);
            }
            if (feedChanged && EMBED_YOUTUBE_HOME_FEED && isHomePage()) {
                // Final aggregated result — render promptly.
                renderHomeFeed();
            }
            if (subChanged) {
                // Subscriptions can change in rapid bursts (import); debounce.
                if (EMBED_YOUTUBE_HOME_FEED && isHomePage()) renderHomeFeedDebounced();
            }
        };
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
            chrome.storage.onChanged.addListener(onChange);
        } else if (typeof browser !== 'undefined' && browser.storage && browser.storage.onChanged) {
            browser.storage.onChanged.addListener(onChange);
        }

        // SPA navigation hooks (mirrors content.js approach).
        window.addEventListener('yt-navigate-finish', () => onRoute());
        window.addEventListener('yt-page-data-updated', () => onRoute());
        window.addEventListener('popstate', () => onRoute());

        // Fallback: poll for URL changes.
        let lastUrl = window.location.href;
        setInterval(() => {
            if (window.location.href !== lastUrl) {
                lastUrl = window.location.href;
                onRoute();
            }
        }, 700);

        // Dismiss YouTube's recommendation / watch-history nag popups.
        setInterval(dismissNagPopups, 1000);
    }

    // ------------------------------------------------------------------
    // Init
    // ------------------------------------------------------------------
    async function init() {
        await waitForStorage();
        await getFeedSettings();
        injectStyles();
        applyGlobalUiPreferences(cachedSettings);
        setupListeners();
        // Pre-warm the feed cache for the extension feed when enabled.
        if (EMBED_YOUTUBE_HOME_FEED && isHomePage()) {
            scheduleFeedRefresh(false);
        }
        onRoute();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Test hook
    if (typeof window !== 'undefined' && window.__YTVHT_TEST__) {
        window.__YTVHT_TEST__.subscriptions = {
            parseFeedEntry,
            relativeTime,
            getChannelPageInfo,
            getWatchOwnerInfo
        };
    }
})();

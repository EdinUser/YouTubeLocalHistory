// Dedicated feed page for YT re:Watch.
//
// This is a stable, self-contained extension page (no YouTube DOM to fight, so
// no flicker/render races). It RENDERS the aggregated subscriptions feed from
// the cache that the content script builds (`feedCache` in storage). Refreshing
// the feed still requires a YouTube tab, because the RSS fetch must run on
// www.youtube.com (same-origin) — we message the content script to do it, then
// re-render automatically when the cache updates.

'use strict';

let allVideos = [];      // canonical subscription_feed_videos projection
let watchedMap = {};     // videoId -> watch record (for the "viewed" overlay)
let durationCache = {};  // videoId -> seconds
let shortsCache = {};    // videoId -> true when YouTube resolved it as a Short
let releaseDateCache = {}; // videoId -> original YouTube release timestamp
let overlayTitle = '';
let lastUpdated = 0;
let feedCachePolicy = '';
let feedDiagnostics = [];
let localSubscriptions = [];
let sharedFeedScheduler = null;
let pendingFeedVideoCount = 0;
let feedFeedback = { notInterested: {}, channelLess: {}, channelMore: {} };
let searchVisibleLimit = 25;
const SEARCH_PAGE_SIZE = 25;
let searchFiltersOpen = false;
let channelActive = false;
const enrichingSearchChannels = new Set();
const LAST_VIEW_KEY = 'ytvht.lastFeedView.v1';
const LAST_VIEW_STORAGE_KEY = 'ytvht.lastFeedView.v1';

function updateSearchFilterButton() {
    const button = document.getElementById('searchFilterToggle');
    if (!button) return;
    const active = ['searchDate', 'searchDuration', 'searchWatched', 'searchSort']
        .filter((id) => {
            const value = document.getElementById(id)?.value;
            return value && value !== 'any' && value !== 'relevance';
        }).length;
    button.textContent = searchFiltersOpen
        ? tFeed('feed_hide_filters', 'Hide filters')
        : active
            ? tFeed('feed_filters_active', 'Filters ($1)', [feedFormatNumber(active)])
            : tFeed('feed_filters', 'Filters');
    button.classList.toggle('active', searchFiltersOpen || active > 0);
}

function rememberView(view) {
    try { sessionStorage.setItem(LAST_VIEW_KEY, view); } catch (_) { /* optional */ }
    if (typeof ytvhtFeedViewPreference !== 'undefined' && !ytvhtFeedViewPreference.shouldPersistLastView(view)) return;
    try {
        chrome.storage.local.set({ [LAST_VIEW_STORAGE_KEY]: view }).catch(() => {});
    } catch (_) { /* optional */ }
}

// ----- formatting helpers (shared with content-subscriptions.js) ----------
function formatDuration(seconds) {
    const s = Math.floor(seconds);
    if (!s || s < 0) return '';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

function cleanDurationText(value) {
    const match = String(value || '').replace(/\s+/g, ' ').match(/\b(?:\d+:)?\d{1,2}:\d{2}\b/);
    return match ? match[0] : '';
}

function formatViews(n) {
    if (!n || n < 1) return '';
    return feedPlural(
        'feed_views',
        n,
        '$1 view',
        '$1 views',
        [],
        { notation: 'compact', maximumFractionDigits: 1 }
    );
}

function relativeTime(ms) {
    if (!ms || !Number.isFinite(Number(ms))) return '';
    return feedRelativeTime(Number(ms));
}

function parseRelativeTimeText(text) {
    const value = String(text || '').toLowerCase();
    if (!value) return 0;
    const now = Date.now();
    if (value.includes('just now')) return now;
    const match = value.match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/);
    if (!match) return 0;
    const amount = Number(match[1]) || 0;
    const multipliers = {
        second: 1000,
        minute: 60000,
        hour: 3600000,
        day: 86400000,
        week: 7 * 86400000,
        month: 30 * 86400000,
        year: 365 * 86400000
    };
    return now - amount * (multipliers[match[2]] || 0);
}

function effectivePublishedTime(video) {
    if (!video) return 0;
    const cached = Number(video.videoId && releaseDateCache[video.videoId]);
    if (cached > 0) return cached;
    const fromText = video._publishedUnreliable ? parseRelativeTimeText(video._whenText) : 0;
    if (fromText > 0) return fromText;
    return Number(video.published || 0);
}

function decodeHtmlEntities(str) {
    if (!str || str.indexOf('&') === -1) return str || '';
    return new DOMParser().parseFromString(str, 'text/html').documentElement.textContent || '';
}

function applyLocalChannelArtwork(video) {
    if (!video) return video;
    const key = channelKey(video.channelName);
    const subscription = localSubscriptions.find((sub) =>
        (key && channelKey(sub.channelName) === key) ||
        (video.channelId && [sub.id, sub.ucid, sub.handle].filter(Boolean).includes(video.channelId))
    );
    if (subscription) {
        if (!video.channelThumbnail && subscription.thumbnail) {
            video.channelThumbnail = subscription.thumbnail;
        }
        if (!video.channelUrl) video.channelUrl = subscriptionUrl(subscription);
    }
    return video;
}

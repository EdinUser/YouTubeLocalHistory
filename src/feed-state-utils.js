// Dedicated feed page for YT re:Watch.
//
// This is a stable, self-contained extension page (no YouTube DOM to fight, so
// no flicker/render races). It RENDERS the aggregated subscriptions feed from
// the cache that the content script builds (`feedCache` in storage). Refreshing
// the feed still requires a YouTube tab, because the RSS fetch must run on
// www.youtube.com (same-origin) — we message the content script to do it, then
// re-render automatically when the cache updates.

'use strict';

let allVideos = [];      // from feedCache
let watchedMap = {};     // videoId -> watch record (for the "viewed" overlay)
let durationCache = {};  // videoId -> seconds
let shortsCache = {};    // videoId -> true when YouTube resolved it as a Short
let releaseDateCache = {}; // videoId -> original YouTube release timestamp
const metadataAttempts = new Map();
let releaseDateBatchRunning = false;
let overlayTitle = 'Viewed';
let lastUpdated = 0;
let feedCachePolicy = '';
let feedDiagnostics = [];
let localSubscriptions = [];
let feedFeedback = { notInterested: {}, channelLess: {}, channelMore: {} };
let searchVisibleLimit = 25;
const SEARCH_PAGE_SIZE = 25;
let youtubeSearchResults = [];
let youtubeSearchQuery = '';
let youtubeVisibleLimit = 25;
let youtubeSearchTimer = null;
let youtubeSearchRequestId = 0;
let youtubeSearchContinuation = '';
let youtubeSearchLoadingMore = false;
let youtubeSearchObserver = null;
let youtubeSearchConfig = null;
let youtubeSearchPagingError = '';
let searchFiltersOpen = false;
let channelActive = false;
const enrichingSearchChannels = new Set();
const LAST_VIEW_KEY = 'ytvht.lastFeedView.v1';

function updateSearchFilterButton() {
    const button = document.getElementById('searchFilterToggle');
    if (!button) return;
    const active = ['searchDate', 'searchDuration', 'searchWatched', 'searchSort']
        .filter((id) => {
            const value = document.getElementById(id)?.value;
            return value && value !== 'any' && value !== 'relevance';
        }).length;
    button.textContent = searchFiltersOpen
        ? 'Hide filters'
        : `Filters${active ? ` (${active})` : ''}`;
    button.classList.toggle('active', searchFiltersOpen || active > 0);
}

function rememberView(view) {
    try { sessionStorage.setItem(LAST_VIEW_KEY, view); } catch (_) { /* optional */ }
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
    if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B views';
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M views';
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K views';
    return n + ' views';
}

function relativeTime(ms) {
    if (!ms || !Number.isFinite(Number(ms))) return '';
    const diff = Date.now() - ms;
    if (!Number.isFinite(diff)) return '';
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

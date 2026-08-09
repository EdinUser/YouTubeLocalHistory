let analyticsActive = false;
let subscriptionsActive = false;
let playlistsActive = false;
let activePlaylistDetailId = null;
let playlistDetailRenderToken = 0;
let historyActive = false;
let settingsActive = false;
let historyVisibleLimit = 30;
let analyticsChannelSort = 'watchTime';
let analyticsHistorySnapshot = [];

function formatWatchTotal(totalSec) {
    const s = Math.floor(totalSec || 0);
    if (s <= 0) return tFeed('feed_duration_minutes', '$1m', ['0']);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) {
        return tFeed('feed_duration_hours_minutes', '$1h $2m', [feedFormatNumber(h), feedFormatNumber(m)]);
    }
    if (m > 0) return tFeed('feed_duration_minutes', '$1m', [feedFormatNumber(m)]);
    return tFeed('feed_duration_seconds', '$1s', [feedFormatNumber(s)]);
}

function renderBars(containerId, items) {
    const wrap = document.getElementById(containerId);
    if (!wrap) return;
    wrap.textContent = '';
    const max = Math.max(1, ...items.map((i) => i.val));
    items.forEach((it) => {
        const col = document.createElement('div');
        col.className = 'an-bar-wrap';
        const value = document.createElement('div');
        value.className = 'an-bar-value';
        value.textContent = it.val > 0
            ? (Object.prototype.hasOwnProperty.call(it, 'valueText') ? it.valueText : formatWatchTotal(it.val))
            : '';
        const bar = document.createElement('div');
        bar.className = 'an-bar';
        bar.style.height = Math.round((it.val / max) * 130) + 'px';
        bar.title = it.tip || formatWatchTotal(it.val);
        const lbl = document.createElement('div');
        lbl.className = 'an-bar-label';
        lbl.textContent = it.label;
        col.appendChild(value);
        col.appendChild(bar);
        col.appendChild(lbl);
        wrap.appendChild(col);
    });
}

function renderCompletionBreakdown(videos) {
    const wrap = document.getElementById('anCompletion');
    if (!wrap) return;
    wrap.textContent = '';

    const withDuration = videos.filter((video) => Number(video.duration || 0) > 0);
    if (!withDuration.length) {
        const empty = document.createElement('div');
        empty.className = 'an-empty';
        empty.textContent = tFeed('feed_analytics_watch_prompt', 'Watch a few videos to see this breakdown.');
        wrap.appendChild(empty);
        return;
    }

    const groups = [
        { label: tFeed('chart_completed', 'Finished'), className: '', count: 0 },
        { label: tFeed('chart_partial', 'Partly watched'), className: 'partial', count: 0 },
        { label: tFeed('feed_just_started', 'Just started'), className: 'started', count: 0 }
    ];
    withDuration.forEach((video) => {
        const ratio = Math.max(0, Number(video.time || 0) / Number(video.duration || 1));
        if (ratio >= ytvhtFeedContracts.WATCH_COMPLETION_RATIO) groups[0].count++;
        else if (ratio >= ytvhtFeedContracts.WATCH_SKIP_RATIO) groups[1].count++;
        else groups[2].count++;
    });
    const max = Math.max(1, ...groups.map((group) => group.count));
    groups.forEach((group) => {
        const row = document.createElement('div');
        row.className = 'an-completion-row';
        const head = document.createElement('div');
        head.className = 'an-completion-head';
        const label = document.createElement('span');
        label.textContent = group.label;
        const count = document.createElement('span');
        const percent = Math.round((group.count / withDuration.length) * 100);
        count.textContent = `${feedFormatNumber(group.count)} · ${feedFormatNumber(percent / 100, { style: 'percent' })}`;
        head.appendChild(label);
        head.appendChild(count);

        const progress = document.createElement('div');
        progress.className = `an-progress ${group.className}`.trim();
        const fill = document.createElement('span');
        fill.style.width = `${Math.round((group.count / max) * 100)}%`;
        progress.appendChild(fill);
        row.appendChild(head);
        row.appendChild(progress);
        wrap.appendChild(row);
    });
}

function renderTopChannels(videos) {
    const wrap = document.getElementById('anTopChannels');
    if (!wrap) return;
    wrap.textContent = '';
    const top = ytvhtFeedAnalyticsData.topChannels(videos, analyticsChannelSort, 6);
    const metric = document.getElementById('anTopChannelsMetric');
    if (metric) {
        metric.textContent = analyticsChannelSort === 'videos'
            ? tFeed('feed_analytics_ranked_by_videos', 'Ranked by watched video records')
            : tFeed('feed_analytics_ranked_by_watch_time', 'Ranked by local watch time');
    }
    document.querySelectorAll('[data-analytics-channel-sort]').forEach((button) => {
        const selected = button.dataset.analyticsChannelSort === analyticsChannelSort;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    if (!top.length) {
        const empty = document.createElement('div');
        empty.className = 'an-empty';
        empty.textContent = tFeed('feed_analytics_top_channels_empty', 'Your most-watched channels will appear here.');
        wrap.appendChild(empty);
        return;
    }
    top.forEach((data) => {
        const row = document.createElement('div');
        row.className = 'an-channel-row';
        const channelUrl = ytvhtFeedAnalyticsData.channelUrl(data.channelId);
        const name = document.createElement(channelUrl ? 'a' : 'div');
        name.className = 'an-channel-name';
        name.textContent = decodeHtmlEntities(data.channelName);
        if (channelUrl) {
            name.href = channelUrl;
            name.target = '_blank';
            name.rel = 'noopener';
        }
        const stat = document.createElement('div');
        stat.className = 'an-channel-stat';
        stat.textContent = tFeed('analytics_channel_videos', '$1 videos, $2', [
            feedFormatNumber(data.videos),
            formatWatchTotal(data.watchSeconds)
        ]);
        row.appendChild(name);
        row.appendChild(stat);
        wrap.appendChild(row);
    });
}

function setupAnalyticsChannelSort() {
    document.querySelectorAll('[data-analytics-channel-sort]').forEach((button) => {
        if (button.dataset.bound) return;
        button.dataset.bound = 'true';
        button.addEventListener('click', () => {
            analyticsChannelSort = button.dataset.analyticsChannelSort === 'videos' ? 'videos' : 'watchTime';
            renderTopChannels(analyticsHistorySnapshot);
        });
    });
}

function renderSkippedChannels(videos) {
    const wrap = document.getElementById('anSkippedChannels');
    if (!wrap) return;
    wrap.textContent = '';
    const skipped = ytvhtFeedAnalyticsData.topSkippedChannels(videos, {
        minimumDuration: ytvhtFeedContracts.LONG_VIDEO_MIN_DURATION_SECONDS,
        skipRatio: ytvhtFeedContracts.WATCH_SKIP_RATIO,
        limit: 5
    });
    if (!skipped.length) {
        const empty = document.createElement('div');
        empty.className = 'an-empty';
        empty.textContent = tFeed('analytics_no_skipped_channel_data', 'No skipped channels found.');
        wrap.appendChild(empty);
        return;
    }
    skipped.forEach((data) => {
        const row = document.createElement('div');
        row.className = 'an-channel-row';
        const channelUrl = ytvhtFeedAnalyticsData.channelUrl(data.channelId);
        const name = document.createElement(channelUrl ? 'a' : 'div');
        name.className = 'an-channel-name';
        name.textContent = decodeHtmlEntities(data.channelName);
        if (channelUrl) {
            name.href = channelUrl;
            name.target = '_blank';
            name.rel = 'noopener';
        }
        const stat = document.createElement('div');
        stat.className = 'an-channel-stat';
        stat.textContent = tFeed('analytics_skipped_count', '$1 skipped', [feedFormatNumber(data.videos)]);
        row.appendChild(name);
        row.appendChild(stat);
        wrap.appendChild(row);
    });
}

function analyticsVideoUrl(video) {
    const fallback = `https://www.youtube.com/watch?v=${encodeURIComponent(video.videoId || '')}`;
    try {
        const url = new URL(video.url || fallback);
        const watched = Math.floor(Math.max(0, Number(video.watchedSeconds || video.time || 0)));
        if (watched > 0) url.searchParams.set('t', String(watched));
        return url.toString();
    } catch (_) {
        return fallback;
    }
}

function renderLongestUnfinished(videos) {
    const wrap = document.getElementById('anLongestUnfinished');
    if (!wrap) return;
    wrap.textContent = '';
    const unfinished = ytvhtFeedAnalyticsData.longestUnfinishedVideos(videos, {
        minimumDuration: ytvhtFeedContracts.LONG_VIDEO_MIN_DURATION_SECONDS,
        completionRatio: ytvhtFeedContracts.WATCH_COMPLETION_RATIO,
        limit: 5
    });
    if (!unfinished.length) {
        const empty = document.createElement('div');
        empty.className = 'an-empty';
        empty.textContent = tFeed('analytics_no_unfinished_long_videos', 'No unfinished long videos found.');
        wrap.appendChild(empty);
        return;
    }
    unfinished.forEach((video) => {
        const percent = Math.max(0, Math.min(89, Math.round(
            (video.watchedSeconds / video.durationSeconds) * 100
        )));
        const link = document.createElement('a');
        link.className = 'an-continue';
        link.href = analyticsVideoUrl(video);
        link.target = '_blank';
        link.rel = 'noopener';

        const thumb = document.createElement('div');
        thumb.className = 'an-continue-thumb';
        const image = document.createElement('img');
        image.loading = 'lazy';
        image.alt = '';
        image.src = video.thumbnail || `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`;
        thumb.appendChild(image);
        const durationLabel = document.createElement('span');
        durationLabel.className = 'an-continue-duration';
        durationLabel.textContent = formatDuration(video.durationSeconds);
        thumb.appendChild(durationLabel);

        const info = document.createElement('div');
        info.className = 'an-continue-info';
        const title = document.createElement('div');
        title.className = 'an-continue-title';
        title.textContent = decodeHtmlEntities(feedVideoTitle(video.title));
        const channel = document.createElement('div');
        channel.className = 'an-continue-channel';
        channel.textContent = decodeHtmlEntities(feedChannelTitle(video.channelName));
        const meta = document.createElement('div');
        meta.className = 'an-continue-meta';
        const remaining = document.createElement('span');
        remaining.textContent = tFeed('feed_analytics_time_left', '$1 left', [
            formatWatchTotal(video.remainingSeconds)
        ]);
        const watched = document.createElement('span');
        watched.textContent = tFeed('feed_percent_watched', '$1 watched', [
            feedFormatNumber(percent / 100, { style: 'percent' })
        ]);
        meta.appendChild(remaining);
        meta.appendChild(watched);
        info.appendChild(title);
        info.appendChild(channel);
        info.appendChild(meta);
        link.appendChild(thumb);
        link.appendChild(info);
        wrap.appendChild(link);
    });
}

function renderContinueWatching(videos) {
    const wrap = document.getElementById('anContinue');
    if (!wrap) return;
    wrap.textContent = '';

    const unfinished = videos
        .filter((video) => {
            const time = Number(video.time || 0);
            const duration = Number(video.duration || 0);
            return !video.isShorts && time >= 30 && duration >= 180 &&
                time / duration < ytvhtFeedContracts.WATCH_COMPLETION_RATIO;
        })
        .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
        .slice(0, 6);
    if (!unfinished.length) {
        const empty = document.createElement('div');
        empty.className = 'an-empty';
        empty.textContent = tFeed('feed_analytics_no_unfinished', 'No unfinished videos right now.');
        wrap.appendChild(empty);
        return;
    }

    unfinished.forEach((video) => {
        const duration = Number(video.duration || 0);
        const time = Number(video.time || 0);
        const percent = Math.max(1, Math.min(89, Math.round((time / duration) * 100)));
        const link = document.createElement('a');
        link.className = 'an-continue';
        link.href = video.url || `https://www.youtube.com/watch?v=${video.videoId}`;
        link.target = '_blank';
        link.rel = 'noopener';

        const thumb = document.createElement('div');
        thumb.className = 'an-continue-thumb';
        const image = document.createElement('img');
        image.loading = 'lazy';
        image.alt = '';
        image.src = video.thumbnail || `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`;
        thumb.appendChild(image);
        const durationLabel = document.createElement('span');
        durationLabel.className = 'an-continue-duration';
        durationLabel.textContent = formatDuration(duration);
        thumb.appendChild(durationLabel);

        const info = document.createElement('div');
        info.className = 'an-continue-info';
        const title = document.createElement('div');
        title.className = 'an-continue-title';
        title.textContent = decodeHtmlEntities(feedVideoTitle(video.title));
        const channel = document.createElement('div');
        channel.className = 'an-continue-channel';
        channel.textContent = decodeHtmlEntities(feedChannelTitle(video.channelName));
        const progress = document.createElement('div');
        progress.className = 'an-progress';
        const fill = document.createElement('span');
        fill.style.width = `${percent}%`;
        progress.appendChild(fill);
        const meta = document.createElement('div');
        meta.className = 'an-continue-meta';
        const watched = document.createElement('span');
        watched.textContent = tFeed('feed_percent_watched', '$1 watched', [
            feedFormatNumber(percent / 100, { style: 'percent' })
        ]);
        const lastSeen = document.createElement('span');
        lastSeen.textContent = relativeTime(Number(video.timestamp || 0));
        meta.appendChild(watched);
        meta.appendChild(lastSeen);
        info.appendChild(title);
        info.appendChild(channel);
        info.appendChild(progress);
        info.appendChild(meta);
        link.appendChild(thumb);
        link.appendChild(info);
        wrap.appendChild(link);
    });
}

async function renderAnalytics() {
    let stats = null;
    let playlists = {};
    let videoMap = {};
    try { stats = await ytStorage.getStats(); } catch (_) { /* defaults below */ }
    try { playlists = await ytStorage.getAllPlaylists(); } catch (_) { /* ignore */ }
    try { videoMap = await ytStorage.getAllVideos(); } catch (_) { /* ignore */ }

    stats = stats || {};
    const history = Object.values(videoMap || {}).filter(Boolean);
    analyticsHistorySnapshot = history;
    const counters = stats.counters || {};
    const videos = Number(counters.videos || 0);
    const shorts = Number(counters.shorts || 0);
    const totalItems = videos + shorts;
    const avg = totalItems ? (Number(stats.totalWatchSeconds || 0) / totalItems) : 0;
    const completion = videos ? Math.round((Number(counters.completed || 0) / videos) * 100) : 0;
    const playlistCount = Object.keys(playlists || {}).length;

    const cards = [
        [tFeed('analytics_total_watch_time', 'Total watch time'), formatWatchTotal(stats.totalWatchSeconds)],
        [tFeed('analytics_videos_watched', 'Videos watched'), feedFormatNumber(videos)],
        [tFeed('analytics_shorts_watched', 'Shorts watched'), feedFormatNumber(shorts)],
        [tFeed('analytics_avg_duration', 'Avg. per item'), formatWatchTotal(avg)],
        [tFeed('analytics_completion_rate', 'Completion rate'), feedFormatNumber(completion / 100, { style: 'percent' })],
        [tFeed('analytics_playlists_saved', 'Playlists saved'), feedFormatNumber(playlistCount)]
    ];
    const anCards = document.getElementById('anCards');
    if (anCards) {
        anCards.textContent = '';
        cards.forEach(([label, value]) => {
            const card = document.createElement('div');
            card.className = 'an-card';
            const l = document.createElement('div');
            l.className = 'l';
            l.textContent = label;
            const v = document.createElement('div');
            v.className = 'v';
            v.textContent = value;
            card.appendChild(l);
            card.appendChild(v);
            anCards.appendChild(card);
        });
    }

    // Last 7 days (local), oldest → newest.
    const daily = stats.daily || {};
    const now = new Date();
    const days = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const val = Number(daily[key] || 0);
        days.push({
            label: d.toLocaleDateString(undefined, { weekday: 'short' }),
            val,
            valueText: val > 0 ? formatWatchTotal(val) : ''
        });
    }
    renderBars('anDaily', days);

    // 24 hours.
    const hourly = (Array.isArray(stats.hourly) && stats.hourly.length === 24) ? stats.hourly : new Array(24).fill(0);
    const peakHourValue = Math.max(0, ...hourly.map((value) => Number(value || 0)));
    renderBars('anHourly', hourly.map((v, h) => ({
        label: (h % 6 === 0) ? String(h) : '',
        val: Number(v || 0),
        valueText: Number(v || 0) === peakHourValue && peakHourValue > 0 ? formatWatchTotal(Number(v || 0)) : '',
        tip: `${h}:00 — ${formatWatchTotal(Number(v || 0))}`
    })));
    renderCompletionBreakdown(history);
    setupAnalyticsChannelSort();
    renderTopChannels(history);
    renderSkippedChannels(history);
    renderLongestUnfinished(history);
    renderContinueWatching(history);
}

// Highlight the active sidebar item.
function setActiveNav(id) {
    document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
}

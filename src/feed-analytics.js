let analyticsActive = false;
let subscriptionsActive = false;
let playlistsActive = false;
let activePlaylistDetailId = null;
let playlistDetailRenderToken = 0;
let historyActive = false;
let settingsActive = false;
let historyVisibleLimit = 30;

function formatWatchTotal(totalSec) {
    const s = Math.floor(totalSec || 0);
    if (s <= 0) return '0m';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m`;
    return `${s}s`;
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
        wrap.innerHTML = '<div class="an-empty">Watch a few videos to see this breakdown.</div>';
        return;
    }

    const groups = [
        { label: 'Finished', className: '', count: 0 },
        { label: 'Partly watched', className: 'partial', count: 0 },
        { label: 'Just started', className: 'started', count: 0 }
    ];
    withDuration.forEach((video) => {
        const ratio = Math.max(0, Number(video.time || 0) / Number(video.duration || 1));
        if (ratio >= 0.9) groups[0].count++;
        else if (ratio >= 0.1) groups[1].count++;
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
        count.textContent = `${group.count} · ${percent}%`;
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

    const channels = new Map();
    videos.forEach((video) => {
        const channel = decodeHtmlEntities(video.channelName || '').trim();
        const watched = Math.max(0, Number(video.time || 0));
        if (!channel || watched <= 0) return;
        const current = channels.get(channel) || { seconds: 0, videos: 0 };
        current.seconds += watched;
        current.videos++;
        channels.set(channel, current);
    });
    const top = [...channels.entries()]
        .sort((a, b) => b[1].seconds - a[1].seconds)
        .slice(0, 6);
    if (!top.length) {
        wrap.innerHTML = '<div class="an-empty">Your most-watched channels will appear here.</div>';
        return;
    }
    top.forEach(([channel, data]) => {
        const row = document.createElement('div');
        row.className = 'an-channel-row';
        const name = document.createElement('div');
        name.className = 'an-channel-name';
        name.textContent = channel;
        const stat = document.createElement('div');
        stat.className = 'an-channel-stat';
        stat.textContent = `${formatWatchTotal(data.seconds)} · ${data.videos} video${data.videos === 1 ? '' : 's'}`;
        row.appendChild(name);
        row.appendChild(stat);
        wrap.appendChild(row);
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
            return !video.isShorts && time >= 30 && duration >= 180 && time / duration < 0.9;
        })
        .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
        .slice(0, 6);
    if (!unfinished.length) {
        wrap.innerHTML = '<div class="an-empty">No unfinished videos right now.</div>';
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
        title.textContent = decodeHtmlEntities(video.title || 'Untitled video');
        const channel = document.createElement('div');
        channel.className = 'an-continue-channel';
        channel.textContent = decodeHtmlEntities(video.channelName || 'Unknown channel');
        const progress = document.createElement('div');
        progress.className = 'an-progress';
        const fill = document.createElement('span');
        fill.style.width = `${percent}%`;
        progress.appendChild(fill);
        const meta = document.createElement('div');
        meta.className = 'an-continue-meta';
        const watched = document.createElement('span');
        watched.textContent = `${percent}% watched`;
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
    const counters = stats.counters || {};
    const videos = Number(counters.videos || 0);
    const shorts = Number(counters.shorts || 0);
    const totalItems = videos + shorts;
    const avg = totalItems ? (Number(stats.totalWatchSeconds || 0) / totalItems) : 0;
    const completion = videos ? Math.round((Number(counters.completed || 0) / videos) * 100) : 0;
    const playlistCount = Object.keys(playlists || {}).length;

    const cards = [
        ['Total watch time', formatWatchTotal(stats.totalWatchSeconds)],
        ['Videos watched', videos],
        ['Shorts watched', shorts],
        ['Avg. per item', formatWatchTotal(avg)],
        ['Completion rate', completion + '%'],
        ['Playlists saved', playlistCount]
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
    renderTopChannels(history);
    renderContinueWatching(history);
}

// Highlight the active sidebar item.
function setActiveNav(id) {
    document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
}


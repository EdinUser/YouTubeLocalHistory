// Render the top 5 watched channels
function renderTopChannels() {
    const container = document.getElementById('topChannelsList');
    if (!container) return;

    // Aggregate by channel
    const channelMap = {};
    // Prefer full merged video list (non-Shorts) when available
    const source = Array.isArray(analyticsAllVideos) && analyticsAllVideos.length
        ? analyticsAllVideos.filter(r => !r.isShorts)
        : allHistoryRecords;

    source.forEach(record => {
        const channel = record.channelName || 'Unknown Channel';
        const channelId = record.channelId || '';
        if (channel === 'Unknown Channel') return; // skip unknown
        if (!channelMap[channel]) {
            channelMap[channel] = {
                channel,
                channelId,
                count: 0,
                watchTime: 0
            };
        }
        channelMap[channel].count++;
        channelMap[channel].watchTime += record.time || 0;
    });

    let channels = Object.values(channelMap);
    channels.sort((a, b) => b.count - a.count || b.watchTime - a.watchTime);
    const topChannels = channels.slice(0, 5);

    if (topChannels.length === 0) {
        container.textContent = chrome.i18n.getMessage('analytics_no_channel_data');
        return;
    }

    // Helper to create a safe channel entry
    function createChannelEntry(ch) {
        const div = document.createElement('div');
        div.style.marginBottom = '8px';
        let channelUrl = '';
        if (ch.channelId) {
            if (ch.channelId.startsWith('UC')) {
                channelUrl = `https://www.youtube.com/channel/${ch.channelId}`;
            } else if (ch.channelId.startsWith('@')) {
                channelUrl = `https://www.youtube.com/${ch.channelId}`;
            }
        }
        const channelName = sanitizeText(ch.channel);
        let link;
        if (channelUrl) {
            link = document.createElement('a');
            link.href = channelUrl;
            link.target = '_blank';
            link.style.fontWeight = '500';
            link.style.color = 'var(--button-bg)';
            link.style.textDecoration = 'none';
            link.textContent = channelName;
        } else {
            link = document.createElement('span');
            link.style.fontWeight = '500';
            link.style.color = 'var(--button-bg)';
            link.textContent = channelName;
        }
        div.appendChild(link);
        const details = document.createElement('span');
        details.style.color = 'var(--text-color)';
        details.style.opacity = '0.8';
        details.textContent = ` - ${chrome.i18n.getMessage('analytics_channel_videos', [ch.count, formatWatchTime(ch.watchTime)])}`;
        div.appendChild(details);
        return div;
    }

    container.innerHTML = '';
    topChannels.forEach(ch => container.appendChild(createChannelEntry(ch)));
}

// Render the top 5 skipped channels (long videos only, watched <10%)
function renderSkippedChannels() {
    const container = document.getElementById('skippedChannelsList');
    if (!container) return;

    // Only consider long videos
    const source = Array.isArray(analyticsAllVideos) && analyticsAllVideos.length
        ? analyticsAllVideos.filter(r => !r.isShorts)
        : allHistoryRecords;
    const longVideos = source.filter(r => r.duration >= 600);
    const skipped = longVideos.filter(r => (r.time / r.duration) < 0.1);

    // Aggregate by channel
    const channelMap = {};
    skipped.forEach(record => {
        const channel = record.channelName || 'Unknown Channel';
        const channelId = record.channelId || '';
        if (channel === 'Unknown Channel') return; // skip unknown
        if (!channelMap[channel]) {
            channelMap[channel] = {channel, channelId, count: 0};
        }
        channelMap[channel].count++;
    });
    let channels = Object.values(channelMap);
    channels.sort((a, b) => b.count - a.count);
    const topSkipped = channels.slice(0, 5);

    if (topSkipped.length === 0) {
        container.textContent = chrome.i18n.getMessage('analytics_no_skipped_channel_data');
    } else {
        // Helper to create a safe skipped channel entry
        function createSkippedChannelEntry(ch) {
            const div = document.createElement('div');
            div.style.marginBottom = '8px';
            let channelUrl = '';
            if (ch.channelId) {
                if (ch.channelId.startsWith('UC')) {
                    channelUrl = `https://www.youtube.com/channel/${ch.channelId}`;
                } else if (ch.channelId.startsWith('@')) {
                    channelUrl = `https://www.youtube.com/${ch.channelId}`;
                }
            }
            const channelName = sanitizeText(ch.channel);
            let link;
            if (channelUrl) {
                link = document.createElement('a');
                link.href = channelUrl;
                link.target = '_blank';
                link.style.fontWeight = '500';
                link.style.color = 'var(--button-bg)';
                link.style.textDecoration = 'none';
                link.textContent = channelName;
            } else {
                link = document.createElement('span');
                link.style.fontWeight = '500';
                link.style.color = 'var(--button-bg)';
                link.textContent = channelName;
            }
            div.appendChild(link);
            const details = document.createElement('span');
            details.style.color = 'var(--text-color)';
            details.style.opacity = '0.8';
            details.textContent = ` - ${chrome.i18n.getMessage('analytics_skipped_count', [ch.count])}`;
            div.appendChild(details);
            return div;
        }

        container.innerHTML = '';
        topSkipped.forEach(ch => container.appendChild(createSkippedChannelEntry(ch)));
    }
}

// Render the completion bar chart (Skipped, Partial, Completed)
function renderCompletionBarChart() {
    const canvas = document.getElementById('completionBarChart');
    const legendDiv = document.getElementById('completionBarLegend');
    if (!canvas || !legendDiv) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Only consider long videos
    const source = Array.isArray(analyticsAllVideos) && analyticsAllVideos.length
        ? analyticsAllVideos.filter(r => !r.isShorts)
        : allHistoryRecords;
    const longVideos = source.filter(r => r.duration >= 600);
    const skipped = longVideos.filter(r => (r.time / r.duration) < 0.1);
    const partial = longVideos.filter(r => (r.time / r.duration) >= 0.1 && (r.time / r.duration) < 0.9);
    const completed = longVideos.filter(r => (r.time / r.duration) >= 0.9);
    const counts = [skipped.length, partial.length, completed.length];
    // Use short labels for x-axis
    const labels = [
        chrome.i18n.getMessage('chart_skipped'),
        chrome.i18n.getMessage('chart_partial'),
        chrome.i18n.getMessage('chart_completed')
    ];
    // Use detailed labels for legend
    const legendLabels = [
        chrome.i18n.getMessage('chart_skipped_legend'),
        chrome.i18n.getMessage('chart_partial_legend'),
        chrome.i18n.getMessage('chart_completed_legend')
    ];
    const colors = ['#e74c3c', '#f1c40f', '#2ecc40'];
    const total = counts.reduce((a, b) => a + b, 0);

    // Bar chart dimensions
    const barWidth = 40;
    const barGap = 40;
    const chartHeight = canvas.height - 40;
    const maxCount = Math.max(...counts, 1);
    const baseY = canvas.height - 20;
    const startX = 40;

    // Draw bars
    for (let i = 0; i < counts.length; i++) {
        const barHeight = Math.round((counts[i] / maxCount) * chartHeight);
        ctx.fillStyle = colors[i];
        ctx.fillRect(startX + i * (barWidth + barGap), baseY - barHeight, barWidth, barHeight);
        // Draw count above bar
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(counts[i], startX + i * (barWidth + barGap) + barWidth / 2, baseY - barHeight - 8);
    }

    // Draw x-axis labels (short)
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#ccc';
    ctx.textAlign = 'center';
    for (let i = 0; i < labels.length; i++) {
        ctx.fillText(labels[i], startX + i * (barWidth + barGap) + barWidth / 2, baseY + 16);
    }

    // Draw legend (to the right of the chart, detailed)
    let legendHtml = '';
    for (let i = 0; i < legendLabels.length; i++) {
        const percent = total ? Math.round((counts[i] / total) * 100) : 0;
        legendHtml += `<div style="margin-bottom:8px;display:flex;align-items:center;">
            <span style="display:inline-block;width:16px;height:16px;background:${colors[i]};margin-right:8px;border-radius:3px;"></span>
            <span style="color:var(--text-color);font-weight:500;flex:1;">${legendLabels[i]}</span>
            <span style="color:var(--text-color);margin-left:8px;text-align:right;min-width:60px;">${counts[i]} (${percent}%)</span>
        </div>`;
    }
    // Replace with safe DOM construction
    legendDiv.innerHTML = '';
    for (let i = 0; i < legendLabels.length; i++) {
        const row = document.createElement('div');
        row.style.marginBottom = '8px';
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        const colorBox = document.createElement('span');
        colorBox.style.display = 'inline-block';
        colorBox.style.width = '16px';
        colorBox.style.height = '16px';
        colorBox.style.background = colors[i];
        colorBox.style.marginRight = '8px';
        colorBox.style.borderRadius = '3px';
        row.appendChild(colorBox);
        const label = document.createElement('span');
        label.style.color = 'var(--text-color)';
        label.style.fontWeight = '500';
        label.style.flex = '1';
        label.textContent = legendLabels[i];
        row.appendChild(label);
        const count = document.createElement('span');
        count.style.color = 'var(--text-color)';
        count.style.marginLeft = '8px';
        count.style.textAlign = 'right';
        count.style.minWidth = '60px';
        count.textContent = `${counts[i]} (${total ? Math.round((counts[i] / total) * 100) : 0}%)`;
        row.appendChild(count);
        legendDiv.appendChild(row);
    }
}


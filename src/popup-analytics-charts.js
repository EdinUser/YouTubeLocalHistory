// Render the top 5 longest unfinished videos (duration >= 10 min, watched < 90%)
function renderUnfinishedVideos() {
    const container = document.getElementById('unfinishedVideosList');
    if (!container) return;

    // Filter for long, unfinished videos
    const unfinished = allHistoryRecords.filter(record => {
        return record.duration >= 600 && (record.time / record.duration) < 0.9;
    });

    // Sort by absolute time left, descending
    unfinished.sort((a, b) => ((b.duration - b.time) - (a.duration - a.time)));

    // Take top 5
    const topUnfinished = unfinished.slice(0, 5);

    if (topUnfinished.length === 0) {
        // Use textContent for plain text, or build DOM for styled text
        container.textContent = chrome.i18n.getMessage('analytics_no_unfinished_long_videos');
        return;
    }

    // Helper to create a safe unfinished video entry
    function createUnfinishedVideoEntry(record) {
        const div = document.createElement('div');
        div.style.marginBottom = '8px';
        const a = document.createElement('a');
        a.href = (record.time && record.time > 0) 
            ? addTimestampToUrl(record.url, record.time)
            : record.url;
        a.target = '_blank';
        a.style.fontWeight = '500';
        a.style.color = 'var(--button-bg)';
        a.style.textDecoration = 'none';
        a.textContent = sanitizeText(record.title || 'Untitled');
        div.appendChild(a);
        const timeLeft = Math.max(0, Math.round(record.duration - record.time));
        const watched = Math.round(record.time);
        const total = Math.round(record.duration);
        const minLeft = Math.floor(timeLeft / 60);
        const secLeft = timeLeft % 60;
        const minWatched = Math.floor(watched / 60);
        const minTotal = Math.floor(total / 60);
        const secWatched = watched % 60;
        const secTotal = total % 60;
        const timeLeftStr = `${minLeft}m${secLeft > 0 ? ' ' + secLeft + 's' : ''}`;
        const watchedStr = `${minWatched}:${secWatched.toString().padStart(2, '0')}`;
        const totalStr = `${minTotal}:${secTotal.toString().padStart(2, '0')}`;
        // Use a <div> for details, with a <span> for the main text, a <br>, and a <span> for the channel
        const details = document.createElement('div');
        details.style.color = 'var(--text-color)';
        details.style.opacity = '0.8';
        details.style.display = 'flex';
        details.style.alignItems = 'center';
        details.style.justifyContent = 'space-between';

        const leftDetails = document.createElement('div');
        leftDetails.style.display = 'flex';
        leftDetails.style.flexDirection = 'column';

        const mainText = document.createElement('span');
        mainText.textContent = ` - ${timeLeftStr} left (watched ${watchedStr}/${totalStr})`;
        leftDetails.appendChild(mainText);
        leftDetails.appendChild(document.createElement('br'));
        const channel = document.createElement('span');
        channel.style.fontSize = '12px';
        channel.style.color = 'var(--text-color)';
        channel.style.opacity = '0.7';
        channel.textContent = sanitizeText(record.channelName || 'Unknown Channel');
        leftDetails.appendChild(channel);

        details.appendChild(leftDetails);

        // Add delete button aligned right
        const deleteButton = document.createElement('button');
        deleteButton.className = 'delete-button';
        deleteButton.textContent = chrome.i18n.getMessage('delete_label');
        deleteButton.style.marginLeft = 'auto';
        deleteButton.onclick = () => deleteRecord(record.videoId);
        details.appendChild(deleteButton);
        div.appendChild(details);
        return div;
    }

    // Clear and append all entries
    container.innerHTML = '';
    topUnfinished.forEach(record => container.appendChild(createUnfinishedVideoEntry(record)));
}

// Create activity chart
function updateActivityChart() {
    const canvas = document.getElementById('ytvhtActivityChart');
    if (!canvas) return;

    // Set canvas size based on container
    const container = canvas.parentElement;
    canvas.width = container.clientWidth;
    canvas.height = parseInt(canvas.style.height) || 200;

    const ctx = canvas.getContext('2d');

    // Clear previous chart
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Get last 7 days of activity
    const now = new Date();
    const days = Array.from({length: 7}, (_, i) => {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    }).reverse();

    const videoSource = Array.isArray(analyticsAllVideos) && analyticsAllVideos.length
        ? analyticsAllVideos
        : [...allHistoryRecords, ...allShortsRecords];

    // Number of videos per day (use full merged list when available)
    const activity = days.map(day => {
        return videoSource.filter(record => {
            if (!record.timestamp) return false;
            const d = new Date(record.timestamp);
            const recordDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            return recordDate === day;
        }).length;
    });

    // Total minutes per day: prefer storedStats.daily (rebuilt from hybrid stats)
    const minutesPerDay = days.map(day => {
        if (storedStats && storedStats.daily && typeof storedStats.daily === 'object') {
            const seconds = Number(storedStats.daily[day] || 0);
            return Math.round(seconds / 60);
        }

        const secondsFromVideos = videoSource.reduce((sum, record) => {
            if (!record.timestamp) return sum;
            const d = new Date(record.timestamp);
            const recordDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            if (recordDate === day) {
                return sum + (record.time || 0);
            }
            return sum;
        }, 0);
        return Math.round(secondsFromVideos / 60);
    });

    // Draw chart
    const maxActivity = Math.max(...activity, 1);
    const availableWidth = canvas.width - 40; // Leave space for margins
    const barWidth = Math.max(12, Math.floor(availableWidth / 7)); // Minimum 12px width
    const barSpacing = Math.max(2, Math.min(6, Math.floor(barWidth * 0.15))); // 2-6px spacing
    const maxHeight = canvas.height - 40; // Leave space for labels

    // Draw background grid
    ctx.strokeStyle = getComputedStyle(document.documentElement)
        .getPropertyValue('--border-color')
        .trim();
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 5; i++) {
        const y = 20 + (maxHeight * i / 5);
        ctx.moveTo(20, y);
        ctx.lineTo(canvas.width - 20, y);
    }
    ctx.stroke();

    // Draw bars
    activity.forEach((count, i) => {
        const height = Math.max(1, (count / maxActivity) * maxHeight);
        const x = 20 + (barWidth + barSpacing) * i;
        const y = canvas.height - height - 20;

        // Draw bar
        ctx.fillStyle = getComputedStyle(document.documentElement)
            .getPropertyValue('--button-bg')
            .trim();
        ctx.fillRect(x, y, barWidth - barSpacing, height);

        // Draw date label
        ctx.fillStyle = getComputedStyle(document.documentElement)
            .getPropertyValue('--text-color')
            .trim();
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        const dateLabel = days[i].slice(5).replace('-', '/');
        ctx.fillText(dateLabel, x + (barWidth - barSpacing) / 2, canvas.height - 5);

        // Draw label: number of videos / total minutes (e.g., 3/42m)
        const minutes = minutesPerDay[i];
        const label = `${count}/${minutes}m`;
        ctx.fillText(label, x + (barWidth - barSpacing) / 2, y - 5);
    });
}

// Restore the Watch Time by Hour chart function
function updateWatchTimeByHourChart() {
    const canvas = document.getElementById('ytvhtWatchTimeByHourChart');
    if (!canvas) return;

    // Set canvas size based on container
    const container = canvas.parentElement;
    canvas.width = container.clientWidth;
    canvas.height = parseInt(canvas.style.height) || 200;

    const ctx = canvas.getContext('2d');

    // Clear previous chart
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Calculate watch time by hour.
    // Prefer persisted stats.hourly (rebuilt from hybrid storage), fall back to current records.
    let hourlySeconds = null;
    if (storedStats && Array.isArray(storedStats.hourly) && storedStats.hourly.length === 24) {
        hourlySeconds = storedStats.hourly.map(v => Number(v || 0));
    } else {
        hourlySeconds = new Array(24).fill(0);
        const allVideos = [...allHistoryRecords, ...allShortsRecords];
        allVideos.forEach(record => {
            if (record.timestamp) {
                const hour = new Date(record.timestamp).getHours();
                hourlySeconds[hour] += record.time || 0;
            }
        });
    }

    // Convert seconds to minutes for better readability
    const hourlyMinutes = hourlySeconds.map(seconds => Math.round(seconds / 60));

    // Draw chart
    const maxMinutes = Math.max(...hourlyMinutes, 1);
    const availableWidth = canvas.width - 60; // Leave space for labels
    const barWidth = Math.max(8, Math.floor(availableWidth / 24)); // Minimum 8px width
    const barSpacing = Math.max(1, Math.min(4, Math.floor(barWidth * 0.15))); // 1-4px spacing
    const maxHeight = canvas.height - 60; // Leave space for labels

    // Draw background grid
    ctx.strokeStyle = getComputedStyle(document.documentElement)
        .getPropertyValue('--border-color')
        .trim();
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 5; i++) {
        const y = 20 + (maxHeight * i / 5);
        ctx.moveTo(30, y);
        ctx.lineTo(canvas.width - 30, y);
    }
    ctx.stroke();

    // Draw bars
    hourlyMinutes.forEach((minutes, hour) => {
        const height = Math.max(1, (minutes / maxMinutes) * maxHeight);
        const x = 30 + (barWidth + barSpacing) * hour;
        const y = canvas.height - height - 40;

        // Draw bar
        ctx.fillStyle = getComputedStyle(document.documentElement)
            .getPropertyValue('--button-bg')
            .trim();
        ctx.fillRect(x, y, barWidth - barSpacing, height);

        // Draw hour label
        ctx.fillStyle = getComputedStyle(document.documentElement)
            .getPropertyValue('--text-color')
            .trim();
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(
            hour.toString().padStart(2, '0'),
            x + (barWidth - barSpacing) / 2,
            canvas.height - 20
        );

        // Draw minutes label if non-zero
        if (minutes > 0) {
            ctx.fillText(
                `${minutes}m`,
                x + (barWidth - barSpacing) / 2,
                y - 5
            );
        }
    });

    // Draw axis labels
    ctx.fillStyle = getComputedStyle(document.documentElement)
        .getPropertyValue('--text-color')
        .trim();
    ctx.font = '12px Arial';
    ctx.textAlign = 'right';
    ctx.fillText(chrome.i18n.getMessage('chart_minutes'), 25, 35);
    ctx.textAlign = 'center';
    ctx.fillText(chrome.i18n.getMessage('chart_hour_of_day'), canvas.width / 2, canvas.height - 5);
}


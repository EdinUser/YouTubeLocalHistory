// Format duration for analytics
function formatAnalyticsDuration(seconds) {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

// Calculate analytics data
function calculateAnalytics(records) {
    const hasStoredStats = !!(storedStats && typeof storedStats.totalWatchSeconds === 'number' && storedStats.counters);

    // Total watch time: prefer persisted snapshot, fall back to current-page data
    const totalSeconds = hasStoredStats
        ? Math.max(0, Math.floor(storedStats.totalWatchSeconds || 0))
        : records.reduce((sum, record) => sum + (record.time || 0), 0);

    let videosWatched = 0;
    let shortsWatched = 0;
    let avgDurationSeconds = 0;
    let completionRate = 0;

    if (hasStoredStats) {
        const counters = storedStats.counters || {};
        const videosCount = Math.max(0, Math.floor(Number(counters.videos || 0)));
        const shortsCount = Math.max(0, Math.floor(Number(counters.shorts || 0)));
        const totalItems = videosCount + shortsCount;
        const totalDurationSeconds = Math.max(0, Math.floor(Number(counters.totalDurationSeconds || 0)));
        const completedCount = Math.max(0, Math.floor(Number(counters.completed || 0)));

        videosWatched = totalItems;
        shortsWatched = shortsCount;
        avgDurationSeconds = totalItems > 0 ? (totalDurationSeconds / totalItems) : 0;
        completionRate = totalItems > 0 ? Math.round((completedCount / totalItems) * 100) : 0;
    } else {
        // Fallback: current-page-only behavior (what you previously had)
        const totalDuration = records.reduce((sum, record) => sum + (record.duration || 0), 0);
        const completedVideos = records.filter(record =>
            record.time && record.duration && (record.time / record.duration) >= 0.9
        ).length;

        videosWatched = records.length;
        shortsWatched = allShortsRecords.length;
        avgDurationSeconds = videosWatched > 0 ? (totalDuration / videosWatched) : 0;
        completionRate = videosWatched > 0 ? Math.round((completedVideos / videosWatched) * 100) : 0;
    }

    // Playlists are already loaded from getAllPlaylists() in updateAnalytics()
    const playlistsSaved = Array.isArray(allPlaylists) ? allPlaylists.length : 0;

    return {
        totalWatchTime: formatAnalyticsDuration(Math.floor(totalSeconds)),
        videosWatched,
        shortsWatched,
        avgDuration: formatAnalyticsDuration(
            Number.isFinite(avgDurationSeconds) && avgDurationSeconds > 0
                ? Math.floor(avgDurationSeconds)
                : 0
        ),
        completionRate,
        playlistsSaved
    };
}

// Determine if stats are effectively empty (no totals/daily/hourly data)
function isStatsEmpty(stats) {
    if (!stats) return true;
    const totalEmpty = !stats.totalWatchSeconds || stats.totalWatchSeconds <= 0;
    const dailyEmpty = !stats.daily || Object.keys(stats.daily).length === 0;
    const hourlyEmpty = !Array.isArray(stats.hourly) || stats.hourly.length !== 24 || stats.hourly.every(v => !v || v <= 0);
    return totalEmpty && dailyEmpty && hourlyEmpty;
}

// Build initial stats snapshot from existing history records
function buildStatsFromHistory() {
    const all = [...allHistoryRecords, ...allShortsRecords];
    const daily = {};
    const hourly = new Array(24).fill(0);
    let total = 0;

    all.forEach(rec => {
        const time = Math.max(0, Math.floor(rec?.time || 0));
        if (!time) return;
        total += time;
        if (rec.timestamp) {
            const d = new Date(rec.timestamp);
            const dayKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            daily[dayKey] = Math.max(0, Math.floor((daily[dayKey] || 0) + time));
            const h = d.getHours();
            hourly[h] = Math.max(0, Math.floor((hourly[h] || 0) + time));
        }
    });

    return {
        totalWatchSeconds: Math.max(0, Math.floor(total)),
        daily,
        hourly,
        lastUpdated: Date.now()
    };
}

// Update analytics display
async function updateAnalytics() {
    // Load stored stats for cards/charts (ignore errors, fallback below)
    try {
        storedStats = await ytStorage.getStats();
    } catch (e) {
        storedStats = null;
    }

    // Ensure latest history is loaded so on-the-fly charts are accurate
    try {
        await loadCurrentPages();
    } catch (_) {}

    // Ensure playlists are loaded so count isn't 0 when opening Analytics directly
    try {
        const playlistsObj = await ytStorage.getAllPlaylists();
        if (playlistsObj && typeof playlistsObj === 'object') {
            allPlaylists = Object.values(playlistsObj);
        } else {
            allPlaylists = [];
        }
    } catch (_) {
        allPlaylists = [];
    }

    // Load full merged video history for analytics (hybrid: IndexedDB + storage.local)
    // so that channel/skip/completion distributions are based on the complete dataset,
    // not just the current page.
    try {
        const videosObj = await ytStorage.getAllVideos();
        if (videosObj && typeof videosObj === 'object') {
            analyticsAllVideos = Object.values(videosObj);
        } else {
            analyticsAllVideos = [];
        }
    } catch (e) {
        console.warn('[Analytics] Failed to load full video history for analytics, falling back to current page data:', e);
        analyticsAllVideos = [...allHistoryRecords, ...allShortsRecords];
    }

    // Migrate stats if daily/hourly appear empty due to previous key format
    try {
        const haveHistory = (allHistoryRecords && allHistoryRecords.length) || (allShortsRecords && allShortsRecords.length);
        if (haveHistory) {
            // Build last 7 local day keys
            const now = new Date();
            const last7 = Array.from({length: 7}, (_, i) => {
                const d = new Date(now);
                d.setDate(d.getDate() - i);
                return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            });

            let needsDailySeed = false;
            if (!storedStats || !storedStats.daily || typeof storedStats.daily !== 'object') {
                needsDailySeed = true;
            } else {
                const anyInWindow = last7.some(k => Number(storedStats.daily[k] || 0) > 0);
                // If no daily entries in current 7-day window but we have history, seed
                if (!anyInWindow) needsDailySeed = true;
            }

            let needsHourlySeed = false;
            if (!storedStats || !Array.isArray(storedStats.hourly) || storedStats.hourly.length !== 24) {
                needsHourlySeed = true;
            } else {
                const sumHour = storedStats.hourly.reduce((a,b)=>a+Number(b||0),0);
                if (sumHour === 0) needsHourlySeed = true;
            }

            if (needsDailySeed || needsHourlySeed) {
                const seeded = buildStatsFromHistory();
                if (!storedStats) storedStats = {};
                // Prune seeded daily to last 7 keys only
                const daily = {};
                last7.reverse().forEach(k => { // oldest to newest
                    if (seeded.daily[k]) daily[k] = seeded.daily[k];
                });
                if (needsDailySeed) storedStats.daily = daily;
                if (needsHourlySeed) storedStats.hourly = seeded.hourly;
                storedStats.lastUpdated = Date.now();
                await ytStorage.setStats(storedStats);
            }
        }
    } catch (_) {}

    // One-time converter: if stats are empty but we have history, seed from calculated data
    try {
        const haveHistory = (allHistoryRecords && allHistoryRecords.length) || (allShortsRecords && allShortsRecords.length);
        if (haveHistory && isStatsEmpty(storedStats)) {
            const seeded = buildStatsFromHistory();
            if (seeded.totalWatchSeconds > 0) {
                await ytStorage.setStats(seeded);
                storedStats = seeded;
            }
        }
    } catch (_) {}
    const stats = calculateAnalytics(allHistoryRecords);

    document.getElementById('totalWatchTime').textContent = stats.totalWatchTime;
    document.getElementById('videosWatched').textContent = stats.videosWatched;
    document.getElementById('shortsWatched').textContent = stats.shortsWatched;
    document.getElementById('avgDuration').textContent = stats.avgDuration;
    document.getElementById('completionRate').textContent = `${stats.completionRate}%`;
    document.getElementById('playlistsSaved').textContent = stats.playlistsSaved;

    // Update all charts
    updateActivityChart();
    updateWatchTimeByHourChart();
    renderUnfinishedVideos();
    renderTopChannels();
    renderSkippedChannels();
    renderCompletionBarChart();
}


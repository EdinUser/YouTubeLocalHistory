// Shared popup formatting and URL helpers.
(function () {
    'use strict';

    function cleanVideoUrl(url) {
        if (!url) return url;

        let absoluteUrl = url;
        if (url.startsWith('/')) {
            absoluteUrl = 'https://www.youtube.com' + url;
        } else if (!url.startsWith('http://') && !url.startsWith('https://')) {
            if (url.includes('youtube.com') || url.includes('youtu.be')) {
                absoluteUrl = 'https://' + url.replace(/^https?:\/\//, '');
            } else {
                return url;
            }
        }

        try {
            const urlObj = new URL(absoluteUrl);
            const videoId = urlObj.searchParams.get('v') ||
                (urlObj.pathname.includes('/shorts/') ? urlObj.pathname.split('/shorts/')[1]?.split('/')[0] : null);
            if (!videoId) return url;
            return urlObj.pathname.includes('/shorts/')
                ? `https://www.youtube.com/shorts/${videoId}`
                : `https://www.youtube.com/watch?v=${videoId}`;
        } catch (_) {
            const videoIdMatch = absoluteUrl.match(/[?&]v=([^&]+)/) || absoluteUrl.match(/\/shorts\/([^\/\?]+)/);
            if (videoIdMatch) {
                const videoId = videoIdMatch[1];
                return absoluteUrl.includes('/shorts/')
                    ? `https://www.youtube.com/shorts/${videoId}`
                    : `https://www.youtube.com/watch?v=${videoId}`;
            }
            return url;
        }
    }

    function addTimestampToUrl(url, timeSeconds) {
        if (!url || !timeSeconds || timeSeconds <= 0) return url;
        try {
            const cleanUrl = cleanVideoUrl(url);
            const urlToUse = cleanUrl || url;
            try {
                const urlObj = new URL(urlToUse);
                urlObj.searchParams.set('t', Math.floor(timeSeconds) + 's');
                return urlObj.toString();
            } catch (_) {
                if (urlToUse.includes('watch?v=') || urlToUse.includes('/shorts/')) {
                    const separator = urlToUse.includes('?') ? '&' : '?';
                    return `${urlToUse}${separator}t=${Math.floor(timeSeconds)}s`;
                }
                return urlToUse;
            }
        } catch (error) {
            console.warn('[Popup] Failed to add timestamp to URL:', error, url);
            return url;
        }
    }

    function formatDuration(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        return `${m}:${String(s).padStart(2, '0')}`;
    }

    function formatDate(timestamp) {
        if (!timestamp) return chrome.i18n.getMessage('date_unknown');
        const date = new Date(timestamp);
        const now = new Date();
        const isToday = date.toDateString() === now.toDateString();
        const timeStr = date.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
        if (isToday) return chrome.i18n.getMessage('date_today') + ' ' + timeStr;
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        if (date.toDateString() === yesterday.toDateString()) {
            return chrome.i18n.getMessage('date_yesterday') + ' ' + timeStr;
        }
        return date.toLocaleDateString('en-US', {
            month: '2-digit',
            day: '2-digit',
            year: 'numeric'
        }) + ' ' + timeStr;
    }

    function calculateProgress(time, duration) {
        if (!time || !duration || isNaN(time) || isNaN(duration) || duration <= 0) return 0;
        time = Math.max(0, Math.min(time, duration));
        return Math.min(100, Math.max(0, Math.round((time / duration) * 100)));
    }

    function formatProgress(time, duration) {
        const timeStr = formatDuration(time);
        if (!duration || duration <= 0) return timeStr;
        return `${timeStr} (${calculateProgress(time, duration)}%)`;
    }

    function sanitizeText(text) {
        if (!text) return '';
        return String(text)
            .replace(/\u00e2\u20ac\" |\u00e2\u20ac\" |\u00e2\u20ac\" |\u00e2\u20ac\\x9c|\u00e2\u20ac\\x9d/g, 'â€“')
            .replace(/\u00e2\u20ac\u2122/g, "'")
            .replace(/\u00e2\u20ac\u0153|\u00e2\u20ac\u009d/g, '"')
            .replace(/\u00e2\u20ac\u00a6/g, '...')
            .replace(/\u00e2\u20ac\u00a2/g, '-')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function formatWatchTime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        return h > 0 ? `${h}h ${m}m` : `${m}m`;
    }

    Object.assign(globalThis, {
        cleanVideoUrl,
        addTimestampToUrl,
        formatDuration,
        formatDate,
        calculateProgress,
        formatProgress,
        sanitizeText,
        formatWatchTime
    });
})();

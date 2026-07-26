(function() {
    'use strict';

    function createContentUrlHelpers(dependencies) {
        const log = dependencies.log;
        const getStorage = dependencies.getStorage;

        function getVideoId() {
            const url = window.location.href;

            const urlParams = new URLSearchParams(window.location.search);
            const videoId = urlParams.get('v');
            if (videoId) return videoId;

            const patterns = [
                /(?:youtube\.com\/watch\/([^\/\?]+))/i,
                /(?:youtube\.com\/embed\/([^\/\?]+))/i,
                /(?:youtube\.com\/v\/([^\/\?]+))/i,
                /(?:youtu\.be\/([^\/\?]+))/i,
                /(?:youtube\.com\/shorts\/([^\/\?]+))/i
            ];

            for (const pattern of patterns) {
                const match = url.match(pattern);
                if (match && match[1]) {
                    return match[1];
                }
            }

            const pathSegments = window.location.pathname.split('/').filter(Boolean);
            if (pathSegments.length > 0) {
                const lastSegment = pathSegments[pathSegments.length - 1];
                if (/^[a-zA-Z0-9_-]{11}$/.test(lastSegment)) {
                    return lastSegment;
                }
            }

            log('Could not extract video ID from URL:', url);
            return null;
        }

        function getCleanVideoUrl() {
            const videoId = getVideoId();
            if (!videoId) return null;
            return `https://www.youtube.com/watch?v=${videoId}`;
        }

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

                if (urlObj.pathname.includes('/shorts/')) {
                    return `https://www.youtube.com/shorts/${videoId}`;
                }
                return `https://www.youtube.com/watch?v=${videoId}`;
            } catch (e) {
                const videoIdMatch = absoluteUrl.match(/[?&]v=([^&]+)/) || absoluteUrl.match(/\/shorts\/([^\/\?]+)/);
                if (videoIdMatch) {
                    const videoId = videoIdMatch[1];
                    if (absoluteUrl.includes('/shorts/')) {
                        return `https://www.youtube.com/shorts/${videoId}`;
                    }
                    return `https://www.youtube.com/watch?v=${videoId}`;
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
                } catch (e) {
                    if (urlToUse.includes('watch?v=') || urlToUse.includes('/shorts/')) {
                        const separator = urlToUse.includes('?') ? '&' : '?';
                        return `${urlToUse}${separator}t=${Math.floor(timeSeconds)}s`;
                    }
                    return urlToUse;
                }
            } catch (error) {
                log(`[Content] Failed to add timestamp to URL: ${error} (${url})`);
                return url;
            }
        }

        async function addTimestampToLink(anchor) {
            const href = anchor.getAttribute('href');
            if (!href) return;

            log(`[Link Intercept] Processing anchor with href: ${href}`);

            let videoId = null;
            if (href.includes('watch?v=')) {
                const match = href.match(/[?&]v=([^&]+)/);
                videoId = match ? match[1] : null;
            } else if (href.includes('/shorts/')) {
                const match = href.match(/\/shorts\/([^\/\?]+)/);
                videoId = match ? match[1] : null;
            }

            if (!videoId) {
                log(`[Link Intercept] No video ID found in href: ${href}`);
                return;
            }

            log(`[Link Intercept] Found video ID: ${videoId}`);

            try {
                const record = await getStorage().getVideo(videoId);
                log(`[Link Intercept] Retrieved record for ${videoId}:`, record);

                if (record && record.time && record.time > 0) {
                    const newUrl = addTimestampToUrl(href, record.time);
                    log(`[Link Intercept] Original URL: ${href}`);
                    log(`[Link Intercept] Modified URL: ${newUrl}`);

                    if (newUrl !== href) {
                        anchor.setAttribute('href', newUrl);
                        log(`[Link Intercept] Added timestamp ${record.time}s to video ${videoId}`);
                    } else {
                        log('[Link Intercept] URL unchanged, timestamp not added');
                    }
                } else {
                    log(`[Link Intercept] No saved progress found for video ${videoId}`);
                }
            } catch (error) {
                log(`[Link Intercept] Failed to check video ${videoId}:`, error);
            }
        }

        function interceptVideoLinkClicks() {
            document.addEventListener('click', async (e) => {
                let anchor = e.target.closest('a[href*="watch?v="], a[href*="/shorts/"]');
                if (!anchor) {
                    const overlayElement = e.target.closest('.ytvht-viewed-label, .ytvht-progress-bar');
                    if (overlayElement) {
                        anchor = overlayElement.closest('a[href*="watch?v="], a[href*="/shorts/"]');
                        log(`[Click Intercept] Click on overlay, found anchor: ${anchor ? anchor.href : 'none'}`);
                    }
                }

                if (!anchor) {
                    log('[Click Intercept] No anchor found for click target:', e.target);
                    return;
                }

                log(`[Click Intercept] Found anchor for video link: ${anchor.href}`);
                await addTimestampToLink(anchor);
            }, true);
        }

        return {
            getVideoId,
            getCleanVideoUrl,
            cleanVideoUrl,
            addTimestampToUrl,
            addTimestampToLink,
            interceptVideoLinkClicks
        };
    }

    window.YTVHTContentUrls = {
        create: createContentUrlHelpers
    };
})();

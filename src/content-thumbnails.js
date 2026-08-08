(function() {
    'use strict';

    function createContentThumbnailHelpers(dependencies) {
        const log = dependencies.log;
        const getStorage = dependencies.getStorage;
        const getCurrentSettings = dependencies.getCurrentSettings;
        const updateOverlayCSS = dependencies.updateOverlayCSS;
        const overlayColors = dependencies.overlayColors;
        const overlayLabelSizeMap = dependencies.overlayLabelSizeMap;
        const getAccentOverlayColor = dependencies.getAccentOverlayColor;
        const pendingOperations = dependencies.pendingOperations;

        function extractVideoIdFromText(value) {
            const text = String(value || '');
            if (!text) return null;
            const watchMatch = text.match(/[?&]v=([^&/#]+)/);
            if (watchMatch) return watchMatch[1];
            const shortsMatch = text.match(/\/shorts\/([^/?#]+)/);
            if (shortsMatch) return shortsMatch[1];
            const imageMatch = text.match(/\/vi(?:_webp)?\/([a-zA-Z0-9_-]{11})\//);
            if (imageMatch) return imageMatch[1];
            return null;
        }

        function getVideoIdFromUrlElement(element) {
            if (!element) return null;
            return extractVideoIdFromText(element.href) ||
                extractVideoIdFromText(element.getAttribute?.('href')) ||
                extractVideoIdFromText(element.getAttribute?.('data-url')) ||
                extractVideoIdFromText(element.getAttribute?.('aria-label')) ||
                extractVideoIdFromText(element.getAttribute?.('title'));
        }

        function getVideoIdFromThumbnail(thumbnail) {
            if (thumbnail.tagName === 'YTD-PLAYLIST-PANEL-VIDEO-RENDERER' || thumbnail.closest('ytd-playlist-panel-video-renderer')) {
                const videoLink = thumbnail.querySelector('a#wc-endpoint[href*="watch?v="]');
                if (videoLink) {
                    return getVideoIdFromUrlElement(videoLink);
                }

                const thumbnailLink = thumbnail.querySelector('a#thumbnail[href*="watch?v="]');
                if (thumbnailLink) {
                    return getVideoIdFromUrlElement(thumbnailLink);
                }
            }

            if (thumbnail.tagName === 'YTD-PLAYLIST-VIDEO-RENDERER' || thumbnail.closest('ytd-playlist-video-renderer')) {
                const videoId = thumbnail.getAttribute('data-video-id') || thumbnail.getAttribute('video-id');
                if (videoId) return videoId;

                const playlistLink = thumbnail.querySelector('a#video-title[href*="watch?v="], a#thumbnail[href*="watch?v="]');
                if (playlistLink) {
                    return getVideoIdFromUrlElement(playlistLink);
                }
            }

            if (thumbnail.tagName === 'YTD-COMPACT-VIDEO-RENDERER' || thumbnail.closest('ytd-compact-video-renderer')) {
                const videoId = thumbnail.getAttribute('video-id');
                if (videoId) return videoId;

                const compactLink = thumbnail.querySelector('a#thumbnail[href*="watch?v="]');
                if (compactLink) {
                    return getVideoIdFromUrlElement(compactLink);
                }
            }

            if (thumbnail.tagName === 'YT-LOCKUP-VIEW-MODEL' || thumbnail.closest('yt-lockup-view-model')) {
                const lockupLink = thumbnail.querySelector('a[href*="watch?v="]');
                if (lockupLink) {
                    return getVideoIdFromUrlElement(lockupLink);
                }
            }

            let anchor = thumbnail.querySelector('a#thumbnail[href*="watch?v="], a#video-title[href*="watch?v="]');
            if (anchor) {
                return getVideoIdFromUrlElement(anchor);
            }

            anchor = thumbnail.querySelector('a[href*="/watch?v="]');
            if (anchor) {
                return getVideoIdFromUrlElement(anchor);
            }

            const dataVideoId = thumbnail.getAttribute('data-video-id') ||
                                thumbnail.getAttribute('data-context-item-id') ||
                                thumbnail.getAttribute('data-content-id');
            if (dataVideoId && /^[a-zA-Z0-9_-]{11}$/.test(dataVideoId)) {
                return dataVideoId;
            }

            if (thumbnail.tagName === 'A' && (thumbnail.id === 'thumbnail' || thumbnail.id === 'video-title')) {
                const videoId = getVideoIdFromUrlElement(thumbnail);
                if (videoId) return videoId;
            }

            anchor = thumbnail.querySelector('a[href*="/shorts/"]');
            if (anchor) {
                return getVideoIdFromUrlElement(anchor);
            }

            const images = thumbnail.querySelectorAll?.('img') || [];
            for (const image of images) {
                const videoId = extractVideoIdFromText(image.currentSrc) ||
                    extractVideoIdFromText(image.src) ||
                    extractVideoIdFromText(image.srcset) ||
                    extractVideoIdFromText(image.getAttribute('src')) ||
                    extractVideoIdFromText(image.getAttribute('srcset'));
                if (videoId) return videoId;
            }

            return null;
        }

        function removeYtvhtOverlayNodes(targetElement) {
            targetElement?.querySelectorAll('.ytvht-viewed-label, .ytvht-progress-mask, .ytvht-progress-bar, .ytvht-native-progress-line, .ytvht-remove-button')
                .forEach((node) => node.remove());
        }

        function removeYtvhtOverlay(targetElement) {
            removeYtvhtOverlayNodes(targetElement);
            clearNativePseudoOverlay(targetElement);
        }

        function clearNativePseudoOverlay(element) {
            if (!element) return;
            element.classList?.remove('ytvht-native-overlay-target');
            element.classList?.remove('ytvht-native-page-overlay');
            element.classList?.remove('ytvht-native-overlay-no-progress');
            if (element.dataset?.ytvhtLabel) delete element.dataset.ytvhtLabel;
            if (element.style) {
                element.style.removeProperty('--ytvht-overlay-color');
                element.style.removeProperty('--ytvht-label-font-size');
                element.style.removeProperty('--ytvht-label-padding');
                element.style.removeProperty('--ytvht-progress-height');
                element.style.removeProperty('--ytvht-progress-width');
            }
        }

        function applyNativePseudoOverlay(targetElement, settings, size, color, progressPercent, showProgress = true) {
            removeYtvhtOverlay(targetElement);
            targetElement.classList.add('ytvht-native-overlay-target');
            targetElement.classList.toggle('ytvht-native-overlay-no-progress', !showProgress);
            targetElement.dataset.ytvhtLabel = settings.overlayTitle || 'Viewed';
            targetElement.style.setProperty('--ytvht-overlay-color', color);
            targetElement.style.setProperty('--ytvht-label-font-size', `${size.fontSize}px`);
            targetElement.style.setProperty('--ytvht-label-padding', `${size.fontSize / 2}px 4px`);
            targetElement.style.setProperty('--ytvht-progress-height', `${size.bar}px`);
            targetElement.style.setProperty('--ytvht-progress-width', `${progressPercent}%`);
        }

        function removeDuplicateOverlays(targetElement, selectors) {
            selectors.forEach((selector) => {
                targetElement.querySelectorAll(selector).forEach((node, index) => {
                    if (index > 0) node.remove();
                });
            });
        }

        function removeStaleThumbnailOverlays(thumbnailElement, targetElement) {
            thumbnailElement.querySelectorAll('.ytvht-viewed-label, .ytvht-progress-mask, .ytvht-progress-bar, .ytvht-remove-button')
                .forEach((node) => {
                    if (!targetElement.contains(node)) node.remove();
                });
        }

        function clearNativeYouTubeOverlayState(thumbnailElement) {
            thumbnailElement.querySelectorAll('.ytvht-viewed-label, .ytvht-progress-mask, .ytvht-progress-bar, .ytvht-remove-button')
                .forEach((node) => node.remove());
            thumbnailElement.querySelectorAll('.ytvht-has-overlay')
                .forEach((node) => {
                    node.classList.remove('ytvht-has-overlay');
                    if (node.dataset?.ytvhtVideoId) delete node.dataset.ytvhtVideoId;
                });
            thumbnailElement.classList?.remove('ytvht-has-overlay');
            if (thumbnailElement.dataset?.ytvhtVideoId) delete thumbnailElement.dataset.ytvhtVideoId;
        }

        function clearAllNativeYouTubeOverlayState() {
            document.querySelectorAll('.ytvht-viewed-label, .ytvht-progress-mask, .ytvht-progress-bar, .ytvht-remove-button')
                .forEach((node) => node.remove());
            document.querySelectorAll('.ytvht-has-overlay, [data-ytvht-video-id]')
                .forEach((node) => {
                    node.classList.remove('ytvht-has-overlay');
                    if (node.dataset?.ytvhtVideoId) delete node.dataset.ytvhtVideoId;
                });
        }

        function clearNativeOverlayTree(root) {
            if (!root) return;
            const nodes = [root];
            if (typeof root.querySelectorAll === 'function') {
                nodes.push(...root.querySelectorAll('.ytvht-has-overlay, .ytvht-native-page-overlay, .ytvht-native-overlay-target, [data-ytvht-video-id], [data-ytvht-label]'));
            }

            nodes.forEach((node) => {
                removeYtvhtOverlayNodes(node);
                clearNativePseudoOverlay(node);
                node.classList?.remove('ytvht-has-overlay', 'ytvht-native-page-overlay');
                if (node.dataset?.ytvhtVideoId) delete node.dataset.ytvhtVideoId;
            });
        }

        function isExtensionFeedPage() {
            return !!document.getElementById('ytvht-home-feed');
        }

        function isBlockedNativeOverlaySurface(element) {
            if (!element || isExtensionFeedPage()) return false;
            return !!element.closest([
                'ytd-notification-renderer',
                'ytd-notification-container-renderer',
                'ytd-notification-topbar-button-renderer',
                'ytd-multi-page-menu-renderer',
                'ytd-popup-container',
                'ytd-menu-popup-renderer',
                'tp-yt-iron-dropdown',
                'iron-dropdown',
                '[role="menu"]',
                '[aria-label="Notifications"]'
            ].join(', '));
        }

        function clearBlockedNativeOverlaySurfaces(root = document) {
            if (isExtensionFeedPage()) return;
            root.querySelectorAll?.([
                'ytd-notification-renderer',
                'ytd-notification-container-renderer',
                'ytd-notification-topbar-button-renderer',
                'ytd-multi-page-menu-renderer',
                'ytd-popup-container',
                'ytd-menu-popup-renderer',
                'tp-yt-iron-dropdown',
                'iron-dropdown',
                '[role="menu"]',
                '[aria-label="Notifications"]'
            ].join(', ')).forEach((surface) => clearNativeOverlayTree(surface));
        }

        function removeNativePageProgressBars(root = document) {
            // Full thumbnail overlays (label, progress, and remove control) are
            // part of the extension's public interaction contract on YouTube.
            // Keep this hook for callers, but do not strip those controls.
        }

        function updateNativeOverlayMode() {
            const de = document.documentElement;
            const extensionFeed = isExtensionFeedPage();
            de.toggleAttribute('ytvht-extension-feed', extensionFeed);
            de.removeAttribute('ytvht-native-badge-only');
        }

        function findThumbnailOverlayTarget(thumbnailElement) {
            const image = thumbnailElement.querySelector('.ytThumbnailViewModelImage, .yt-thumbnail-view-model__image');
            return image?.parentElement ||
                   thumbnailElement.querySelector('.yt-lockup-view-model-wiz__content-image img')?.parentElement ||
                   thumbnailElement.querySelector('.yt-lockup-view-model-wiz__content-image') ||
                   thumbnailElement.querySelector('#thumbnail') ||
                   thumbnailElement.querySelector('a#thumbnail[href*="/watch?v="]') ||
                   thumbnailElement.querySelector('a[href*="/watch?v="]') ||
                   thumbnailElement.querySelector('yt-thumbnail-view-model') ||
                   thumbnailElement.querySelector('.ytThumbnailViewModelHost') ||
                   thumbnailElement.querySelector('ytd-thumbnail') ||
                   thumbnailElement.querySelector('a[href*="/watch?v="]');
        }

        function findNativeThumbnailOverlayTarget(thumbnailElement) {
            if (!thumbnailElement) return null;
            if (thumbnailElement.matches?.('ytd-thumbnail, yt-thumbnail-view-model, .ytThumbnailViewModelHost, a#thumbnail')) {
                return thumbnailElement;
            }
            return thumbnailElement.querySelector?.([
                'ytd-thumbnail',
                'yt-thumbnail-view-model',
                '.ytThumbnailViewModelHost',
                'a#thumbnail[href*="/watch?v="]',
                'a#thumbnail[href*="/shorts/"]'
            ].join(', ')) || null;
        }

        function renderNativeDomOverlay(targetElement, settings, size, color, progressPercent, showProgress = true) {
            removeYtvhtOverlay(targetElement);
            clearNativePseudoOverlay(targetElement);
            targetElement.style.position = 'relative';

            const label = document.createElement('div');
            label.className = 'ytvht-viewed-label ytvht-native-dom-label';
            label.dataset.ytvhtOverlayNode = 'true';
            label.textContent = `${Math.round(progressPercent)}%`;
            label.style.setProperty('background-color', color, 'important');
            label.style.setProperty('display', 'block', 'important');
            label.style.setProperty('font-size', `${Math.max(11, size.fontSize - 4)}px`, 'important');
            label.style.setProperty('line-height', '1.2', 'important');
            label.style.setProperty('padding', '4px 6px', 'important');
            label.style.setProperty('border-radius', '6px', 'important');
            label.style.setProperty('z-index', '2147483647', 'important');
            targetElement.appendChild(label);

            if (showProgress) {
                const progress = document.createElement('div');
                progress.className = 'ytvht-native-progress-line';
                progress.dataset.ytvhtOverlayNode = 'true';
                progress.style.setProperty('background-color', color, 'important');
                progress.style.setProperty('height', `${size.bar}px`, 'important');
                progress.style.setProperty('width', `${progressPercent}%`, 'important');
                targetElement.appendChild(progress);
            }
        }

        function addViewedLabelToThumbnail(thumbnailElement, videoId) {
            if (!thumbnailElement || !videoId) return;

            const currentSettings = getCurrentSettings();
            const isCompact = !!(thumbnailElement.tagName === 'YTD-PLAYLIST-PANEL-VIDEO-RENDERER' ||
                thumbnailElement.tagName === 'YTD-COMPACT-VIDEO-RENDERER' ||
                thumbnailElement.tagName === 'YTD-COMPACT-RADIO-RENDERER' ||
                thumbnailElement.closest('ytd-playlist-panel-video-renderer, ytd-compact-video-renderer, ytd-compact-radio-renderer'));
            const isNativeYouTubePage = !isExtensionFeedPage();
            const isLockupCard = !!(thumbnailElement.tagName === 'YT-LOCKUP-VIEW-MODEL' ||
                thumbnailElement.closest('yt-lockup-view-model'));
            updateNativeOverlayMode();

            if (isNativeYouTubePage && isBlockedNativeOverlaySurface(thumbnailElement)) {
                clearNativeOverlayTree(thumbnailElement);
                return;
            }

            let targetElement = thumbnailElement;

            if (isLockupCard) {
                const thumbnailContainer = findThumbnailOverlayTarget(thumbnailElement);
                targetElement = thumbnailContainer || thumbnailElement;
            } else if (thumbnailElement.tagName === 'YTD-PLAYLIST-PANEL-VIDEO-RENDERER' || thumbnailElement.closest('ytd-playlist-panel-video-renderer')) {
                const thumbnailContainer = thumbnailElement.querySelector('#thumbnail-container ytd-thumbnail') ||
                                        thumbnailElement.querySelector('ytd-thumbnail') ||
                                        thumbnailElement.querySelector('#thumbnail-container');
                if (thumbnailContainer) {
                    targetElement = thumbnailContainer;
                } else {
                    return;
                }
            } else if (thumbnailElement.tagName === 'YTD-PLAYLIST-VIDEO-RENDERER' || thumbnailElement.closest('ytd-playlist-video-renderer')) {
                const thumbnailContainer = thumbnailElement.querySelector('ytd-thumbnail') ||
                                        thumbnailElement.querySelector('a#thumbnail');
                if (thumbnailContainer) {
                    targetElement = thumbnailContainer;
                } else {
                    return;
                }
            } else if (thumbnailElement.tagName !== 'YTD-THUMBNAIL' && !(thumbnailElement.tagName === 'A' && thumbnailElement.id === 'thumbnail')) {
                const image = thumbnailElement.querySelector('.ytThumbnailViewModelImage, .yt-thumbnail-view-model__image');
                const inner = image?.parentElement ||
                    thumbnailElement.querySelector('.yt-lockup-view-model-wiz__content-image img')?.parentElement ||
                    thumbnailElement.querySelector('.yt-lockup-view-model-wiz__content-image, a#thumbnail, a[href*="/watch?v="], yt-thumbnail-view-model, .ytThumbnailViewModelHost, ytd-thumbnail');
                targetElement = inner || thumbnailElement;
            }

            if (isNativeYouTubePage) {
                const nativeTarget = findNativeThumbnailOverlayTarget(thumbnailElement);
                if (!nativeTarget) {
                    clearNativeOverlayTree(thumbnailElement);
                    return;
                }
                targetElement = nativeTarget;
            }

            if (isNativeYouTubePage && isBlockedNativeOverlaySurface(targetElement)) {
                clearNativeOverlayTree(targetElement);
                return;
            }

            targetElement.style.position = 'relative';
            removeStaleThumbnailOverlays(thumbnailElement, targetElement);
            if (targetElement.dataset.ytvhtVideoId && targetElement.dataset.ytvhtVideoId !== videoId) {
                removeYtvhtOverlay(targetElement);
            }
            targetElement.dataset.ytvhtVideoId = videoId;
            thumbnailElement.dataset.ytvhtVideoId = videoId;
            const overlayHosts = Array.from(new Set([
                targetElement,
                thumbnailElement,
                targetElement.closest('yt-thumbnail-view-model, .ytThumbnailViewModelHost'),
                targetElement.closest('yt-lockup-view-model, ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-rich-grid-media, ytd-video-renderer, ytd-compact-video-renderer, ytd-compact-radio-renderer, ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer'),
                targetElement.closest('a[href*="/watch"], a[href*="/shorts/"]')
            ].filter(Boolean)));
            const setOverlayHostClass = (enabled) => {
                overlayHosts.forEach((host) => {
                    host.classList.toggle('ytvht-has-overlay', enabled);
                    host.classList.toggle('ytvht-native-page-overlay', enabled && isNativeYouTubePage);
                });
            };

            let label = targetElement.querySelector('.ytvht-viewed-label');
            let progressMask = targetElement.querySelector('.ytvht-progress-mask');
            let progress = targetElement.querySelector('.ytvht-progress-bar');
            let removeBtn = targetElement.querySelector('.ytvht-remove-button');

            getStorage().getVideo(videoId).then(record => {
                if (!targetElement.isConnected || targetElement.dataset.ytvhtVideoId !== videoId) {
                    return;
                }

                if (record) {
                    removeDuplicateOverlays(targetElement, [
                        '.ytvht-viewed-label',
                        '.ytvht-progress-mask',
                        '.ytvht-progress-bar',
                        '.ytvht-remove-button'
                    ]);
                    // Several mutation-driven passes can await storage at the
                    // same time. Re-read the DOM after that await so a later
                    // pass reuses controls created by an earlier one.
                    label = targetElement.querySelector('.ytvht-viewed-label');
                    progressMask = targetElement.querySelector('.ytvht-progress-mask');
                    progress = targetElement.querySelector('.ytvht-progress-bar');
                    removeBtn = targetElement.querySelector('.ytvht-remove-button');
                    setOverlayHostClass(true);
                    const settings = getCurrentSettings();
                    const size = overlayLabelSizeMap[settings.overlayLabelSize] || overlayLabelSizeMap.medium;
                    const color = getAccentOverlayColor
                        ? getAccentOverlayColor(settings)
                        : (overlayColors[settings.accentColor] || overlayColors[settings.overlayColor] || overlayColors.blue);

                    updateOverlayCSS(size, color);

                    const duration = Number(record.duration || 0);
                    const time = Number(record.time || 0);
                    const progressPercent = duration > 0
                        ? Math.max(0, Math.min(100, (time / duration) * 100))
                        : 100;

                    if (!label) {
                        label = document.createElement('div');
                        label.className = 'ytvht-viewed-label';
                        label.dataset.ytvhtOverlayNode = 'true';
                        targetElement.appendChild(label);
                    }
                    label.classList.toggle('ytvht-compact', isCompact);

                    if (label.textContent !== settings.overlayTitle) {
                        label.textContent = settings.overlayTitle;
                    }

                    if (!progressMask) {
                        progressMask = document.createElement('div');
                        progressMask.className = 'ytvht-progress-mask';
                        progressMask.dataset.ytvhtOverlayNode = 'true';
                        targetElement.appendChild(progressMask);
                    }
                    progressMask.classList.toggle('ytvht-compact', isCompact);

                    if (!progress) {
                        progress = document.createElement('div');
                        progress.className = 'ytvht-progress-bar';
                        progress.dataset.ytvhtOverlayNode = 'true';
                        targetElement.appendChild(progress);
                    }
                    progress.classList.toggle('ytvht-compact', isCompact);

                    const newWidth = `${progressPercent}%`;
                    if (progress.style.width !== newWidth) {
                        progress.style.width = newWidth;
                    }

                    if (!removeBtn) {
                        removeBtn = document.createElement('button');
                        removeBtn.className = 'ytvht-remove-button';
                        removeBtn.dataset.ytvhtOverlayNode = 'true';
                        removeBtn.setAttribute('type', 'button');
                        removeBtn.setAttribute('title', 'Remove from YT re:Watch history');
                        removeBtn.textContent = '×';
                        removeBtn.addEventListener('click', (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            getStorage().removeVideo(videoId).then(() => {
                                label?.remove();
                                progress?.remove();
                                removeBtn?.remove();
                            }).catch(() => {
                                // no-op: silent fail
                            });
                        }, { once: false });
                        targetElement.appendChild(removeBtn);
                    }
                } else {
                    setOverlayHostClass(false);
                    removeYtvhtOverlay(targetElement);
                    delete targetElement.dataset.ytvhtVideoId;
                    delete thumbnailElement.dataset.ytvhtVideoId;
                }
            }).catch(error => {
                log('[Error] Failed to process thumbnail', { videoId, error });
                setOverlayHostClass(false);
                removeYtvhtOverlay(targetElement);
                delete targetElement.dataset.ytvhtVideoId;
                delete thumbnailElement.dataset.ytvhtVideoId;
            });
        }

        function processExistingThumbnails() {
            updateNativeOverlayMode();
            if (!isExtensionFeedPage()) {
                clearBlockedNativeOverlaySurfaces();
                document.querySelectorAll('.ytvht-native-overlay-target')
                    .forEach((element) => {
                        if (!element.closest('ytd-playlist-panel-video-renderer, ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-rich-grid-media, ytd-compact-video-renderer, ytd-compact-radio-renderer, ytd-video-renderer, yt-lockup-view-model')) {
                            clearNativeOverlayTree(element);
                        }
                    });
            }
            const selectors = [
                'ytd-playlist-panel-video-renderer',
                'ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-rich-grid-media',
                'ytd-compact-video-renderer, ytd-compact-radio-renderer',
                'ytd-video-renderer, yt-lockup-view-model'
            ];

            selectors.forEach(selector => {
                document.querySelectorAll(selector).forEach(element => processVideoElement(element));
            });
        }

        function processVideoElement(element) {
            const currentSettings = getCurrentSettings();
            if (!element || !element.isConnected) {
                if (currentSettings?.debug) log('[Overlay] Skipping invalid or disconnected element');
                return;
            }

            if (!isExtensionFeedPage() && isBlockedNativeOverlaySurface(element)) {
                clearNativeOverlayTree(element);
                return;
            }

            if (pendingOperations.has(element)) {
                const ops = pendingOperations.get(element);
                if (ops.timeout) {
                    if (currentSettings?.debug) log('[Overlay] Clearing existing timeout for element');
                    clearTimeout(ops.timeout);
                }
                if (ops.rafId) {
                    if (currentSettings?.debug) log('[Overlay] Cancelling existing animation frame for element');
                    cancelAnimationFrame(ops.rafId);
                }
                pendingOperations.delete(element);
            }

            const ops = {};

            const process = (retryCount = 0) => {
                const settings = getCurrentSettings();
                if (!element.isConnected) {
                    if (settings?.debug) log('[Overlay] Element no longer connected, aborting');
                    return;
                }

                const videoId = getVideoIdFromThumbnail(element);
                if (videoId) {
                    addViewedLabelToThumbnail(element, videoId);
                    return;
                }

                if (retryCount < 2) {
                    const delay = 100 * (retryCount + 1);
                    ops.timeout = setTimeout(() => {
                        ops.timeout = null;
                        process(retryCount + 1);
                    }, delay);
                    pendingOperations.set(element, ops);
                }
            };

            ops.rafId = requestAnimationFrame(() => {
                ops.rafId = null;
                process();
            });

            pendingOperations.set(element, ops);
        }

        const thumbnailObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes') {
                    const target = mutation.target;
                    if (!isExtensionFeedPage() && isBlockedNativeOverlaySurface(target)) {
                        clearNativeOverlayTree(target);
                        return;
                    }
                    if (target.tagName === 'IMG' && target.id === 'img') {
                        const videoElement = target.closest('ytd-playlist-panel-video-renderer, ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-rich-grid-media, ytd-compact-video-renderer, ytd-compact-radio-renderer, ytd-video-renderer, yt-lockup-view-model');
                        if (videoElement) {
                            processVideoElement(videoElement);
                        }
                    }
                    return;
                }

                const repairTarget = mutation.target?.closest?.('[data-ytvht-video-id]');
                if (repairTarget &&
                    !isBlockedNativeOverlaySurface(repairTarget) &&
                    !repairTarget.classList.contains('ytvht-native-overlay-target') &&
                    !repairTarget.querySelector('.ytvht-viewed-label')) {
                    const videoElement = repairTarget.closest('ytd-playlist-panel-video-renderer, ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-rich-grid-media, ytd-compact-video-renderer, ytd-compact-radio-renderer, ytd-video-renderer, yt-lockup-view-model');
                    if (videoElement) {
                        processVideoElement(videoElement);
                    }
                }

                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        removeNativePageProgressBars(node);
                        if (!isExtensionFeedPage()) {
                            clearBlockedNativeOverlaySurfaces(node);
                            if (isBlockedNativeOverlaySurface(node)) {
                                clearNativeOverlayTree(node);
                                return;
                            }
                        }

                        if (node.tagName && (
                            node.tagName === 'YTD-PLAYLIST-PANEL-VIDEO-RENDERER' ||
                            node.tagName === 'YTD-RICH-ITEM-RENDERER' ||
                            node.tagName === 'YTD-GRID-VIDEO-RENDERER' ||
                            node.tagName === 'YTD-RICH-GRID-MEDIA' ||
                            node.tagName === 'YTD-VIDEO-RENDERER' ||
                            node.tagName === 'YT-LOCKUP-VIEW-MODEL' ||
                            node.tagName === 'YTD-COMPACT-VIDEO-RENDERER' ||
                            node.tagName === 'YTD-COMPACT-RADIO-RENDERER'
                        )) {
                            processVideoElement(node);
                        }

                        const videoElements = node.querySelectorAll('ytd-playlist-panel-video-renderer, ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-rich-grid-media, ytd-compact-video-renderer, ytd-compact-radio-renderer, ytd-video-renderer, yt-lockup-view-model');
                        if (videoElements.length > 0) {
                            videoElements.forEach(element => processVideoElement(element));
                        }
                    }
                });
            });
        });

        function startRemovedElementCleanupObserver() {
            if (typeof MutationObserver === 'undefined' || window.ytvhtCleanupObserver) return;

            window.ytvhtCleanupObserver = new MutationObserver((mutations) => {
                if (!getCurrentSettings()?.debug) return;

                mutations.forEach((mutation) => {
                    mutation.removedNodes.forEach((node) => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            const elements = [node, ...node.querySelectorAll('*')];
                            elements.forEach(el => {
                                if (pendingOperations.has(el)) {
                                    const ops = pendingOperations.get(el);
                                    if (ops.timeout) clearTimeout(ops.timeout);
                                    if (ops.rafId) cancelAnimationFrame(ops.rafId);
                                    pendingOperations.delete(el);
                                }
                            });
                        }
                    });
                });
            });

            window.ytvhtCleanupObserver.observe(document.body, {
                childList: true,
                subtree: true
            });
        }

        return {
            thumbnailObserver,
            processExistingThumbnails,
            processVideoElement,
            startRemovedElementCleanupObserver
        };
    }

    window.YTVHTContentThumbnails = {
        create: createContentThumbnailHelpers
    };
})();

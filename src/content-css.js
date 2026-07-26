(function() {
    'use strict';

    function injectCSS() {
        document.getElementById('ytvht-styles')?.remove();
        const isExtensionFeed = !!document.getElementById('ytvht-home-feed');
        document.documentElement.toggleAttribute('ytvht-extension-feed', isExtensionFeed);
        document.documentElement.removeAttribute('ytvht-native-badge-only');

        const style = document.createElement('style');
        style.id = 'ytvht-styles';
        style.textContent = `
            .ytvht-viewed-label {
                position: absolute !important;
                top: 0 !important;
                left: 0 !important;
                padding: 8px 4px !important;
                background-color: #4285f4 !important;
                color: #fff !important;
                font-size: 16px !important;
                font-weight: bold !important;
                z-index: 9999 !important;
                border-radius: 0 0 4px 0 !important;
                pointer-events: none !important;
            }
            .ytvht-progress-bar {
                position: absolute !important;
                bottom: 0 !important;
                left: 0 !important;
                height: 4px !important;
                background-color: #4285f4 !important;
                z-index: 2147483647 !important;
                pointer-events: none !important;
            }
            .ytvht-progress-mask {
                position: absolute !important;
                bottom: 0 !important;
                left: 0 !important;
                width: 100% !important;
                height: 6px !important;
                background: rgba(0, 0, 0, 0.72) !important;
                z-index: 2147483646 !important;
                pointer-events: none !important;
            }
            /* Compact overlay for small extension-feed thumbnails.
               Two-class selectors keep higher specificity than the dynamic
               single-class rules in updateOverlayCSS, so size stays small here. */
            .ytvht-viewed-label.ytvht-compact {
                padding: 2px 4px !important;
                font-size: 10px !important;
                border-radius: 0 0 3px 0 !important;
            }
            .ytvht-progress-bar.ytvht-compact {
                height: 3px !important;
            }
            .ytvht-progress-mask.ytvht-compact {
                height: 5px !important;
            }
            .ytvht-native-overlay-target {
                position: relative !important;
            }
            .ytvht-native-overlay-target::before {
                content: attr(data-ytvht-label) !important;
                position: absolute !important;
                top: 0 !important;
                left: 0 !important;
                padding: var(--ytvht-label-padding, 8px 4px) !important;
                background-color: var(--ytvht-overlay-color, #4285f4) !important;
                color: #fff !important;
                font-size: var(--ytvht-label-font-size, 16px) !important;
                font-weight: bold !important;
                z-index: 2147483647 !important;
                border-radius: 0 0 4px 0 !important;
                pointer-events: none !important;
            }
            .ytvht-native-overlay-target::after {
                content: "" !important;
                position: absolute !important;
                bottom: 0 !important;
                left: 0 !important;
                width: var(--ytvht-progress-width, 100%) !important;
                height: var(--ytvht-progress-height, 4px) !important;
                background-color: var(--ytvht-overlay-color, #4285f4) !important;
                z-index: 2147483647 !important;
                pointer-events: none !important;
            }
            .ytvht-native-overlay-target.ytvht-native-overlay-no-progress::after {
                content: none !important;
                display: none !important;
            }
            .ytvht-native-progress-line {
                position: absolute !important;
                bottom: 0 !important;
                left: 0 !important;
                height: 4px !important;
                background-color: #4285f4 !important;
                z-index: 2147483647 !important;
                pointer-events: none !important;
            }
            ytd-notification-renderer .ytvht-viewed-label,
            ytd-notification-renderer .ytvht-progress-mask,
            ytd-notification-renderer .ytvht-progress-bar,
            ytd-notification-renderer .ytvht-native-progress-line,
            ytd-notification-renderer .ytvht-native-overlay-target::before,
            ytd-notification-renderer .ytvht-native-overlay-target::after,
            ytd-multi-page-menu-renderer .ytvht-viewed-label,
            ytd-multi-page-menu-renderer .ytvht-progress-mask,
            ytd-multi-page-menu-renderer .ytvht-progress-bar,
            ytd-multi-page-menu-renderer .ytvht-native-progress-line,
            ytd-multi-page-menu-renderer .ytvht-native-overlay-target::before,
            ytd-multi-page-menu-renderer .ytvht-native-overlay-target::after,
            ytd-popup-container .ytvht-viewed-label,
            ytd-popup-container .ytvht-progress-mask,
            ytd-popup-container .ytvht-progress-bar,
            ytd-popup-container .ytvht-native-progress-line,
            ytd-popup-container .ytvht-native-overlay-target::before,
            ytd-popup-container .ytvht-native-overlay-target::after {
                content: none !important;
                display: none !important;
            }
            html[ytvht-native-badge-only]:not([ytvht-extension-feed]) ytd-thumbnail-overlay-resume-playback-renderer,
            html[ytvht-native-badge-only]:not([ytvht-extension-feed]) yt-thumbnail-overlay-resume-playback-renderer,
            html[ytvht-native-badge-only]:not([ytvht-extension-feed]) yt-thumbnail-overlay-progress-bar-view-model,
            html[ytvht-native-badge-only]:not([ytvht-extension-feed]) yt-thumbnail-overlay-progress-view-model,
            html[ytvht-native-badge-only]:not([ytvht-extension-feed]) .ytThumbnailOverlayProgressBarHost,
            html[ytvht-native-badge-only]:not([ytvht-extension-feed]) .ytThumbnailOverlayProgressBarProgress,
            html[ytvht-native-badge-only]:not([ytvht-extension-feed]) [class*="ThumbnailOverlayProgress"],
            html[ytvht-native-badge-only]:not([ytvht-extension-feed]) [class*="thumbnailOverlayProgress"],
            html[ytvht-native-badge-only]:not([ytvht-extension-feed]) #progress:not(.ytp-progress-bar):not(.ytp-play-progress):not(.ytp-load-progress),
            html[ytvht-native-badge-only]:not([ytvht-extension-feed]) tp-yt-paper-progress,
            html[ytvht-native-badge-only]:not([ytvht-extension-feed]) yt-progress-bar {
                display: none !important;
            }
            .ytvht-has-overlay ytd-thumbnail-overlay-resume-playback-renderer,
            .ytvht-has-overlay yt-thumbnail-overlay-resume-playback-renderer,
            .ytvht-has-overlay yt-thumbnail-overlay-progress-bar-view-model,
            .ytvht-has-overlay yt-thumbnail-overlay-progress-view-model,
            .ytvht-has-overlay .ytThumbnailOverlayProgressBarHost,
            .ytvht-has-overlay .ytThumbnailOverlayProgressBarProgress,
            .ytvht-has-overlay [class*="ThumbnailOverlayProgress"],
            .ytvht-has-overlay [class*="thumbnailOverlayProgress"],
            .ytvht-has-overlay #progress:not(.ytvht-progress-bar),
            .ytvht-has-overlay tp-yt-paper-progress,
            .ytvht-has-overlay yt-progress-bar {
                display: none !important;
            }
            .ytvht-remove-button {
                position: absolute !important;
                bottom: 10px !important;
                right: 10px !important;
                width: 26px !important;
                height: 26px !important;
                line-height: 26px !important;
                text-align: center !important;
                font-size: 18px !important;
                font-weight: 700 !important;
                color: #fff !important;
                background: #4285f4 !important;
                border: none !important;
                border-radius: 50% !important;
                cursor: pointer !important;
                z-index: 10000 !important;
                pointer-events: auto !important;
                opacity: 0 !important;
                transition: opacity 0.15s ease-in-out !important;
                user-select: none !important;
            }
            ytd-thumbnail:hover .ytvht-remove-button,
            a#thumbnail:hover .ytvht-remove-button,
            ytd-playlist-video-renderer:hover .ytvht-remove-button,
            ytd-playlist-panel-video-renderer:hover .ytvht-remove-button,
            yt-lockup-view-model:hover .ytvht-remove-button,
            ytd-video-renderer:hover .ytvht-remove-button,
            ytd-rich-item-renderer:hover .ytvht-remove-button,
            ytd-grid-video-renderer:hover .ytvht-remove-button {
                opacity: 0.95 !important;
            }
            .ytvht-info {
                position: absolute !important;
                top: -120px !important;
                right: 0 !important;
                background: var(--yt-spec-brand-background-primary, #0f0f0f) !important;
                border: 1px solid var(--yt-spec-text-secondary, #aaa) !important;
                border-radius: 8px !important;
                padding: 12px !important;
                width: 300px !important;
                z-index: 9999 !important;
                color: var(--yt-spec-text-primary, #fff) !important;
                font-size: 14px !important;
                box-shadow: 0 4px 8px rgba(0,0,0,0.1) !important;
            }
            .ytvht-info-content {
                display: flex !important;
                align-items: start !important;
                gap: 12px !important;
            }
            .ytvht-info-text {
                flex-grow: 1 !important;
            }
            .ytvht-info-title {
                font-weight: 500 !important;
                margin-bottom: 8px !important;
                color: #fff !important;
            }
            .ytvht-info-description {
                color: #aaa !important;
                line-height: 1.4 !important;
            }
            .ytvht-info-highlight {
                color: #fff !important;
                background: rgba(255,255,255,0.1) !important;
                padding: 2px 6px !important;
                border-radius: 4px !important;
            }
            .ytvht-close {
                background: none !important;
                border: none !important;
                padding: 4px 8px !important;
                cursor: pointer !important;
                color: #aaa !important;
                font-size: 20px !important;
                opacity: 0.8 !important;
                transition: opacity 0.2s !important;
            }
            .ytvht-close:hover {
                opacity: 1 !important;
            }
        `;
        document.head.appendChild(style);
    }

    function updateOverlayCSS(size, color) {
        let styleElement = document.getElementById('ytvht-dynamic-styles');
        if (!styleElement) {
            styleElement = document.createElement('style');
            styleElement.id = 'ytvht-dynamic-styles';
            document.head.appendChild(styleElement);
        }

        styleElement.textContent = `
            .ytvht-viewed-label {
                padding: ${size.fontSize / 2}px 4px !important;
                background-color: ${color} !important;
                font-size: ${size.fontSize}px !important;
            }
            .ytvht-progress-bar {
                height: ${size.bar}px !important;
                background-color: ${color} !important;
            }
            .ytvht-remove-button {
                background: ${color} !important;
            }
        `;
    }

    window.YTVHTContentCss = {
        injectCSS,
        updateOverlayCSS
    };
})();

// Local Follow controls for YouTube pages.
// Feed discovery belongs exclusively to the extension-page v5 scheduler.
(function () {
    'use strict';

    function channelInfoFromPage() {
        const path = location.pathname;
        const channelMatch = path.match(/^\/channel\/(UC[\w-]+)/);
        const handleMatch = path.match(/^\/(@[\w.-]+)/);
        let channelId = channelMatch ? channelMatch[1] : null;
        if (!channelId) {
            const ownerLink = document.querySelector('ytd-video-owner-renderer a[href*="/channel/UC"], ytd-watch-metadata a[href*="/channel/UC"], yt-page-header-renderer a[href*="/channel/UC"]');
            const ownerMatch = ownerLink && ownerLink.getAttribute('href').match(/\/channel\/(UC[\w-]+)/);
            channelId = ownerMatch ? ownerMatch[1] : null;
        }
        if (!channelId) {
            const scripts = Array.from(document.querySelectorAll('script')).map((script) => script.textContent || '');
            for (const text of scripts) {
                const match = text.match(/"externalId":"(UC[\w-]+)"/);
                if (match) {
                    channelId = match[1];
                    break;
                }
            }
        }
        if (!channelId) return null;
        const title = document.querySelector('meta[property="og:title"]')?.content || document.title.replace(/\s*-\s*YouTube\s*$/i, '');
        const thumbnail = document.querySelector('meta[property="og:image"]')?.content || '';
        return { channelId, channelTitle: title || '', thumbnail, handle: handleMatch ? handleMatch[1] : '' };
    }

    async function refreshFollowButton(button, info) {
        const existing = await ytIndexedDBStorage.getSubscriptionRecord(info.channelId);
        button.textContent = existing ? 'Unfollow re:Watch' : 'Subscribe with re:Watch';
        button.classList.toggle('ytvht-sub-btn-following', Boolean(existing));
    }

    function subscriptionAnchor() {
        const native = document.querySelector(
            'ytd-watch-metadata #subscribe-button button[aria-label^="Subscribe"], ' +
            'ytd-video-owner-renderer button[aria-label^="Subscribe"], ' +
            'yt-page-header-renderer button[aria-label^="Subscribe"]'
        );
        if (!native) return null;
        return native.closest('#subscribe-button, .ytFlexibleActionsViewModelAction') || native;
    }

    async function mountFollowButton() {
        const info = channelInfoFromPage();
        if (!info || typeof ytIndexedDBStorage === 'undefined') return;
        const existingButton = document.querySelector('.ytvht-sub-btn');
        if (existingButton) {
            await refreshFollowButton(existingButton, info);
            return;
        }
        const anchor = subscriptionAnchor();
        if (!anchor || !anchor.parentNode) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ytvht-sub-btn';
        button.style.cssText = 'margin:4px 8px;padding:8px 12px;border:0;border-radius:18px;background:#3ea6ff;color:#0f0f0f;font-weight:600;cursor:pointer;';
        await refreshFollowButton(button, info);
        button.addEventListener('click', async () => {
            button.disabled = true;
            try {
                const existing = await ytIndexedDBStorage.getSubscriptionRecord(info.channelId);
                if (existing) await ytvhtLocalSubscriptionActions.unfollow(ytIndexedDBStorage, info.channelId);
                else await ytvhtLocalSubscriptionActions.follow(ytIndexedDBStorage, info);
                await refreshFollowButton(button, info);
            } finally {
                button.disabled = false;
            }
        });
        anchor.parentNode.insertBefore(button, anchor.nextSibling);
    }

    let mountTimer = null;
    const scheduleMount = () => {
        if (mountTimer) clearTimeout(mountTimer);
        mountTimer = setTimeout(() => {
            mountTimer = null;
            mountFollowButton().catch(() => {});
        }, 250);
    };
    window.addEventListener('yt-navigate-finish', scheduleMount);
    window.addEventListener('yt-page-data-updated', scheduleMount);
    if (typeof MutationObserver !== 'undefined') {
        new MutationObserver(scheduleMount).observe(document.documentElement, { childList: true, subtree: true });
    }
    scheduleMount();
})();

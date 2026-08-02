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
        button.textContent = existing ? '✓ Following locally' : '＋ Follow locally';
        button.classList.toggle('ytvht-sub-btn-following', Boolean(existing));
    }

    async function mountFollowButton() {
        const info = channelInfoFromPage();
        document.querySelectorAll('.ytvht-sub-btn').forEach((button) => button.remove());
        if (!info || typeof ytIndexedDBStorage === 'undefined') return;
        const anchor = document.querySelector('#subscribe-button, ytd-c4-tabbed-header-renderer #buttons, ytd-video-owner-renderer #subscribe-button');
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
                if (existing) {
                    await ytIndexedDBStorage.deleteSubscriptionAndSyncState(info.channelId);
                } else {
                    await ytIndexedDBStorage.putSubscriptionRecord({
                        ...info,
                        source: 'manual',
                        followedAt: Date.now()
                    });
                    await ytIndexedDBStorage.putChannelSyncState({
                        channelId: info.channelId,
                        initializationState: 'pending',
                        nextEligibleCheckAt: Date.now(),
                        scanLeaseUntil: null,
                        scanRunId: null
                    });
                }
                await refreshFollowButton(button, info);
            } finally {
                button.disabled = false;
            }
        });
        anchor.parentNode.insertBefore(button, anchor.nextSibling);
    }

    const scheduleMount = () => setTimeout(() => mountFollowButton().catch(() => {}), 500);
    window.addEventListener('yt-navigate-finish', scheduleMount);
    window.addEventListener('yt-page-data-updated', scheduleMount);
    scheduleMount();
})();

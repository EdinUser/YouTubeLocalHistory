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
        if (!channelId && !handleMatch) return null;
        const ownerTitle = document.querySelector('ytd-video-owner-renderer #channel-name, ytd-video-owner-renderer #upload-info a, yt-page-header-renderer h1')?.textContent.trim();
        // og:title is the video title on /watch, so only use it as a fallback
        // on a channel route where it really identifies the channel.
        const title = ownerTitle || (channelMatch || handleMatch
            ? (document.querySelector('meta[property="og:title"]')?.content || document.title.replace(/\s*-\s*YouTube\s*$/i, ''))
            : '');
        const thumbnail = document.querySelector('meta[property="og:image"]')?.content || '';
        return { channelId, channelTitle: title || '', thumbnail, handle: handleMatch ? handleMatch[1] : '' };
    }

    function canonicalSubscriptionStorage() {
        const call = (operation, args) => new Promise((resolve, reject) => {
            const runtime = globalThis.chrome && globalThis.chrome.runtime;
            runtime.sendMessage({ type: 'localSubscriptionStore', operation, args }, (response) => {
                if (runtime.lastError) reject(new Error(runtime.lastError.message));
                else if (!response || response.error) reject(new Error(response && response.error || 'Local subscription request failed.'));
                else resolve(response.result || null);
            });
        });
        return {
            getSubscriptionRecord: (channelId) => call('get', { channelId }),
            putSubscriptionRecord: (record) => call('putSubscription', { record }),
            putChannelSyncState: (record) => call('putSyncState', { record }),
            deleteSubscriptionAndSyncState: (channelId) => call('unfollow', { channelId })
        };
    }

    const subscriptionStorage = canonicalSubscriptionStorage();

    async function refreshFollowButton(button, info) {
        const existing = info.channelId && await subscriptionStorage.getSubscriptionRecord(info.channelId);
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
        let info = channelInfoFromPage();
        if (!info || !globalThis.chrome?.runtime?.sendMessage) return;
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
        const stopYouTubeOwnerAction = (event) => {
            event.preventDefault();
            event.stopImmediatePropagation();
        };
        ['pointerdown', 'mousedown', 'mouseup'].forEach((type) => button.addEventListener(type, stopYouTubeOwnerAction, true));
        button.addEventListener('click', async (event) => {
            stopYouTubeOwnerAction(event);
            button.disabled = true;
            try {
                if (!info.channelId) {
                    button.textContent = 'Preparing re:Watch subscription…';
                    info = { ...info, ...(await ytvhtLocalSubscriptionActions.resolveInput(info.handle, fetch)) };
                }
                const existing = await subscriptionStorage.getSubscriptionRecord(info.channelId);
                if (existing) await ytvhtLocalSubscriptionActions.unfollow(subscriptionStorage, info.channelId);
                else await ytvhtLocalSubscriptionActions.follow(subscriptionStorage, info);
                await refreshFollowButton(button, info);
            } catch (error) {
                console.error('[re:Watch] local subscription update failed', error);
                button.title = error && error.message ? error.message : 'Could not update the local subscription.';
                await refreshFollowButton(button, info).catch(() => {
                    button.textContent = 'Subscribe with re:Watch';
                });
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

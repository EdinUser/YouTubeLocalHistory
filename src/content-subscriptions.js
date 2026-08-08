// Local Follow controls for YouTube pages.
// Feed discovery belongs exclusively to the extension-page v5 scheduler.
(function () {
    'use strict';

    function channelInfoFromPage() {
        const path = location.pathname;
        const channelMatch = path.match(/^\/channel\/(UC[\w-]+)/);
        const handleMatch = path.match(/^\/(@[\w.-]+)/);
        let channelId = channelMatch ? channelMatch[1] : null;
        let handle = handleMatch ? handleMatch[1] : '';
        if (!channelId) {
            const ownerLink = document.querySelector('ytd-video-owner-renderer a[href*="/channel/UC"], ytd-watch-metadata a[href*="/channel/UC"], yt-page-header-renderer a[href*="/channel/UC"]');
            const ownerMatch = ownerLink && ownerLink.getAttribute('href').match(/\/channel\/(UC[\w-]+)/);
            channelId = ownerMatch ? ownerMatch[1] : null;
        }
        if (!handle) {
            const ownerHandleLink = document.querySelector('ytd-video-owner-renderer a[href^="/@"], ytd-watch-metadata a[href^="/@"], yt-page-header-renderer a[href^="/@"]');
            const ownerHandleMatch = ownerHandleLink && ownerHandleLink.getAttribute('href').match(/^\/(@[\w.-]+)/);
            handle = ownerHandleMatch ? ownerHandleMatch[1] : '';
        }
        if (!channelId) {
            const canonicalMeta = document.querySelector('meta[itemprop="identifier"][content^="UC"], link[itemprop="url"][href*="/channel/UC"]');
            const canonicalValue = canonicalMeta && (canonicalMeta.getAttribute('content') || canonicalMeta.getAttribute('href') || '');
            const canonicalMatch = canonicalValue.match(/(?:\/channel\/)?(UC[\w-]+)/);
            channelId = canonicalMatch ? canonicalMatch[1] : null;
        }
        // YouTube retains arbitrary old page scripts through SPA navigation.
        // Never use those scripts to infer an @handle channel's identity: a
        // stale externalId makes the button reflect and update the prior page.
        if (!channelId && !handle) {
            const scripts = Array.from(document.querySelectorAll('script')).map((script) => script.textContent || '');
            for (const text of scripts) {
                const match = text.match(/"externalId":"(UC[\w-]+)"/);
                if (match) {
                    channelId = match[1];
                    break;
                }
            }
        }
        if (!channelId && !handle) return null;
        const ownerTitle = document.querySelector('ytd-video-owner-renderer #channel-name, ytd-video-owner-renderer #upload-info a, yt-page-header-renderer h1')?.textContent.trim();
        // og:title is the video title on /watch, so only use it as a fallback
        // on a channel route where it really identifies the channel.
        const title = ownerTitle || (channelMatch || handleMatch
            ? (document.querySelector('meta[property="og:title"]')?.content || document.title.replace(/\s*-\s*YouTube\s*$/i, ''))
            : '');
        const thumbnail = document.querySelector('meta[property="og:image"]')?.content || '';
        return { channelId, channelTitle: title || '', thumbnail, handle };
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
            getSubscriptionRecord: (channelId, handle) => call('get', { channelId, handle }),
            putSubscriptionRecord: (record) => call('putSubscription', { record }),
            putChannelSyncState: (record) => call('putSyncState', { record }),
            deleteSubscriptionAndSyncState: (channelId) => call('unfollow', { channelId })
        };
    }

    const subscriptionStorage = canonicalSubscriptionStorage();

    function isWatchSurface() {
        return /^\/watch(?:\/|$)/.test(location.pathname);
    }

    function configureFollowButton(button) {
        const compact = isWatchSurface();
        button.dataset.ytvhtCompact = compact ? 'true' : 'false';
        button.classList.toggle('ytvht-sub-btn-compact', compact);
        button.style.cssText = compact
            ? 'margin:4px 8px;padding:0;border:0;border-radius:18px;background:#3ea6ff;color:#0f0f0f;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;position:relative;'
            : 'margin:4px 8px;padding:8px 12px;border:0;border-radius:18px;background:#3ea6ff;color:#0f0f0f;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px;';
    }

    function extensionAssetUrl(path) {
        const runtime = globalThis.browser?.runtime || globalThis.chrome?.runtime;
        return runtime.getURL(path);
    }

    function resolveSubscriptionInput(input) {
        return new Promise((resolve, reject) => {
            const runtime = globalThis.chrome && globalThis.chrome.runtime;
            runtime.sendMessage({ type: 'resolveLocalSubscriptionInput', input }, (response) => {
                if (runtime.lastError) reject(new Error(runtime.lastError.message));
                else if (!response || response.error) reject(new Error(response && response.error || 'Could not resolve that YouTube channel.'));
                else resolve(response.result);
            });
        });
    }

    async function refreshFollowButton(button, info) {
        const existing = (info.channelId || info.handle) && await subscriptionStorage.getSubscriptionRecord(info.channelId, info.handle);
        const label = existing ? 'Unfollow re:Watch' : 'Subscribe with re:Watch';
        button.replaceChildren();
        const icon = document.createElement('img');
        icon.className = 'ytvht-sub-btn-icon';
        icon.src = extensionAssetUrl('icon48.png');
        icon.alt = '';
        icon.width = 18;
        icon.height = 18;
        button.append(icon);
        if (button.dataset.ytvhtCompact === 'true') {
            if (existing) {
                const check = document.createElement('span');
                check.className = 'ytvht-sub-btn-check';
                check.textContent = '✓';
                check.setAttribute('aria-hidden', 'true');
                check.style.cssText = 'position:absolute;right:-3px;bottom:-3px;width:14px;height:14px;border-radius:50%;background:#0f0f0f;color:#fff;font-size:11px;line-height:14px;text-align:center;';
                button.append(check);
            }
            button.title = label;
        } else {
            button.append(document.createTextNode(label));
            button.removeAttribute('title');
        }
        button.setAttribute('aria-label', label);
        button.classList.toggle('ytvht-sub-btn-following', Boolean(existing));
        if (button.dataset.ytvhtCompact === 'true') {
            button.style.opacity = existing ? '1' : '0.7';
        }
    }

    function subscriptionAnchor() {
        // A channel page can contain watch metadata in shelves. Scope that
        // selector to actual watch routes so a card never becomes the anchor.
        const container = isWatchSurface()
            ? document.querySelector('ytd-watch-metadata #subscribe-button')
            : document.querySelector('yt-page-header-renderer #subscribe-button, ytd-c4-tabbed-header-renderer #subscribe-button');
        if (container) return container;
        // Newer channel headers can use view-model actions instead of the
        // legacy #subscribe-button wrapper. This structural fallback avoids
        // tying the extension to YouTube's localized button wording.
        return document.querySelector('yt-page-header-renderer .ytFlexibleActionsViewModelAction');
    }

    async function mountFollowButton() {
        const info = channelInfoFromPage();
        if (!info || !globalThis.chrome?.runtime?.sendMessage) return;
        const existingButton = document.querySelector('.ytvht-sub-btn');
        if (existingButton) {
            existingButton.ytvhtSubscriptionInfo = info;
            configureFollowButton(existingButton);
            await refreshFollowButton(existingButton, info);
            const anchor = subscriptionAnchor();
            if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(existingButton, anchor.nextSibling);
            return;
        }
        const anchor = subscriptionAnchor();
        if (!anchor || !anchor.parentNode) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ytvht-sub-btn';
        configureFollowButton(button);
        button.ytvhtSubscriptionInfo = info;
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
                let currentInfo = button.ytvhtSubscriptionInfo;
                if (!currentInfo.channelId) {
                    button.title = 'Preparing re:Watch subscription…';
                    currentInfo = { ...currentInfo, ...(await resolveSubscriptionInput(currentInfo.handle)) };
                    button.ytvhtSubscriptionInfo = currentInfo;
                }
                const existing = await subscriptionStorage.getSubscriptionRecord(currentInfo.channelId);
                if (existing) await ytvhtLocalSubscriptionActions.unfollow(subscriptionStorage, currentInfo.channelId);
                else await ytvhtLocalSubscriptionActions.follow(subscriptionStorage, currentInfo);
                await refreshFollowButton(button, currentInfo);
            } catch (error) {
                console.error('[re:Watch] local subscription update failed', error);
                button.title = error && error.message ? error.message : 'Could not update the local subscription.';
                await refreshFollowButton(button, button.ytvhtSubscriptionInfo).catch(() => {
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
        const subscriptionSurfaceSelector = [
            'ytd-watch-metadata',
            'yt-page-header-renderer',
            'ytd-c4-tabbed-header-renderer'
        ].join(', ');
        const affectsSubscriptionSurface = (node) => node && node.nodeType === 1 && (
            node.matches(subscriptionSurfaceSelector) || node.querySelector(subscriptionSurfaceSelector)
        );
        // Watching the complete document caused Firefox to remount this
        // control for the button's own icon DOM updates (and for unrelated
        // player animation). Only new/removed subscription surfaces matter.
        new MutationObserver((mutations) => {
            if (mutations.some((mutation) =>
                Array.from(mutation.addedNodes).some(affectsSubscriptionSurface) ||
                Array.from(mutation.removedNodes).some(affectsSubscriptionSurface)
            )) scheduleMount();
        }).observe(document.documentElement, { childList: true, subtree: true });
    }
    scheduleMount();
})();

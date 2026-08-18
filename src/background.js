let backgroundDebugEnabled = false;

function debugLog(...args) {
    if (backgroundDebugEnabled) console.log(...args);
}

function updateBackgroundDebugSetting(settings) {
    backgroundDebugEnabled = settings?.debug === true;
}

function recordTestMessage(message) {
    const metrics = globalThis.__YTVHT_TEST__?.backgroundMetrics;
    if (!metrics) return;
    metrics.messageTypes = metrics.messageTypes || {};
    metrics.storageMethods = metrics.storageMethods || {};
    metrics.messageTypes[message.type] = (metrics.messageTypes[message.type] || 0) + 1;
    if (message.type === 'ytStorageCall' && message.method) {
        metrics.storageMethods[message.method] = (metrics.storageMethods[message.method] || 0) + 1;
    }
}

// Keep informational service-worker traces behind the user-facing debug
// setting. Warnings and errors remain unconditional below.
globalThis.ytvhtDebugLog = debugLog;
chrome.storage.local.get(['settings'], (result) => {
    if (chrome.runtime.lastError) return;
    updateBackgroundDebugSetting(result?.settings);
    debugLog('YouTube Video History Tracker background script running.');
});
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) {
        updateBackgroundDebugSetting(changes.settings.newValue);
    }
});

// Load shared storage modules when this file runs as a Chrome MV3 service worker.
if (typeof importScripts === 'function') {
    try {
        importScripts('indexeddb-storage.js', 'storage.js', 'local-subscription-actions.js');
        if (typeof ytIndexedDBStorage === 'undefined') {
            console.error('[Background] ytIndexedDBStorage not available after import');
        }
        if (typeof ytStorage === 'undefined') {
            console.error('[Background] ytStorage not available after import');
        }
    } catch (e) {
        console.error('Background: Failed to import scripts:', e.message);
    }
}

// In-memory state for non-session storage environments (like Firefox)
let inMemoryState = {
    activePopupWindowId: null,
    lastVideoUpdate: null
};

// Use session storage for a more reliable state in Chrome's service worker
const stateManager = {
    async get(key) {
        if (chrome.storage.session) {
            const result = await chrome.storage.session.get(key);
            return result[key];
        }
        return inMemoryState[key];
    },
    async set(data) {
        if (chrome.storage.session) {
            return await chrome.storage.session.set(data);
        }
        inMemoryState = { ...inMemoryState, ...data };
    }
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
        recordTestMessage(message);
        debugLog('Background script received message:', message.type, 'from sender:', sender.tab ? 'content' : 'popup');

        if (message.type === 'getAnnouncements') {
            if (!isLocalSubscriptionSender(sender) || !Number.isInteger(sender.tab?.id)) {
                sendResponse({ announcements: [] });
                return;
            }
            sendResponse({ announcements: Object.values(ANNOUNCEMENTS) });
            return;
        }

        if (message.type === 'claimAnnouncement') {
            if (!isLocalSubscriptionSender(sender) || !Number.isInteger(sender.tab?.id)) {
                sendResponse({ show: false });
                return;
            }
            if (!ANNOUNCEMENTS[message.announcementId]) {
                sendResponse({ show: false });
                return;
            }
            try {
                sendResponse({ show: await claimAnnouncement(message.announcementId, sender.tab.id) });
            } catch (error) {
                console.warn('[Announcements] could not claim an announcement', error);
                sendResponse({ show: false });
            }
            return;
        }

        if (message.type === 'releaseAnnouncement' || message.type === 'runAnnouncementAction') {
            if (!isLocalSubscriptionSender(sender)) {
                sendResponse({ ok: false });
                return;
            }
            const announcement = ANNOUNCEMENTS[message.announcementId];
            if (!announcement) {
                sendResponse({ ok: false });
                return;
            }
            try {
                if (message.type === 'runAnnouncementAction') await runAnnouncementAction(announcement);
                await releaseAnnouncement(message.announcementId);
                sendResponse({ ok: true });
            } catch (error) {
                console.warn('[Announcements] could not complete an announcement', error);
                sendResponse({ ok: false });
            }
            return;
        }
        
        if (message.type === 'openPopup') {
            const popupId = await stateManager.get('activePopupWindowId');
            if (popupId) {
                try {
                    await chrome.windows.update(popupId, { focused: true });
                    return;
                } catch (e) {
                    // Window no longer exists
                }
            }

            const newWindow = await chrome.windows.create({
                url: chrome.runtime.getURL("popup.html"),
                type: "popup",
                width: 600,
                height: 500,
                top: 100,
                left: 100
            });
            await stateManager.set({ activePopupWindowId: newWindow.id });
        }

        if (message.type === 'videoUpdate') {
            await stateManager.set({ lastVideoUpdate: message.data });

            chrome.runtime.sendMessage({
                type: 'videoUpdateFromBackground',
                data: message.data
            }).catch(() => {
                // Expected when popup is closed - no need to log
            });
        }

        if (message.type === 'getLatestUpdate') {
            const lastUpdate = await stateManager.get('lastVideoUpdate');
            sendResponse({ lastUpdate: lastUpdate });
            return; // Return early because we're using sendResponse
        }

        if (message.type === 'resolveLocalSubscriptionInput') {
            if (!isLocalSubscriptionSender(sender)) {
                sendResponse({ error: 'Channel resolution must come from a YouTube tab.' });
                return;
            }
            try {
                const result = await ytvhtLocalSubscriptionActions.resolveInput(message.input, fetch);
                sendResponse({ result });
            } catch (error) {
                sendResponse({ error: error && error.message ? error.message : String(error) });
            }
            return;
        }

        // Content scripts have a YouTube-page context. Keep the canonical feed
        // repositories in the extension-origin background instead.
        if (message.type === 'localSubscriptionStore') {
            if (!isLocalSubscriptionSender(sender)) {
                sendResponse({ error: 'Local subscription requests must come from a YouTube tab.' });
                return;
            }
            if (typeof ytIndexedDBStorage === 'undefined') {
                sendResponse({ error: 'Extension database is unavailable. Reload the extension.' });
                return;
            }
            try {
                const args = message.args || {};
                let result;
                if (message.operation === 'get') {
                    result = args.channelId && await ytIndexedDBStorage.getSubscriptionRecord(args.channelId);
                    if (!result && args.handle) {
                        const handle = String(args.handle).toLowerCase();
                        const records = await ytIndexedDBStorage.listSubscriptionRecords();
                        result = records.find((record) => String(record.handle || '').toLowerCase() === handle) || null;
                        // A watch page normally exposes only @handle. Imports
                        // and early manual follows can have the canonical UC id
                        // but no handle until the Channels page hydrates it.
                        // Resolve here, in the extension origin, so the button
                        // state never depends on scrolling that page first.
                        if (!result && typeof ytvhtLocalSubscriptionActions !== 'undefined') {
                            try {
                                const resolved = await ytvhtLocalSubscriptionActions.resolveInput(args.handle, fetch);
                                result = await ytIndexedDBStorage.getSubscriptionRecord(resolved.channelId);
                                if (result && !result.handle && resolved.handle) {
                                    result = await ytIndexedDBStorage.putSubscriptionRecord({ ...result, handle: resolved.handle });
                                }
                            } catch (_) {
                                // A transient handle-resolution failure means
                                // no match for now; it must not block the page.
                            }
                        }
                    }
                }
                else if (message.operation === 'getTombstone') result = await ytIndexedDBStorage.getLocalUnsubscribeTombstone(args.channelId);
                else if (message.operation === 'putSubscription') result = await ytIndexedDBStorage.putSubscriptionRecord(args.record);
                else if (message.operation === 'putSyncState') result = await ytIndexedDBStorage.putChannelSyncState(args.record);
                else if (message.operation === 'deleteTombstone') result = await ytIndexedDBStorage.deleteLocalUnsubscribeTombstone(args.channelId);
                else if (message.operation === 'unfollow') result = await ytIndexedDBStorage.deleteSubscriptionAndSyncState(args.channelId, args.tombstone);
                else throw new Error('Unknown local subscription operation.');
                chrome.runtime.sendMessage({ type: 'localSubscriptionChanged', channelId: args.channelId || args.record?.channelId }).catch(() => {});
                sendResponse({ result });
            } catch (error) {
                sendResponse({ error: error && error.message ? error.message : String(error) });
            }
            return;
        }

        // Content scripts run IndexedDB under youtube.com, while extension
        // pages and this background context share the extension origin. Keep
        // AI-disclosure results here so local re:Watch views can safely render
        // the result already obtained while browsing YouTube.
        if (message.type === 'aiLabelCache') {
            if (!isLocalSubscriptionSender(sender)) {
                sendResponse({ error: 'AI label cache requests must come from a YouTube tab.' });
                return;
            }
            if (typeof ytIndexedDBStorage === 'undefined') {
                sendResponse({ error: 'Extension database is unavailable. Reload the extension.' });
                return;
            }
            try {
                const args = message.args || {};
                let result;
                if (message.operation === 'get') {
                    result = await ytIndexedDBStorage.getAiLabelResult(args.videoId);
                } else if (message.operation === 'put') {
                    result = await ytIndexedDBStorage.putAiLabelResult(args.record);
                    chrome.runtime.sendMessage({
                        type: 'aiLabelCacheUpdated',
                        videoId: args.record && args.record.videoId
                    }).catch(() => {});
                } else {
                    throw new Error('Unknown AI label cache operation.');
                }
                sendResponse({ result });
            } catch (error) {
                sendResponse({ error: error && error.message ? error.message : String(error) });
            }
            return;
        }

        // Handle content script storage RPC calls (ytStorageCall)
        if (message.type === 'ytStorageCall') {
            if (typeof ytStorage === 'undefined') {
                console.error('[Background] ytStorage not available');
                sendResponse({ error: 'ytStorage not available' });
                return;
            }

            const { method, args } = message;
            if (!method || typeof ytStorage[method] !== 'function') {
                console.error(`[Background] Unknown method: ${method}`);
                sendResponse({ error: `Unknown method: ${method}` });
                return;
            }

            // For importRecords, ensure IndexedDB is available
            if (method === 'importRecords') {
                if (typeof ytIndexedDBStorage === 'undefined') {
                    console.error('[Background] ytIndexedDBStorage not available for import');
                    sendResponse({ error: 'IndexedDB storage not available. Please reload the extension.' });
                    return;
                }
            }

            // Call the method on ytStorage instance
            Promise.resolve(ytStorage[method](...args))
                .then(result => {
                    sendResponse({ result: result });
                })
                .catch(error => {
                    console.error(`[Background] ytStorageCall error for ${method}:`, error);
                    const errorMessage = error && error.message ? error.message : String(error);
                    sendResponse({ error: errorMessage });
                });

            return true; // Indicates async response
        }

    })();
    return true; // Indicates async response
});

chrome.tabs?.onRemoved?.addListener((tabId) => {
    stateManager.get(ANNOUNCEMENT_OWNERS_STATE_KEY).then((owners) => {
        owners = owners || {};
        const remainingOwners = Object.fromEntries(
            Object.entries(owners).filter(([, ownerTabId]) => ownerTabId !== tabId)
        );
        if (Object.keys(remainingOwners).length !== Object.keys(owners).length) {
            return stateManager.set({ [ANNOUNCEMENT_OWNERS_STATE_KEY]: remainingOwners });
        }
    }).catch(() => {});
});

function isLocalSubscriptionSender(sender) {
    const senderUrl = sender && sender.url || '';
    // The loopback origin is injected only by the Firefox E2E build to replay
    // captured YouTube DOM. Production manifests never inject there.
    return Boolean(sender && sender.tab) && (
        /^https:\/\/(?:www\.)?youtube\.com\//.test(senderUrl) ||
        /^http:\/\/127\.0\.0\.1(?::\d+)?\//.test(senderUrl)
    );
}

// Listen for storage changes
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
        // Check if any video records were changed
        const videoChanges = Object.entries(changes).filter(([key]) => key.startsWith('video_'));
        if (videoChanges.length > 0) {
            // Broadcast changes to any open popups
            chrome.runtime.sendMessage({
                type: 'storageUpdate',
                changes: videoChanges
            }).catch(() => {
                // Expected when popup is closed - no need to log
            });
        }
    }
});

// Clean up session storage when a popup window is closed
chrome.windows.onRemoved.addListener(async (windowId) => {
    const activeId = await stateManager.get('activePopupWindowId');
    if (windowId === activeId) {
        await stateManager.set({ activePopupWindowId: null });
    }
});

// ============================================================
// Watch Later — right-click menu (no button injected into YouTube)
// ============================================================
const WATCH_LATER_MENU_ID = 'ytvht-add-watchlater';
const WATCH_LATER_PAGE_MENU_ID = 'ytvht-add-watchlater-page';
const CHANNEL_CONTEXT_PAGE_MENU_ID = 'ytvht-toggle-channel-page';
const CHANNEL_CONTEXT_LINK_MENU_ID = 'ytvht-toggle-channel-link';

function createContextMenus() {
    if (!chrome.contextMenus) return;
    // removeAll first so reloading the extension doesn't throw "duplicate id".
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
            id: WATCH_LATER_MENU_ID,
            title: 'Save to Watch Later (local)',
            contexts: ['link', 'video'],
            documentUrlPatterns: ['*://*.youtube.com/*'],
            targetUrlPatterns: ['*://*.youtube.com/watch*', '*://*.youtube.com/shorts/*', '*://youtu.be/*']
        });
        chrome.contextMenus.create({
            id: WATCH_LATER_PAGE_MENU_ID,
            title: 'Save to Watch Later (local)',
            contexts: ['page'],
            documentUrlPatterns: ['*://*.youtube.com/watch*', '*://*.youtube.com/shorts/*']
        });
        chrome.contextMenus.create({
            id: CHANNEL_CONTEXT_PAGE_MENU_ID,
            title: 'Subscribe or Unfollow with re:Watch',
            contexts: ['page'],
            documentUrlPatterns: ['*://*.youtube.com/channel/UC*', '*://*.youtube.com/@*']
        });
        chrome.contextMenus.create({
            id: CHANNEL_CONTEXT_LINK_MENU_ID,
            title: 'Subscribe or Unfollow with re:Watch',
            contexts: ['link'],
            documentUrlPatterns: ['*://*.youtube.com/*'],
            targetUrlPatterns: ['*://*.youtube.com/channel/UC*', '*://*.youtube.com/@*']
        });
    });
}

// MV3 service workers are torn down and restarted; re-create the menu on both
// install/update and browser startup so it's always present.
const ANNOUNCEMENT_OWNERS_STATE_KEY = 'announcementOwners';
let announcementClaimQueue = Promise.resolve();
const ANNOUNCEMENTS = {
    'ai-label-controls-v1': {
        id: 'ai-label-controls-v1',
        titleKey: 'ai_label_announcement_title',
        title: 'New AI-label controls',
        bodyKey: 'ai_label_announcement_body',
        body: 'Choose whether AI-labeled videos are shown, dimmed, or hidden in re:Watch.',
        actionLabelKey: 'ai_label_announcement_settings',
        actionLabel: 'See it in Settings',
        storageKey: '__rwui_notice_7',
        action: { type: 'open-extension-page', path: 'feed.html#settings' }
    }
};

async function announcementOwnerIsLive(tabId) {
    if (!Number.isInteger(tabId) || !chrome.tabs?.get) return false;
    try {
        await chrome.tabs.get(tabId);
        return true;
    } catch (_) {
        return false;
    }
}

function claimAnnouncement(announcementId, tabId) {
    const claim = announcementClaimQueue.then(() => claimAnnouncementUnlocked(announcementId, tabId));
    // Keep the queue usable after a storage/API failure while returning the
    // failure to this caller for normal message handling.
    announcementClaimQueue = claim.catch(() => {});
    return claim;
}

async function claimAnnouncementUnlocked(announcementId, tabId) {
    const owners = (await stateManager.get(ANNOUNCEMENT_OWNERS_STATE_KEY)) || {};
    const ownerTabId = owners[announcementId];
    if (ownerTabId !== tabId && await announcementOwnerIsLive(ownerTabId)) return false;
    await stateManager.set({
        [ANNOUNCEMENT_OWNERS_STATE_KEY]: { ...owners, [announcementId]: tabId }
    });
    return true;
}

async function releaseAnnouncement(announcementId) {
    const owners = (await stateManager.get(ANNOUNCEMENT_OWNERS_STATE_KEY)) || {};
    const nextOwners = { ...owners };
    delete nextOwners[announcementId];
    await stateManager.set({ [ANNOUNCEMENT_OWNERS_STATE_KEY]: nextOwners });
}

async function runAnnouncementAction(announcement) {
    if (announcement.action?.type === 'open-extension-page') {
        await chrome.tabs.create({ url: chrome.runtime.getURL(announcement.action.path) });
        return;
    }
    throw new Error(`Unsupported announcement action: ${announcement.action?.type || 'none'}`);
}

async function injectAnnouncementsIntoOpenYouTubeTabs() {
    if (!chrome.tabs?.query || !chrome.scripting?.executeScript) return;
    const tabs = await chrome.tabs.query({ url: ['https://www.youtube.com/*'] });
    await Promise.all(tabs.filter((tab) => Number.isInteger(tab.id)).map((tab) =>
        chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content-announcement.js']
        }).catch(() => {})
    ));
}

chrome.runtime.onInstalled.addListener((details) => {
    createContextMenus();
    Promise.resolve(details.reason === 'install' || details.reason === 'update')
        .then((shouldInject) => shouldInject && injectAnnouncementsIntoOpenYouTubeTabs())
        .catch((error) => console.warn('[Announcements] setup failed', error));
});
if (chrome.runtime.onStartup) chrome.runtime.onStartup.addListener(createContextMenus);

// Extract a YouTube video id (and shorts flag) from any link/page URL.
function parseYouTubeVideo(rawUrl) {
    if (!rawUrl) return null;
    try {
        const u = new URL(rawUrl);
        let videoId = u.searchParams.get('v');
        let isShorts = false;
        if (!videoId) {
            const m = u.pathname.match(/\/shorts\/([\w-]{6,})/);
            if (m) { videoId = m[1]; isShorts = true; }
        }
        if (!videoId && /(^|\.)youtu\.be$/.test(u.hostname)) {
            const seg = u.pathname.split('/').filter(Boolean)[0];
            if (seg) videoId = seg;
        }
        if (!videoId) return null;
        videoId = videoId.slice(0, 20);
        const url = isShorts
            ? `https://www.youtube.com/shorts/${videoId}`
            : `https://www.youtube.com/watch?v=${videoId}`;
        return { videoId, url, isShorts };
    } catch (_) {
        return null;
    }
}

// Injected into the page to read a video's title/channel from the DOM. Must be
// fully self-contained (it runs in the tab, not here).
function ytvhtExtractVideoMeta(videoId) {
    const txt = (el) => (el && (el.textContent || '').trim()) || '';
    const onWatch = new URLSearchParams(location.search).get('v') === videoId;
    const onShorts = location.pathname.indexOf('/shorts/' + videoId) === 0;
    if (onWatch || onShorts) {
        const h1 = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, h1.ytd-watch-metadata, yt-shorts-video-title-view-model h2 span');
        const title = txt(h1) || document.title.replace(/ - YouTube( Shorts)?$/, '').trim();
        const ch = document.querySelector('ytd-video-owner-renderer #channel-name a, #owner #channel-name a, ytd-channel-name a, #owner-name a');
        return { title, channelName: txt(ch) };
    }
    const a = document.querySelector(
        'a#thumbnail[href*="' + videoId + '"], a[href*="watch?v=' + videoId + '"], a[href*="/shorts/' + videoId + '"]'
    );
    if (a) {
        const box = a.closest('ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer, yt-lockup-view-model') || document;
        const t = box.querySelector('#video-title, a#video-title-link, yt-formatted-string#video-title, .yt-lockup-metadata-view-model-wiz__title');
        let title = txt(t) || a.getAttribute('title') || a.getAttribute('aria-label') || '';
        const ch = box.querySelector('ytd-channel-name a, #channel-name a, .yt-content-metadata-view-model-wiz__metadata-text');
        return { title: title.trim(), channelName: txt(ch) };
    }
    return { title: '', channelName: '' };
}

// The card DOM is not guaranteed to be mounted when a context-menu item is
// clicked (and YouTube changes those card layouts regularly). oEmbed gives us
// the two bits of display metadata we need without depending on that DOM.
async function ytvhtFetchWatchLaterMetadata(url) {
    if (!url) return { title: '', channelName: '' };
    try {
        const response = await fetch(
            'https://www.youtube.com/oembed?url=' + encodeURIComponent(url) + '&format=json'
        );
        if (!response.ok) return { title: '', channelName: '' };
        const data = await response.json();
        return {
            title: typeof data.title === 'string' ? data.title.trim() : '',
            channelName: typeof data.author_name === 'string' ? data.author_name.trim() : ''
        };
    } catch (_) {
        return { title: '', channelName: '' };
    }
}

// Brief icon-badge feedback so the user knows the save worked (no extra
// "notifications" permission needed).
function flashBadge(tabId, text, color) {
    if (!chrome.action || tabId == null) return;
    try {
        chrome.action.setBadgeBackgroundColor({ color: color || '#34a853', tabId });
        chrome.action.setBadgeText({ text, tabId });
        setTimeout(() => {
            try { chrome.action.setBadgeText({ text: '', tabId }); } catch (_) {}
        }, 2000);
    } catch (_) { /* ignore */ }
}

async function handleAddWatchLater(info, tab) {
    const src = info.linkUrl || info.pageUrl || (tab && tab.url) || '';
    const parsed = parseYouTubeVideo(src);
    if (!parsed) {
        flashBadge(tab && tab.id, '?', '#ea4335');
        return;
    }

    // Best-effort title/channel from the page; falls back to empty if blocked.
    let meta = { title: '', channelName: '' };
    try {
        if (tab && tab.id != null && chrome.scripting) {
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: ytvhtExtractVideoMeta,
                args: [parsed.videoId]
            });
            if (results && results[0] && results[0].result) meta = results[0].result;
        }
    } catch (_) { /* ignore — save with what we have */ }

    if (!meta.title || !meta.channelName) {
        const fallback = await ytvhtFetchWatchLaterMetadata(parsed.url);
        meta = {
            title: meta.title || fallback.title,
            channelName: meta.channelName || fallback.channelName
        };
    }

    const record = {
        videoId: parsed.videoId,
        url: parsed.url,
        isShorts: parsed.isShorts,
        title: (meta.title || '').slice(0, 300),
        channelName: (meta.channelName || '').slice(0, 200),
        addedAt: Date.now()
    };

    try {
        if (typeof ytStorage === 'undefined' || typeof ytStorage.setWatchLater !== 'function') {
            throw new Error('ytStorage.setWatchLater unavailable');
        }
        await ytStorage.setWatchLater(parsed.videoId, record);
        flashBadge(tab && tab.id, '+1', '#34a853');
    } catch (e) {
        console.error('[WatchLater] save failed:', e);
        flashBadge(tab && tab.id, 'x', '#ea4335');
    }
}

function subscriptionRepository() {
    return {
        getSubscriptionRecord: (channelId) => ytIndexedDBStorage.getSubscriptionRecord(channelId),
        getLocalUnsubscribeTombstone: (channelId) => ytIndexedDBStorage.getLocalUnsubscribeTombstone(channelId),
        putSubscriptionRecord: (record) => ytIndexedDBStorage.putSubscriptionRecord(record),
        putChannelSyncState: (record) => ytIndexedDBStorage.putChannelSyncState(record),
        deleteLocalUnsubscribeTombstone: (channelId) => ytIndexedDBStorage.deleteLocalUnsubscribeTombstone(channelId),
        deleteSubscriptionAndSyncState: (channelId, tombstone) =>
            ytIndexedDBStorage.deleteSubscriptionAndSyncState(channelId, tombstone)
    };
}

async function handleChannelContextAction(info, tab) {
    const rawInput = info.linkUrl || info.pageUrl || (tab && tab.url);
    if (!rawInput || typeof ytvhtLocalSubscriptionActions === 'undefined') {
        flashBadge(tab && tab.id, '?', '#ea4335');
        return;
    }
    try {
        const resolved = await ytvhtLocalSubscriptionActions.resolveInput(rawInput, fetch);
        const target = { channelId: resolved.channelId, handle: resolved.handle || '' };
        const repository = subscriptionRepository();
        const existing = await repository.getSubscriptionRecord(target.channelId);
        if (existing) {
            await ytvhtLocalSubscriptionActions.unfollow(repository, target.channelId);
            flashBadge(tab && tab.id, '−1', '#34a853');
        } else {
            await ytvhtLocalSubscriptionActions.follow(repository, target);
            flashBadge(tab && tab.id, '+1', '#34a853');
        }
        chrome.runtime.sendMessage({ type: 'localSubscriptionChanged', channelId: target.channelId }).catch(() => {});
    } catch (error) {
        console.error('[re:Watch] context subscription update failed', error);
        flashBadge(tab && tab.id, 'x', '#ea4335');
    }
}

if (chrome.contextMenus && chrome.contextMenus.onClicked) {
    chrome.contextMenus.onClicked.addListener((info, tab) => {
        if (info.menuItemId === WATCH_LATER_MENU_ID || info.menuItemId === WATCH_LATER_PAGE_MENU_ID) {
            handleAddWatchLater(info, tab).catch((e) => console.error('[WatchLater]', e));
            return;
        }
        if (info.menuItemId === CHANNEL_CONTEXT_PAGE_MENU_ID || info.menuItemId === CHANNEL_CONTEXT_LINK_MENU_ID) {
            handleChannelContextAction(info, tab);
        }
    });
}

console.log('YouTube Video History Tracker background script running.');

// Load shared storage modules when this file runs as a Chrome MV3 service worker.
if (typeof importScripts === 'function') {
    try {
        importScripts('indexeddb-storage.js', 'storage.js');
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

function sendContinuationThroughTab(tabId, token, config) {
    return new Promise((resolve) => {
        chrome.tabs.sendMessage(
            tabId,
            { type: 'fetchYouTubeSearchContinuationInTab', token, config },
            (response) => {
                if (chrome.runtime.lastError) {
                    resolve({ error: chrome.runtime.lastError.message });
                    return;
                }
                resolve(response || {});
            }
        );
    });
}

function sendSearchPageThroughTab(tabId, query) {
    return new Promise((resolve) => {
        chrome.tabs.sendMessage(
            tabId,
            { type: 'fetchYouTubeSearchPageInTab', query },
            (response) => {
                if (chrome.runtime.lastError) {
                    resolve({ error: chrome.runtime.lastError.message });
                    return;
                }
                resolve(response || {});
            }
        );
    });
}

async function createTemporaryYouTubeContext(url = 'https://www.youtube.com/') {
    if (chrome.windows && typeof chrome.windows.create === 'function') {
        try {
            const win = await chrome.windows.create({
                url,
                focused: false,
                type: 'popup',
                width: 120,
                height: 120,
                left: -32000,
                top: -32000
            });
            let tab = win && win.tabs && win.tabs[0];
            if (!tab && win && win.id != null) {
                const tabs = await chrome.tabs.query({ windowId: win.id });
                tab = tabs && tabs[0];
            }
            if (tab && tab.id != null) {
                return { tab, windowId: win.id || null };
            }
            if (win && win.id != null) {
                try { await chrome.windows.remove(win.id); } catch (_) {}
            }
        } catch (_) {
            // Some browsers do not allow offscreen extension-created windows.
        }
    }

    const tab = await chrome.tabs.create({
        url,
        active: false
    });
    return { tab, windowId: null };
}

async function waitForTabReady(tabId, maxWaitMs = 7000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < maxWaitMs) {
        try {
            const tab = await chrome.tabs.get(tabId);
            if (tab && tab.status === 'complete') return;
        } catch (_) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
}

async function fetchSearchPageThroughYouTubeTab(query) {
    const searchUrl = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query);
    try {
        const response = await fetch(searchUrl, { credentials: 'include' });
        if (!response.ok) throw new Error(`YouTube returned ${response.status}`);
        return { html: await response.text() };
    } catch (error) {
        // Fall through to a real youtube.com tab. Firefox can reject direct
        // extension-page requests while allowing same-origin tab requests.
    }

    const tabs = await chrome.tabs.query({ url: ['*://www.youtube.com/*'] });
    let temporaryTab = null;
    let temporaryWindowId = null;
    let lastError = 'Could not contact a YouTube tab';

    async function tryTab(tab, attempts = 16) {
        if (!tab || tab.id == null) return null;
        for (let attempt = 0; attempt < attempts; attempt++) {
            const response = await sendSearchPageThroughTab(tab.id, query);
            if (response.html) return response;
            lastError = response.error || lastError;
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
        return null;
    }

    try {
        for (const tab of tabs) {
            const response = await tryTab(tab, 8);
            if (response) return response;
        }

        const temporary = await createTemporaryYouTubeContext(searchUrl);
        temporaryTab = temporary.tab;
        temporaryWindowId = temporary.windowId;
        if (temporaryTab && temporaryTab.id != null) {
            await waitForTabReady(temporaryTab.id);
        }
        const temporaryResponse = await tryTab(temporaryTab, 28);
        if (temporaryResponse) return temporaryResponse;
        return { error: lastError };
    } finally {
        if (temporaryWindowId != null && chrome.windows && typeof chrome.windows.remove === 'function') {
            try { await chrome.windows.remove(temporaryWindowId); } catch (_) {}
        } else if (temporaryTab && temporaryTab.id != null) {
            try { await chrome.tabs.remove(temporaryTab.id); } catch (_) {}
        }
    }
}

async function fetchContinuationThroughYouTubeTab(token, config) {
    const tabs = await chrome.tabs.query({ url: ['*://www.youtube.com/*'] });
    let temporaryTab = null;
    let temporaryWindowId = null;
    let lastError = 'Could not contact a YouTube tab';

    async function tryTab(tab, attempts = 16) {
        if (!tab || tab.id == null) return null;
        for (let attempt = 0; attempt < attempts; attempt++) {
            const response = await sendContinuationThroughTab(tab.id, token, config);
            if (response.data) return response;
            lastError = response.error || lastError;
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
        return null;
    }

    try {
        for (const tab of tabs) {
            const response = await tryTab(tab, 8);
            if (response) return response;
        }

        const temporary = await createTemporaryYouTubeContext();
        temporaryTab = temporary.tab;
        temporaryWindowId = temporary.windowId;
        if (temporaryTab && temporaryTab.id != null) {
            await waitForTabReady(temporaryTab.id);
        }
        const temporaryResponse = await tryTab(temporaryTab, 28);
        if (temporaryResponse) {
            return temporaryResponse;
        }
        return { error: lastError };
    } finally {
        if (temporaryWindowId != null && chrome.windows && typeof chrome.windows.remove === 'function') {
            try { await chrome.windows.remove(temporaryWindowId); } catch (_) {}
        } else if (temporaryTab && temporaryTab.id != null) {
            try { await chrome.tabs.remove(temporaryTab.id); } catch (_) {}
        }
    }
}


chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
        console.log('Background script received message:', message.type, 'from sender:', sender.tab ? 'content' : 'popup');
        
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

        if (message.type === 'getPlaylistMetadata') {
            const playlistId = String(message.playlistId || '').trim();
            if (!playlistId) {
                sendResponse({ error: 'Missing playlist ID' });
                return;
            }
            try {
                const playlistUrl = `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`;
                const oembedUrl = 'https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(playlistUrl);
                const response = await fetch(oembedUrl, { credentials: 'omit' });
                if (!response.ok) throw new Error(`YouTube returned ${response.status}`);
                const data = await response.json();
                sendResponse({
                    title: data && data.title ? data.title : '',
                    thumbnail: data && data.thumbnail_url ? data.thumbnail_url : ''
                });
            } catch (error) {
                sendResponse({ error: error && error.message ? error.message : String(error) });
            }
            return;
        }

        if (message.type === 'fetchYouTubeSearchPage') {
            const query = String(message.query || '').trim();
            if (!query) {
                sendResponse({ error: 'Missing YouTube search query' });
                return;
            }
            try {
                sendResponse(await fetchSearchPageThroughYouTubeTab(query));
            } catch (error) {
                sendResponse({ error: error && error.message ? error.message : String(error) });
            }
            return;
        }

        if (message.type === 'fetchYouTubeSearchContinuation') {
            const token = String(message.token || '');
            const config = message.config || {};
            if (!token || !config.clientVersion) {
                sendResponse({ error: 'Missing YouTube search continuation data' });
                return;
            }
            try {
                const tabResponse = await fetchContinuationThroughYouTubeTab(token, config);
                if (tabResponse.data) {
                    sendResponse(tabResponse);
                    return;
                }

                const key = config.apiKey ? `?key=${encodeURIComponent(config.apiKey)}` : '';
                const headers = {
                    'Content-Type': 'application/json',
                    'X-YouTube-Client-Name': '1',
                    'X-YouTube-Client-Version': String(config.clientVersion)
                };
                if (config.visitorData) headers['X-Goog-Visitor-Id'] = String(config.visitorData);
                const context = {
                    client: {
                        clientName: 'WEB',
                        clientVersion: String(config.clientVersion),
                        visitorData: String(config.visitorData || ''),
                        hl: 'en',
                        gl: 'US'
                    }
                };
                if (config.clickTrackingParams) {
                    context.clickTracking = { clickTrackingParams: String(config.clickTrackingParams) };
                }
                const body = JSON.stringify({
                    context,
                    continuation: token
                });
                const endpoints = [
                    `https://www.youtube.com/youtubei/v1/search${key}`,
                    `https://youtubei.googleapis.com/youtubei/v1/search${key}`
                ];
                let lastError = null;
                for (const endpoint of endpoints) {
                    try {
                        const response = await fetch(endpoint, {
                            method: 'POST',
                            credentials: endpoint.includes('www.youtube.com') ? 'include' : 'omit',
                            headers,
                            body
                        });
                        if (!response.ok) {
                            lastError = new Error(`YouTube returned ${response.status}`);
                            continue;
                        }
                        const data = await response.json();
                        sendResponse({ data });
                        return;
                    } catch (error) {
                        lastError = error;
                    }
                }
                throw lastError || new Error('YouTube search paging failed');
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

function createContextMenus() {
    if (!chrome.contextMenus) return;
    // removeAll first so reloading the extension doesn't throw "duplicate id".
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
            id: WATCH_LATER_MENU_ID,
            title: 'Save to Watch Later (local)',
            contexts: ['link', 'page', 'video'],
            documentUrlPatterns: ['*://*.youtube.com/*'],
            targetUrlPatterns: ['*://*.youtube.com/*', '*://youtu.be/*']
        });
    });
}

// MV3 service workers are torn down and restarted; re-create the menu on both
// install/update and browser startup so it's always present.
chrome.runtime.onInstalled.addListener(createContextMenus);
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

if (chrome.contextMenus && chrome.contextMenus.onClicked) {
    chrome.contextMenus.onClicked.addListener((info, tab) => {
        if (info.menuItemId !== WATCH_LATER_MENU_ID) return;
        handleAddWatchLater(info, tab).catch((e) => console.error('[WatchLater]', e));
    });
}

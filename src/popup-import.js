// Popup import helpers for watch history and subscriptions.
(function () {
    'use strict';

    function openImportPage() {
        if (!chrome || !chrome.tabs || !chrome.tabs.query) return;

        const targetHash = '#ytlh_import';
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const activeTab = tabs && tabs[0];
            if (activeTab && activeTab.id && activeTab.url && activeTab.url.includes('://www.youtube.com/')) {
                try {
                    chrome.tabs.sendMessage(activeTab.id, { type: 'pauseVideoForImport' }, () => {});
                } catch (_) {
                    // Best-effort pause only.
                }
            }
            chrome.tabs.create({ url: `https://www.youtube.com/${targetHash}` });
        });
    }

    function setImportStatus(text, isError) {
        const el = document.getElementById('ytvhtImportStatus');
        if (el) {
            el.textContent = text || '';
            el.style.color = isError ? '#ff7070' : '';
        }
    }

    function parseWatchHistoryHtml(htmlText) {
        const doc = new DOMParser().parseFromString(htmlText, 'text/html');
        const records = [];
        const seen = new Set();
        let cells = Array.from(doc.querySelectorAll('div.content-cell'));
        if (cells.length === 0) cells = [doc.body];

        let index = 0;
        cells.forEach((cell) => {
            const videoLink = cell.querySelector('a[href*="watch?v="], a[href*="youtu.be/"]');
            if (!videoLink) return;
            const href = videoLink.getAttribute('href') || '';
            const idMatch = href.match(/[?&]v=([\w-]{11})/) || href.match(/youtu\.be\/([\w-]{11})/);
            if (!idMatch) return;
            const videoId = idMatch[1];
            if (seen.has(videoId)) return;
            seen.add(videoId);

            const chLink = cell.querySelector('a[href*="/channel/"], a[href*="youtube.com/@"]');
            let channelName = '';
            let channelId = '';
            if (chLink) {
                channelName = (chLink.textContent || '').trim();
                const chHref = chLink.getAttribute('href') || '';
                const cm = chHref.match(/\/channel\/(UC[\w-]+)/) || chHref.match(/\/(@[\w.\-]+)/);
                if (cm) channelId = cm[1];
            }

            let timestamp = 0;
            const dateMatch = (cell.textContent || '').match(
                /([A-Z][a-z]{2,8} \d{1,2}, \d{4}, [\d:]+(?:\s?[AP]M)?[^\n]*)/
            );
            if (dateMatch) {
                const parsed = Date.parse(dateMatch[1].replace(/â€¯/g, ' '));
                if (!isNaN(parsed)) timestamp = parsed;
            }
            if (!timestamp) timestamp = Date.now() - index * 60000;
            index++;

            records.push({
                videoId,
                title: (videoLink.textContent || '').trim() || 'Unknown Title',
                url: `https://www.youtube.com/watch?v=${videoId}`,
                channelName: channelName || 'Unknown Channel',
                channelId,
                time: 0,
                duration: 0,
                importedHistory: true,
                timestamp
            });
        });

        return records;
    }

    async function handleImportHistoryFile(e) {
        const file = e.target && e.target.files && e.target.files[0];
        e.target.value = '';
        if (!file) return;
        try {
            setImportStatus('Reading history fileâ€¦');
            const records = parseWatchHistoryHtml(await file.text());
            if (records.length === 0) {
                setImportStatus('No videos found in that file. Make sure it is the watch-history.html from Google Takeout.', true);
                return;
            }
            setImportStatus(`Importing ${records.length} videosâ€¦`);
            const result = await ytStorage.importRecords(records, [], true);
            setImportStatus(`Imported ${result.importedVideos} videos from watch history.`);
            if (typeof loadHistory === 'function') await loadHistory(true);
            if (typeof displayHistoryPage === 'function') displayHistoryPage();
        } catch (err) {
            console.error('Import history failed:', err);
            setImportStatus(`Import failed: ${err.message || 'Unknown error'}`, true);
        }
    }

    function parseSubscriptionsExport(text, fileName) {
        const subs = [];
        const trimmed = text.trim();
        const looksJson = (fileName && fileName.toLowerCase().endsWith('.json')) ||
            trimmed.startsWith('[') || trimmed.startsWith('{');

        if (looksJson) {
            try {
                const data = JSON.parse(trimmed);
                const arr = Array.isArray(data) ? data : (data.subscriptions || []);
                arr.forEach((item) => {
                    const snip = item.snippet || item;
                    const resource = snip.resourceId || {};
                    const ucid = resource.channelId || snip.channelId || item.channelId;
                    const title = snip.title || item.title || 'Unknown Channel';
                    if (ucid && /^UC[\w-]+$/.test(ucid)) {
                        subs.push({ ucid, title, url: `https://www.youtube.com/channel/${ucid}` });
                    }
                });
                return subs;
            } catch (_) {
                // Fall through to CSV parsing.
            }
        }

        trimmed.split(/\r?\n/).forEach((line, i) => {
            if (!line.trim()) return;
            if (i === 0 && /channel id/i.test(line)) return;
            const c1 = line.indexOf(',');
            const c2 = c1 >= 0 ? line.indexOf(',', c1 + 1) : -1;
            if (c1 < 0 || c2 < 0) return;
            const id = line.slice(0, c1).trim();
            const url = line.slice(c1 + 1, c2).trim();
            const title = line.slice(c2 + 1).trim().replace(/^"|"$/g, '');
            if (/^UC[\w-]+$/.test(id)) {
                subs.push({ ucid: id, title: title || 'Unknown Channel', url: url || `https://www.youtube.com/channel/${id}` });
            }
        });
        return subs;
    }

    async function handleImportSubsFile(e) {
        const file = e.target && e.target.files && e.target.files[0];
        e.target.value = '';
        if (!file) return;
        try {
            setImportStatus('Reading subscriptions fileâ€¦');
            const subs = parseSubscriptionsExport(await file.text(), file.name);
            if (subs.length === 0) {
                setImportStatus('No channels found. Use the subscriptions.csv from YouTube/Takeout.', true);
                return;
            }
            setImportStatus(`Importing ${subs.length} subscriptionsâ€¦`);
            let added = 0;
            for (const s of subs) {
                try {
                    await ytStorage.addSubscription({
                        id: s.ucid,
                        ucid: s.ucid,
                        channelName: s.title,
                        url: s.url
                    });
                    added++;
                } catch (_) {
                    // Skip bad rows.
                }
            }
            setImportStatus(`Imported ${added} subscriptions. Open YouTube and click Refresh to load their videos.`);
            if (typeof notifyYouTubeTabs === 'function') notifyYouTubeTabs({ type: 'ytvhtSubsChanged' });
            if (typeof displaySubscriptionsPage === 'function') displaySubscriptionsPage();
        } catch (err) {
            console.error('Import subscriptions failed:', err);
            setImportStatus(`Import failed: ${err.message || 'Unknown error'}`, true);
        }
    }

    Object.assign(globalThis, {
        openImportPage,
        setImportStatus,
        parseWatchHistoryHtml,
        handleImportHistoryFile,
        parseSubscriptionsExport,
        handleImportSubsFile
    });
})();

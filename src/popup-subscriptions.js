// Decode HTML entities (e.g. "&amp;" -> "&") that can end up stored in a
// channel name when scraped from an HTML-encoded og:title.
function decodeHtmlEntities(str) {
    if (!str || str.indexOf('&') === -1) return str || '';
    return new DOMParser().parseFromString(str, 'text/html').documentElement.textContent || '';
}

// A round letter-avatar fallback for channels without a stored thumbnail.
function buildLetterAvatar(name, size) {
    const div = document.createElement('div');
    div.textContent = (name || '?').trim().charAt(0).toUpperCase() || '?';
    div.style.cssText =
        `width:${size}px;height:${size}px;border-radius:50%;flex:0 0 auto;` +
        'background:#555;color:#fff;display:flex;align-items:center;' +
        'justify-content:center;font-size:13px;font-weight:600;';
    return div;
}

// Build a channel avatar element: the stored thumbnail, or a letter fallback
// (also used if the image fails to load).
function buildSubAvatar(sub, name) {
    const size = 28;
    if (sub.thumbnail) {
        const img = document.createElement('img');
        img.src = sub.thumbnail;
        img.width = size;
        img.height = size;
        img.referrerPolicy = 'no-referrer';
        img.style.cssText =
            `width:${size}px;height:${size}px;border-radius:50%;` +
            'object-fit:cover;flex:0 0 auto;background:#333;';
        img.addEventListener('error', () => {
            img.replaceWith(buildLetterAvatar(name, size));
        });
        return img;
    }
    return buildLetterAvatar(name, size);
}

// Switch between different tabs in the popup
// Render the list of local subscriptions in the Subs tab.
async function displaySubscriptionsPage() {
    const body = document.getElementById('ytvhtSubscriptionsBody');
    const noSubs = document.getElementById('ytvhtNoSubscriptions');
    const countEl = document.getElementById('ytvhtSubsCount');
    if (!body) return;

    let subs = [];
    try {
        subs = await ytStorage.getSubscriptionList();
    } catch (e) {
        console.error('Error loading subscriptions:', e);
    }

    body.innerHTML = '';

    if (countEl) {
        countEl.textContent = subs.length
            ? `${subs.length} channel${subs.length === 1 ? '' : 's'}`
            : '';
    }

    if (subs.length === 0) {
        if (noSubs) noSubs.style.display = 'block';
        return;
    }
    if (noSubs) noSubs.style.display = 'none';

    subs.forEach((sub) => {
        const row = document.createElement('tr');

        const nameCell = document.createElement('td');
        const link = document.createElement('a');
        link.href = sub.url || (sub.handle
            ? `https://www.youtube.com/${sub.handle}`
            : `https://www.youtube.com/channel/${sub.ucid || sub.id}`);
        link.target = '_blank';
        link.rel = 'noopener';
        link.style.textDecoration = 'none';
        link.style.color = 'inherit';
        link.style.display = 'flex';
        link.style.alignItems = 'center';
        link.style.gap = '10px';
        link.style.minWidth = '0'; // allow the flex row to shrink (no overflow)
        link.style.overflow = 'hidden';

        const name = decodeHtmlEntities(sub.channelName || sub.id);
        link.appendChild(buildSubAvatar(sub, name));

        const nameSpan = document.createElement('span');
        nameSpan.textContent = name;
        // Truncate long names so they can't push the table wider (no slider).
        nameSpan.style.overflow = 'hidden';
        nameSpan.style.textOverflow = 'ellipsis';
        nameSpan.style.whiteSpace = 'nowrap';
        nameSpan.style.minWidth = '0';
        link.appendChild(nameSpan);

        nameCell.appendChild(link);
        nameCell.style.overflow = 'hidden';
        row.appendChild(nameCell);

        // Name column takes the remaining width; the action column gets a fixed
        // width sized to the button so it sits flush at the right edge without
        // overflowing the panel (table-layout is fixed).
        nameCell.style.width = 'auto';

        const actionCell = document.createElement('td');
        actionCell.style.textAlign = 'right';
        actionCell.style.width = '104px';
        actionCell.style.whiteSpace = 'nowrap';
        actionCell.style.paddingRight = '4px';
        const removeBtn = document.createElement('button');
        removeBtn.className = 'compact-button';
        removeBtn.textContent = chrome.i18n.getMessage('subscriptions_unsubscribe') || 'Unsubscribe';
        removeBtn.addEventListener('click', async () => {
            removeBtn.disabled = true;
            try {
                await ytStorage.removeSubscription(sub.id);
                notifyYouTubeTabs({ type: 'ytvhtSubsChanged' });
                await displaySubscriptionsPage();
            } catch (e) {
                console.error('Error removing subscription:', e);
                removeBtn.disabled = false;
            }
        });
        actionCell.appendChild(removeBtn);
        row.appendChild(actionCell);

        body.appendChild(row);
    });
}

// Render the local Watch Later list (saved via the right-click menu).
async function displayWatchLaterPage() {
    const body = document.getElementById('ytvhtWatchlaterBody');
    const empty = document.getElementById('ytvhtNoWatchlater');
    const countEl = document.getElementById('ytvhtWatchlaterCount');
    if (!body) return;

    let items = {};
    try {
        items = await ytStorage.getAllWatchLater();
    } catch (e) {
        console.error('Error loading watch later:', e);
    }

    // Newest additions first.
    const list = Object.values(items || {}).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));

    body.innerHTML = '';

    if (countEl) {
        countEl.textContent = list.length
            ? `${list.length} video${list.length === 1 ? '' : 's'}`
            : '';
    }

    if (list.length === 0) {
        if (empty) empty.style.display = 'block';
        return;
    }
    if (empty) empty.style.display = 'none';

    list.forEach((item) => {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.className = 'video-cell';

        const img = document.createElement('img');
        img.className = 'video-thumbnail';
        img.alt = item.title || 'Video thumbnail';
        img.src = `https://i.ytimg.com/vi/${item.videoId}/mqdefault.jpg`;

        const content = document.createElement('div');
        content.className = 'video-content';

        const titleDiv = document.createElement('div');
        titleDiv.className = 'video-title';
        const link = document.createElement('a');
        link.className = 'video-link';
        link.target = '_blank';
        link.rel = 'noopener';
        link.href = item.url || `https://www.youtube.com/watch?v=${item.videoId}`;
        link.textContent = item.title || item.url || item.videoId;
        titleDiv.appendChild(link);

        const channelDiv = document.createElement('div');
        channelDiv.className = 'video-channel';
        channelDiv.textContent = sanitizeText(item.channelName || '');

        const details = document.createElement('div');
        details.className = 'video-details';
        const dateSpan = document.createElement('span');
        dateSpan.className = 'video-date';
        dateSpan.textContent = formatDate(item.addedAt);
        const removeBtn = document.createElement('button');
        removeBtn.className = 'delete-button';
        removeBtn.textContent = chrome.i18n.getMessage('delete_label') || 'Delete';
        removeBtn.addEventListener('click', async () => {
            removeBtn.disabled = true;
            try {
                await ytStorage.removeWatchLater(item.videoId);
                await displayWatchLaterPage();
            } catch (e) {
                console.error('Error removing watch later item:', e);
                removeBtn.disabled = false;
            }
        });
        details.appendChild(dateSpan);
        details.appendChild(removeBtn);

        content.appendChild(titleDiv);
        if (channelDiv.textContent) content.appendChild(channelDiv);
        content.appendChild(details);

        cell.appendChild(img);
        cell.appendChild(content);
        row.appendChild(cell);
        body.appendChild(row);
    });
}

// Send a message to all open YouTube tabs (content scripts handle feed work).
function notifyYouTubeTabs(message) {
    if (!chrome || !chrome.tabs || !chrome.tabs.query) return;
    chrome.tabs.query({ url: '*://*.youtube.com/*' }, (tabs) => {
        if (!tabs || tabs.length === 0) return;
        tabs.forEach((tab) => {
            try {
                chrome.tabs.sendMessage(tab.id, message, () => {
                    // Ignore errors from tabs without the content script loaded.
                    void chrome.runtime.lastError;
                });
            } catch (e) {
                // ignore
            }
        });
    });
}

// Ask an open YouTube tab to refresh the subscription feed.
function requestFeedRefresh(button) {
    if (!chrome || !chrome.tabs || !chrome.tabs.query) return;
    chrome.tabs.query({ url: '*://*.youtube.com/*' }, (tabs) => {
        if (!tabs || tabs.length === 0) {
            showMessage(chrome.i18n.getMessage('subscriptions_open_youtube')
                || 'Open a YouTube tab to refresh the feed.', 'error');
            return;
        }
        if (button) {
            button.disabled = true;
            const original = button.textContent;
            button.textContent = chrome.i18n.getMessage('subscriptions_refreshing') || 'Refreshing…';
            setTimeout(() => {
                button.disabled = false;
                button.textContent = original;
            }, 2500);
        }
        notifyYouTubeTabs({ type: 'ytvhtRefreshFeed' });
        showMessage(chrome.i18n.getMessage('subscriptions_refresh_started')
            || 'Refreshing feed in your YouTube tab…');
    });
}

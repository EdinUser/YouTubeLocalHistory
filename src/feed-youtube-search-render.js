function setYouTubeSearchLoading(ytStatus, query) {
    ytStatus.className = 'status yt-search-state loading';
    ytStatus.textContent = '';

    const loader = document.createElement('span');
    loader.className = 'yt-search-loader';
    loader.setAttribute('aria-hidden', 'true');

    const text = document.createElement('span');
    text.className = 'yt-search-state-text';

    const title = document.createElement('strong');
    title.textContent = 'Searching YouTube';

    const queryText = document.createElement('span');
    queryText.textContent = query;

    text.appendChild(title);
    text.appendChild(queryText);
    ytStatus.appendChild(loader);
    ytStatus.appendChild(text);
}

function setYouTubeSearchError(ytStatus, error) {
    ytStatus.className = 'status yt-search-error';
    ytStatus.textContent = '';

    const text = document.createElement('div');
    text.className = 'yt-search-error-text';

    const title = document.createElement('strong');
    title.textContent = 'YouTube search is unavailable';

    const help = document.createElement('span');
    help.textContent = 'Open YouTube once in this browser, accept any prompt, then try the search again.';

    const detail = document.createElement('span');
    detail.className = 'yt-search-error-detail';
    detail.textContent = error && error.message ? error.message : 'Request failed';

    const button = document.createElement('button');
    button.className = 'btn primary';
    button.type = 'button';
    button.textContent = 'Open YouTube';
    button.addEventListener('click', () => {
        window.open('https://www.youtube.com/', '_blank', 'noopener');
    });

    text.appendChild(title);
    text.appendChild(help);
    text.appendChild(detail);
    ytStatus.appendChild(text);
    ytStatus.appendChild(button);
}

function buildSearchGroupTitle(text) {
    const title = document.createElement('div');
    title.className = 'search-group-title';
    title.textContent = text;
    return title;
}

function appendGroupedSearchResults(container, results) {
    const channels = results.filter((result) => result._type === 'channel').slice(0, 3);
    const videos = results.filter((result) => result._type !== 'channel').slice(0, youtubeVisibleLimit);
    if (channels.length) {
        const group = document.createElement('div');
        group.className = 'search-channel-group';
        group.appendChild(buildSearchGroupTitle('Channels'));
        channels.forEach((channel) => group.appendChild(buildChannelCard(channel)));
        container.appendChild(group);
    }
    if (videos.length) {
        if (channels.length) container.appendChild(buildSearchGroupTitle('Videos'));
        videos.forEach((video) => container.appendChild(buildResultRow(video)));
    }
}

function renderYouTubeSearchResults(query) {
    if (channelActive) return;
    const section = document.getElementById('ytSection');
    const ytGrid = document.getElementById('ytGrid');
    const ytStatus = document.getElementById('ytStatus');
    const ytSub = document.getElementById('ytSub');
    if (!section || query.length < 2) {
        if (section) section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    ytSub.textContent = '';
    if (youtubeSearchQuery !== query) {
        ytGrid.textContent = '';
        setYouTubeSearchLoading(ytStatus, query);
        return;
    }

    const results = filteredYouTubeResults(query);
    const videoCount = results.filter((result) => result._type !== 'channel').length;
    ytStatus.className = 'status';
    ytStatus.textContent = youtubeSearchPagingError && !results.length
        ? youtubeSearchPagingError
        : (results.length ? '' : 'No YouTube results.');
    ytGrid.textContent = '';
    appendGroupedSearchResults(ytGrid, results);

    if (videoCount > youtubeVisibleLimit || youtubeSearchContinuation) {
        const sentinel = document.createElement('div');
        sentinel.className = 'search-auto-load';
        if (youtubeSearchLoadingMore) {
            const spinner = document.createElement('span');
            spinner.className = 'spinner';
            sentinel.appendChild(spinner);
            sentinel.appendChild(document.createTextNode('Loading more videos...'));
        } else {
            sentinel.textContent = youtubeSearchPagingError
                ? 'More videos unavailable right now'
                : 'Scroll for more videos';
        }
        ytGrid.appendChild(sentinel);

        if (youtubeSearchObserver) youtubeSearchObserver.disconnect();
        const hiddenNow = Math.max(0, filteredYouTubeResults(query).length - youtubeVisibleLimit);
        if (youtubeSearchPagingError || (!youtubeSearchContinuation && !hiddenNow)) return;
        youtubeSearchObserver = new IntersectionObserver((entries) => {
            if (!entries.some((entry) => entry.isIntersecting) || youtubeSearchLoadingMore) return;
            const hiddenCount = Math.max(0, filteredYouTubeResults(query).length - youtubeVisibleLimit);
            if (hiddenCount) {
                youtubeVisibleLimit += SEARCH_PAGE_SIZE;
                renderYouTubeSearchResults(query);
            } else {
                loadMoreYouTubeResults(query);
            }
        }, { rootMargin: '700px 0px' });
        youtubeSearchObserver.observe(sentinel);
    } else if (youtubeSearchObserver) {
        youtubeSearchObserver.disconnect();
    }
}

function cancelYouTubeSearch() {
    if (youtubeSearchTimer) {
        clearTimeout(youtubeSearchTimer);
        youtubeSearchTimer = null;
    }
    youtubeSearchRequestId++;
    youtubeSearchLoadingMore = false;
    youtubeSearchPagingError = '';
    if (youtubeSearchObserver) {
        youtubeSearchObserver.disconnect();
        youtubeSearchObserver = null;
    }
    const section = document.getElementById('ytSection');
    const ytGrid = document.getElementById('ytGrid');
    const ytStatus = document.getElementById('ytStatus');
    if (section) section.style.display = 'none';
    if (ytGrid) ytGrid.textContent = '';
    if (ytStatus) {
        ytStatus.className = 'status';
        ytStatus.textContent = '';
    }
}

async function loadMoreYouTubeResults(query) {
    if (youtubeSearchLoadingMore || !youtubeSearchContinuation) return;
    const requestId = youtubeSearchRequestId;
    youtubeSearchLoadingMore = true;
    youtubeSearchPagingError = '';
    renderYouTubeSearchResults(query);
    try {
        const beforeVisible = filteredYouTubeResults(query).length;
        const beforeTotal = youtubeSearchResults.length;
        let attempts = 0;
        while (youtubeSearchContinuation && attempts < 4) {
            const previousToken = youtubeSearchContinuation;
            const page = await searchYouTubeContinuation(previousToken);
            if (requestId !== youtubeSearchRequestId ||
                (document.getElementById('search').value || '').trim() !== query ||
                channelActive) return;
            appendUniqueYouTubeResults(page.results);
            youtubeSearchContinuation = page.continuation || '';
            if (youtubeSearchConfig && page.clickTrackingParams) {
                youtubeSearchConfig.clickTrackingParams = page.clickTrackingParams;
            }
            attempts++;
            if (filteredYouTubeResults(query).length > beforeVisible) break;
            if (!youtubeSearchContinuation || youtubeSearchContinuation === previousToken) {
                youtubeSearchContinuation = '';
                break;
            }
        }
        const added = youtubeSearchResults.length > beforeTotal;
        const visibleAdded = filteredYouTubeResults(query).length > beforeVisible;
        if (!visibleAdded && !added) {
            youtubeSearchPagingError = 'No more videos found.';
            youtubeSearchContinuation = '';
        }
        youtubeVisibleLimit = Math.max(
            youtubeVisibleLimit + SEARCH_PAGE_SIZE,
            filteredYouTubeResults(query).length
        );
    } catch (error) {
        console.error('[feed] loading more YouTube results failed', error);
        youtubeSearchPagingError = 'More videos unavailable right now';
        youtubeSearchContinuation = '';
    } finally {
        youtubeSearchLoadingMore = false;
        if (requestId === youtubeSearchRequestId && !channelActive) renderYouTubeSearchResults(query);
    }
}

async function prefetchYouTubeSearchPages(query, pages = 2) {
    const requestId = youtubeSearchRequestId;
    for (let page = 0; page < pages && youtubeSearchContinuation; page++) {
        if (requestId !== youtubeSearchRequestId ||
            (document.getElementById('search').value || '').trim() !== query ||
            channelActive) return;
        await loadMoreYouTubeResults(query);
        if (!youtubeSearchContinuation) break;
    }
}

function appendUniqueYouTubeResults(results) {
    const known = new Set(youtubeSearchResults.map((result) =>
        result._type === 'channel'
            ? `channel:${result.ucid || result.handle || normalizeText(result.channelName)}`
            : `video:${result.videoId}`
    ));
    (results || []).forEach((result) => {
        const key = result._type === 'channel'
            ? `channel:${result.ucid || result.handle || normalizeText(result.channelName)}`
            : `video:${result.videoId}`;
        if (key && !known.has(key)) {
            known.add(key);
            youtubeSearchResults.push(result);
        }
    });
}

function scheduleYouTubeSearch(query, immediate = false) {
    if (youtubeSearchTimer) clearTimeout(youtubeSearchTimer);
    const requestId = ++youtubeSearchRequestId;
    if (!query || query.length < 2) return;
    if (youtubeSearchQuery === query) {
        renderYouTubeSearchResults(query);
        return;
    }
    youtubeSearchTimer = setTimeout(() => {
        youtubeSearchTimer = null;
        runYouTubeSearch(query, requestId);
    }, immediate ? 0 : 500);
}

async function runYouTubeSearch(query, requestId) {
    const currentQuery = (document.getElementById('search').value || '').trim();
    query = (query || currentQuery).trim();
    const section = document.getElementById('ytSection');
    const ytGrid = document.getElementById('ytGrid');
    const ytStatus = document.getElementById('ytStatus');
    const ytSub = document.getElementById('ytSub');
    if (query !== currentQuery) return;
    if (!query) { section.style.display = 'none'; return; }
    if (requestId !== youtubeSearchRequestId || channelActive) return;

    section.style.display = 'block';
    ytSub.textContent = '';
    ytGrid.textContent = '';
    setYouTubeSearchLoading(ytStatus, query);
    try {
        const page = await searchYouTube(query);
        if (requestId !== youtubeSearchRequestId ||
            (document.getElementById('search').value || '').trim() !== query) return;
        youtubeSearchResults = page.results;
        youtubeSearchContinuation = page.continuation || '';
        youtubeSearchConfig = page.config || null;
        youtubeSearchPagingError = '';
        youtubeSearchQuery = query;
        youtubeVisibleLimit = SEARCH_PAGE_SIZE;
        if (channelActive) return;
        renderYouTubeSearchResults(query);
        // Firefox does not always fire the scroll observer reliably on an
        // extension page. Fetch two extra pages immediately, then infinite
        // scrolling continues from there.
        await prefetchYouTubeSearchPages(query, 2);
    } catch (e) {
        if (requestId !== youtubeSearchRequestId || channelActive ||
            (document.getElementById('search').value || '').trim() !== query) return;
        console.error('[feed] YouTube search failed', e);
        setYouTubeSearchError(ytStatus, e);
    }
}

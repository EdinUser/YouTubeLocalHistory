(function () {
    'use strict';

    const MODES = new Set(['off', 'badge', 'dim', 'hide']);
    // AI disclosures and valid no-disclosure answers can be kept for a long
    // time. An indeterminate answer is different: it must be retried soon so
    // a temporary YouTube response change cannot leave a video untreated.
    const TTL = { ai: 365 * 86400000, unlabeled: 180 * 86400000, unknown: 6 * 3600000 };
    const CACHE_VERSION = 2;
    const PAGE_CHANNEL = 'ytvht-ai-labels-page-v1';
    const MAX_CONCURRENT_LOOKUPS = 2;
    const LOOKUP_START_INTERVAL_MS = 1000;
    const OWN_OVERLAY_SELECTOR = [
        '.ytvht-ai-label', '.ytvht-viewed-label', '.ytvht-progress-mask',
        '.ytvht-progress-bar', '.ytvht-native-progress-line', '.ytvht-remove-button',
        '[data-ytvht-overlay-node]'
    ].join(',');
    const CARD_SELECTOR = [
        'ytd-rich-item-renderer', 'ytd-video-renderer', 'ytd-grid-video-renderer',
        'ytd-compact-video-renderer', 'ytd-playlist-video-renderer',
        'ytd-playlist-panel-video-renderer', 'yt-lockup-view-model', 'ytd-reel-item-renderer'
    ].join(',');

    function create(dependencies) {
        const log = dependencies.log || (() => {});
        const getSettings = dependencies.getSettings;
        const db = dependencies.db;
        let mode = 'off';
        let observer = null;
        let mutationObserver = null;
        const requestControllers = new Set();
        let stopped = true;
        let activeLookups = 0;
        let timer = null;
        let nextRequestAt = 0;
        let pageBridgeReady = false;
        let pageBridgePromise = null;
        let nextRequestId = 0;
        const cardsById = new Map();
        const videoIdByCard = new WeakMap();
        const resolvedStatuses = new Map();
        const queuedIds = new Set();

        function diagnostic(message, data) {
            // This is intentionally visible while the experimental option is
            // enabled. It gives users a way to distinguish a real YouTube
            // response from an unchanged card when the external contract
            // changes.
            console.info('[YTVHT AI]', message, data || '');
        }

        function videoIdFor(card) {
            const direct = card.getAttribute('video-id') || card.getAttribute('data-video-id') || card.getAttribute('data-content-id');
            if (/^[\w-]{11}$/.test(direct || '')) return direct;
            const link = card.querySelector('a[href*="watch?v="], a[href*="/shorts/"]');
            if (!link) return null;
            try {
                const url = new URL(link.href || link.getAttribute('href'), location.origin);
                return url.searchParams.get('v') || url.pathname.match(/^\/shorts\/([\w-]{11})/)?.[1] || null;
            } catch (_) { return null; }
        }

        function clearCard(card) {
            card.classList.remove('ytvht-ai-labeled', 'ytvht-ai-dimmed', 'ytvht-ai-hidden');
            card.querySelectorAll('.ytvht-ai-label').forEach((node) => node.remove());
            delete card.dataset.ytvhtAiStatus;
        }

        function apply(id, status) {
            (cardsById.get(id) || new Set()).forEach((card) => {
                if (!card.isConnected) return;
                clearCard(card);
                card.dataset.ytvhtAiStatus = status;
                if (status !== 'ai' || mode === 'off') return;
                card.classList.add('ytvht-ai-labeled');
                if (mode === 'dim') card.classList.add('ytvht-ai-dimmed');
                if (mode === 'hide') card.classList.add('ytvht-ai-hidden');
                // Dimming alone is too easy to mistake for a watched, hovered,
                // or otherwise de-emphasized YouTube card. Keep the explicit
                // disclosure marker visible in both Badge and Dim modes.
                if (mode === 'badge' || mode === 'dim') {
                    const badge = document.createElement('span');
                    badge.className = 'ytvht-ai-label';
                    badge.textContent = 'AI';
                    badge.title = 'YouTube marked this video as Made with AI';
                    card.appendChild(badge);
                }
            });
        }

        function clientContext() {
            const scripts = [...document.scripts].map((script) => script.textContent || '').join('\n');
            const version = scripts.match(/"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/)?.[1];
            if (!version) return null;
            const hl = scripts.match(/"HL"\s*:\s*"([^"]+)"/)?.[1] || document.documentElement.lang || 'en';
            const gl = scripts.match(/"GL"\s*:\s*"([^"]+)"/)?.[1] || 'US';
            return { clientName: 'WEB', clientVersion: version, hl, gl };
        }

        function parse(response) {
            const contents = response?.contents?.twoColumnWatchNextResults?.results?.results?.contents;
            if (!Array.isArray(contents)) return 'unknown';
            return contents.some((item) => item?.videoPrimaryInfoRenderer?.badges?.some((badge) => {
                const renderer = badge?.metadataBadgeRenderer;
                // `label` is the stable signal observed in the response. The
                // accessibility text is a defensive fallback for a renderer
                // variation, rather than a title/thumbnail heuristic.
                return renderer?.label === 'AI' || /made with ai/i.test(
                    renderer?.accessibilityData?.label || ''
                );
            })) ? 'ai' : 'unlabeled';
        }

        function ensurePageBridge() {
            if (pageBridgeReady) return Promise.resolve();
            if (pageBridgePromise) return pageBridgePromise;
            pageBridgePromise = new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = chrome.runtime.getURL('content-ai-labels-page.js');
                script.onload = () => {
                    pageBridgeReady = true;
                    script.remove();
                    diagnostic('YouTube page-world request bridge is ready');
                    resolve();
                };
                script.onerror = () => reject(new Error('Could not load the YouTube AI lookup bridge'));
                (document.head || document.documentElement).appendChild(script);
            }).catch((error) => {
                pageBridgePromise = null;
                throw error;
            });
            return pageBridgePromise;
        }

        async function pageWorldLookup(payload, signal) {
            await ensurePageBridge();
            const requestId = `ytvht-ai-${Date.now()}-${++nextRequestId}`;
            const token = crypto.getRandomValues(new Uint32Array(2)).join('-');
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => finish(reject, new Error('YouTube AI lookup timed out')), 10000);
                const onMessage = (event) => {
                    if (event.source !== window || event.origin !== location.origin ||
                        event.data?.channel !== PAGE_CHANNEL || event.data?.type !== 'result' ||
                        event.data.requestId !== requestId || event.data.token !== token) return;
                    finish(resolve, event.data.ok ? event.data.response : null);
                };
                const onAbort = () => {
                    window.postMessage({ channel: PAGE_CHANNEL, type: 'abort', requestId, token }, location.origin);
                    finish(reject, new DOMException('Aborted', 'AbortError'));
                };
                const finish = (callback, value) => {
                    clearTimeout(timeout);
                    window.removeEventListener('message', onMessage);
                    signal?.removeEventListener('abort', onAbort);
                    callback(value);
                };
                window.addEventListener('message', onMessage);
                signal?.addEventListener('abort', onAbort, { once: true });
                window.postMessage({ channel: PAGE_CHANNEL, type: 'lookup', requestId, token, payload }, location.origin);
            });
        }

        async function lookup(id, previous) {
            const context = clientContext();
            if (!context) return 'unknown';
            const controller = new AbortController();
            requestControllers.add(controller);
            try {
                const response = await pageWorldLookup({
                    videoId: id,
                    racyCheckOk: true,
                    contentCheckOk: true,
                    context: { client: context }
                }, controller.signal);
                return response ? parse(response) : 'unknown';
            } catch (_) {
                return 'unknown';
            } finally {
                requestControllers.delete(controller);
            }
        }

        async function process(id) {
            if (stopped || mode === 'off') return;
            const cached = await db.getAiLabelResult(id).catch(() => null);
            if (cached && cached.cacheVersion === CACHE_VERSION && Number(cached.expiresAt) > Date.now()) {
                diagnostic('Using cached result', { videoId: id, status: cached.status });
                resolvedStatuses.set(id, cached.status);
                apply(id, cached.status);
                return;
            }
            diagnostic('Checking YouTube disclosure', { videoId: id });
            const status = await lookup(id, cached);
            if (stopped) return;
            const failureCount = status === 'unknown' ? Number(cached?.failureCount || 0) + 1 : 0;
            const ttl = status === 'unknown' ? Math.min(TTL.unknown * Math.pow(4, failureCount - 1), 90 * 86400000) : TTL[status];
            const record = {
                videoId: id,
                status,
                checkedAt: Date.now(),
                expiresAt: Date.now() + ttl,
                failureCount,
                cacheVersion: CACHE_VERSION
            };
            await db.putAiLabelResult(record).catch((error) => log('[AI labels] Cache write failed', error));
            diagnostic('YouTube disclosure result', { videoId: id, status });
            resolvedStatuses.set(id, status);
            apply(id, status);
        }

        function drain() {
            if (timer) clearTimeout(timer);
            timer = null;
            if (stopped || activeLookups >= MAX_CONCURRENT_LOOKUPS || !queuedIds.size) return;
            const wait = Math.max(0, nextRequestAt - Date.now());
            if (wait) { timer = setTimeout(drain, wait); return; }
            const id = queuedIds.values().next().value;
            queuedIds.delete(id);
            activeLookups += 1;
            nextRequestAt = Date.now() + LOOKUP_START_INTERVAL_MS;
            process(id).catch((error) => log('[AI labels] Lookup failed', error)).finally(() => {
                activeLookups -= 1;
                drain();
            });
            // Start the second request on schedule if the first is still in
            // flight, rather than serializing every visible card behind it.
            drain();
        }

        function observeCard(card) {
            const id = videoIdFor(card);
            if (!id) return;
            const previousId = videoIdByCard.get(card);
            if (previousId && previousId !== id) {
                cardsById.get(previousId)?.delete(card);
            }
            videoIdByCard.set(card, id);
            if (!cardsById.has(id)) cardsById.set(id, new Set());
            cardsById.get(id).add(card);
            if (resolvedStatuses.has(id)) apply(id, resolvedStatuses.get(id));
            observer.observe(card);
        }

        function scan(root = document) {
            if (stopped) return;
            if (root.matches?.(CARD_SELECTOR)) observeCard(root);
            root.querySelectorAll?.(CARD_SELECTOR).forEach(observeCard);
        }

        function start(settings) {
            stop();
            mode = MODES.has(settings?.aiLabeledVideoHandling) ? settings.aiLabeledVideoHandling : 'off';
            if (mode === 'off') return;
            diagnostic('Enabled', { mode });
            stopped = false;
            observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                const id = videoIdFor(entry.target);
                if (id) { queuedIds.add(id); drain(); }
                // Do not unobserve. YouTube virtualizes and rebuilds cards
                // while they are off-screen; re-entry reapplies the cached
                // result without making another network request.
            }), { rootMargin: '150px 0px' });
            mutationObserver = new MutationObserver((mutations) => mutations.forEach((mutation) =>
                mutation.addedNodes.forEach((node) => {
                    // The Viewed/progress renderer changes these nodes as part
                    // of its own redraw. They are not YouTube card updates and
                    // must not clear and reapply the AI visual treatment.
                    if (node.nodeType !== Node.ELEMENT_NODE || node.matches?.(OWN_OVERLAY_SELECTOR)) return;
                    node.closest?.(CARD_SELECTOR) && observeCard(node.closest(CARD_SELECTOR));
                    scan(node);
                })
            ));
            mutationObserver.observe(document.documentElement, { childList: true, subtree: true });
            scan();
        }

        function stop() {
            stopped = true;
            if (timer) clearTimeout(timer);
            timer = null;
            queuedIds.clear();
            observer?.disconnect(); observer = null;
            mutationObserver?.disconnect(); mutationObserver = null;
            requestControllers.forEach((controller) => controller.abort());
            requestControllers.clear();
            cardsById.forEach((cards) => cards.forEach(clearCard));
            cardsById.clear();
            resolvedStatuses.clear();
        }

        function update(settings) {
            const nextMode = MODES.has(settings?.aiLabeledVideoHandling)
                ? settings.aiLabeledVideoHandling
                : 'off';
            // A focus refresh reads the same setting most of the time. Do
            // not tear down visual state and make already-known AI cards
            // flash back to normal merely because the YouTube tab regained
            // focus.
            if (!stopped && nextMode === mode) return;
            start(settings);
        }

        return { start, stop, update, parse, TTL };
    }

    window.YTVHTAiLabels = { create };
})();

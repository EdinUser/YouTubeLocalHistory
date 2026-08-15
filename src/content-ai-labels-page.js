(function () {
    'use strict';

    // This intentionally runs in YouTube's page world. The /youtubei endpoint
    // is an internal page API; a DevTools/page-world request works, whereas an
    // isolated extension-world request is not a reliable equivalent.
    const CHANNEL = 'ytvht-ai-labels-page-v1';
    const controllers = new Map();

    window.addEventListener('message', async (event) => {
        if (event.source !== window || event.data?.channel !== CHANNEL) return;
        const { type, requestId, token } = event.data;
        if (!requestId || !token) return;

        if (type === 'abort') {
            controllers.get(requestId)?.abort();
            controllers.delete(requestId);
            return;
        }
        if (type !== 'lookup') return;

        const controller = new AbortController();
        controllers.set(requestId, controller);
        try {
            console.info('[YTVHT AI] Page-world lookup started', { videoId: event.data.payload?.videoId });
            const response = await fetch('/youtubei/v1/next?prettyPrint=false&alt=json', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                signal: controller.signal,
                body: JSON.stringify(event.data.payload)
            });
            const responseData = response.ok ? await response.json() : null;
            console.info('[YTVHT AI] Page-world lookup finished', {
                videoId: event.data.payload?.videoId,
                httpStatus: response.status
            });
            window.postMessage({
                channel: CHANNEL,
                type: 'result',
                requestId,
                token,
                ok: response.ok,
                response: responseData
            }, location.origin);
        } catch (_) {
            console.warn('[YTVHT AI] Page-world lookup failed', { videoId: event.data.payload?.videoId });
            window.postMessage({
                channel: CHANNEL,
                type: 'result',
                requestId,
                token,
                ok: false
            }, location.origin);
        } finally {
            controllers.delete(requestId);
        }
    });
})();

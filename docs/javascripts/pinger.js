(() => {
    const projectKey = 'pk_FBOt2HGSSqzXP8J1OL95ctgo_rw2wbThwygdOl-fWvE';
    const storageKey = 'pinger:' + projectKey + ':visitor-id';

    try {
        if (!window.crypto?.randomUUID || !window.fetch) {
            return;
        }

        let visitorId = window.localStorage.getItem(storageKey);

        if (!visitorId) {
            visitorId = window.crypto.randomUUID();
            window.localStorage.setItem(storageKey, visitorId);
        }

        window.fetch('https://ping.kirilov.dev/api/v1/ping', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({projectKey, visitorId}),
            keepalive: true,
        }).catch(() => {
            // Presence measurement must never interrupt the documentation site.
        });
    } catch {
        // Storage or browser privacy settings must never interrupt the site.
    }
})();

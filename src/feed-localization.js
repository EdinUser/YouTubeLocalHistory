function feedMessage(key, substitutions) {
    if (!key || !chrome?.i18n?.getMessage) return '';
    return chrome.i18n.getMessage(key, substitutions) || '';
}

function tFeed(key, fallback = '', substitutions) {
    return feedMessage(key, substitutions) || fallback;
}

function feedUiLocale() {
    return chrome?.i18n?.getUILanguage?.() || navigator.language || 'en';
}

function feedFormatNumber(value, options) {
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value ?? '');

    try {
        return new Intl.NumberFormat(feedUiLocale(), options).format(number);
    } catch (_error) {
        return String(number);
    }
}

function feedPlural(baseKey, count, fallbackOne, fallbackOther, extraSubstitutions = [], numberOptions) {
    const number = Number(count) || 0;
    let category = number === 1 ? 'one' : 'other';

    try {
        category = new Intl.PluralRules(feedUiLocale()).select(number);
    } catch (_error) {
        // The one/other fallback above is sufficient for unsupported locales.
    }

    const substitutions = [feedFormatNumber(number, numberOptions), ...extraSubstitutions];
    const localized = feedMessage(`${baseKey}_${category}`, substitutions)
        || feedMessage(`${baseKey}_other`, substitutions);
    if (localized) return localized;

    const fallback = number === 1 ? fallbackOne : fallbackOther;
    return String(fallback || '').replace('$1', substitutions[0]);
}

function feedRelativeTime(timestamp) {
    const value = Number(timestamp);
    if (!Number.isFinite(value)) return '';

    const elapsedSeconds = (value - Date.now()) / 1000;
    const ranges = [
        ['year', 60 * 60 * 24 * 365],
        ['month', 60 * 60 * 24 * 30],
        ['week', 60 * 60 * 24 * 7],
        ['day', 60 * 60 * 24],
        ['hour', 60 * 60],
        ['minute', 60]
    ];

    try {
        const formatter = new Intl.RelativeTimeFormat(feedUiLocale(), { numeric: 'auto' });
        for (const [unit, seconds] of ranges) {
            if (Math.abs(elapsedSeconds) >= seconds) {
                return formatter.format(Math.round(elapsedSeconds / seconds), unit);
            }
        }
    } catch (_error) {
        // Fall through to the catalog-backed fallback.
    }

    return tFeed('feed_just_now', 'just now');
}

function feedVideoTitle(value) {
    const title = String(value || '').trim();
    if (!title || ['Untitled', 'Untitled video', 'Unknown Title', 'YouTube video'].includes(title)) {
        return tFeed('videos_unknown_title', 'Unknown title');
    }
    return title;
}

function feedChannelTitle(value) {
    const title = String(value || '').trim();
    if (!title || ['Unknown Channel', 'Unknown channel'].includes(title)) {
        return tFeed('analytics_unknown_channel', 'Unknown channel');
    }
    return title;
}

function localizeFeedPage(root = document) {
    root.querySelectorAll('[data-i18n]').forEach((element) => {
        const message = feedMessage(element.dataset.i18n);
        if (message) element.textContent = message;
    });

    root.querySelectorAll('[data-i18n-title]').forEach((element) => {
        const message = feedMessage(element.dataset.i18nTitle);
        if (message) element.title = message;
    });

    root.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
        const message = feedMessage(element.dataset.i18nPlaceholder);
        if (message) element.placeholder = message;
    });

    root.querySelectorAll('[data-i18n-aria-label]').forEach((element) => {
        const message = feedMessage(element.dataset.i18nAriaLabel);
        if (message) element.setAttribute('aria-label', message);
    });
}

document.addEventListener('DOMContentLoaded', () => localizeFeedPage());

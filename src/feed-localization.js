function feedMessage(key, substitutions) {
    if (!key || !chrome?.i18n?.getMessage) return '';
    return chrome.i18n.getMessage(key, substitutions) || '';
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

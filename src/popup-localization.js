// Localization helper: localize all elements with data-i18n* attributes
function localizeHtmlPage() {
    // Set text content for elements with data-i18n
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const msg = chrome.i18n.getMessage(key);
        if (msg) el.textContent = msg;
    });
    // Set title attribute for elements with data-i18n-title
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        const msg = chrome.i18n.getMessage(key);
        if (msg) el.title = msg;
    });
    // Set placeholder attribute for elements with data-i18n-placeholder
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        const msg = chrome.i18n.getMessage(key);
        if (msg) el.placeholder = msg;
    });
}

document.addEventListener('DOMContentLoaded', () => {
    localizeHtmlPage();
    // ... existing code ...

// ... existing code ...
// Replace all user-facing text in JS with chrome.i18n.getMessage
// Example:
// document.getElementById('ytvhtMessage').textContent = chrome.i18n.getMessage('message_some_key');
// ...
});

// ... existing code ...
// For all dynamic text assignments, replace hardcoded strings with chrome.i18n.getMessage('key')
// For example:
// alert(chrome.i18n.getMessage('alert_some_error'));
// ...


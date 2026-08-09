(function () {
    const runtime = (typeof browser !== 'undefined' && browser.runtime)
        ? browser.runtime
        : chrome.runtime;
    location.replace(runtime.getURL('feed.html') + '#settings');
})();

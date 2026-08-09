(function (root) {
    'use strict';
    function selectStartupFeedView(defaultPage, storedLast) {
        if (defaultPage && defaultPage !== 'last') return defaultPage;
        return storedLast && storedLast !== 'settings' ? storedLast : 'home';
    }
    function shouldPersistLastView(view) {
        return Boolean(view) && view !== 'settings';
    }
    const api = { selectStartupFeedView, shouldPersistLastView };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.ytvhtFeedViewPreference = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

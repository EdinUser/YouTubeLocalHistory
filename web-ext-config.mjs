// web-ext configuration for running YT re:Watch in Firefox during development.
//
// Why: loading the extension as a "Temporary Add-on" in about:debugging makes
// Firefox's toolbar button flaky — the background event page unloads and the
// popup sometimes stops opening until you reload it. Running via web-ext keeps
// the add-on stable and auto-reloads it when you edit files in src/.
//
// Run it with:   npm start        (or: npx web-ext run)
//
// web-ext auto-discovers this file in the project root.
//
// NOTE: this must be a real ES module (.mjs) using named `export` statements.
// web-ext 8.x imports the config with import(); a CommonJS file (.cjs/.js with
// `module.exports = {...}`) makes Node expose a stray "module.exports" named
// export that web-ext rejects ("must be specified in camel case").

import path from 'node:path';

// Use your EXISTING Firefox profile ("default-release") so the subscriptions
// and watch history you already imported are there — no re-import needed.
// keepProfileChanges makes web-ext use this profile in place (not a throwaway
// copy) and write changes back, so anything you do persists between runs.
//
// IMPORTANT: close your normal Firefox before running `npm start` — Firefox
// can't open the same profile twice at once.
const firefoxProfile = path.join(
    process.env.APPDATA,
    'Mozilla', 'Firefox', 'Profiles', '9ij2f2ur.default-release'
);

// src/ keeps browser-specific manifests separate. Build copies the Firefox
// manifest into build/firefox/manifest.json, which is what web-ext expects.
export const sourceDir = './build/firefox';

export const run = {
    target: ['firefox-desktop'],

    firefoxProfile,
    keepProfileChanges: true,

    // Set to true (or pass --browser-console) to auto-open the Browser
    // Console and see popup/background errors as they happen.
    browserConsole: false,
};

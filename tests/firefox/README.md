# Firefox E2E Tests

Firefox E2E tests are intentionally separate from Playwright Chromium tests.

Run:

```bash
npm run test:firefox:e2e
npm run test:firefox:static
```

Current coverage:

- builds `build/e2e/firefox`
- launches real Firefox through Selenium
- uses an isolated temporary profile under `/tmp`
- installs the unpacked Firefox extension temporarily
- verifies the extension add-on ID
- discovers the temporary `moz-extension://` UUID at runtime
- verifies `browser.storage.local` read/write/remove from an extension page
- verifies the temporary profile is removed after cleanup
- opens the live Rick Astley video in Firefox
- saves the player around 45 seconds
- asserts the saved `video_<id>` record exists in extension storage
- clears YouTube origin state while preserving extension storage
- asserts the extension storage record survives YouTube origin cleanup
- verifies return-to-video resume
- verifies reload resume
- verifies live playlist overlay rendering and overlay remove behavior
- verifies live channel videos overlay rendering
- serves captured playlist/channel HTML from a local `127.0.0.1` replay server for static overlay tests
- verifies static playlist overlay rendering, overlay removal, and storage deletion
- verifies static channel overlay rendering for initially present and dynamically appended captured nodes
- verifies static overlay processing does not create duplicate overlay elements in Firefox

Firefox storage inspection uses the test profile's runtime `moz-extension://` URL. It never uses a UUID from a real Firefox profile.

The static replay server uses a test-only local host permission injected into `build/e2e/firefox/manifest.json` by `scripts/build-firefox-unpacked.sh`. The production Firefox source manifest remains YouTube-only.

Rules:

- never use a real Firefox profile path
- never use `~/.mozilla/firefox`
- never preserve profile changes from automated tests
- keep Firefox browser launch code in `firefox-fixture.js`

# YT re:Watch — Project audit (maintenance & security)

**Date:** 2026-05-06  
**Scope:** Repository layout, tooling, CI, dependencies, extension security posture, and hygiene.

---

## 1. What is `yt-storage.json`?

**Purpose:** It is a **Playwright [`storageState`](https://playwright.dev/docs/auth#reuse-signed-in-state)** file. Playwright can save cookies, `localStorage`, and related browser state so the next test run starts already “warmed up” (e.g. YouTube consent banner already dismissed, optional signed-in state).

**Where it is used:** Only in `playwright.config.js`, on the `chromium-with-extension` project:

```48:51:playwright.config.js
        storageState: path.join(__dirname, 'yt-storage.json'),
```

**Important:** This file is **not** used by the extension at runtime. It exists **only for local / CI e2e** runs when you use that Playwright project.

**Risk if committed:** The file can contain **real YouTube / Google cookies** and other session data. It must **not** be shared publicly or stored in Git history. Prefer:

- Adding `yt-storage.json` to `.gitignore`
- Generating it locally (or in CI from secrets) when running Playwright
- Rotating sessions if it was ever pushed

---

## 2. Critical finding — session data in repo

- `yt-storage.json` was present in the workspace and **tracked by Git** at audit time.
- `.gitignore` did not exclude it.

**Action:** Remove from the index, add to `.gitignore`, and if it was ever pushed, purge from history and rotate credentials for the affected account.

---

## 3. High — `npm audit` (developer / CI only)

`npm audit` reported multiple issues in **transitive dev dependencies** (e.g. ESLint plugin-kit, Jest/jsdom chain, `flatted`, `minimatch`, `picomatch`).

**Impact:** Affects **developers and CI**, not end users (the shipped extension does not bundle `node_modules`).

**Action:** Run `npm audit fix`; where fixes require major upgrades (e.g. Jest 30), plan a dedicated upgrade PR.

---

## 4. Medium — ESLint 9 without config

- `package.json` includes ESLint `^9.x`, which expects `eslint.config.js` (flat config).
- No `eslint.config.*` or `.eslintrc.*` was present, so `npm run lint` **fails**.

**Action:** Add `eslint.config.js` or pin ESLint 8 until migration is done.

---

## 5. Medium — CI scope

`.github/workflows/ci.yml` runs **Jest only** (`npm test`).

It does **not** run:

- `npm run lint` (once fixed)
- `npm run test:coverage`
- `npm run test:e2e` (Playwright; heavy and may need local `storageState` / display)

**Action:** Add lint (and optionally coverage) to CI; treat e2e as optional or manual workflow if full YouTube automation is impractical in GitHub runners.

---

## 6. Medium — version drift

- `package.json` `version`: **2.4.0**
- `manifest.chrome.json` / `manifest.firefox.json` `version`: **4.0.3**

**Action:** Single source of truth (often manifest), sync the other in build or a small script.

---

## 7. Medium — background `ytStorageCall` RPC

`background.js` forwards `ytStorageCall` to `ytStorage[method](...args)` with method-name validation but **no `sender` checks**.

**Action:** Restrict by sender, whitelist methods, and validate argument shapes for defense in depth.

---

## 8. Medium — maintainability

- `content.js` and `popup.js` are very large monoliths.

**Action:** Long-term modularization / bundler for clearer boundaries (especially for YouTube DOM churn).

---

## 9. Low — packaging / docs accuracy

- `build.sh` copies `sync-service.js` while comments in `background.js` indicate it is no longer imported in Chrome’s service worker — clarify or remove dead packaging.
- README security claims (“encrypted”, “no console access”) are **overstated** relative to how browsers and devtools actually work. Prefer precise language: data stays **local to the extension** and is **not sent to your servers**; sophisticated users can still inspect extension storage in some setups.

---

## 10. Low — other hygiene

- **Browserslist / caniuse-lite:** Jest warned data is stale; run `npx update-browserslist-db@latest` when convenient.
- **`sanitizeText`:** Normalizes mojibake; it is **not** HTML escaping. Popup code generally uses `textContent` for user strings, which is appropriate.
- **Telegram release workflow:** Markdown in release titles may need escaping if titles contain special characters.

---

## 11. Positive observations

- Manifest permissions are **reasonably scoped** to YouTube + storage APIs for the feature set.
- **Jest** coverage is strong (multiple unit/integration suites; tests passed at audit time).
- Popup rendering largely uses **`createElement` + `textContent`**, which is good for XSS resilience.
- Import flow performs **basic structural validation** before merging data.

---

## 12. Suggested priority order

1. Fix **secrets / `yt-storage.json`** handling (ignore, remove from Git, rotate if exposed).
2. Restore **ESLint** (config or version pin) and add **lint to CI**.
3. **Align versions** across `package.json` and manifests.
4. **Triage `npm audit`** on dev dependencies.
5. Harden **`ytStorageCall`** and tighten README security wording.

---

*This document was produced as a static audit snapshot; re-run checks (tests, audit, lint) after any major change.*

const assert = require('node:assert/strict');
const { By } = require('selenium-webdriver');
const {
  launchFirefoxWithExtension,
  openFirefoxExtensionPage,
} = require('./firefox-fixture');

const LOCALES = ['en', 'bg', 'de', 'es', 'fr'];
const PLAYLIST_ID = 'PLv4ReferenceFixture123';
const PLAYLIST_URL = `https://www.youtube.com/playlist?list=${PLAYLIST_ID}`;
const CANONICAL_CHANNEL_ID = 'UCbackupfixture000000000001';
const LEGACY_CHANNEL_ID = 'UCbackupfixture000000000002';
const LIVE_RSS_CHANNEL_ID = 'UCuAXFkgsw1L7xaCfnd5JJOw';
const LIVE_CHANNEL_HANDLE = '@TodorKirilov';
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
const TEST_TIMEOUT_MS = 120000;

async function waitForFeed(session) {
  await openFirefoxExtensionPage(session, 'feed.html');
  await session.driver.wait(async () => session.driver.executeScript(() => (
    !document.documentElement.classList.contains('app-loading')
  )), 15000, 'feed page should finish loading');
}

async function runScenario(name, options, fn) {
  const timeout = setTimeout(() => {
    console.error(`Firefox packaged feed test "${name}" exceeded ${TEST_TIMEOUT_MS}ms`);
    process.exit(1);
  }, TEST_TIMEOUT_MS);
  const session = await launchFirefoxWithExtension(options);
  try {
    await fn(session);
    console.log(`Firefox packaged feed passed: ${name}`);
  } finally {
    clearTimeout(timeout);
    await session.cleanup();
  }
}

async function main() {
  for (const locale of LOCALES) {
    await runScenario(`localization ${locale}`, { locale }, async (session) => {
      await waitForFeed(session);
      const initial = await session.driver.executeScript(() => {
        const keys = [
          'feed_search_local', 'feed_menu', 'feed_channels', 'tab_playlists',
          'feed_history', 'tab_analytics', 'tab_settings',
        ];
        return {
          uiLanguage: browser.i18n.getUILanguage(),
          messages: Object.fromEntries(keys.map((key) => [key, browser.i18n.getMessage(key)])),
          searchPlaceholder: document.querySelector('#search')?.getAttribute('placeholder'),
          menuTitle: document.querySelector('#menuToggle')?.getAttribute('title'),
          menuAria: document.querySelector('#menuToggle')?.getAttribute('aria-label'),
        };
      });

      assert.match(initial.uiLanguage.toLowerCase(), new RegExp(`^${locale}(?:-|$)`));
      assert.equal(initial.searchPlaceholder, initial.messages.feed_search_local);
      assert.equal(initial.menuTitle, initial.messages.feed_menu);
      assert.equal(initial.menuAria, initial.messages.feed_menu);

      const surfaces = [
        ['#manage', '.subs-title', 'feed_channels'],
        ['#navPlaylists', '.playlists-title', 'tab_playlists'],
        ['#navHistory', '.history-title', 'feed_history'],
        ['#analyticsToggle', '#analyticsSection .section-h', 'tab_analytics'],
        ['#navSettings', '.settings-title', 'tab_settings'],
      ];
      for (const [buttonSelector, textSelector, messageKey] of surfaces) {
        await session.driver.findElement(By.css(buttonSelector)).click();
        await session.driver.wait(async () => session.driver.executeScript(
          (selector, expected) => document.querySelector(selector)?.textContent.includes(expected),
          textSelector,
          initial.messages[messageKey]
        ), 10000, `${locale} ${messageKey} surface should be localized`);
      }

      const missingScripts = await session.driver.executeAsyncScript((done) => {
        const urls = [...new Set([...document.scripts].map((script) => script.src).filter(Boolean))];
        Promise.all(urls.map(async (url) => {
          try {
            const response = await fetch(url);
            return response.ok ? null : `${url} (${response.status})`;
          } catch (error) {
            return `${url} (${error.message})`;
          }
        })).then((results) => done(results.filter(Boolean)));
      });
      assert.deepEqual(missingScripts, []);
    });
  }

  await runScenario('outbound playlist reference', { locale: 'en' }, async (session) => {
    await waitForFeed(session);
    const localPlaylists = {
      'local-fixture': {
        id: 'local-fixture',
        title: 'Preserve this experimental local playlist',
        createdAt: 1,
        updatedAt: 2,
        items: {},
        order: [],
      },
    };
    const seeded = await session.driver.executeAsyncScript((playlistId, playlistUrl, thumbnail, local, done) => {
      (async () => {
        await ytStorage.setPlaylist(playlistId, {
          playlistId,
          title: 'V4 playlist reference',
          url: playlistUrl,
          thumbnail,
          timestamp: 1700000000000,
        });
        await browser.storage.local.set({ localVideoPlaylists: local });
        window.__playlistReferenceFetches = [];
        window.__playlistReferenceMessages = [];
        window.__playlistReferenceErrors = [];
        window.addEventListener('error', (event) => {
          window.__playlistReferenceErrors.push(event.error?.message || event.message || 'unknown page error');
        });
        const originalFetch = window.fetch.bind(window);
        window.fetch = (input, options) => {
          const url = typeof input === 'string' ? input : input && input.url;
          window.__playlistReferenceFetches.push(String(url || ''));
          return originalFetch(input, options);
        };
        const originalSendMessage = browser.runtime.sendMessage.bind(browser.runtime);
        browser.runtime.sendMessage = (message, ...args) => {
          window.__playlistReferenceMessages.push(message);
          return originalSendMessage(message, ...args);
        };
        window.__playlistCookieBefore = document.cookie;
        done({ ok: true });
      })().catch((error) => done({ ok: false, error: error.message }));
    }, PLAYLIST_ID, PLAYLIST_URL, PIXEL, localPlaylists);
    assert.equal(seeded.ok, true, seeded.error);

    await session.driver.findElement(By.css('#navPlaylists')).click();
    await session.driver.wait(async () => session.driver.executeScript(() => (
      [...document.querySelectorAll('.playlist-row')]
        .some((row) => row.textContent.includes('V4 playlist reference'))
    )), 10000, 'playlist reference row should render');

    const state = await session.driver.executeAsyncScript((title, done) => {
      (async () => {
        const row = [...document.querySelectorAll('.playlist-row')]
          .find((candidate) => candidate.textContent.includes(title));
        const name = row?.querySelector('.playlist-name');
        const thumbnail = row?.querySelector('.playlist-thumb-link');
        const stored = await browser.storage.local.get('localVideoPlaylists');
        done({
          nameHref: name?.getAttribute('href') || '',
          nameTarget: name?.getAttribute('target') || '',
          nameRel: name?.getAttribute('rel') || '',
          thumbnailHref: thumbnail?.getAttribute('href') || '',
          thumbnailTarget: thumbnail?.getAttribute('target') || '',
          thumbnailRel: thumbnail?.getAttribute('rel') || '',
          imageSrc: row?.querySelector('img')?.getAttribute('src') || '',
          meta: row?.querySelector('.playlist-meta')?.textContent || '',
          loadingCount: document.querySelectorAll('.playlist-detail-loading').length,
          fetches: window.__playlistReferenceFetches,
          messages: window.__playlistReferenceMessages,
          errors: window.__playlistReferenceErrors,
          cookieBefore: window.__playlistCookieBefore,
          cookieAfter: document.cookie,
          localPlaylists: stored.localVideoPlaylists,
        });
      })().catch((error) => done({ scriptError: error.message }));
    }, 'V4 playlist reference');

    assert.equal(state.scriptError, undefined);
    assert.equal(state.nameHref, PLAYLIST_URL);
    assert.equal(state.nameTarget, '_blank');
    assert.match(state.nameRel, /noopener/);
    assert.equal(state.thumbnailHref, PLAYLIST_URL);
    assert.equal(state.thumbnailTarget, '_blank');
    assert.match(state.thumbnailRel, /noopener/);
    assert.equal(state.imageSrc, PIXEL);
    assert.match(state.meta, /Saved/);
    assert.equal(state.loadingCount, 0);
    assert.deepEqual(state.fetches, []);
    assert.deepEqual(state.messages.filter((message) => message?.type === 'getPlaylistMetadata'), []);
    assert.deepEqual(state.errors.filter((message) => (
      /ReferenceError|ensureConsentCookie|fetchSearchMetadata|runsText/.test(message)
    )), []);
    assert.equal(state.cookieAfter, state.cookieBefore);
    assert.deepEqual(state.localPlaylists, localPlaylists);
  });

  await runScenario('canonical v5 subscription backup round trip', { locale: 'en' }, async (session) => {
    await waitForFeed(session);
    const result = await session.driver.executeAsyncScript((canonicalId, legacyId, done) => {
      (async () => {
        await ytIndexedDBStorage.deleteSubscriptionRecord(canonicalId);
        await ytStorage.removeSubscription(legacyId);
        const original = {
          channelId: canonicalId,
          channelTitle: 'Canonical backup fixture',
          thumbnail: 'https://example.test/canonical-avatar.jpg',
          handle: '@canonicalbackupfixture',
          source: 'manual',
          followedAt: 1700000000000,
          importedAt: 1700000001000,
        };
        await ytIndexedDBStorage.putSubscriptionRecord(original);

        const backup = await createFeedBackupData();
        await ytIndexedDBStorage.deleteSubscriptionRecord(canonicalId);
        await restoreFeedBackupData(backup);
        await restoreFeedBackupData(backup);

        const restored = await ytIndexedDBStorage.getSubscriptionRecord(canonicalId);
        const duplicateCount = (await ytIndexedDBStorage.listSubscriptionRecords())
          .filter((record) => record.channelId === canonicalId).length;

        const legacyRecord = {
          id: legacyId,
          channelName: 'Legacy backup fixture',
          ucid: legacyId,
          subscribedAt: 1600000000000,
        };
        await restoreFeedBackupData({ subscriptions: [legacyRecord] });
        const restoredLegacy = await ytStorage.getSubscription(legacyId);

        await ytIndexedDBStorage.deleteSubscriptionRecord(canonicalId);
        await ytStorage.removeSubscription(legacyId);
        done({
          ok: true,
          dataVersion: backup._metadata.dataVersion,
          exported: backup.canonicalSubscriptions.find((record) => record.channelId === canonicalId),
          restored,
          duplicateCount,
          restoredLegacy,
        });
      })().catch((error) => done({ ok: false, error: error.message }));
    }, CANONICAL_CHANNEL_ID, LEGACY_CHANNEL_ID);

    assert.equal(result.ok, true, result.error);
    assert.equal(result.dataVersion, '2.1');
    assert.deepEqual(result.restored, result.exported);
    assert.equal(result.exported.channelId, CANONICAL_CHANNEL_ID);
    assert.equal(result.exported.source, 'manual');
    assert.equal(result.exported.followedAt, 1700000000000);
    assert.equal(result.duplicateCount, 1);
    assert.equal(result.restoredLegacy.id, LEGACY_CHANNEL_ID);
    assert.equal(result.restoredLegacy.channelName, 'Legacy backup fixture');
    assert.equal(result.restoredLegacy.subscribedAt, 1600000000000);
  });

  if (process.env.RUN_LIVE_PERMISSION_CANARY === '1') {
    await runScenario('retained YouTube host permission canary', { locale: 'en' }, async (session) => {
      await waitForFeed(session);
      const result = await session.driver.executeAsyncScript((rssChannelId, handle, done) => {
        (async () => {
          const resolved = await ytvhtLocalSubscriptionActions.resolveInput(handle, fetch);
          const rss = await ytvhtRssClient.fetchChannelRss(rssChannelId, { timeoutMs: 30000 });
          const hydrated = await ytvhtFeedChannelMetadata.hydrateChannel({
            channelId: resolved.channelId,
            channelTitle: '',
            url: `https://www.youtube.com/channel/${resolved.channelId}`,
          }, { fetch, now: 1700000000000 });
          done({
            ok: true,
            rssError: rss.error,
            rssEntries: rss.entries.length,
            resolved,
            channelTitle: hydrated.channelTitle || '',
            metadataHydratedAt: hydrated.metadataHydratedAt || 0,
            metadataRetryAfter: hydrated.metadataRetryAfter || 0,
          });
        })().catch((error) => done({ ok: false, error: error.message }));
      }, LIVE_RSS_CHANNEL_ID, LIVE_CHANNEL_HANDLE);

      assert.equal(result.ok, true, result.error);
      assert.equal(result.rssError, null);
      assert.ok(result.rssEntries > 0, 'public channel RSS should contain entries');
      assert.match(result.resolved.channelId, /^UC[\w-]+$/);
      assert.equal(result.resolved.handle, LIVE_CHANNEL_HANDLE);
      assert.match(result.channelTitle, /\S/);
      assert.equal(result.metadataHydratedAt, 1700000000000);
      assert.equal(result.metadataRetryAfter, 0);
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

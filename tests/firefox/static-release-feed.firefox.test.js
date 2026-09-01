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
const IGNORED_TAB_CHANNEL_ID = 'UCfirefoxignoredtab00000001';
const PAGINATION_CHANNEL_ID = 'UCfirefoxpaginationfixture01';
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
const TEST_TIMEOUT_MS = 120000;

async function waitForFeed(session) {
  await openFirefoxExtensionPage(session, 'feed.html');
  await session.driver.wait(async () => session.driver.executeScript(() => (
    !document.documentElement.classList.contains('app-loading')
  )), 15000, 'feed page should finish loading');
}

async function clickStatusAction(session) {
  const clicked = await session.driver.executeScript(() => {
    const button = document.querySelector('#status button');
    if (!button) return false;
    button.click();
    return true;
  });
  assert.equal(clicked, true, 'feed status action should be available');
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
        ['#navHistory', '#historySection .history-title', 'feed_history'],
        ['#analyticsToggle', '#analyticsSection h2[data-i18n="tab_analytics"]', 'tab_analytics'],
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

  await runScenario('Channels Ignored tab lifecycle', { locale: 'en' }, async (session) => {
    await waitForFeed(session);
    const seeded = await session.driver.executeAsyncScript((channelId, done) => {
      (async () => {
        await ytIndexedDBStorage.putSubscriptionRecord({
          channelId,
          channelTitle: 'Firefox ignored tab fixture',
          source: 'manual',
          followedAt: 1700000000000,
        });
        await ytIndexedDBStorage.putChannelSyncState({
          channelId,
          initializationState: 'complete',
          lastSuccessfulCheckAt: 1700000000000,
          nextEligibleCheckAt: 4102444800000,
        });
        done({ ok: true });
      })().catch((error) => done({ ok: false, error: error.message }));
    }, IGNORED_TAB_CHANNEL_ID);
    assert.equal(seeded.ok, true, seeded.error);

    await session.driver.findElement(By.css('#manage')).click();
    await session.driver.wait(async () => session.driver.executeScript(() => (
      document.querySelector('#subscriptionTabs')?.hidden === true
    )), 10000, 'Ignored tab should be absent with zero tombstones');

    const unfollowed = await session.driver.executeAsyncScript((channelId, done) => {
      ytvhtLocalSubscriptionActions.unfollow(ytIndexedDBStorage, channelId, {
        source: 'channels',
        channelTitle: 'Firefox ignored tab fixture',
      }).then(() => done({ ok: true })).catch((error) => done({ ok: false, error: error.message }));
    }, IGNORED_TAB_CHANNEL_ID);
    assert.equal(unfollowed.ok, true, unfollowed.error);

    await openFirefoxExtensionPage(session, 'feed.html?review=1#channels/ignored');
    await session.driver.wait(async () => session.driver.executeScript(() => (
      !document.documentElement.classList.contains('app-loading') &&
      document.querySelector('#channelsIgnoredTab')?.getAttribute('aria-selected') === 'true'
    )), 15000, 'direct Ignored route should select the internal tab');

    const ignoredState = await session.driver.executeScript(() => ({
      tabsHidden: document.querySelector('#subscriptionTabs')?.hidden,
      following: document.querySelector('#channelsFollowingTab')?.textContent,
      ignored: document.querySelector('#channelsIgnoredTab')?.textContent,
      list: document.querySelector('#subscriptionsList')?.textContent,
      addHidden: document.querySelector('#subscriptionAddForm')?.style.display === 'none',
    }));
    assert.equal(ignoredState.tabsHidden, false);
    assert.equal(ignoredState.following, 'Following (0)');
    assert.equal(ignoredState.ignored, 'Ignored (1)');
    assert.match(ignoredState.list, /Firefox ignored tab fixture/);
    assert.equal(ignoredState.addHidden, true);

    await session.driver.findElement(By.css('#subscriptionsList button')).click();
    await session.driver.wait(async () => {
      const state = await session.driver.executeAsyncScript((channelId, done) => {
        Promise.all([
          ytIndexedDBStorage.getLocalUnsubscribeTombstone(channelId),
          ytIndexedDBStorage.getSubscriptionRecord(channelId),
        ]).then(([tombstone, subscription]) => done({
          tabHidden: document.querySelector('#subscriptionTabs')?.hidden,
          tombstone: tombstone || null,
          channelTitle: subscription?.channelTitle || '',
        })).catch((error) => done({ error: error.message }));
      }, IGNORED_TAB_CHANNEL_ID);
      return !state.error && state.tabHidden === true && state.tombstone === null &&
        state.channelTitle === 'Firefox ignored tab fixture';
    }, 15000, 'following again should remove the last tombstone and hide the tab');
  });

  await runScenario('ignored-channel import review actions', { locale: 'en' }, async (session) => {
    const channelId = 'UCfirefoxignoredimport000001';
    const csv = `Channel Id,Channel Url,Channel Title\n${channelId},https://www.youtube.com/channel/${channelId},Firefox ignored import`;
    await waitForFeed(session);
    const tombstoned = await session.driver.executeAsyncScript((id, done) => {
      ytIndexedDBStorage.putLocalUnsubscribeTombstone({
        channelId: id,
        channelTitle: 'Firefox ignored import',
        unsubscribedAt: 1700000000000,
        source: 'channels',
      }).then(() => done({ ok: true })).catch((error) => done({ ok: false, error: error.message }));
    }, channelId);
    assert.equal(tombstoned.ok, true, tombstoned.error);

    await session.driver.findElement(By.css('#navSettings')).click();
    const settingsImported = await session.driver.executeAsyncScript((text, done) => {
      const input = document.querySelector('#importChannelsFile');
      const transfer = new DataTransfer();
      transfer.items.add(new File([text], 'subscriptions.csv', { type: 'text/csv' }));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      const startedAt = Date.now();
      const waitForReview = () => {
        const review = document.querySelector('#feedSettingsMessage button');
        if (review) done({ ok: true, text: review.textContent });
        else if (Date.now() - startedAt > 15000) done({ ok: false, error: 'Settings review action did not appear' });
        else setTimeout(waitForReview, 50);
      };
      waitForReview();
    }, csv);
    assert.equal(settingsImported.ok, true, settingsImported.error);
    assert.match(settingsImported.text, /Review ignored channels/);
    await session.driver.findElement(By.css('#feedSettingsMessage button')).click();
    await session.driver.wait(async () => session.driver.executeScript(() => (
      document.querySelector('#channelsIgnoredTab')?.getAttribute('aria-selected') === 'true' &&
      document.querySelector('#subscriptionsList')?.textContent.includes('Firefox ignored import')
    )), 10000, 'Settings review action should open the Ignored tab');

    await openFirefoxExtensionPage(session, 'popup.html');
    const popupImported = await session.driver.executeAsyncScript((text, done) => {
      (async () => {
        const status = document.createElement('div');
        status.id = 'ytvhtImportStatus';
        document.body.appendChild(status);
        const file = new File([text], 'subscriptions.csv', { type: 'text/csv' });
        await handleImportSubsFile({ target: { files: [file], value: '' } });
        done({ ok: true, review: status.querySelector('button')?.textContent || '' });
      })().catch((error) => done({ ok: false, error: error.message }));
    }, csv);
    assert.equal(popupImported.ok, true, popupImported.error);
    assert.match(popupImported.review, /Review ignored channels/);

    const priorHandles = new Set(await session.driver.getAllWindowHandles());
    await session.driver.findElement(By.css('#ytvhtImportStatus button')).click();
    await session.driver.wait(async () => (await session.driver.getAllWindowHandles()).length > priorHandles.size,
      10000, 'Popup review action should open an extension tab');
    const reviewHandle = (await session.driver.getAllWindowHandles()).find((handle) => !priorHandles.has(handle));
    await session.driver.switchTo().window(reviewHandle);
    await session.driver.wait(async () => session.driver.executeScript(() => (
      !document.documentElement.classList.contains('app-loading') &&
      document.querySelector('#channelsIgnoredTab')?.getAttribute('aria-selected') === 'true'
    )), 15000, 'Popup review action should open the Ignored tab');
    assert.match(await session.driver.getCurrentUrl(), /feed\.html#channels\/ignored$/);
  });

  await runScenario('feed video menu local subscription actions', { locale: 'en' }, async (session) => {
    const channelId = 'UCfirefoxfeedmenuactions001';
    const videoId = 'FxFeedMenu1';
    await waitForFeed(session);
    const seeded = await session.driver.executeAsyncScript((id, fixtureVideoId, done) => {
      (async () => {
        await ytIndexedDBStorage.putSubscriptionRecord({
          channelId: id,
          channelTitle: 'Firefox feed menu fixture',
          source: 'manual',
          followedAt: 1700000000000,
        });
        await ytIndexedDBStorage.putSubscriptionFeedVideo({
          videoId: fixtureVideoId,
          channelId: id,
          channelTitle: 'Firefox feed menu fixture',
          title: 'Firefox feed menu fixture video',
          thumbnailUrl: '',
          publishedAt: 1800000000000,
          discoveredAt: 1700000000000,
          lastSeenInFeedAt: 1700000000000,
          durationSeconds: 600,
          isShort: false,
          source: 'rss',
        });
        await ytStorage.setVideo(fixtureVideoId, {
          videoId: fixtureVideoId,
          title: 'Firefox feed menu fixture video',
          channelName: 'Firefox feed menu fixture',
          channelId: id,
          url: `https://www.youtube.com/watch?v=${fixtureVideoId}`,
          channelUrl: `https://www.youtube.com/channel/${id}`,
          time: 30,
          duration: 600,
          timestamp: 1700000000000,
        });
        await loadData();
        showFeed();
        done({ ok: true });
      })().catch((error) => done({ ok: false, error: error.message }));
    }, channelId, videoId);
    assert.equal(seeded.ok, true, seeded.error);

    const homeCardSelector = `.ytvht-feed-card[data-ytvht-video-id="${videoId}"]`;
    await session.driver.wait(async () => session.driver.executeScript(
      (selector) => !!document.querySelector(selector), homeCardSelector
    ), 10000, 'Home feed card should render');
    await session.driver.findElement(By.css(`${homeCardSelector} .video-menu-button`)).click();
    const unsubscribed = await session.driver.executeAsyncScript((selector, id, done) => {
      const item = [...document.querySelectorAll(`${selector} .video-menu-item`)]
        .find((button) => button.textContent.includes('Unsubscribe'));
      if (!item) {
        done({ ok: false, error: 'Unsubscribe action was not rendered' });
        return;
      }
      item.click();
      const startedAt = Date.now();
      const waitForState = async () => {
        const [subscription, tombstone] = await Promise.all([
          ytIndexedDBStorage.getSubscriptionRecord(id),
          ytIndexedDBStorage.getLocalUnsubscribeTombstone(id),
        ]);
        if (!subscription && tombstone) done({ ok: true, tombstone });
        else if (Date.now() - startedAt > 15000) done({ ok: false, error: 'Unsubscribe state was not stored' });
        else setTimeout(waitForState, 50);
      };
      waitForState().catch((error) => done({ ok: false, error: error.message }));
    }, homeCardSelector, channelId);
    assert.equal(unsubscribed.ok, true, unsubscribed.error);
    assert.equal(unsubscribed.tombstone.channelId, channelId);

    await session.driver.findElement(By.css('#navHistory')).click();
    const historyRowSelector = `#historyList .yt-row[data-ytvht-video-id="${videoId}"]`;
    await session.driver.wait(async () => session.driver.executeScript(
      (selector) => !!document.querySelector(selector), historyRowSelector
    ), 10000, 'History row should remain after local unsubscribe');
    await session.driver.findElement(By.css(`${historyRowSelector} .video-menu-button`)).click();
    const followed = await session.driver.executeAsyncScript((selector, id, done) => {
      const item = [...document.querySelectorAll(`${selector} .video-menu-item`)]
        .find((button) => button.textContent.includes('Subscribe with re:Watch'));
      if (!item) {
        done({ ok: false, error: 'Subscribe action was not rendered' });
        return;
      }
      item.click();
      const startedAt = Date.now();
      const waitForState = async () => {
        const [subscription, tombstone] = await Promise.all([
          ytIndexedDBStorage.getSubscriptionRecord(id),
          ytIndexedDBStorage.getLocalUnsubscribeTombstone(id),
        ]);
        if (subscription && !tombstone) done({ ok: true, subscription });
        else if (Date.now() - startedAt > 15000) done({ ok: false, error: 'Follow state was not stored' });
        else setTimeout(waitForState, 50);
      };
      waitForState().catch((error) => done({ ok: false, error: error.message }));
    }, historyRowSelector, channelId);
    assert.equal(followed.ok, true, followed.error);
    assert.equal(followed.subscription.channelId, channelId);
    assert.equal(followed.subscription.source, 'manual');
  });

  await runScenario('real IndexedDB v5 to v7 preservation', { locale: 'en' }, async (session) => {
    await waitForFeed(session);
    const preserved = await session.driver.executeAsyncScript((done) => {
      (async () => {
        const databaseName = 'YTLH_HybridDB';
        const channelId = 'UCfirefoxv5upgrade0000001';
        const videoId = 'FxV5Upgrade';
        const openConnection = await ytIndexedDBStorage._getDB();
        openConnection.close();
        ytIndexedDBStorage._dbPromise = null;
        await new Promise((resolve, reject) => {
          const request = indexedDB.deleteDatabase(databaseName);
          request.onsuccess = resolve;
          request.onerror = () => reject(request.error);
          request.onblocked = () => reject(new Error('v7 database deletion was blocked'));
        });
        await new Promise((resolve, reject) => {
          const request = indexedDB.open(databaseName, 5);
          request.onupgradeneeded = () => {
            request.result.createObjectStore('videos', { keyPath: 'videoId' }).put({
              videoId: 'FxLegacyHistory', title: 'Preserved Firefox history', time: 12,
            });
            request.result.createObjectStore('subscriptions', { keyPath: 'channelId' }).put({
              channelId, channelTitle: 'Preserved Firefox channel', source: 'manual', followedAt: 10,
            });
            request.result.createObjectStore('subscription_feed_videos', { keyPath: 'videoId' }).put({
              videoId, channelId, title: 'Preserved Firefox feed video', publishedAt: 20,
            });
            request.result.createObjectStore('channel_sync_state', { keyPath: 'channelId' }).put({
              channelId, initializationState: 'complete', lastSuccessfulCheckAt: 30,
            });
          };
          request.onsuccess = () => {
            request.result.close();
            resolve();
          };
          request.onerror = () => reject(request.error);
        });
        const [history, subscription, feedVideo, syncState] = await Promise.all([
          ytIndexedDBStorage.getVideo('FxLegacyHistory'),
          ytIndexedDBStorage.getSubscriptionRecord(channelId),
          ytIndexedDBStorage.getSubscriptionFeedVideo(videoId),
          ytIndexedDBStorage.getChannelSyncState(channelId),
        ]);
        const upgraded = await ytIndexedDBStorage._getDB();
        done({
          ok: true,
          version: upgraded.version,
          stores: [...upgraded.objectStoreNames],
          history,
          subscription,
          feedVideo,
          syncState,
        });
      })().catch((error) => done({ ok: false, error: error.message }));
    });
    assert.equal(preserved.ok, true, preserved.error);
    assert.equal(preserved.version, 7);
    assert.equal(preserved.stores.includes('local_unsubscribe_tombstones'), true);
    assert.equal(preserved.stores.includes('ai_label_results'), true);
    assert.deepEqual(preserved.history, {
      videoId: 'FxLegacyHistory', title: 'Preserved Firefox history', time: 12,
    });
    assert.equal(preserved.subscription.channelTitle, 'Preserved Firefox channel');
    assert.equal(preserved.subscription.source, 'manual');
    assert.equal(preserved.feedVideo.title, 'Preserved Firefox feed video');
    assert.equal(preserved.syncState.initializationState, 'complete');
  });

  await runScenario('Home and Subscriptions pagination', { locale: 'en' }, async (session) => {
    await waitForFeed(session);
    const seeded = await session.driver.executeAsyncScript((channelId, done) => {
      (async () => {
        const videoIds = Array.from({ length: 120 }, (_, index) => `Page${String(index).padStart(3, '0')}`);
        await ytIndexedDBStorage.putSubscriptionRecord({
          channelId,
          channelTitle: 'Firefox pagination fixture',
          source: 'manual',
          followedAt: 1700000000000,
        });
        await Promise.all(videoIds.map((videoId) => ytIndexedDBStorage.putSubscriptionFeedVideo({
          videoId,
          channelId,
          title: `Pagination ${videoId}`,
          thumbnailUrl: '',
          publishedAt: 1800000000000,
          discoveredAt: 1700000000000,
          lastSeenInFeedAt: 1700000000000,
          durationSeconds: 600,
          isShort: false,
          source: 'rss',
        })));
        await loadData();
        shortsOnly = false;
        subscriptionsChronological = false;
        showFeed();
        done({ ok: true });
      })().catch((error) => done({ ok: false, error: error.message }));
    }, PAGINATION_CHANNEL_ID);
    assert.equal(seeded.ok, true, seeded.error);

    const cardCount = () => session.driver.executeScript(() => (
      document.querySelectorAll('#grid .ytvht-feed-card').length
    ));
    const scrollToNextPage = async (expectedCount) => {
      await session.driver.executeScript(() => {
        document.querySelector('#feedPaginationSentinel')?.scrollIntoView({ block: 'center' });
      });
      await session.driver.wait(async () => (await cardCount()) === expectedCount,
        15000, `feed should render ${expectedCount} cards`);
    };

    await session.driver.wait(async () => (await cardCount()) === 50, 10000, 'Home should render 50 cards initially');
    await session.driver.executeScript(() => {
      window.__phase3HomeCards = [...document.querySelectorAll('#grid .ytvht-feed-card')];
    });
    await scrollToNextPage(100);
    assert.equal(await session.driver.executeScript(() => window.__phase3HomeCards.every(
      (card, index) => card === document.querySelectorAll('#grid .ytvht-feed-card')[index]
    )), true);
    await scrollToNextPage(120);
    assert.equal(await session.driver.executeScript(() => window.__phase3HomeCards.every(
      (card, index) => card === document.querySelectorAll('#grid .ytvht-feed-card')[index]
    )), true);
    const homeIds = await session.driver.executeScript(() => (
      [...document.querySelectorAll('#grid .ytvht-feed-card')].map((card) => card.dataset.ytvhtVideoId)
    ));
    assert.equal(new Set(homeIds).size, 120);

    await session.driver.findElement(By.css('#navSubscriptions')).click();
    await session.driver.wait(async () => (await cardCount()) === 50,
      15000, 'Subscriptions should fetch 50 records initially');
    const inserted = await session.driver.executeAsyncScript((channelId, done) => {
      ytIndexedDBStorage.putSubscriptionFeedVideo({
        videoId: 'InsertedAfterFirstPage',
        channelId,
        title: 'Inserted after first page',
        thumbnailUrl: '',
        publishedAt: 1900000000000,
        discoveredAt: Date.now(),
        lastSeenInFeedAt: Date.now(),
        durationSeconds: 600,
        isShort: false,
        source: 'rss',
      }).then(() => done({ ok: true })).catch((error) => done({ ok: false, error: error.message }));
    }, PAGINATION_CHANNEL_ID);
    assert.equal(inserted.ok, true, inserted.error);

    await scrollToNextPage(100);
    await scrollToNextPage(120);
    const subscriptionIds = await session.driver.executeScript(() => (
      [...document.querySelectorAll('#grid .ytvht-feed-card')].map((card) => card.dataset.ytvhtVideoId)
    ));
    assert.equal(new Set(subscriptionIds).size, 120);
    assert.equal(subscriptionIds.includes('InsertedAfterFirstPage'), false);
    assert.deepEqual(subscriptionIds.slice(0, 3), ['Page119', 'Page118', 'Page117']);
    assert.deepEqual(subscriptionIds.slice(-3), ['Page002', 'Page001', 'Page000']);

    const filtered = await session.driver.executeAsyncScript((done) => {
      (async () => {
        const ids = ['InsertedAfterFirstPage',
          ...Array.from({ length: 70 }, (_, index) => `Page${String(index + 50).padStart(3, '0')}`)];
        await Promise.all(ids.map((videoId) => ytStorage.setVideo(videoId, { videoId, time: 1 })));
        await loadData();
        const unwatched = document.getElementById('unwatched');
        unwatched.checked = true;
        unwatched.dispatchEvent(new Event('change', { bubbles: true }));
        done({ ok: true });
      })().catch((error) => done({ ok: false, error: error.message }));
    });
    assert.equal(filtered.ok, true, filtered.error);
    await session.driver.wait(async () => {
      const state = await session.driver.executeScript(() => ({
        cardCount: document.querySelectorAll('#grid .ytvht-feed-card').length,
        sentinelHidden: document.querySelector('#feedPaginationSentinel')?.hidden,
      }));
      return state.cardCount === 50 && state.sentinelHidden === true;
    }, 15000, 'Subscriptions should fill one filtered page and exhaust its cursor');
    const filteredIds = await session.driver.executeScript(() => (
      [...document.querySelectorAll('#grid .ytvht-feed-card')].map((card) => card.dataset.ytvhtVideoId)
    ));
    assert.deepEqual(filteredIds, Array.from({ length: 50 }, (_, index) => (
      `Page${String(49 - index).padStart(3, '0')}`
    )));

    const emptied = await session.driver.executeAsyncScript((done) => {
      (async () => {
        const ids = Array.from({ length: 50 }, (_, index) => `Page${String(index).padStart(3, '0')}`);
        await Promise.all(ids.map((videoId) => ytStorage.setVideo(videoId, { videoId, time: 1 })));
        await loadData();
        render();
        done({ ok: true });
      })().catch((error) => done({ ok: false, error: error.message }));
    });
    assert.equal(emptied.ok, true, emptied.error);
    await session.driver.wait(async () => session.driver.executeScript(() => (
      document.querySelectorAll('#grid .ytvht-feed-card').length === 0 &&
      document.querySelector('#empty')?.style.display === 'block'
    )), 15000, 'Subscriptions should show its empty state when filters exclude every page');
  });

  await runScenario('feed scan reload and Show semantics', { locale: 'en' }, async (session) => {
    const channelId = 'UCfirefoxphase2fixture00001';
    const discoveredVideoId = 'FxPhaseNew1';
    const retryVideoId = 'FxPhaseRetry';
    const filteredVideoId = 'FxPhaseShort';
    await waitForFeed(session);
    const seeded = await session.driver.executeAsyncScript((id, done) => {
      (async () => {
        const videoIds = Array.from({ length: 60 }, (_, index) => `FxPhase${String(index).padStart(2, '0')}`);
        await ytIndexedDBStorage.putSubscriptionRecord({
          channelId: id,
          channelTitle: 'Firefox Phase 2 fixture',
          source: 'manual',
          followedAt: 1700000000000,
        });
        await ytIndexedDBStorage.putChannelSyncState({
          channelId: id,
          initializationState: 'complete',
          lastAttemptAt: 1700000000000,
          lastSuccessfulCheckAt: 1700000000000,
          nextEligibleCheckAt: 4102444800000,
        });
        await Promise.all(videoIds.map((videoId, index) => ytIndexedDBStorage.putSubscriptionFeedVideo({
          videoId,
          channelId: id,
          title: `Firefox Phase 2 seed ${index}`,
          thumbnailUrl: '',
          publishedAt: 1800000000000 - index,
          discoveredAt: 1700000000000,
          lastSeenInFeedAt: 1700000000000,
          durationSeconds: 600,
          isShort: false,
          source: 'rss',
        })));
        await loadData();
        showFeed();
        done({ ok: true });
      })().catch((error) => done({ ok: false, error: error.message }));
    }, channelId);
    assert.equal(seeded.ok, true, seeded.error);
    await session.driver.wait(async () => session.driver.executeScript(() => (
      document.querySelectorAll('.ytvht-feed-card').length === 50
    )), 10000, 'Phase 2 seed cards should render');
    const labels = await session.driver.executeScript(() => ({
      scan: document.querySelector('#refresh')?.textContent,
      reload: document.querySelector('#reloadView')?.textContent,
      shareHeaderActions: document.querySelector('#refresh')?.parentElement === document.querySelector('#reloadView')?.parentElement,
    }));
    assert.equal(labels.scan, 'Reload videos');
    assert.equal(labels.reload, 'Refresh');
    assert.equal(labels.shareHeaderActions, true);
    await session.driver.executeScript(() => window.scrollTo(0, 500));

    const stable = await session.driver.executeAsyncScript((id, fixtureChannelId, done) => {
      (async () => {
        const grid = document.querySelector('#grid');
        const visibleAnchor = () => [...grid.querySelectorAll('[data-ytvht-video-id]')]
          .map((card) => ({ videoId: card.dataset.ytvhtVideoId, top: card.getBoundingClientRect().top }))
          .find((card) => card.top >= 0);
        const before = { html: grid.innerHTML, anchor: visibleAnchor() };
        await ytIndexedDBStorage.putSubscriptionFeedVideo({
          videoId: id,
          channelId: fixtureChannelId,
          title: 'Firefox newly discovered fixture',
          thumbnailUrl: '',
          publishedAt: 1900000000000,
          discoveredAt: Date.now(),
          lastSeenInFeedAt: Date.now(),
          durationSeconds: 900,
          isShort: false,
          source: 'rss',
        });
        await showNewFeedVideos([id]);
        done({
          ok: true,
          sameHtml: before.html === grid.innerHTML,
          beforeAnchor: before.anchor,
          afterAnchor: visibleAnchor(),
          status: document.querySelector('#status')?.textContent,
        });
      })().catch((error) => done({ ok: false, error: error.message }));
    }, discoveredVideoId, channelId);
    assert.equal(stable.ok, true, stable.error);
    assert.equal(stable.sameHtml, true);
    assert.equal(stable.afterAnchor.videoId, stable.beforeAnchor.videoId);
    assert.ok(Math.abs(stable.afterAnchor.top - stable.beforeAnchor.top) <= 1);
    assert.match(stable.status, /1 new subscription video available/);

    await openFirefoxExtensionPage(session, 'feed.html');
    await session.driver.wait(async () => session.driver.executeScript(() => (
      !document.documentElement.classList.contains('app-loading') &&
      document.querySelector('#status')?.textContent.includes('1 new subscription video available')
    )), 15000, 'pending discovery should restore through a real feed reload');
    const restoredIds = await session.driver.executeAsyncScript((done) => {
      browser.storage.local.get('ytvht.pendingFeedDiscovery.v1')
        .then((stored) => done(stored['ytvht.pendingFeedDiscovery.v1']?.videoIds || []))
        .catch((error) => done({ error: error.message }));
    });
    assert.deepEqual(restoredIds, [discoveredVideoId]);

    await session.driver.executeScript(() => {
      window.__phase2ScrolledTo = null;
      const original = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function scrollIntoView(options) {
        window.__phase2ScrolledTo = { videoId: this.dataset.ytvhtVideoId || null, options };
        if (original) original.call(this, options);
      };
    });
    await clickStatusAction(session);
    await session.driver.wait(async () => session.driver.executeScript((id) => (
      document.querySelector('.ytvht-feed-card')?.dataset.ytvhtVideoId === id &&
      window.__phase2ScrolledTo?.videoId === id
    ), discoveredVideoId), 15000, 'Show should pin and scroll to the new video');
    const pendingAfterShow = await session.driver.executeAsyncScript((done) => {
      browser.storage.local.get('ytvht.pendingFeedDiscovery.v1')
        .then((stored) => done(stored['ytvht.pendingFeedDiscovery.v1']?.videoIds || []));
    });
    assert.deepEqual(pendingAfterShow, []);

    const reloadSchedulerCalls = await session.driver.executeAsyncScript((done) => {
      const original = requestPageActiveFeedWork;
      let calls = 0;
      requestPageActiveFeedWork = (...args) => {
        calls += 1;
        return original(...args);
      };
      document.querySelector('#reloadView').click();
      setTimeout(() => {
        requestPageActiveFeedWork = original;
        done(calls);
      }, 0);
    });
    assert.equal(reloadSchedulerCalls, 0);
    await session.driver.wait(async () => session.driver.executeScript(() => (
      document.querySelector('#status')?.textContent.includes('View reloaded')
    )), 15000, 'Reload should report the refreshed local view');

    await session.driver.executeAsyncScript((id, done) => {
      showNewFeedVideos([id]).then(() => done()).catch((error) => done({ error: error.message }));
    }, retryVideoId);
    await clickStatusAction(session);
    await session.driver.wait(async () => session.driver.executeScript(() => (
      document.querySelector('#status')?.textContent.includes('1 stale discovery was removed from the new-videos notice.')
    )), 15000, 'missing discovery should be removed as stale');
    const pendingRetryIds = await session.driver.executeAsyncScript((done) => {
      browser.storage.local.get('ytvht.pendingFeedDiscovery.v1')
        .then((stored) => done(stored['ytvht.pendingFeedDiscovery.v1']?.videoIds || []));
    });
    assert.deepEqual(pendingRetryIds, []);

    const filterSeeded = await session.driver.executeAsyncScript((id, fixtureChannelId, done) => {
      (async () => {
        await ytIndexedDBStorage.putSubscriptionFeedVideo({
          videoId: id,
          channelId: fixtureChannelId,
          title: 'Firefox filtered Shorts fixture',
          thumbnailUrl: '',
          publishedAt: 1960000000000,
          discoveredAt: Date.now(),
          lastSeenInFeedAt: Date.now(),
          durationSeconds: 30,
          isShort: true,
          source: 'rss',
        });
        await showNewFeedVideos([id]);
        done({ ok: true });
      })().catch((error) => done({ ok: false, error: error.message }));
    }, filteredVideoId, channelId);
    assert.equal(filterSeeded.ok, true, filterSeeded.error);
    await clickStatusAction(session);
    await session.driver.wait(async () => session.driver.executeScript(() => (
      document.querySelector('#status')?.textContent.includes('0 new videos shown. 1 new video is hidden: Shorts (1).')
    )), 15000, 'Show should report a pending video hidden by filters');

  });

  await runScenario('Analytics restored insights and channel sorting', { locale: 'en' }, async (session) => {
    await waitForFeed(session);
    const seeded = await session.driver.executeAsyncScript((done) => {
      (async () => {
        const records = [
          { videoId: 'AnalyticsLongest', title: 'Longest unfinished fixture', channelName: 'Longest Channel', channelId: 'UCLongestAnalyticsFixture', time: 1000, duration: 7200 },
          { videoId: 'AnalyticsWatchLong', title: 'Watch-time long fixture', channelName: 'Watch Time Channel', channelId: 'UCWatchTimeAnalyticsFixture', time: 60, duration: 1000 },
          { videoId: 'AnalyticsWatchShort', title: 'Watch-time Short fixture', channelName: 'Watch Time Channel', channelId: 'UCWatchTimeAnalyticsFixture', time: 340, duration: 40, isShorts: true },
          { videoId: 'AnalyticsCount1', title: 'Count one', channelName: 'Video Count Channel', channelId: 'UCVideoCountAnalyticsFixture', time: 100, duration: 300 },
          { videoId: 'AnalyticsCount2', title: 'Count two', channelName: 'Video Count Channel', channelId: 'UCVideoCountAnalyticsFixture', time: 100, duration: 300 },
          { videoId: 'AnalyticsCount3', title: 'Count three', channelName: 'Video Count Channel', channelId: 'UCVideoCountAnalyticsFixture', time: 100, duration: 300 },
          { videoId: 'AnalyticsAlphaSkip', title: 'Alpha skipped', channelName: 'Alpha Skipped', channelId: 'UCAlphaSkippedAnalytics', time: 50, duration: 600 },
          { videoId: 'AnalyticsZetaSkip', title: 'Zeta skipped', channelName: 'Zeta Skipped', channelId: 'UCZetaSkippedAnalytics', time: 50, duration: 1000 },
          { videoId: 'AnalyticsNoId', title: 'No channel ID fixture', channelName: 'No ID Channel', time: 80, duration: 300 },
          { videoId: 'AnalyticsComplete', title: 'Completed long fixture', channelName: '', channelId: '', time: 900, duration: 1000 },
          { videoId: 'AnalyticsExcludedShort', title: 'Excluded Short fixture', channelName: 'Excluded Short Channel', channelId: 'UCExcludedShortAnalytics', time: 0, duration: 9000, isShorts: true },
        ];
        await Promise.all(records.map((record) => ytStorage.setVideo(record.videoId, {
          ...record,
          url: `https://www.youtube.com/watch?v=${record.videoId}`,
          timestamp: 1700000000000,
        })));
        done({ ok: true, videoIds: records.map((record) => record.videoId) });
      })().catch((error) => done({ ok: false, error: error.message }));
    });
    assert.equal(seeded.ok, true, seeded.error);

    await session.driver.findElement(By.css('#analyticsToggle')).click();
    await session.driver.wait(async () => session.driver.executeScript(() => (
      document.querySelectorAll('#anTopChannels .an-channel-row').length === 6 &&
      document.querySelectorAll('#anLongestUnfinished .an-continue').length === 4
    )), 15000, 'restored analytics should render from full local history');
    const initial = await session.driver.executeScript(() => {
      const topRows = [...document.querySelectorAll('#anTopChannels .an-channel-row')];
      const watchTimeRow = topRows.find((row) => row.textContent.includes('Watch Time Channel'));
      const noIdRow = topRows.find((row) => row.textContent.includes('No ID Channel'));
      const noIdName = noIdRow?.querySelector('.an-channel-name');
      const skippedRows = [...document.querySelectorAll('#anSkippedChannels .an-channel-row')];
      const unfinished = [...document.querySelectorAll('#anLongestUnfinished .an-continue')];
      return {
        firstTop: topRows[0]?.querySelector('.an-channel-name')?.textContent,
        firstTopHref: topRows[0]?.querySelector('.an-channel-name')?.getAttribute('href'),
        watchTimeStat: watchTimeRow?.querySelector('.an-channel-stat')?.textContent,
        noIdTag: noIdName?.tagName,
        noIdHref: noIdName?.getAttribute('href'),
        metric: document.querySelector('#anTopChannelsMetric')?.textContent,
        watchPressed: document.querySelector('[data-analytics-channel-sort="watchTime"]')?.getAttribute('aria-pressed'),
        firstSkipped: skippedRows[0]?.querySelector('.an-channel-name')?.textContent,
        firstSkippedHref: skippedRows[0]?.querySelector('.an-channel-name')?.getAttribute('href'),
        skippedText: document.querySelector('#anSkippedChannels')?.textContent,
        firstUnfinished: unfinished[0]?.querySelector('.an-continue-title')?.textContent,
        firstUnfinishedHref: unfinished[0]?.getAttribute('href'),
        unfinishedText: document.querySelector('#anLongestUnfinished')?.textContent,
        skippedMetric: document.querySelector('[data-i18n="feed_analytics_skipped_metric"]')?.textContent,
        unfinishedMetric: document.querySelector('[data-i18n="feed_analytics_unfinished_metric"]')?.textContent,
      };
    });
    assert.equal(initial.firstTop, 'Longest Channel');
    assert.equal(initial.firstTopHref, 'https://www.youtube.com/channel/UCLongestAnalyticsFixture');
    assert.match(initial.watchTimeStat, /2 videos/);
    assert.equal(initial.noIdTag, 'DIV');
    assert.equal(initial.noIdHref, null);
    assert.equal(initial.metric, 'Ranked by local watch time');
    assert.equal(initial.watchPressed, 'true');
    assert.equal(initial.firstSkipped, 'Alpha Skipped');
    assert.equal(initial.firstSkippedHref, 'https://www.youtube.com/channel/UCAlphaSkippedAnalytics');
    assert.doesNotMatch(initial.skippedText, /Excluded Short Channel/);
    assert.equal(initial.firstUnfinished, 'Longest unfinished fixture');
    assert.match(initial.firstUnfinishedHref, /watch\?v=AnalyticsLongest&t=1000/);
    assert.doesNotMatch(initial.unfinishedText, /Excluded Short fixture/);
    assert.match(initial.skippedMetric, /under 10%/);
    assert.match(initial.unfinishedMetric, /under 90%/);

    await session.driver.findElement(By.css('[data-analytics-channel-sort="videos"]')).click();
    await session.driver.wait(async () => session.driver.executeScript(() => (
      document.querySelector('#anTopChannels .an-channel-name')?.textContent === 'Video Count Channel'
    )), 10000, 'Videos watched should re-sort Top Channels');
    const sorted = await session.driver.executeScript(() => ({
      metric: document.querySelector('#anTopChannelsMetric')?.textContent,
      videosPressed: document.querySelector('[data-analytics-channel-sort="videos"]')?.getAttribute('aria-pressed'),
    }));
    assert.equal(sorted.metric, 'Ranked by watched video records');
    assert.equal(sorted.videosPressed, 'true');

    const emptied = await session.driver.executeAsyncScript((videoIds, done) => {
      Promise.all(videoIds.map((videoId) => ytStorage.removeVideo(videoId)))
        .then(() => renderAnalytics())
        .then(() => done({
          top: document.querySelector('#anTopChannels')?.textContent,
          skipped: document.querySelector('#anSkippedChannels')?.textContent,
          unfinished: document.querySelector('#anLongestUnfinished')?.textContent,
        }))
        .catch((error) => done({ error: error.message }));
    }, seeded.videoIds);
    assert.equal(emptied.error, undefined);
    assert.match(emptied.top, /most-watched channels/);
    assert.match(emptied.skipped, /No skipped channels found/);
    assert.match(emptied.unfinished, /No unfinished long videos found/);
  });

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

  await runScenario('canonical v6 subscription backup round trip', { locale: 'en' }, async (session) => {
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
    assert.equal(result.dataVersion, '2.2');
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

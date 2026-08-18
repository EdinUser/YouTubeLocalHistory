const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { By, until } = require('selenium-webdriver');
const {
  assertSafeTempProfile,
  discoverFirefoxExtensionUuid,
  getExtensionStorage,
  launchFirefoxWithExtension,
  openFirefoxExtensionPage,
  removeExtensionStorage,
  setExtensionStorage,
} = require('./firefox-fixture');

async function main() {
  const session = await launchFirefoxWithExtension();

  try {
    assert.match(
      session.extensionId,
      /fallenangelbg@protonmail\.com|^[{]?[0-9a-f-]+[}]?$/i,
      `Unexpected Firefox extension id: ${session.extensionId}`
    );

    assertSafeTempProfile(session.profileDir);
    assert.equal(fs.existsSync(session.profileDir), true, 'temporary Firefox profile should exist while running');

    const extensionUuid = await discoverFirefoxExtensionUuid(session);
    assert.match(extensionUuid, /^[0-9a-f-]+$/i, `Unexpected Firefox moz-extension UUID: ${extensionUuid}`);

    await session.driver.get('about:blank');
    await session.driver.wait(until.elementLocated(By.css('body')), 10000);

    await setExtensionStorage(session, {
      video_firefoxpopupstable: {
        videoId: 'firefoxpopupstable',
        title: 'Firefox stable popup fixture',
        channelName: 'Firefox popup fixture channel',
        url: 'https://www.youtube.com/watch?v=firefoxpopupstable',
        thumbnail: 'https://i.ytimg.com/vi/firefoxpopupstable/mqdefault.jpg',
        time: 30,
        duration: 120,
        timestamp: Date.now(),
      },
    });
    const popupUrl = await openFirefoxExtensionPage(session, 'popup.html');
    assert.equal(
      await session.driver.executeScript(() => typeof browser !== 'undefined' && !!browser.storage && !!browser.storage.local),
      true,
      'extension page should expose browser.storage.local'
    );
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) await openFirefoxExtensionPage(session, 'popup.html');
      await session.driver.wait(until.elementLocated(By.css('#ytvhtHistoryTable .video-cell')), 10000);
      const popupState = await session.driver.executeAsyncScript((done) => {
        (async () => {
          const samples = [];
          for (let index = 0; index < 12; index += 1) {
            const cell = document.querySelector('.video-cell');
            samples.push({
              bodySkeleton: document.body.classList.contains('loading-skeleton'),
              opacity: cell ? getComputedStyle(cell).opacity : null,
              pulseAnimations: document.getAnimations().filter((animation) =>
                String(animation.animationName || '').toLowerCase().includes('pulse')
              ).length,
            });
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          done({
            samples,
            iconComplete: document.querySelector('.popup-title-icon')?.complete === true,
            version: document.querySelector('#ytvhtHeaderVersion')?.textContent || '',
          });
        })().catch((error) => done({ error: error.message }));
      });
      assert.equal(popupState.error, undefined, popupState.error);
      assert.equal(popupState.iconComplete, true, 'popup title icon should load');
      assert.match(popupState.version, /^v\d+\.\d+\.\d+/, 'popup should show the extension version');
      assert.equal(popupState.samples.every((sample) => !sample.bodySkeleton), true, 'popup must not enter skeleton mode');
      assert.equal(popupState.samples.every((sample) => sample.opacity === '1'), true, 'popup content opacity must remain stable');
      assert.equal(popupState.samples.every((sample) => sample.pulseAnimations === 0), true, 'popup must not run pulse animations');
    }

    await openFirefoxExtensionPage(session, 'feed.html');
    await session.driver.wait(until.elementLocated(By.css('#refresh')), 10000);
    const schedulerStatusCount = await session.driver.findElements(By.css('#feedSyncStatus')).then((elements) => elements.length);
    assert.equal(schedulerStatusCount, 1, 'feed page should expose one scheduler-status surface beside Refresh');
    await session.driver.wait(async () => session.driver.executeScript(() =>
      !document.documentElement.classList.contains('app-loading') &&
      document.querySelector('#feedSyncStatus')?.getAttribute('aria-busy') !== 'true'
    ), 10000, 'automatic feed startup should settle before installing the controlled scan');
    await session.driver.executeAsyncScript((done) => {
      requestPageActiveFeedWork().then(() => done({ ok: true }), (error) => done({ ok: false, error: error.message }));
    }).then((result) => assert.equal(result.ok, true, result.error));

    await session.driver.executeAsyncScript((done) => {
      (async () => {
        clearPageFeedWorkTimer();
        const channelId = 'UC9876543210abcdefghijkl';
        const thumbnailUrl = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
        await ytIndexedDBStorage.putSubscriptionRecord({ channelId, channelTitle: 'Firefox progress fixture', source: 'manual', followedAt: 1 });
        await ytIndexedDBStorage.putSubscriptionFeedVideo({
          videoId: 'firefox-cached-progress', channelId, title: 'Firefox cached fixture upload', thumbnailUrl,
          publishedAt: 100, discoveredAt: 100, lastSeenInFeedAt: 100, durationSeconds: null, isShort: null, source: 'rss'
        });
        await ytIndexedDBStorage.putChannelSyncState({ channelId, initializationState: 'pending', nextEligibleCheckAt: 0, scanLeaseUntil: null, scanRunId: null });
        await loadData();
        subscriptionsChronological = true;
        showFeed();
        const scheduler = ensureSharedFeedScheduler();
        scheduler.fetchChannelRss = () => new Promise((resolve) => { window.__releaseFirefoxFixtureScan = resolve; });
        window.__firefoxFixtureRun = requestPageActiveFeedWork();
        done({ ok: true });
      })().catch((error) => done({ ok: false, error: error.message }));
    }).then((result) => assert.equal(result.ok, true, result.error));
    try {
      await session.driver.wait(async () => session.driver.executeScript(() =>
        document.querySelector('#grid')?.textContent.includes('Firefox cached fixture upload') &&
        document.querySelector('#feedSyncStatus')?.textContent.includes('Scanning channels') &&
        typeof window.__releaseFirefoxFixtureScan === 'function'
      ), 10000, 'cached inventory and initialization progress should render before the fixture scan resolves');
    } catch (error) {
      const diagnostic = await session.driver.executeScript(() => ({
        releaseType: typeof window.__releaseFirefoxFixtureScan,
        runType: typeof window.__firefoxFixtureRun,
        syncStatus: document.querySelector('#feedSyncStatus')?.textContent || '',
        syncBusy: document.querySelector('#feedSyncStatus')?.getAttribute('aria-busy') || '',
        gridText: document.querySelector('#grid')?.textContent || ''
      }));
      error.message = `${error.message}. State: ${JSON.stringify(diagnostic)}`;
      throw error;
    }
    await session.driver.executeAsyncScript((done) => {
      window.__releaseFirefoxFixtureScan(ytvhtFeedContracts.createRssScanResult({
        channelId: 'UC9876543210abcdefghijkl', fetchedAt: Date.now(), entries: [{
          videoId: 'firefox-scanned-progress', title: 'Firefox scanned fixture upload', publishedAt: Date.now(),
          thumbnailUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='
        }]
      }));
      window.__firefoxFixtureRun.then(() => done({ ok: true }), (error) => done({ ok: false, error: error.message }));
    }).then((result) => assert.equal(result.ok, true, result.error));
    assert.equal(
      await session.driver.executeScript(() => document.querySelector('#grid')?.textContent.includes('Firefox scanned fixture upload')),
      false,
      'new inventory should wait for Show instead of reordering the visible subscriptions view'
    );

    await session.driver.executeAsyncScript((done) => {
      (async () => {
        const channelId = 'UC1234567890abcdefghijkl';
        const thumbnailUrl = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
        await ytIndexedDBStorage.putSubscriptionRecord({ channelId, channelTitle: 'Firefox fixture channel', source: 'manual', followedAt: 1 });
        await ytIndexedDBStorage.putSubscriptionFeedVideo({
          videoId: 'firefox-local-video', channelId, title: 'Firefox local fixture upload', thumbnailUrl,
          publishedAt: 100, discoveredAt: 100, lastSeenInFeedAt: 100, durationSeconds: null, isShort: null, source: 'rss'
        });
        await loadData();
        subscriptionsChronological = false;
        showFeed();
        await ytIndexedDBStorage.putSubscriptionFeedVideo({
          videoId: 'firefox-new-video', channelId, title: 'Firefox new fixture upload', thumbnailUrl,
          publishedAt: 200, discoveredAt: 200, lastSeenInFeedAt: 200, durationSeconds: null, isShort: null, source: 'rss'
        });
        await showNewFeedVideos(['firefox-new-video']);
        done({ ok: true });
      })().catch((error) => done({ ok: false, error: error.message }));
    }).then((result) => assert.equal(result.ok, true, result.error));
    await session.driver.findElement(By.css('#status button')).click();
    await session.driver.wait(async () => session.driver.executeScript(() =>
      document.querySelector('#grid')?.textContent.includes('Firefox new fixture upload')
    ), 10000, 'Show should load chronological local subscriptions');
    await session.driver.executeScript(() => {
      const search = document.querySelector('#search');
      search.value = 'firefox local';
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await session.driver.wait(async () => session.driver.executeScript(() =>
      document.querySelector('#localSearchResults')?.textContent.includes('Firefox local fixture upload')
    ), 10000, 'local search should render the fixture inventory');

    await session.driver.executeAsyncScript((done) => {
      (async () => {
        const channelId = 'UCfirefoxsortreload00001';
        const thumbnailUrl = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
        await ytIndexedDBStorage.putSubscriptionRecord({
          channelId,
          channelTitle: 'Firefox sort reload fixture',
          source: 'manual',
          followedAt: 1,
        });
        await ytIndexedDBStorage.putChannelSyncState({
          channelId,
          initializationState: 'complete',
          lastSuccessfulCheckAt: Date.now(),
          nextEligibleCheckAt: 4102444800000,
        });
        const now = Date.now();
        for (const [videoId, title, publishedAt] of [
          ['fxsortnew01', 'Firefox sort newest', now - 1000],
          ['fxsortmid001', 'Firefox sort middle', now - 2000],
          ['fxsortold001', 'Firefox sort oldest', now - 3000],
        ]) {
          await ytIndexedDBStorage.putSubscriptionFeedVideo({
            videoId, channelId, title, thumbnailUrl,
            publishedAt, discoveredAt: now,
            lastSeenInFeedAt: publishedAt, durationSeconds: null, isShort: null, source: 'rss',
          });
        }
        document.querySelector('#search').value = '';
        await loadData();
        subscriptionsChronological = true;
        showFeed();
        const sort = document.querySelector('#subscriptionSort');
        sort.value = 'published_asc';
        sort.dispatchEvent(new Event('change', { bubbles: true }));
        done({ ok: true });
      })().catch((error) => done({ ok: false, error: error.message }));
    }).then((result) => assert.equal(result.ok, true, result.error));
    const getFirefoxSortTitles = () => session.driver.executeScript(() => [...document.querySelectorAll('#grid .ytvht-card-title')]
      .map((element) => element.textContent.trim())
      .filter((title) => title.startsWith('Firefox sort')));
    await session.driver.wait(async () => (await getFirefoxSortTitles()).length === 3, 10000, 'sorted fixture videos should render');
    assert.deepEqual(await getFirefoxSortTitles(), ['Firefox sort oldest', 'Firefox sort middle', 'Firefox sort newest']);

    await session.driver.navigate().refresh();
    await session.driver.wait(async () => session.driver.executeScript(() =>
      !document.documentElement.classList.contains('app-loading') && !!document.querySelector('#subscriptionSort')
    ), 15000, 'feed should reload for persisted sort verification');
    await session.driver.executeAsyncScript((done) => {
      loadData().then(() => {
        subscriptionsChronological = true;
        showFeed();
        done({ ok: true });
      }).catch((error) => done({ ok: false, error: error.message }));
    }).then((result) => assert.equal(result.ok, true, result.error));
    assert.equal(
      await session.driver.executeScript(() => document.querySelector('#subscriptionSort').value),
      'published_asc',
      'subscription sort selection should persist through reload'
    );
    await session.driver.wait(async () => (await getFirefoxSortTitles()).length === 3, 10000, 'reloaded sorted videos should render');
    assert.deepEqual(await getFirefoxSortTitles(), ['Firefox sort oldest', 'Firefox sort middle', 'Firefox sort newest']);

    await setExtensionStorage(session, { __firefox_e2e_smoke__: { ok: true } });
    assert.deepEqual(
      await getExtensionStorage(session, ['__firefox_e2e_smoke__']),
      { __firefox_e2e_smoke__: { ok: true } },
      'extension page should read and write browser.storage.local'
    );
    await removeExtensionStorage(session, ['__firefox_e2e_smoke__']);
    assert.deepEqual(
      await getExtensionStorage(session, ['__firefox_e2e_smoke__']),
      {},
      'extension page should remove browser.storage.local keys'
    );

    const profileRoot = path.resolve(session.profileDir);
    assert.ok(
      profileRoot.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`),
      `temporary Firefox profile should be under ${os.tmpdir()}: ${profileRoot}`
    );

    console.log(`Firefox extension smoke passed with addon ${session.extensionId}`);
    console.log(`Firefox extension page opened at ${popupUrl}`);
    console.log(`Firefox profile was isolated at ${session.profileDir}`);
  } finally {
    const profileDir = session.profileDir;
    await session.cleanup();
    assert.equal(fs.existsSync(profileDir), false, 'temporary Firefox profile should be removed after cleanup');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

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

    const popupUrl = await openFirefoxExtensionPage(session, 'popup.html');
    assert.equal(
      await session.driver.executeScript(() => typeof browser !== 'undefined' && !!browser.storage && !!browser.storage.local),
      true,
      'extension page should expose browser.storage.local'
    );

    await openFirefoxExtensionPage(session, 'feed.html');
    await session.driver.wait(until.elementLocated(By.css('#refresh')), 10000);
    const schedulerStatusCount = await session.driver.findElements(By.css('#feedSyncStatus')).then((elements) => elements.length);
    assert.equal(schedulerStatusCount, 1, 'feed page should expose one scheduler-status surface beside Refresh');

    await session.driver.executeAsyncScript((done) => {
      (async () => {
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
    await session.driver.wait(async () => session.driver.executeScript(() =>
      document.querySelector('#grid')?.textContent.includes('Firefox cached fixture upload') &&
      document.querySelector('#feedSyncStatus')?.textContent.includes('Scanning channels')
    ), 10000, 'cached inventory and initialization progress should render before the fixture scan resolves');
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
        showNewFeedVideos(1);
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

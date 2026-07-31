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

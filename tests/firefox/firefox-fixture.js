const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Builder, Browser } = require('selenium-webdriver');
const firefox = require('selenium-webdriver/firefox');

const root = path.resolve(__dirname, '../..');
const firefoxBuildDir = path.join(root, 'build', 'e2e', 'firefox');
const firefoxXpiPath = path.join(root, 'build', 'e2e', 'firefox-e2e.xpi');
const firefoxExtensionId = 'fallenangelbg@protonmail.com';
const userFirefoxRoot = path.join(os.homedir(), '.mozilla');

function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function assertSafeTempProfile(profileDir) {
  const resolved = path.resolve(profileDir);
  const tmpRoot = path.resolve(os.tmpdir());

  if (!resolved.startsWith(`${tmpRoot}${path.sep}`)) {
    throw new Error(`Firefox E2E profile must live under ${tmpRoot}; got ${resolved}`);
  }

  if (resolved.startsWith(`${userFirefoxRoot}${path.sep}`)) {
    throw new Error(`Firefox E2E profile must never use the real Firefox profile root: ${resolved}`);
  }
}

function createFirefoxOptions(profileDir) {
  const options = new firefox.Options()
    .setProfile(profileDir)
    .setPreference('browser.shell.checkDefaultBrowser', false)
    .setPreference('browser.tabs.warnOnClose', false)
    .setPreference('browser.startup.homepage', 'about:blank')
    .setPreference('datareporting.healthreport.uploadEnabled', false)
    .setPreference('datareporting.policy.dataSubmissionEnabled', false)
    .setPreference('toolkit.telemetry.enabled', false);

  // Use the same debugging override as Chromium extension tests.
  if (process.env.PW_HEADED !== '1') {
    options.addArguments('-headless');
  }

  if (process.env.FIREFOX_BINARY) {
    options.setBinary(process.env.FIREFOX_BINARY);
  }

  return options;
}

function parseFirefoxPrefs(profileDir) {
  const prefsPath = path.join(profileDir, 'prefs.js');
  if (!fs.existsSync(prefsPath)) {
    return {};
  }

  const prefs = {};
  const content = fs.readFileSync(prefsPath, 'utf8');
  const regex = /^user_pref\("([^"]+)",\s*(.*)\);$/gm;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const key = match[1];
    const rawValue = match[2];

    try {
      prefs[key] = JSON.parse(rawValue);
    } catch {
      prefs[key] = rawValue;
    }
  }

  return prefs;
}

async function discoverFirefoxExtensionUuid(session) {
  const { driver, profileDir, runtimeProfileDir, extensionId = firefoxExtensionId } = session;
  assertSafeTempProfile(profileDir);
  if (runtimeProfileDir) {
    assertSafeTempProfile(runtimeProfileDir);
  }

  const originalContext = await driver.getContext().catch(() => null);
  try {
    await driver.setContext(firefox.Context.CHROME);
    const hostname = await driver.executeScript((id) => {
      const policy = WebExtensionPolicy.getByID(id);
      return policy ? policy.mozExtensionHostname : null;
    }, extensionId);

    if (typeof hostname === 'string' && hostname.length > 0) {
      return hostname;
    }
  } catch {
    // Firefox may require -remote-allow-system-access for chrome context.
    // WebDriver rejects that flag through capabilities, so fall back to profile metadata.
  } finally {
    if (originalContext) {
      await driver.setContext(originalContext).catch(() => {});
    } else {
      await driver.setContext(firefox.Context.CONTENT).catch(() => {});
    }
  }

  for (let attempt = 0; attempt < 20; attempt++) {
    const prefs = parseFirefoxPrefs(runtimeProfileDir || profileDir);
    const uuidMap = prefs['extensions.webextensions.uuids'];

    if (uuidMap && typeof uuidMap === 'object' && typeof uuidMap[extensionId] === 'string') {
      return uuidMap[extensionId];
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Could not discover Firefox moz-extension UUID for ${extensionId}`);
}

async function openFirefoxExtensionPage(session, pagePath = 'popup.html') {
  const uuid = await discoverFirefoxExtensionUuid(session);
  const normalizedPath = pagePath.replace(/^\/+/, '');
  const url = `moz-extension://${uuid}/${normalizedPath}`;

  await session.driver.get(url);
  return url;
}

async function withFirefoxExtensionPage(session, fn, pagePath = 'popup.html') {
  const { driver } = session;
  const originalHandle = await driver.getWindowHandle();

  await driver.switchTo().newWindow('tab');
  try {
    const url = await openFirefoxExtensionPage(session, pagePath);
    return await fn(url);
  } finally {
    await driver.close().catch(() => {});
    await driver.switchTo().window(originalHandle);
  }
}

async function executeStorageOperation(session, operation, payload) {
  return withFirefoxExtensionPage(session, async () => {
    const result = await session.driver.executeAsyncScript((op, data, done) => {
      Promise.resolve()
        .then(async () => {
          if (op === 'get') {
            return browser.storage.local.get(data);
          }
          if (op === 'set') {
            await browser.storage.local.set(data);
            return true;
          }
          if (op === 'remove') {
            await browser.storage.local.remove(data);
            return true;
          }
          throw new Error(`Unknown storage operation: ${op}`);
        })
        .then((value) => done({ ok: true, value }))
        .catch((error) => done({ ok: false, error: error && error.message ? error.message : String(error) }));
    }, operation, payload);

    if (!result || result.ok !== true) {
      throw new Error(`Firefox extension storage ${operation} failed: ${result && result.error}`);
    }

    return result.value;
  });
}

async function getFirefoxStorage(session, keys) {
  return executeStorageOperation(session, 'get', keys);
}

async function setFirefoxStorage(session, data) {
  return executeStorageOperation(session, 'set', data);
}

async function removeFirefoxStorage(session, keys) {
  return executeStorageOperation(session, 'remove', keys);
}

async function getExtensionStorage(session, keys) {
  return getFirefoxStorage(session, keys);
}

async function setExtensionStorage(session, data) {
  return setFirefoxStorage(session, data);
}

async function removeExtensionStorage(session, keys) {
  return removeFirefoxStorage(session, keys);
}

async function getStoredVideo(session, videoId) {
  const items = await getExtensionStorage(session, [`video_${videoId}`]);
  return items[`video_${videoId}`] || null;
}

async function getLocalSubscription(session, channelId) {
  return withFirefoxExtensionPage(session, async () => {
    const result = await session.driver.executeAsyncScript((id, done) => {
      browser.runtime.getBackgroundPage()
        .then((background) => background.ytIndexedDBStorage.getSubscriptionRecord(id))
        .then((value) => done({ ok: true, value }))
        .catch((error) => done({ ok: false, error: error && error.message ? error.message : String(error) }));
    }, channelId);
    if (!result || result.ok !== true) {
      throw new Error(`Firefox local subscription read failed: ${result && result.error}`);
    }
    return result.value;
  });
}

async function removeStoredVideo(session, videoId) {
  await removeExtensionStorage(session, [`video_${videoId}`]);
}

async function setExtensionSettings(session, settings) {
  await setExtensionStorage(session, { settings });
}

async function seedStoredVideo(session, videoId, record) {
  await setExtensionStorage(session, {
    [`video_${videoId}`]: {
      videoId,
      ...record,
    },
  });
}

async function launchFirefoxWithExtension() {
  if (!fs.existsSync(path.join(firefoxBuildDir, 'manifest.json'))) {
    throw new Error('Missing build/e2e/firefox/manifest.json. Run `npm run build:e2e:firefox` first.');
  }
  if (!fs.existsSync(firefoxXpiPath)) {
    throw new Error('Missing build/e2e/firefox-e2e.xpi. Run `npm run build:e2e:firefox` first.');
  }

  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytlh-firefox-e2e-profile-'));
  assertSafeTempProfile(profileDir);

  let driver;

  try {
    driver = await new Builder()
      .forBrowser(Browser.FIREFOX)
      .setFirefoxOptions(createFirefoxOptions(profileDir))
      .setFirefoxService(new firefox.ServiceBuilder().addArguments('--allow-system-access'))
      .build();

    const capabilities = await driver.getCapabilities();
    const runtimeProfileDir = capabilities.get('moz:profile') || profileDir;
    assertSafeTempProfile(runtimeProfileDir);
    const installedExtensionId = await driver.installAddon(firefoxBuildDir, true);

    return {
      driver,
      extensionId: installedExtensionId,
      profileDir,
      runtimeProfileDir,
      async cleanup() {
        if (driver) {
          await driver.quit();
          driver = null;
        }
        if (runtimeProfileDir && runtimeProfileDir !== profileDir) {
          assertSafeTempProfile(runtimeProfileDir);
          removeDir(runtimeProfileDir);
        }
        removeDir(profileDir);
      },
    };
  } catch (error) {
    if (driver) {
      await driver.quit();
    }
    removeDir(profileDir);
    throw error;
  }
}

module.exports = {
  assertSafeTempProfile,
  discoverFirefoxExtensionUuid,
  firefoxBuildDir,
  firefoxExtensionId,
  firefoxXpiPath,
  getExtensionStorage,
  getFirefoxStorage,
  getLocalSubscription,
  getStoredVideo,
  launchFirefoxWithExtension,
  openFirefoxExtensionPage,
  parseFirefoxPrefs,
  removeExtensionStorage,
  removeFirefoxStorage,
  removeStoredVideo,
  seedStoredVideo,
  setExtensionSettings,
  setExtensionStorage,
  setFirefoxStorage,
  withFirefoxExtensionPage,
};

async function getServiceWorker(context) {
  const existing = context.serviceWorkers().find((worker) => worker.url().includes('background.js'));
  if (existing) {
    return existing;
  }

  return context.waitForEvent('serviceworker', {
    timeout: 15000,
    predicate: (worker) => worker.url().includes('background.js'),
  });
}

async function getExtensionStorage(context, keys) {
  const serviceWorker = await getServiceWorker(context);
  return serviceWorker.evaluate(
    (storageKeys) =>
      new Promise((resolve) => {
        chrome.storage.local.get(storageKeys, resolve);
      }),
    keys
  );
}

async function setExtensionStorage(context, data) {
  const serviceWorker = await getServiceWorker(context);
  await serviceWorker.evaluate(
    (storageData) =>
      new Promise((resolve) => {
        chrome.storage.local.set(storageData, resolve);
      }),
    data
  );
}

async function removeExtensionStorage(context, keys) {
  const serviceWorker = await getServiceWorker(context);
  await serviceWorker.evaluate(
    (storageKeys) =>
      new Promise((resolve) => {
        chrome.storage.local.remove(storageKeys, resolve);
      }),
    keys
  );
}

async function getStoredVideo(context, videoId) {
  const items = await getExtensionStorage(context, [`video_${videoId}`]);
  return items[`video_${videoId}`] || null;
}

async function removeStoredVideo(context, videoId) {
  await removeExtensionStorage(context, [`video_${videoId}`]);
}

async function setExtensionSettings(context, settings) {
  await setExtensionStorage(context, { settings });
}

async function seedStoredVideo(context, videoId, record) {
  await setExtensionStorage(context, {
    [`video_${videoId}`]: {
      videoId,
      ...record,
    },
  });
}

module.exports = {
  getExtensionStorage,
  getServiceWorker,
  getStoredVideo,
  removeExtensionStorage,
  removeStoredVideo,
  seedStoredVideo,
  setExtensionSettings,
  setExtensionStorage,
};

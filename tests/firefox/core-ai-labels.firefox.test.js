const assert = require('node:assert/strict');
const {
  launchFirefoxWithExtension,
  setExtensionSettings,
} = require('./firefox-fixture');

const KNOWN_AI_VIDEO_ID = 'rzekIMUxrtg';
const SEARCH_URL = `https://www.youtube.com/results?search_query=${KNOWN_AI_VIDEO_ID}`;

async function main() {
  if (process.env.RUN_LIVE_AI_LABEL_CANARY !== '1') {
    console.log('Firefox AI-label canary skipped (set RUN_LIVE_AI_LABEL_CANARY=1).');
    return;
  }

  const session = await launchFirefoxWithExtension({ locale: 'en' });
  try {
    await setExtensionSettings(session, {
      aiLabeledVideoHandling: 'off',
      debug: false,
      version: '5.2.0',
    });
    await session.driver.get(SEARCH_URL);
    await session.driver.wait(
      () => session.driver.executeScript(() => document.scripts.length > 0),
      30000,
      'YouTube should provide page scripts for the current client context'
    );
    await session.driver.wait(
      () => session.driver.executeScript(() => Boolean(document.querySelector('#ytvht-styles'))),
      30000,
      'the extension content script should initialize on YouTube'
    );
    await session.driver.wait(
      () => session.driver.executeScript((videoId) => {
        const card = [...document.querySelectorAll('ytd-video-renderer')].find((candidate) => {
          const rect = candidate.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
        if (!card) return false;
        card.id = 'ytvht-ai-live-canary-card';
        card.setAttribute('video-id', videoId);
        card.scrollIntoView({ block: 'center', inline: 'nearest' });
        return true;
      }, KNOWN_AI_VIDEO_ID),
      30000,
      'YouTube search should expose a visible video renderer'
    );
    assert.equal(await session.driver.executeAsyncScript((done) => {
      const card = document.querySelector('#ytvht-ai-live-canary-card');
      const observer = new IntersectionObserver(([entry]) => {
        observer.disconnect();
        done(entry?.isIntersecting === true);
      });
      observer.observe(card);
    }), true, 'the AI-label canary card should intersect the viewport');
    await setExtensionSettings(session, {
      aiLabeledVideoHandling: 'badge',
      debug: false,
      version: '5.2.0',
    });
    assert.equal(await session.driver.executeScript(() => (
      document.querySelector('#ytvht-ai-live-canary-card')?.isConnected === true
    )), true, 'the AI-label canary card should remain attached after enabling the option');
    await session.driver.wait(
      () => session.driver.executeScript(() => (
        document.querySelector('#ytvht-ai-live-canary-card')?.dataset.ytvhtAiStatus === 'ai'
      )),
      30000,
      'the real YouTube /next response should mark the known AI-disclosed video'
    );
    const badge = await session.driver.executeScript(() => (
      document.querySelector('#ytvht-ai-live-canary-card .ytvht-ai-label')?.textContent
    ));
    assert.equal(badge, 'AI');
    console.log(`Firefox AI-label canary passed for ${KNOWN_AI_VIDEO_ID}`);
  } finally {
    await session.cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

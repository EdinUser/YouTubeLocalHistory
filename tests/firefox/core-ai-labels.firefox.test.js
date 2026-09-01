const assert = require('node:assert/strict');
const {
  launchFirefoxWithExtension,
  setExtensionSettings,
} = require('./firefox-fixture');

const KNOWN_AI_VIDEO_IDS = ['hm4xejC2B70', 'x3vCeDsNxJ4', '6FME5SDKbnw'];
const AI_SOURCE_CHANNEL_ID = 'UCJ5XcWu45V7Jg1XbSqJD8yg';
const MAX_CHANNEL_CANDIDATES = 3;
const PREFERRED_AI_VIDEO_IDS = process.env.YTVHT_AI_CANARY_FORCE_CHANNEL === '1' ? [] : KNOWN_AI_VIDEO_IDS;
const SEARCH_URL = `https://www.youtube.com/results?search_query=${KNOWN_AI_VIDEO_IDS[0]}`;

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
    const selected = await session.driver.executeAsyncScript((selection, done) => {
      (async () => {
        const scripts = [...document.scripts].map((script) => script.textContent || '').join('\n');
        const clientVersion = scripts.match(/"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/)?.[1];
        if (!clientVersion) return done({ videoId: null, checks: [{ state: 'missing-client-version' }] });
        const checks = [];
        const checkVideoIds = async (videoIds, source) => {
          for (const videoId of videoIds) {
            try {
              const response = await fetch('/youtubei/v1/next?prettyPrint=false&alt=json', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({
                  videoId,
                  racyCheckOk: true,
                  contentCheckOk: true,
                  context: { client: { clientName: 'WEB', clientVersion, hl: 'en', gl: 'US' } },
                }),
              });
              const payload = response.ok ? await response.json() : null;
              const contents = payload?.contents?.twoColumnWatchNextResults?.results?.results?.contents;
              const primary = contents?.find((item) => item?.videoPrimaryInfoRenderer)?.videoPrimaryInfoRenderer;
              const isAi = primary?.badges?.some((badge) => {
                const renderer = badge?.metadataBadgeRenderer;
                return renderer?.label === 'AI' || /made with ai/i.test(renderer?.accessibilityData?.label || '');
              }) === true;
              const state = !response.ok ? `http-${response.status}` : !primary ? 'unavailable' : isAi ? 'ai' : 'unlabeled';
              checks.push({ videoId, source, state });
              if (isAi) return { videoId, source, checks };
            } catch (error) {
              checks.push({ videoId, source, state: 'request-failed', error: error?.message || String(error) });
            }
          }
          return null;
        };

        const knownMatch = await checkVideoIds(selection.knownVideoIds, 'curated');
        if (knownMatch) return done(knownMatch);

        try {
          const feedResponse = await fetch(`/feeds/videos.xml?channel_id=${encodeURIComponent(selection.channelId)}`, {
            credentials: 'same-origin',
          });
          if (!feedResponse.ok) {
            checks.push({ source: 'channel-feed', state: `http-${feedResponse.status}` });
            return done({ videoId: null, checks });
          }
          const feedXml = await feedResponse.text();
          const channelVideoIds = [...new Set(
            [...feedXml.matchAll(/<yt:videoId>([\w-]{11})<\/yt:videoId>/g)].map((match) => match[1])
          )].filter((videoId) => !selection.knownVideoIds.includes(videoId))
            .slice(0, selection.maxChannelCandidates);
          if (!channelVideoIds.length) {
            checks.push({ source: 'channel-feed', state: 'empty' });
            return done({ videoId: null, checks });
          }
          const channelMatch = await checkVideoIds(channelVideoIds, 'channel-feed');
          if (channelMatch) return done(channelMatch);
        } catch (error) {
          checks.push({ source: 'channel-feed', state: 'request-failed', error: error?.message || String(error) });
        }
        done({ videoId: null, checks });
      })();
    }, {
      knownVideoIds: PREFERRED_AI_VIDEO_IDS,
      channelId: AI_SOURCE_CHANNEL_ID,
      maxChannelCandidates: MAX_CHANNEL_CANDIDATES,
    });
    assert.ok(selected.videoId, `No available AI-disclosed canary video. Fixture checks: ${JSON.stringify(selected.checks)}`);
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
      }, selected.videoId),
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
        Boolean(document.querySelector('#ytvht-ai-live-canary-card')?.dataset.ytvhtAiStatus)
      )),
      30000,
      'the extension should classify the selected live AI fixture'
    );
    const detectedStatus = await session.driver.executeScript(() => (
      document.querySelector('#ytvht-ai-live-canary-card')?.dataset.ytvhtAiStatus
    ));
    assert.equal(
      detectedStatus,
      'ai',
      `Extension did not recognize selected live fixture ${selected.videoId}; checks: ${JSON.stringify(selected.checks)}`
    );
    const badge = await session.driver.executeScript(() => (
      document.querySelector('#ytvht-ai-live-canary-card .ytvht-ai-label')?.textContent
    ));
    assert.equal(badge, 'AI');
    console.log(`Firefox AI-label canary passed for ${selected.videoId}`);
  } finally {
    await session.cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

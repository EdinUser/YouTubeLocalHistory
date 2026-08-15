/**
 * Live canary for playlist video changes handled by YouTube's SPA router.
 */

const { test, expect } = require('./extension-fixture');
const { dismissYouTubeConsent } = require('./youtube-consent');
const {
  getStoredPlaylist,
  getStoredVideo,
  removeStoredVideo,
  setExtensionSettings,
} = require('./chromium-extension-storage');

const PLAYLIST_ID = 'PLQga0f7orXVB8fZObVcpXuX-2swTybQqR';
const PLAYLIST_URL = `https://www.youtube.com/playlist?list=${PLAYLIST_ID}`;
const PRIMARY_VIDEO_SELECTOR = '#movie_player video.html5-main-video, ytd-player video.html5-main-video';
const SAVE_TIME = 20;
const MINIMUM_SAVED_TIME = 10;
const DEFAULT_SETTINGS = {
  autoCleanPeriod: 90,
  paginationCount: 10,
  overlayTitle: 'viewed',
  overlayColor: 'blue',
  overlayLabelSize: 'medium',
  debug: true,
  pauseHistoryInPlaylists: false,
};

async function openPlaylist(page) {
  await page.goto(PLAYLIST_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await dismissYouTubeConsent(page);

  const accessBlock = await page.evaluate(() => {
    const text = document.body ? document.body.innerText : '';
    const patterns = [/unusual traffic/i, /captcha/i, /not a robot/i, /verify you are human/i];
    const match = patterns.find((pattern) => pattern.test(text));
    return match ? `YouTube access blocked by ${match}` : null;
  });
  if (accessBlock) return accessBlock;

  await expect.poll(() => page.url(), { timeout: 30000 }).toContain(`/playlist?list=${PLAYLIST_ID}`);
  return null;
}

async function getPlaylistItems(page) {
  const extractItems = () =>
    page.evaluate((playlistId) => {
      const seen = new Set();
      const items = [];
      for (const anchor of document.querySelectorAll('a[href*="watch?v="]')) {
          const rect = anchor.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) continue;

          const url = new URL(anchor.href, window.location.href);
          const videoId = url.searchParams.get('v');
          if (!videoId || url.searchParams.get('list') !== playlistId || seen.has(videoId)) continue;

          seen.add(videoId);
          items.push({ videoId, href: anchor.getAttribute('href') });
          if (items.length === 2) return items;
      }
      return items;
    }, PLAYLIST_ID);

  await expect.poll(extractItems, { timeout: 30000 }).toHaveLength(2);
  return extractItems();
}

async function clickPlaylistItem(page, item) {
  const link = page.locator('a[href*="watch?v="]');
  await link.evaluateAll((anchors, href) => {
    const anchor = anchors.find((candidate) => candidate.getAttribute('href') === href);
    if (!anchor) throw new Error(`Playlist link not found for ${href}`);
    anchor.click();
  }, item.href);

  await expect
    .poll(() => page.url(), { timeout: 30000 })
    .toContain(`watch?v=${item.videoId}`);
  await expect.poll(() => page.url(), { timeout: 30000 }).toContain(`list=${PLAYLIST_ID}`);
  await expect
    .poll(
      () => page.evaluate(() => {
        const player = document.querySelector('#movie_player');
        return typeof player?.getVideoData === 'function' ? player.getVideoData()?.video_id || '' : '';
      }),
      { timeout: 30000 }
    )
    .toBe(item.videoId);
  await page.waitForSelector(PRIMARY_VIDEO_SELECTOR, { timeout: 30000 });
}

async function skipYouTubeAdIfPossible(page) {
  const skipButton = page
    .locator('.ytp-skip-ad-button:visible, .ytp-ad-skip-button:visible, .ytp-ad-skip-button-modern:visible, button:visible')
    .filter({ hasText: /skip/i })
    .first();

  if (await skipButton.isVisible({ timeout: 250 }).catch(() => false)) {
    const clicked = await skipButton.click({ timeout: 2000 })
      .then(() => true)
      .catch(() => false);
    if (!clicked) return false;
    await page.waitForTimeout(500);
    return true;
  }
  return false;
}

async function waitForMainPlaylistMedia(page, videoId) {
  const deadline = Date.now() + 90000;
  let nextForcedLoadAt = Date.now() + 10000;
  let forcedLoadAttempts = 0;
  let lastState = null;

  while (Date.now() < deadline) {
    const skipped = await skipYouTubeAdIfPossible(page);
    const forceContentLoad = !skipped
      && forcedLoadAttempts < 3
      && Date.now() >= nextForcedLoadAt;
    lastState = await page.evaluate(({ selector, expectedVideoId, skippedAd, forceLoad }) => {
      const video = document.querySelector(selector);
      const player = document.querySelector('#movie_player');
      const playerVideoId = typeof player?.getVideoData === 'function'
        ? player.getVideoData()?.video_id || ''
        : '';
      const adPlaying = !!player && (
        player.classList.contains('ad-showing')
        || player.classList.contains('ad-interrupting')
      );
      let forcedContentLoad = false;
      // Headless Chromium can leave an unskippable pre-roll paused or reject
      // media seeks. Let it complete through real playback at an accelerated
      // rate, then use the player API as a bounded fallback. The clicked URL
      // and player identity were already verified by clickPlaylistItem().
      if (video && adPlaying && !skippedAd) {
        video.muted = true;
        if (typeof player?.mute === 'function') player.mute();
        video.playbackRate = 16;
        if (video.paused) {
          if (typeof player?.playVideo === 'function') player.playVideo();
          video.play().catch(() => {});
        }
        if (forceLoad && typeof player?.loadVideoById === 'function') {
          try {
            player.loadVideoById(expectedVideoId, 0);
            forcedContentLoad = true;
          } catch (_) {
            // Keep accelerated playback as the fallback if this page does not
            // expose YouTube's player API in the expected form.
          }
        }
      } else if (video && video.playbackRate !== 1) {
        video.playbackRate = 1;
      }
      return {
        found: !!video,
        duration: video && Number.isFinite(video.duration) ? video.duration : 0,
        currentTime: video?.currentTime || 0,
        paused: video?.paused ?? true,
        playbackRate: video?.playbackRate || 0,
        playerVideoId,
        adPlaying,
        forcedContentLoad,
        canForceContentLoad: typeof player?.loadVideoById === 'function',
        ready: !!video
          && !adPlaying
          && playerVideoId === expectedVideoId
          && Number.isFinite(video.duration)
          && video.duration > 30,
      };
    }, {
      selector: PRIMARY_VIDEO_SELECTOR,
      expectedVideoId: videoId,
      skippedAd: skipped,
      forceLoad: forceContentLoad,
    });
    if (forceContentLoad) {
      forcedLoadAttempts += 1;
      nextForcedLoadAt = Date.now() + 10000;
    }
    if (lastState.ready) return;
    await page.waitForTimeout(1000);
  }

  throw new Error(`Expected the main playlist media after any pre-roll ad; last state: ${JSON.stringify(lastState)}`);
}

async function saveCurrentPlaylistVideo(context, page, videoId) {
  await waitForMainPlaylistMedia(page, videoId);

  let lastSavedTime = 0;
  for (let attempt = 0; attempt < 30; attempt++) {
    const mediaTime = await page.evaluate(async ({ time, selector }) => {
      const player = document.querySelector('#movie_player');
      const video = document.querySelector(selector);
      if (!video) throw new Error('Playlist video element not found');
      video.muted = true;
      if (typeof player?.mute === 'function') player.mute();
      if (typeof player?.seekTo === 'function') {
        player.seekTo(time, true);
      } else {
        video.currentTime = time;
      }

      const deadline = Date.now() + 3000;
      while (video.currentTime < time - 1 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      if (typeof player?.pauseVideo === 'function') player.pauseVideo();
      video.pause();
      video.dispatchEvent(new Event('timeupdate'));
      video.dispatchEvent(new Event('pause'));
      return video.currentTime;
    }, { time: SAVE_TIME, selector: PRIMARY_VIDEO_SELECTOR });
    await page.waitForTimeout(900);

    const record = await getStoredVideo(context, videoId);
    lastSavedTime = record && typeof record.time === 'number' ? record.time : 0;
    // This is a live canary for SPA video identity. YouTube may clamp a seek
    // to its currently buffered range, so require a meaningful saved position
    // rather than an exact external-media timestamp. Only inspect storage
    // after the real player has accepted the seek.
    if (mediaTime < MINIMUM_SAVED_TIME) continue;
    if (lastSavedTime >= MINIMUM_SAVED_TIME) return;
  }

  throw new Error(`Expected Chromium to save ${videoId} beyond ${MINIMUM_SAVED_TIME}s; last saved time was ${lastSavedTime}s`);
}

async function expectPlaylistReference(context, videoId) {
  await expect
    .poll(async () => {
      const record = await getStoredPlaylist(context, PLAYLIST_ID);
      return record && {
        playlistId: record.playlistId,
        title: typeof record.title === 'string' ? record.title.trim() : '',
        url: record.url,
        timestamp: record.timestamp,
        lastUpdated: record.lastUpdated,
        videoId: record.videoId,
        hasLocalItems: Object.prototype.hasOwnProperty.call(record, 'localItems'),
        hasVideoCount: Object.prototype.hasOwnProperty.call(record, 'videoCount'),
      };
    }, { timeout: 30000 })
    .toMatchObject({
      playlistId: PLAYLIST_ID,
      title: expect.stringMatching(/\S/),
      url: PLAYLIST_URL,
      timestamp: expect.any(Number),
      lastUpdated: expect.any(Number),
      videoId,
      hasLocalItems: false,
      hasVideoCount: false,
    });
}

test.describe('Controlled playlist SPA canary (live YouTube)', () => {
  test.setTimeout(240000);

  test('clicking another playlist item tracks the new video ID', async ({ context, page }) => {
    await setExtensionSettings(context, DEFAULT_SETTINGS);
    const accessBlock = await openPlaylist(page);
    test.skip(!!accessBlock, accessBlock);

    const [firstItem, secondItem] = await getPlaylistItems(page);
    expect(firstItem.videoId).not.toBe(secondItem.videoId);
    await removeStoredVideo(context, firstItem.videoId);
    await removeStoredVideo(context, secondItem.videoId);

    await clickPlaylistItem(page, firstItem);
    await saveCurrentPlaylistVideo(context, page, firstItem.videoId);
    await expectPlaylistReference(context, firstItem.videoId);

    await clickPlaylistItem(page, secondItem);
    await saveCurrentPlaylistVideo(context, page, secondItem.videoId);
    await expectPlaylistReference(context, secondItem.videoId);

    await expect.poll(() => getStoredVideo(context, firstItem.videoId), { timeout: 15000 }).toMatchObject({
      videoId: firstItem.videoId,
    });
    await expect.poll(() => getStoredVideo(context, secondItem.videoId), { timeout: 15000 }).toMatchObject({
      videoId: secondItem.videoId,
    });
  });
});

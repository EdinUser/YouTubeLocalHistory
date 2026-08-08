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
const SAVE_TIME = 20;
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
  await page.waitForSelector('video', { timeout: 30000 });
}

async function saveCurrentPlaylistVideo(context, page, videoId) {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const video = document.querySelector('video');
          return video && Number.isFinite(video.duration) ? video.duration : 0;
        }),
      { timeout: 60000 }
    )
    .toBeGreaterThan(SAVE_TIME + 10);

  await page.evaluate((time) => {
    const video = document.querySelector('video');
    video.muted = true;
    video.pause();
    video.currentTime = time;
    video.dispatchEvent(new Event('timeupdate'));
    video.dispatchEvent(new Event('seeked'));
    video.dispatchEvent(new Event('pause'));
  }, SAVE_TIME);

  await expect
    .poll(async () => getStoredVideo(context, videoId), { timeout: 30000 })
    .toMatchObject({ videoId, time: expect.any(Number) });
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
  test.setTimeout(180000);

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

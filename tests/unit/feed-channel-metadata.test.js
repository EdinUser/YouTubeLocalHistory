const metadata = require('../../src/feed-channel-metadata.js');

test('parses the current public YouTube channel metadata shape', () => {
  const result = metadata.parseChannelMetadata(`
    {"videoCountText":{"runs":[{"text":"1422"},{"text":" videos"}]},
    "subscriberCountText":{"simpleText":"1.23M subscribers"},
    "banner":{"imageBannerViewModel":{"image":{"sources":[{"url":"https://img.example/banner"}]}}},
    "metadata":{"channelMetadataRenderer":{"title":"PewDiePie","externalId":"UC-lHJZR3Gqxm24_Vd_AJ5Yw","ownerUrls":["http://www.youtube.com/@PewDiePie"]}}}`,
    'https://www.youtube.com/channel/UC-lHJZR3Gqxm24_Vd_AJ5Yw');

  expect(result).toEqual(expect.objectContaining({
    channelTitle: 'PewDiePie', bannerUrl: 'https://img.example/banner',
    subscriberCount: '1.23M subscribers', videoCount: '1422 videos', handle: '@PewDiePie'
  }));
});

test('hydrates through credentials-omitted public requests and persists presentation fields', async () => {
  const fetch = jest.fn(async () => ({ ok: true, url: 'https://www.youtube.com/@PewDiePie', text: async () =>
    '{"subscriberCountText":{"simpleText":"1M subscribers"},"videoCountText":{"runs":[{"text":"10"},{"text":" videos"}]},"metadata":{"channelMetadataRenderer":{"title":"PewDiePie","ownerUrls":["http://www.youtube.com/@PewDiePie"]}}}'
  }));
  const result = await metadata.hydrateChannel({ channelId: 'UC-lHJZR3Gqxm24_Vd_AJ5Yw', source: 'manual' }, { fetch, now: 100 });

  expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/channel/UC-lHJZR3Gqxm24_Vd_AJ5Yw'), { credentials: 'omit' });
  expect(result).toEqual(expect.objectContaining({ channelTitle: 'PewDiePie', handle: '@PewDiePie', videoCount: '10 videos', metadataHydratedAt: 100, metadataRetryAfter: null }));
});

test('backs off when a public response contains no channel presentation data', async () => {
  const result = await metadata.hydrateChannel({ channelId: 'UC-lHJZR3Gqxm24_Vd_AJ5Yw', source: 'manual' }, {
    now: 100, fetch: async () => ({ ok: true, text: async () => '<html>generic page</html>' })
  });
  expect(result.metadataRetryAfter).toBe(100 + metadata.RETRY_MS);
  expect(metadata.needsHydration(result, 101)).toBe(false);
});

test('selects only the next 15 eligible unprocessed channels for a hydration batch', () => {
  const subscriptions = Array.from({ length: 31 }, (_, index) => ({ channelId: `UC${index}`, metadataHydratedAt: 0 }));
  const processed = new Set(['UC0', 'UC1']);
  const batch = metadata.selectHydrationBatch(subscriptions, processed, 100, 15);
  expect(batch).toHaveLength(15);
  expect(batch[0].channelId).toBe('UC2');
  expect(batch.at(-1).channelId).toBe('UC16');
});

test('hydrates a batch with at most three requests, persists each result, and stops persisting after cancellation', async () => {
  let active = 0;
  let peak = 0;
  const releases = [];
  const fetch = jest.fn(() => new Promise((resolve) => {
    active += 1;
    peak = Math.max(peak, active);
    releases.push(() => {
      active -= 1;
      resolve({ ok: true, text: async () => '<meta property="og:title" content="Fixture channel">' });
    });
  }));
  const controller = new AbortController();
  const storage = { putSubscriptionRecord: jest.fn(async () => controller.abort()) };
  const subscriptions = Array.from({ length: 4 }, (_, index) => ({ channelId: `UC${index}` }));
  const task = metadata.hydrateSubscriptionBatch(subscriptions, {
    storage, fetch, now: 100, concurrency: 3, signal: controller.signal
  });

  await Promise.resolve();
  expect(peak).toBe(3);
  releases.splice(0).forEach((release) => release());
  await task;

  expect(fetch).toHaveBeenCalledTimes(3);
  expect(storage.putSubscriptionRecord).toHaveBeenCalledTimes(1);
});

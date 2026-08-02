const https = require('https');
const { hydrateChannel } = require('../../src/feed-channel-metadata.js');

// Opt-in public contract coverage. Fixtures remain the deterministic default;
// this catches YouTube channel-page response-shape changes before blank cards
// reach users.
const LIVE_CHANNELS = [
  ['Astrum', 'UC-9b7aDP6ZNOcoj9-xFnrtw'],
  ['PewDiePie', 'UC-lHJZR3Gqxm24_Vd_AJ5Yw'],
  ['Sargon of Akkad', 'UC-yewGHQbNFpDrGM0diZOLA'],
];
const liveTest = process.env.RUN_LIVE_CHANNEL_METADATA === '1' ? test : test.skip;

function publicHttpsFetch(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { Accept: 'text/html' } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        ok: response.statusCode >= 200 && response.statusCode < 300,
        status: response.statusCode,
        url: response.headers.location || url,
        text: async () => Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.setTimeout(15000, () => request.destroy(new Error('channel metadata request timed out')));
    request.on('error', reject);
  });
}

describe('public channel metadata live readings (opt-in)', () => {
  liveTest.each(LIVE_CHANNELS)('%s exposes parseable public channel presentation metadata', async (_name, channelId) => {
    const result = await hydrateChannel({ channelId, source: 'manual' }, { fetch: publicHttpsFetch });
    expect(result.metadataRetryAfter).toBeNull();
    expect(result.channelTitle).toEqual(expect.any(String));
    expect(result.channelTitle.length).toBeGreaterThan(0);
    expect(result.thumbnail || result.bannerUrl || result.subscriberCount || result.videoCount).toBeTruthy();
  }, 25000);
});

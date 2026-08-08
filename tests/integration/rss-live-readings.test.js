const { fetchChannelRss } = require('../../src/rss-client.js');
const https = require('https');

// Opt-in smoke coverage only: public feeds and their contents change outside
// this repository, so deterministic fixtures remain the default CI contract.
const LIVE_RSS_CHANNELS = [
  ['AsmonTV', 'UCQeRaTukNYft1_6AZPACnog'],
  ['Mentour Pilot', 'UCwpHKudUkP5tNgmMdexB3ow'],
  ['Nerdrotic', 'UC5T0tXJN5CrMZUEJuz4oovw']
];

const liveTest = process.env.RUN_LIVE_RSS === '1' ? test : test.skip;

function publicHttpsFetch(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: { Accept: 'application/atom+xml' }
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        ok: response.statusCode >= 200 && response.statusCode < 300,
        status: response.statusCode,
        text: async () => Buffer.concat(chunks).toString('utf8')
      }));
    });
    request.setTimeout(10000, () => request.destroy(new Error('RSS request timed out')));
    request.on('error', reject);
  });
}

describe('public RSS live readings (opt-in)', () => {
  liveTest.each(LIVE_RSS_CHANNELS)('%s returns parseable public RSS without credentials', async (_name, channelId) => {
    const result = await fetchChannelRss(channelId, {
      fetch: publicHttpsFetch,
      timeoutMs: 10000
    });

    expect(result).toEqual(expect.objectContaining({ channelId, error: null }));
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.entries[0]).toEqual(expect.objectContaining({
      channelId,
      videoId: expect.any(String),
      title: expect.any(String),
      publishedAt: expect.any(Number),
      source: 'rss'
    }));
  }, 20000);
});

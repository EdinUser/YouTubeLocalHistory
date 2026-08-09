const fs = require('fs');
const path = require('path');
const { CHANNEL_ID } = require('../fixtures/feed/contracts.js');
const { parseRssXml } = require('../../src/rss-parser.js');
const { fetchChannelRss, RSS_URL } = require('../../src/rss-client.js');

const RSS_XML = fs.readFileSync(path.join(__dirname, '../fixtures/feed/rss.xml'), 'utf8');

describe('RSS client and parser', () => {
  test('normalizes public RSS XML without local data inputs', () => {
    expect(parseRssXml(RSS_XML, CHANNEL_ID)).toEqual([expect.objectContaining({
      videoId: 'video-001', channelId: CHANNEL_ID, title: 'Fixture upload',
      channelTitle: 'Fixture Channel', publishedAt: 1735603200000,
      thumbnailUrl: 'https://i.ytimg.com/vi/video-001/mqdefault.jpg', source: 'rss'
    })]);
  });

  test('uses one credentials-omitted request and returns the canonical scan result', async () => {
    const fetch = jest.fn().mockResolvedValue({ ok: true, text: async () => RSS_XML });
    const result = await fetchChannelRss(CHANNEL_ID, { fetch, now: 100 });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(`${RSS_URL}${CHANNEL_ID}`, expect.objectContaining({ credentials: 'omit' }));
    expect(result).toEqual(expect.objectContaining({ channelId: CHANNEL_ID, fetchedAt: 100, error: null }));
    expect(result.entries).toHaveLength(1);
  });

  test('maps malformed XML and HTTP failures into the fixed error taxonomy', async () => {
    const parseFailure = await fetchChannelRss(CHANNEL_ID, {
      fetch: async () => ({ ok: true, text: async () => '<feed><entry>' }), now: 101
    });
    expect(parseFailure.error).toEqual(expect.objectContaining({ code: 'parse' }));

    const httpFailure = await fetchChannelRss(CHANNEL_ID, {
      fetch: async () => ({ ok: false, status: 503 }), now: 102
    });
    expect(httpFailure).toEqual(expect.objectContaining({ entries: [], error: { code: 'http', status: 503, message: 'RSS request failed with HTTP 503' } }));
  });
});

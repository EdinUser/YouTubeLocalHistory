const fs = require('fs');
const path = require('path');
const { parseRssXml } = require('../../src/rss-parser.js');

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'feed', 'live');
const RSS_FIXTURES = [
  ['asmontv', 'UCQeRaTukNYft1_6AZPACnog'],
  ['mentour-pilot', 'UCwpHKudUkP5tNgmMdexB3ow'],
  ['nerdrotic', 'UC5T0tXJN5CrMZUEJuz4oovw'],
];
const capturedTest = RSS_FIXTURES.every(([name]) => fs.existsSync(path.join(FIXTURE_DIR, `${name}.xml`))) ? test : test.skip;

describe('locally captured public RSS readings', () => {
  capturedTest.each(RSS_FIXTURES)('%s remains parseable as canonical RSS input', (name, channelId) => {
    const fixturePath = path.join(FIXTURE_DIR, `${name}.xml`);
    const entries = parseRssXml(fs.readFileSync(fixturePath, 'utf8'), channelId);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]).toEqual(expect.objectContaining({
      channelId,
      videoId: expect.any(String),
      title: expect.any(String),
      publishedAt: expect.any(Number),
      source: 'rss',
    }));
  });
});

const { enrichVisibleItems } = require('../../src/feed-enrichment.js');

test('enrichment is limited to unique visible items', async () => {
  const enrich = jest.fn(async (videoId) => ({ videoId }));
  await expect(enrichVisibleItems(['a', 'a', 'b', 'c'], enrich, { limit: 2 })).resolves.toEqual([{ videoId: 'a' }, { videoId: 'b' }]);
  expect(enrich).toHaveBeenCalledTimes(2);
});

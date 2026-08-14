const subscriptionSort = require('../../src/feed-subscription-sort.js');

const recentlyPublished = {
  videoId: 'recent-upload',
  publishedAt: 300,
  discoveredAt: 100,
};
const oldButNewlyDetected = {
  videoId: 'old-discovered-now',
  publishedAt: 100,
  discoveredAt: 400,
};

test('Subscriptions defaults to newest upload, independent of detection time', () => {
  expect(subscriptionSort.DEFAULT_SUBSCRIPTION_SORT).toBe('published_desc');
  expect(subscriptionSort.sortSubscriptionVideos(
    [oldButNewlyDetected, recentlyPublished],
    subscriptionSort.DEFAULT_SUBSCRIPTION_SORT
  ).map((video) => video.videoId)).toEqual(['recent-upload', 'old-discovered-now']);
});

test('Subscriptions can sort by first detection time without mutating upload-date order', () => {
  expect(subscriptionSort.sortSubscriptionVideos(
    [recentlyPublished, oldButNewlyDetected],
    'discovered_desc'
  ).map((video) => video.videoId)).toEqual(['old-discovered-now', 'recent-upload']);
  expect(subscriptionSort.sortSubscriptionVideos(
    [recentlyPublished, oldButNewlyDetected],
    'published_asc'
  ).map((video) => video.videoId)).toEqual(['old-discovered-now', 'recent-upload']);
});

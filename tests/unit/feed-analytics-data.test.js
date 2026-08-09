const analytics = require('../../src/feed-analytics-data.js');

test('Top Channels includes Shorts and applies both deterministic sort modes', () => {
  const records = [
    { videoId: 'a-long', channelId: 'UCAlpha', channelName: 'Alpha', time: 60, duration: 900 },
    { videoId: 'a-short', channelId: 'UCAlpha', channelName: 'Alpha', time: 40, duration: 40, isShorts: true },
    { videoId: 'z-one', channelId: 'UCZeta', channelName: 'Zeta', time: 100, duration: 900 },
    { videoId: 'b-1', channelId: 'UCBeta', channelName: 'Beta', time: 30, duration: 900 },
    { videoId: 'b-2', channelId: 'UCBeta', channelName: 'Beta', time: 30, duration: 900 },
    { videoId: 'b-3', channelId: 'UCBeta', channelName: 'Beta', time: 30, duration: 900 },
    { videoId: 'zero', channelId: 'UCZero', channelName: 'Zero', time: 0, duration: 900 },
  ];

  expect(analytics.topChannels(records, 'watchTime').map((item) => item.channelName))
    .toEqual(['Alpha', 'Zeta', 'Beta']);
  expect(analytics.topChannels(records, 'videos').map((item) => item.channelName))
    .toEqual(['Beta', 'Alpha', 'Zeta']);
  expect(analytics.topChannels(records, 'watchTime')[0]).toEqual(expect.objectContaining({
    videos: 2,
    watchSeconds: 100,
  }));
  expect(analytics.channelUrl('UCAlpha')).toBe('https://www.youtube.com/channel/UCAlpha');
  expect(analytics.channelUrl('@alpha')).toBe('https://www.youtube.com/%40alpha');
  expect(analytics.channelUrl('name-only')).toBe('');
});

test('Top Skipped Channels considers only non-Short long videos below the skip threshold', () => {
  const skipped = analytics.topSkippedChannels([
    { videoId: 'alpha', channelId: 'UCAlpha', channelName: 'Alpha', time: 50, duration: 1000 },
    { videoId: 'beta-1', channelId: 'UCBeta', channelName: 'Beta', time: 0, duration: 1000 },
    { videoId: 'beta-2', channelId: 'UCBeta', channelName: 'Beta', time: 99, duration: 1000 },
    { videoId: 'short', channelId: 'UCAlpha', channelName: 'Alpha', time: 0, duration: 1000, isShorts: true },
    { videoId: 'brief', channelId: 'UCBeta', channelName: 'Beta', time: 0, duration: 599 },
    { videoId: 'minimum', channelId: 'UCDelta', channelName: 'Delta', time: 59, duration: 600 },
    { videoId: 'boundary', channelId: 'UCGamma', channelName: 'Gamma', time: 100, duration: 1000 },
  ], { minimumDuration: 600, skipRatio: 0.1, limit: 5 });

  expect(skipped.map((item) => [item.channelName, item.videos])).toEqual([
    ['Beta', 2],
    ['Alpha', 1],
    ['Delta', 1],
  ]);
});

test('Longest Unfinished Videos uses remaining time and deterministic title ties', () => {
  const unfinished = analytics.longestUnfinishedVideos([
    { videoId: 'longest', title: 'Longest', time: 200, duration: 2000 },
    { videoId: 'zeta', title: 'Zeta tie', time: 0, duration: 1000 },
    { videoId: 'alpha', title: 'Alpha tie', time: 0, duration: 1000 },
    { videoId: 'short', title: 'Short-form', time: 0, duration: 5000, isShorts: true },
    { videoId: 'brief', title: 'Brief', time: 0, duration: 599 },
    { videoId: 'minimum', title: 'Minimum duration', time: 59, duration: 600 },
    { videoId: 'complete', title: 'Complete', time: 900, duration: 1000 },
  ], { minimumDuration: 600, completionRatio: 0.9, limit: 5 });

  expect(unfinished.map((item) => item.videoId)).toEqual(['longest', 'alpha', 'zeta', 'minimum']);
  expect(unfinished[0]).toEqual(expect.objectContaining({
    watchedSeconds: 200,
    durationSeconds: 2000,
    remainingSeconds: 1800,
  }));
  expect(analytics.longestUnfinishedVideos([])).toEqual([]);
});

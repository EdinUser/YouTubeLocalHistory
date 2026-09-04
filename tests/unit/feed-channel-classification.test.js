const classifier = require('../../src/feed-channel-classification.js');

const DAY = classifier.DAY_MS;

function entries(timestamps) {
  return timestamps.map((publishedAt, index) => ({ videoId: `video-${index}`, publishedAt }));
}

test('keeps a channel with no RSS upload evidence explicitly unknown', () => {
  const now = 1_000 * DAY;
  const result = classifier.classifyChannelActivity({}, [], now);

  expect(result).toEqual(expect.objectContaining({
    classificationVersion: 2,
    activityClass: 'unknown',
    classificationConfidence: 0,
    recentUploadTimestamps: [],
  }));
});

test('learns bounded upload rates and identifies a very active channel', () => {
  const now = 1_000 * DAY;
  const timestamps = Array.from({ length: 12 }, (_, index) => now - index * 13 * 60 * 60 * 1000);
  const result = classifier.classifyChannelActivity({}, entries(timestamps), now);

  expect(result).toEqual(expect.objectContaining({
    activityClass: 'very_active', uploads7d: 12, uploads30d: 12,
    latestUploadAt: now, classificationConfidence: 1
  }));
  expect(result.recentUploadTimestamps).toHaveLength(12);
  expect(result.medianUploadIntervalMs).toBe(13 * 60 * 60 * 1000);
});

test('does not mistake a daily batch of uploads for many independent publishing sessions', () => {
  const now = 1_000 * DAY;
  const timestamps = Array.from({ length: 7 }, (_, day) => [0, 2, 4]
    .map((hour) => now - day * DAY - hour * 60 * 60 * 1000)).flat();
  const result = classifier.classifyChannelActivity({}, entries(timestamps), now);

  expect(result.uploads7d).toBe(20); // bounded by the 20-upload ring
  expect(result.uploadSessions7d).toBe(7);
  expect(result.activityClass).toBe('active');
});

test('degrades a quiet channel at most one activity tier per day', () => {
  const now = 1_000 * DAY;
  const oldTimestamps = Array.from({ length: 10 }, (_, index) => now - (200 + index) * DAY);
  const first = classifier.classifyChannelActivity({
    activityClass: 'very_active', latestUploadAt: now - 200 * DAY, recentUploadTimestamps: oldTimestamps
  }, [], now);
  const second = classifier.classifyChannelActivity({ ...first, activityClass: first.activityClass }, [], now);
  const nextDay = classifier.classifyChannelActivity(second, [], now + DAY);

  expect(first.activityClass).toBe('active');
  expect(second.activityClass).toBe('active');
  expect(nextDay.activityClass).toBe('regular');
});

test('promotes frequent uploads spread throughout the day immediately, including formerly dormant channels', () => {
  const now = 1_000 * DAY;
  const uploads = entries(Array.from({ length: 20 }, (_, i) => now - i * 30 * 60 * 1000));
  for (const activityClass of ['unknown', 'active', 'regular', 'rare', 'dormant', 'reactivated']) {
    const result = classifier.classifyChannelActivity({ activityClass, latestUploadAt: now - 200 * DAY }, uploads, now);
    expect(result.activityClass).toBe('very_active');
    expect(result.uploadSessions7d).toBe(1);
  }
});

test('a single bulk upload over a few minutes does not establish a very active cadence', () => {
  const now = 1_000 * DAY;
  const uploads = entries(Array.from({ length: 20 }, (_, i) => now - i * 60 * 1000));
  expect(classifier.classifyChannelActivity({}, uploads, now).activityClass).toBe('occasional');
});

test('a short recent sample cannot downgrade an active channel and checks do not postpone eventual downgrades', () => {
  const now = 1_000 * DAY;
  const first = classifier.classifyChannelActivity({ activityClass: 'active', latestUploadAt: now }, entries([now]), now);
  const hourly = classifier.classifyChannelActivity(first, [], now + 60 * 60 * 1000);
  expect(first.activityClass).toBe('active');
  expect(hourly.activityClass).toBe('active');
  expect(hourly.activityClassChangedAt).toBe(first.activityClassChangedAt);
  expect(classifier.classifyChannelActivity(hourly, [], now + 11 * DAY).activityClass).toBe('regular');
});

test('reactivates a dormant channel by one controlled tier when RSS finds a new upload', () => {
  const now = 1_000 * DAY;
  const result = classifier.classifyChannelActivity({
    activityClass: 'dormant', latestUploadAt: now - 220 * DAY,
    recentUploadTimestamps: [now - 220 * DAY]
  }, entries([now - DAY]), now);

  expect(result).toEqual(expect.objectContaining({
    activityClass: 'reactivated', hasNewUpload: true, reactivatedAt: now
  }));
});

test('expires reactivated status at its next successful observation into the learned class', () => {
  const now = 1_000 * DAY;
  const first = classifier.classifyChannelActivity({
    activityClass: 'dormant', latestUploadAt: now - 220 * DAY,
    recentUploadTimestamps: [now - 220 * DAY]
  }, entries([now - DAY]), now);
  const second = classifier.classifyChannelActivity(first, [], now + 3 * DAY);

  expect(first.activityClass).toBe('reactivated');
  expect(second).toEqual(expect.objectContaining({ activityClass: 'occasional', reactivatedAt: null }));
});

test('classifies each non-dormant rate boundary and normalizes out-of-order RSS timestamps', () => {
  const now = 1_000 * DAY;
  const classify = (timestamps) => classifier.classifyChannelActivity({}, entries(timestamps), now).activityClass;

  expect(classify([now, now - 6 * DAY])).toBe('regular');
  expect(classify([now - 40 * DAY])).toBe('occasional');
  expect(classify([now - 100 * DAY])).toBe('rare');
  expect(classify([now - 181 * DAY])).toBe('dormant');
  expect(classifier.classifyChannelActivity({}, entries([now - DAY, now, now - DAY]), now)
    .recentUploadTimestamps).toEqual([now, now - DAY]);
});

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'feed.js'), 'utf8')
  .slice(0, fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'feed.js'), 'utf8').indexOf('function init()'));

function runtime({ progress, foreground, dormant } = {}) {
  const scheduler = {
    successfulCheckIntervalMs: 0,
    start: jest.fn(async () => {}),
    subscribe: jest.fn(),
    getInitializationProgress: jest.fn()
      .mockResolvedValueOnce(progress?.before || { completed: 0, total: 0, pending: 0 })
      .mockResolvedValue(progress?.after || { completed: 0, total: 0, pending: 0 }),
    runInitialization: jest.fn(async () => progress?.result || { insertedVideoCount: 0 }),
    runForeground: jest.fn(async () => foreground || { total: 0, insertedVideoCount: 0 }),
    runDormantMaintenance: jest.fn(async () => dormant || { ran: false, terminal: null }),
  };
  const timers = [];
  const context = {
    console, Promise, Math, Number, Object, Date,
    setTimeout: jest.fn((callback, delay) => { timers.push({ callback, delay }); return timers.length; }),
    clearTimeout: jest.fn(),
    analyticsActive: false, subscriptionsActive: false, playlistsActive: false,
    historyActive: false, settingsActive: false, channelActive: false,
    ytStorage: { getSettings: jest.fn(async () => ({ feedRefreshMinutes: 5 })) },
    ytIndexedDBStorage: {},
    ytvhtFeedScheduler: { FeedScheduler: jest.fn(() => scheduler) },
    localSubscriptions: [], watchedMap: {}, pendingFeedVideoCount: 0, sharedFeedScheduler: null,
    loadData: jest.fn(async () => {}), showNewFeedVideos: jest.fn(),
    setFeedSyncStatus: jest.fn(), setFeedSettingsMessage: jest.fn(),
    document: { getElementById: jest.fn(() => null) },
  };
  vm.runInNewContext(source, context);
  return { context, scheduler, timers };
}

test('page-active initialization is resumable and schedules only one bounded continuation', async () => {
  const { context, scheduler, timers } = runtime({
    progress: {
      before: { completed: 2, total: 4, pending: 2 },
      after: { completed: 3, total: 4, pending: 1 },
      result: { insertedVideoCount: 1 },
    },
  });

  await context.runPageActiveFeedWork();

  expect(scheduler.runInitialization).toHaveBeenCalledTimes(1);
  expect(scheduler.runForeground).not.toHaveBeenCalled();
  expect(timers).toEqual([expect.objectContaining({ delay: 350 })]);
  context.clearPageFeedWorkTimer();
  expect(context.clearTimeout).toHaveBeenCalledWith(1);
});

test('page-active foreground work yields to dormant maintenance only when no foreground channel ran', async () => {
  const idle = runtime({ dormant: { ran: true, terminal: { insertedVideoCount: 0 } } });
  await idle.context.runPageActiveFeedWork();
  expect(idle.scheduler.runDormantMaintenance).toHaveBeenCalledWith({ pageActive: true });
  expect(idle.timers).toEqual([expect.objectContaining({ delay: 1000 })]);

  const busy = runtime({ foreground: { total: 1, insertedVideoCount: 0 } });
  await busy.context.runPageActiveFeedWork();
  expect(busy.scheduler.runDormantMaintenance).not.toHaveBeenCalled();
  expect(busy.timers).toEqual([expect.objectContaining({ delay: 5 * 60 * 1000 })]);
});

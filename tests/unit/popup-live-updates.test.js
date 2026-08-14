/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'popup-core.js'), 'utf8');
const runtimeSource = source.slice(source.indexOf('function handleStorageUpdates'), source.indexOf('// Load history records'));

function createRuntime(records = [], currentPage = 1, totalPages = 1) {
  document.body.innerHTML = '<table id="ytvhtHistoryTable"><tr><td><a class="video-link"></a><span class="video-progress"></span><span class="video-date"></span></td></tr></table>';
  const storedRecords = [...records];
  const context = {
    document, allHistoryRecords: records, allShortsRecords: [...records], currentPage, totalPages, pageSize: 20,
    displayHistoryPage: jest.fn(), displayShortsPage: jest.fn(), log: jest.fn(),
    addTimestampToUrl: (url, time) => `${url}&t=${time}`, formatProgress: (time, duration) => `${time}/${duration}`,
    formatDate: (timestamp) => `date:${timestamp}`, chrome: { storage: { local: { get: jest.fn(async () => ({})) } } }, console, Promise,
  };
  context.loadHistoryPage = jest.fn(async () => {
    context.allHistoryRecords = storedRecords
      .filter((record) => Number(record.time || 0) > 0 && Number(record.duration || 0) > 0 &&
        Number(record.time) / Number(record.duration) < 0.9)
      .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
  });
  context.setStoredRecords = (next) => {
    storedRecords.splice(0, storedRecords.length, ...next);
  };
  vm.runInNewContext(runtimeSource, context);
  return context;
}

test('rebuilds Continue Watching instead of patching the wrong filtered DOM row', async () => {
  const completed = { videoId: 'completed', title: 'Completed', time: 95, duration: 100, timestamp: 3 };
  const unfinished = { videoId: 'unfinished', title: 'Keep me', time: 20, duration: 100, timestamp: 2 };
  const context = createRuntime([completed, unfinished]);

  await context.updateVideoRecord(completed);

  expect(context.loadHistoryPage).toHaveBeenCalledWith({ page: 1 });
  expect(context.allHistoryRecords).toEqual([unfinished]);
  expect(context.displayHistoryPage).toHaveBeenCalledTimes(1);
  expect(document.querySelector('.video-link').textContent).toBe('');
});

test('refreshes for new records and deletions, and blocks tombstoned resurrection', async () => {
  const context = createRuntime([{ videoId: 'old', timestamp: 1 }]);
  context.setStoredRecords([
    { videoId: 'old', title: 'Old', time: 10, duration: 100, timestamp: 1 },
    { videoId: 'new', title: 'New', time: 20, duration: 100, timestamp: 2 }
  ]);
  await context.updateVideoRecord({ videoId: 'new', title: 'New', timestamp: 2 });
  expect(context.allHistoryRecords.map((record) => record.videoId)).toEqual(['new', 'old']);

  await context.handleStorageUpdates([['video_new', { newValue: null }]]);
  expect(context.loadHistoryPage).toHaveBeenCalledTimes(2);

  context.chrome.storage.local.get.mockResolvedValue({ deleted_video_blocked: { deletedAt: 1 } });
  await context.checkTombstoneAndUpdateVideo('blocked', { videoId: 'blocked', timestamp: 3 });
  expect(context.loadHistoryPage).toHaveBeenCalledTimes(2);
});

test('keeps the selected page during a live update', async () => {
  const context = createRuntime([
    { videoId: 'page-two', title: 'Page two', time: 20, duration: 100, timestamp: 2 }
  ], 2, 3);

  await context.updateVideoRecord({ videoId: 'newer', time: 30, duration: 100, timestamp: 3 });

  expect(context.loadHistoryPage).toHaveBeenCalledWith({ page: 2 });
  expect(context.currentPage).toBe(2);
});

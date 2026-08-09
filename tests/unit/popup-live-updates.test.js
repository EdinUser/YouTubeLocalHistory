/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'popup-core.js'), 'utf8');
const runtimeSource = source.slice(source.indexOf('function handleStorageUpdates'), source.indexOf('// Load history records'));

function createRuntime(records = []) {
  document.body.innerHTML = '<table id="ytvhtHistoryTable"><tr><td><a class="video-link"></a><span class="video-progress"></span><span class="video-date"></span></td></tr></table>';
  const context = {
    document, allHistoryRecords: records, allShortsRecords: [...records], currentPage: 1, pageSize: 20,
    displayHistoryPage: jest.fn(), displayShortsPage: jest.fn(), log: jest.fn(),
    addTimestampToUrl: (url, time) => `${url}&t=${time}`, formatProgress: (time, duration) => `${time}/${duration}`,
    formatDate: (timestamp) => `date:${timestamp}`, chrome: { storage: { local: { get: jest.fn(async () => ({})) } } }, console, Promise,
  };
  vm.runInNewContext(runtimeSource, context);
  return context;
}

test('updates the current popup row using the real compact row contract', () => {
  const context = createRuntime([{ videoId: 'one', title: 'Old', time: 10, duration: 100, timestamp: 1, url: 'https://example.test/watch?v=one' }]);
  context.updateVideoRecord({ videoId: 'one', title: 'New', time: 50, duration: 100, timestamp: 2, url: 'https://example.test/watch?v=one' });
  expect(document.querySelector('.video-link').textContent).toBe('New');
  expect(document.querySelector('.video-progress').textContent).toBe('50/100');
  expect(document.querySelector('.video-date').textContent).toBe('date:2');
});

test('adds a new first-page record, removes deleted records, and blocks tombstoned resurrection', async () => {
  const context = createRuntime([{ videoId: 'old', timestamp: 1 }]);
  context.updateVideoRecord({ videoId: 'new', title: 'New', timestamp: 2, url: 'https://example.test/watch?v=new' });
  expect(context.allHistoryRecords[0].videoId).toBe('new');
  expect(context.displayHistoryPage).toHaveBeenCalled();

  context.handleStorageUpdates([['video_new', { newValue: null }]]);
  expect(context.allHistoryRecords.map((record) => record.videoId)).toEqual(['old']);

  context.chrome.storage.local.get.mockResolvedValue({ deleted_video_blocked: { deletedAt: 1 } });
  await context.checkTombstoneAndUpdateVideo('blocked', { videoId: 'blocked', timestamp: 3 });
  expect(context.allHistoryRecords.map((record) => record.videoId)).toEqual(['old']);
});

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

test('popup and Feed History use the complete regular-video history rather than divergent unfinished-only data', () => {
  const popupData = read('src/popup-data-pages.js');
  const popupDisplay = read('src/popup-history-display.js');
  const feedHistory = read('src/feed-history-view.js');

  expect(popupData).toContain('ytStorage.getVideosPage({');
  expect(popupData).not.toContain('unfinishedOnly: true');
  expect(popupDisplay).not.toContain('WATCH_COMPLETION_RATIO');
  expect(feedHistory).toContain('ytStorage.getAllVideos()');
});

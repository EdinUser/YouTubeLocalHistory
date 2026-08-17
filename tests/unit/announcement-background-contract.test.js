const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('announcements use an opaque YouTube-local acknowledgement and a session-only ownership lock', () => {
  const background = read('src/background.js');
  const renderer = read('src/content-announcement.js');

  expect(background).toContain("storageKey: '__rwui_notice_7'");
  expect(background).toContain("const ANNOUNCEMENT_OWNERS_STATE_KEY = 'announcementOwners'");
  expect(background).toContain('stateManager.get(ANNOUNCEMENT_OWNERS_STATE_KEY)');
  expect(background).toContain("files: ['content-announcement.js']");
  expect(background).toContain("url: ['https://www.youtube.com/*']");
  expect(renderer).toContain("location.hostname !== 'www.youtube.com'");
  expect(renderer).toContain('window.localStorage.setItem(announcement.storageKey, \'1\')');
  expect(renderer).toContain('window.localStorage.getItem(announcement.storageKey) !== null');
});

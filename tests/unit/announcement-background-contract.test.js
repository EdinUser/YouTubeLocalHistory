const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('announcements use opaque YouTube-local acknowledgements and one session-wide queue', () => {
  const background = read('src/background.js');
  const renderer = read('src/content-announcement.js');

  expect(background).toContain("storageKey: '__rwui_notice_7'");
  expect(background).toContain("storageKey: '__rwui_notice_8'");
  expect(background).toContain("const ACTIVE_ANNOUNCEMENT_STATE_KEY = 'activeAnnouncement'");
  expect(background).toContain('stateManager.get(ACTIVE_ANNOUNCEMENT_STATE_KEY)');
  expect(background).toContain('announcementIsOwnedBy(message.announcementId, sender.tab.id)');
  expect(background).toContain("action: { type: 'open-popup' }");
  expect(background).toContain('await chrome.action.openPopup()');
  expect(background).toContain("chrome.storage.local.get(['infoShown'])");
  expect(background).toContain("files: ['content-announcement.js']");
  expect(background).toContain("url: ['https://www.youtube.com/*']");
  expect(renderer).toContain("location.hostname !== 'www.youtube.com'");
  expect(renderer).toContain('window.localStorage.setItem(announcement.storageKey, \'1\')');
  expect(renderer).toContain('window.localStorage.getItem(announcement.storageKey) !== null');
  expect(renderer).toContain("chrome.runtime.getURL('icon48.png')");
  expect(renderer).toContain('showNextAnnouncement();');
});

test('background and storage informational traces follow the persisted debug setting', () => {
  const background = read('src/background.js');
  const storage = read('src/storage.js');

  expect(background).toContain('let backgroundDebugEnabled = false');
  expect(background).toContain("backgroundDebugEnabled = settings?.debug === true");
  expect(background).toContain("debugLog('Background script received message:'");
  expect(background).not.toContain("console.log('Background script received message:'");
  expect(background).toContain("chrome.storage.onChanged.addListener((changes, area) => {");
  expect(background).toContain('function recordTestMessage(message)');
  expect(background).toContain("if (message.type === 'ytStorageCall' && message.method)");

  expect(storage).toContain('let storageDebugEnabled = false');
  expect(storage).toContain("if (typeof globalScope.ytvhtDebugLog === 'function')");
  expect(storage).toContain("debugLog('[Storage] Video migration already complete')");
  expect(storage).not.toContain("console.log('[Storage] Video migration already complete')");
});

const path = require('path');

const SOURCE_PATH = path.join(__dirname, '..', '..', 'src', 'content-announcement.js');
const ANNOUNCEMENT = {
  id: 'ai-label-controls-v1',
  storageKey: '__rwui_notice_7',
  titleKey: 'ai_label_announcement_title',
  title: 'New AI-label controls',
  bodyKey: 'ai_label_announcement_body',
  body: 'Choose whether AI-labeled videos are shown, dimmed, or hidden in re:Watch.',
  actionLabelKey: 'ai_label_announcement_settings',
  actionLabel: 'See it in Settings',
};

const WELCOME_ANNOUNCEMENT = {
  id: 'welcome-v1',
  storageKey: '__rwui_notice_8',
  titleKey: 'welcome_announcement_title',
  title: 'YT re:Watch is ready',
  bodyKey: 'welcome_announcement_body',
  body: 'Your watch progress stays private in this browser.',
  actionLabelKey: 'welcome_announcement_open',
  actionLabel: 'Open YT re:Watch',
};

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function loadAnnouncement(messageHandler = () => ({ ok: true })) {
  global.chrome = {
    i18n: { getMessage: jest.fn(() => '') },
    runtime: {
      lastError: null,
      getURL: jest.fn((path) => `chrome-extension://test/${path}`),
      sendMessage: jest.fn((message, callback) => callback(messageHandler(message))),
    },
  };
  jest.resetModules();
  require(SOURCE_PATH);
}

function toast() {
  return document.querySelector('#ytvht-announcement');
}

describe('extension feature announcement toast', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('dark');
    document.body.innerHTML = '';
    window.localStorage.clear();
  });

  afterEach(() => {
    delete global.chrome;
  });

  test('shows only when its YouTube localStorage acknowledgement is absent', async () => {
    loadAnnouncement((message) => {
      if (message.type === 'getAnnouncements') return { announcements: [ANNOUNCEMENT] };
      if (message.type === 'claimAnnouncement') return { show: true };
      return { ok: true };
    });
    await flush();

    expect(toast()).not.toBeNull();
    expect(toast().shadowRoot.querySelector('h2').textContent).toBe(ANNOUNCEMENT.title);
    expect(toast().shadowRoot.querySelector('.brand-icon').src).toBe('chrome-extension://test/icon48.png');
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { type: 'claimAnnouncement', announcementId: ANNOUNCEMENT.id },
      expect.any(Function)
    );
  });

  test('does not claim or render an already acknowledged announcement', async () => {
    window.localStorage.setItem(ANNOUNCEMENT.storageKey, '1');
    loadAnnouncement((message) => ({ announcements: message.type === 'getAnnouncements' ? [ANNOUNCEMENT] : [] }));
    await flush();

    expect(toast()).toBeNull();
    expect(chrome.runtime.sendMessage.mock.calls.map(([message]) => message.type)).toEqual(['getAnnouncements']);
  });

  test('dismissal stores the opaque acknowledgement and releases the tab claim', async () => {
    loadAnnouncement((message) => {
      if (message.type === 'getAnnouncements') return { announcements: [ANNOUNCEMENT] };
      if (message.type === 'claimAnnouncement') return { show: true };
      if (message.type === 'releaseAnnouncement') return { ok: true };
      return { ok: false };
    });
    await flush();

    toast().shadowRoot.querySelector('.dismiss').click();
    await flush();

    expect(window.localStorage.getItem(ANNOUNCEMENT.storageKey)).toBe('1');
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { type: 'releaseAnnouncement', announcementId: ANNOUNCEMENT.id },
      expect.any(Function)
    );
    expect(toast()).toBeNull();
  });

  test('acknowledges only after the settings action succeeds', async () => {
    let actionSucceeded = false;
    loadAnnouncement((message) => {
      if (message.type === 'getAnnouncements') return { announcements: [ANNOUNCEMENT] };
      if (message.type === 'claimAnnouncement') return { show: true };
      if (message.type === 'runAnnouncementAction') return { ok: actionSucceeded };
      return { ok: true };
    });
    await flush();

    toast().shadowRoot.querySelector('.action').click();
    await flush();
    expect(window.localStorage.getItem(ANNOUNCEMENT.storageKey)).toBeNull();
    expect(toast()).not.toBeNull();

    actionSucceeded = true;
    toast().shadowRoot.querySelector('.action').click();
    await flush();
    expect(window.localStorage.getItem(ANNOUNCEMENT.storageKey)).toBe('1');
    expect(toast()).toBeNull();
  });

  test('tracks YouTube dark-mode changes', async () => {
    loadAnnouncement((message) => ({
      announcements: message.type === 'getAnnouncements' ? [ANNOUNCEMENT] : [],
      show: message.type === 'claimAnnouncement',
    }));
    await flush();

    document.documentElement.setAttribute('dark', '');
    await flush();
    expect(toast().dataset.theme).toBe('dark');

    document.documentElement.removeAttribute('dark');
    await flush();
    expect(toast().dataset.theme).toBe('light');
  });

  test('uses the same toast for onboarding and opens the extension popup action', async () => {
    loadAnnouncement((message) => {
      if (message.type === 'getAnnouncements') return { announcements: [WELCOME_ANNOUNCEMENT] };
      if (message.type === 'claimAnnouncement') return { show: true };
      if (message.type === 'runAnnouncementAction') return { ok: true };
      return { ok: true };
    });
    await flush();

    expect(toast().shadowRoot.querySelector('h2').textContent).toBe(WELCOME_ANNOUNCEMENT.title);
    toast().shadowRoot.querySelector('.action').click();
    await flush();

    expect(window.localStorage.getItem(WELCOME_ANNOUNCEMENT.storageKey)).toBe('1');
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { type: 'runAnnouncementAction', announcementId: WELCOME_ANNOUNCEMENT.id },
      expect.any(Function)
    );
  });
});

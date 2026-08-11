/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'feed-settings.js'), 'utf8');

test('applies the saved legacy overlay color when the feed opens', async () => {
  const context = {
    document,
    window: { matchMedia: jest.fn(() => ({ matches: false })) },
    ytStorage: { getSettings: jest.fn(async () => ({ accentColor: 'blue', overlayColor: 'green' })) },
    chrome: { tabs: { query: jest.fn() } },
    localStorage,
    console,
    tFeed: (_key, fallback) => fallback
  };
  vm.runInNewContext(source, context);

  await context.initializeFeedAppearance();

  expect(document.documentElement.dataset.accent).toBe('green');
  expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#2ecc71');
});

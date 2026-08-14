const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

test('Feed uses title blocks for its top-level views and keeps master actions in the masthead', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src', 'feed.html'), 'utf8');

  expect(html).toContain('id="feedTitleBar"');
  expect(html).toContain('id="reloadView"');
  expect(html).toContain('id="reloadWatchLater"');
  expect(html).toContain('id="clearHistoryPage"');
  expect(html).toContain('id="clearSubscriptions"');
  expect(html).toContain('id="subscriptionAddForm"');
  expect((html.match(/class="[^\"]*feed-title-bar/g) || []).length).toBeGreaterThanOrEqual(7);
  expect(html.indexOf('id="reloadView"')).toBeGreaterThan(html.indexOf('<main class="main">'));
  expect(html.indexOf('id="clearHistoryPage"')).toBeLessThan(html.indexOf('<main class="main">'));
});

test('Feed persists the default collapsed icon rail and restores expanded navigation labels', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'feed.js'), 'utf8');

  expect(source).toContain("localStorage.getItem('ytvhtSidebarCollapsed') !== 'false'");
  expect(source).toContain("localStorage.setItem('ytvhtSidebarCollapsed'");
  expect(source).toContain("item.title = collapsed ? item.textContent.trim() : item.dataset.expandedTitle");
});

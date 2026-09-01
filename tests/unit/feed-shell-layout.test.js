const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

test('Feed groups its video reload and local refresh actions in the feed title bar', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src', 'feed.html'), 'utf8');

  expect(html).toContain('id="feedTitleBar"');
  expect(html).toContain('data-i18n="feed_refresh">Reload videos</button>');
  expect(html).toContain('data-i18n="feed_refresh_view">Refresh</button>');
  expect(html).toContain('id="reloadView"');
  expect(html).toContain('id="reloadWatchLater"');
  expect(html).toContain('id="clearHistoryPage"');
  expect(html).toContain('id="clearSubscriptions"');
  expect(html).toContain('id="subscriptionAddForm"');
  expect((html.match(/class="[^\"]*feed-title-bar/g) || []).length).toBeGreaterThanOrEqual(7);
  expect(html.indexOf('id="reloadView"')).toBeGreaterThan(html.indexOf('<main class="main">'));
  expect(html.indexOf('id="refresh"')).toBeGreaterThan(html.indexOf('<main class="main">'));
  expect(html.indexOf('id="clearHistoryPage"')).toBeLessThan(html.indexOf('<main class="main">'));
});

test('Feed starts with expanded navigation and restores a user-selected collapsed rail', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'feed.js'), 'utf8');

  expect(source).toContain("localStorage.getItem('ytvhtSidebarCollapsed') === 'true'");
  expect(source).toContain("localStorage.setItem('ytvhtSidebarCollapsed'");
  expect(source).toContain("item.title = collapsed ? item.textContent.trim() : item.dataset.expandedTitle");
});

test('Feed title icons are constructed as SVG DOM nodes rather than dynamic HTML', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'feed-home.js'), 'utf8');

  expect(source).toContain("document.createElementNS('http://www.w3.org/2000/svg', 'svg')");
  expect(source).toContain('titleIcon.replaceChildren(createFeedTitleIcon(');
  expect(source).not.toContain('titleIcon.innerHTML');
});

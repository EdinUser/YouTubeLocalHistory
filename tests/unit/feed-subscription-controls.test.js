const fs = require('fs');
const path = require('path');

const feedHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'feed.html'), 'utf8');

test('Subscriptions order control shares the status row and is right-aligned', () => {
  expect(feedHtml).toMatch(
    /<div class="status-row" id="statusRow" hidden>\s*<div class="status" id="status"><\/div>[\s\S]*?<select id="subscriptionSort"/
  );
  expect(feedHtml).toContain('.status-row {');
  expect(feedHtml).toContain('margin-left: auto;');
});

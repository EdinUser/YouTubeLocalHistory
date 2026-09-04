const assert = require('node:assert/strict');
const http = require('node:http');
const { launchFirefoxWithExtension, setExtensionSettings } = require('./firefox-fixture');

const AI_VIDEO_ID = 'AiLabel0001';
const REGULAR_VIDEO_ID = 'Regular0001';

function startServer() {
  let lookupCount = 0;
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/ai-label-static') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html><html><head><style>ytd-rich-item-renderer{display:block;height:100px;width:400px}</style><script>var ytcfg={data_:{"INNERTUBE_CLIENT_VERSION":"2.20260813.05.00","HL":"en","GL":"US"}};</script></head><body><ytd-rich-item-renderer id="ai-card"><a id="thumbnail" href="/watch?v=${AI_VIDEO_ID}">AI video</a></ytd-rich-item-renderer><ytd-rich-item-renderer id="regular-card"><a id="thumbnail" href="/watch?v=${REGULAR_VIDEO_ID}">Regular video</a></ytd-rich-item-renderer></body></html>`);
      return;
    }
    if (url.pathname === '/youtubei/v1/next') {
      lookupCount += 1;
      let body = '';
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        const isAi = JSON.parse(body).videoId === AI_VIDEO_ID;
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ contents: { twoColumnWatchNextResults: { results: { results: { contents: [{ videoPrimaryInfoRenderer: { badges: isAi ? [{ metadataBadgeRenderer: { label: 'AI' } }] : [] } }] } } } } }));
      });
      return;
    }
    response.writeHead(404); response.end();
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ origin: `http://127.0.0.1:${port}`, lookupCount: () => lookupCount, close: () => new Promise((done) => server.close(done)) });
    });
  });
}

async function main() {
  const fixture = await startServer();
  const session = await launchFirefoxWithExtension({ locale: 'en' });
  try {
    await setExtensionSettings(session, { aiLabeledVideoHandling: 'dim', debug: false, version: '5.2.1' });
    await session.driver.get(`${fixture.origin}/ai-label-static`);
    await session.driver.wait(() => session.driver.executeScript(() => document.querySelector('#ai-card')?.classList.contains('ytvht-ai-dimmed')), 15000, 'AI fixture card should be dimmed');
    await session.driver.wait(() => session.driver.executeScript(() => document.querySelector('#regular-card')?.dataset.ytvhtAiStatus === 'unlabeled'), 15000, 'regular fixture card should receive a valid non-AI result');
    const initial = await session.driver.executeScript(() => ({ status: document.querySelector('#ai-card')?.dataset.ytvhtAiStatus, badge: document.querySelector('#ai-card .ytvht-ai-label')?.textContent, regularClasses: document.querySelector('#regular-card')?.className }));
    assert.equal(initial.status, 'ai');
    assert.equal(initial.badge, 'AI');
    assert.doesNotMatch(initial.regularClasses, /ytvht-ai-(labeled|dimmed|hidden)/);
    assert.equal(fixture.lookupCount(), 2);
    await session.driver.executeScript(() => {
      window.dispatchEvent(new FocusEvent('focus'));
      const viewed = document.createElement('span'); viewed.className = 'ytvht-viewed-label'; document.querySelector('#ai-card').appendChild(viewed);
      const original = document.querySelector('#ai-card'); const replacement = original.cloneNode(true);
      replacement.id = 'ai-card-rebuilt'; replacement.className = '';
      replacement.querySelectorAll('.ytvht-ai-label, .ytvht-viewed-label').forEach((node) => node.remove());
      original.replaceWith(replacement);
    });
    await session.driver.wait(() => session.driver.executeScript(() => document.querySelector('#ai-card-rebuilt')?.classList.contains('ytvht-ai-dimmed') && document.querySelector('#ai-card-rebuilt .ytvht-ai-label')?.textContent === 'AI'), 15000, 'cached AI result should survive card rebuilding');
    assert.equal(fixture.lookupCount(), 2, 'rebuilt card should use the IndexedDB result');
    console.log('Firefox static AI-label contract passed');
  } finally { await session.cleanup(); await fixture.close(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

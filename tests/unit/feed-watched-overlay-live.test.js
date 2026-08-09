/** @jest-environment jsdom */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
let cardsContext;

beforeAll(() => {
  cardsContext = { document, watchedMap: {}, overlayTitle: 'Viewed' };
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'feed-cards.js'), 'utf8');
  vm.runInNewContext(source, cardsContext);
});

afterEach(() => {
  document.body.textContent = '';
  cardsContext.watchedMap = {};
});

test('updates only matching visible watched overlays without rerendering the feed', () => {
  const card = document.createElement('article');
  card.dataset.ytvhtVideoId = 'video-1';
  const thumbnail = document.createElement('div');
  thumbnail.className = 'ytvht-thumb-wrap';
  card.appendChild(thumbnail);
  document.body.appendChild(card);

  cardsContext.watchedMap['video-1'] = { videoId: 'video-1', time: 25, duration: 100 };
  cardsContext.refreshWatchedOverlayForVideo('video-1');
  expect(card.querySelector('.ytvht-viewed-label').textContent).toBe('25%');
  expect(card.querySelector('.ytvht-progress-bar').style.width).toBe('25%');

  cardsContext.watchedMap['video-1'] = { videoId: 'video-1', time: 100, duration: 100 };
  cardsContext.refreshWatchedOverlayForVideo('video-1');
  expect(card.querySelectorAll('.ytvht-viewed-label')).toHaveLength(1);
  expect(card.querySelector('.ytvht-viewed-label').textContent).toBe('Viewed');
  expect(card.querySelector('.ytvht-progress-bar').style.width).toBe('100%');

  delete cardsContext.watchedMap['video-1'];
  cardsContext.refreshWatchedOverlayForVideo('video-1');
  expect(card.querySelector('.ytvht-viewed-label')).toBeNull();
  expect(card.querySelector('.ytvht-progress-bar')).toBeNull();
});

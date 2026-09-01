/** @jest-environment jsdom */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
let cardsContext;

beforeAll(() => {
  cardsContext = {
    document,
    watchedMap: {},
    overlayTitle: 'Viewed',
    ytStorage: { getSettings: jest.fn(async () => ({ aiLabeledVideoHandling: 'off' })) },
    ytIndexedDBStorage: { getAiLabelResult: jest.fn(async () => null) }
  };
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'feed-cards.js'), 'utf8');
  vm.runInNewContext(source, cardsContext);
});

afterEach(() => {
  document.body.textContent = '';
  cardsContext.watchedMap = {};
  cardsContext.invalidateCachedAiLabelPresentation();
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

test('uses fresh cached AI results in extension cards without hiding local videos', async () => {
  cardsContext.ytStorage.getSettings = jest.fn(async () => ({ aiLabeledVideoHandling: 'hide' }));
  cardsContext.ytIndexedDBStorage.getAiLabelResult = jest.fn(async () => ({
    videoId: 'ai-video', status: 'ai', expiresAt: Date.now() + 60_000
  }));
  const card = document.createElement('article');
  card.dataset.ytvhtVideoId = 'ai-video';
  const thumbnail = document.createElement('div');
  thumbnail.className = 'ytvht-thumb-wrap';
  card.appendChild(thumbnail);
  document.body.appendChild(card);

  await cardsContext.applyCachedAiLabel(card, 'ai-video');

  expect(cardsContext.ytIndexedDBStorage.getAiLabelResult).toHaveBeenCalledWith('ai-video');
  expect(card.classList.contains('ytvht-feed-ai-labeled')).toBe(true);
  expect(card.classList.contains('ytvht-feed-ai-dimmed')).toBe(true);
  expect(card.style.display).not.toBe('none');
  expect(card.querySelector('.ytvht-feed-ai-label').textContent).toBe('AI');
});

test('does not render expired or unlabeled AI cache results in extension cards', async () => {
  cardsContext.ytStorage.getSettings = jest.fn(async () => ({ aiLabeledVideoHandling: 'badge' }));
  cardsContext.ytIndexedDBStorage.getAiLabelResult = jest.fn(async () => ({
    videoId: 'expired-video', status: 'ai', expiresAt: Date.now() - 1
  }));
  const card = document.createElement('article');
  card.appendChild(document.createElement('div')).className = 'ytvht-thumb-wrap';
  document.body.appendChild(card);

  await cardsContext.applyCachedAiLabel(card, 'expired-video');

  expect(card.classList.contains('ytvht-feed-ai-labeled')).toBe(false);
  expect(card.querySelector('.ytvht-feed-ai-label')).toBeNull();
});

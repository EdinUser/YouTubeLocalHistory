require('../../src/content-ai-labels');

describe('AI-label response parser', () => {
  const parser = () => window.YTVHTAiLabels.create({
    cache: { getAiLabelResult: jest.fn(), putAiLabelResult: jest.fn() }
  }).parse;

  test('recognizes YouTube metadata badge label AI', () => {
    expect(parser()({
      contents: { twoColumnWatchNextResults: { results: { results: { contents: [
        { videoPrimaryInfoRenderer: { badges: [{ metadataBadgeRenderer: { label: 'AI' } }] } }
      ] } } } }
    })).toBe('ai');
  });

  test('keeps a valid response with no disclosure distinct from a malformed response', () => {
    expect(parser()({
      contents: { twoColumnWatchNextResults: { results: { results: { contents: [
        { videoPrimaryInfoRenderer: { badges: [] } }
      ] } } } }
    })).toBe('unlabeled');
    expect(parser()({ contents: {} })).toBe('unknown');
    expect(parser()({
      contents: { twoColumnWatchNextResults: { results: { results: { contents: [
        { itemSectionRenderer: { contents: [] } }
      ] } } } }
    })).toBe('unknown');
  });

  test('does not treat generic information badges as AI labels', () => {
    expect(parser()({
      contents: { twoColumnWatchNextResults: { results: { results: { contents: [
        { videoPrimaryInfoRenderer: { badges: [{ metadataBadgeRenderer: { icon: { iconType: 'INFO' }, label: 'New' } }] } }
      ] } } } }
    })).toBe('unlabeled');
  });

  test('accepts the disclosure accessibility text as a renderer fallback', () => {
    expect(parser()({
      contents: { twoColumnWatchNextResults: { results: { results: { contents: [
        { videoPrimaryInfoRenderer: { badges: [{ metadataBadgeRenderer: {
          accessibilityData: { label: 'AI: Content was made with AI' }
        } }] } }
      ] } } } }
    })).toBe('ai');
  });

  test('keeps the explicit marker in Dim mode so dimming is explainable', () => {
    const source = require('fs').readFileSync(
      require('path').join(__dirname, '..', '..', 'src', 'content-ai-labels.js'),
      'utf8'
    );

    expect(source).toContain("if (mode === 'badge' || mode === 'dim')");
  });

  test('retries indeterminate responses after six hours and uses the page-world request bridge', () => {
    const source = require('fs').readFileSync(
      require('path').join(__dirname, '..', '..', 'src', 'content-ai-labels.js'),
      'utf8'
    );

    expect(source).toContain('unknown: 6 * 3600000');
    expect(source).toContain('racyCheckOk: true');
    expect(source).toContain('contentCheckOk: true');
    expect(source).toContain('cacheVersion: CACHE_VERSION');
    expect(source).toContain('pageWorldLookup');
    expect(source).not.toContain("fetch(new URL('/youtubei/");
    expect(source).toContain('log(`[YTVHT AI] ${message}`, data)');
    expect(source).not.toContain("console.info('[YTVHT AI]'");
  });

  test('keeps page-world request traces behind debug mode', () => {
    const source = require('fs').readFileSync(
      require('path').join(__dirname, '..', '..', 'src', 'content-ai-labels-page.js'),
      'utf8'
    );

    expect(source).toContain('const debug = event.data.debug === true');
    expect(source).toContain("if (debug) console.info('[YTVHT AI] Page-world lookup started'");
    expect(source).toContain("if (debug) console.info('[YTVHT AI] Page-world lookup finished'");
  });

  test('keeps observing returned cards so virtualized YouTube DOM updates reapply cached results', () => {
    const source = require('fs').readFileSync(
      require('path').join(__dirname, '..', '..', 'src', 'content-ai-labels.js'),
      'utf8'
    );

    expect(source).toContain('const resolvedStatuses = new Map()');
    expect(source).toContain('re-entry reapplies the cached');
    expect(source).not.toContain('observer.unobserve(entry.target)');
    expect(source).toContain("'.ytvht-viewed-label'");
    expect(source).toContain('OWN_OVERLAY_SELECTOR');
  });

  test('starts lookups once per second with at most two requests in flight', () => {
    const source = require('fs').readFileSync(
      require('path').join(__dirname, '..', '..', 'src', 'content-ai-labels.js'),
      'utf8'
    );

    expect(source).toContain('const MAX_CONCURRENT_LOOKUPS = 2');
    expect(source).toContain('const LOOKUP_START_INTERVAL_MS = 1000');
    expect(source).toContain('activeLookups >= MAX_CONCURRENT_LOOKUPS');
  });

  test('does not restart unchanged AI handling on a focus settings refresh', () => {
    const source = require('fs').readFileSync(
      require('path').join(__dirname, '..', '..', 'src', 'content-ai-labels.js'),
      'utf8'
    );

    expect(source).toContain('if (!stopped && nextMode === mode) {');
    expect(source).toContain('debug = nextDebug');
    expect(source).toContain('return { start, stop, update, parse, TTL }');
  });

  test('accepts an extension-owned shared cache instead of requiring the page-origin database', () => {
    const cache = { getAiLabelResult: jest.fn(), putAiLabelResult: jest.fn() };
    const instance = window.YTVHTAiLabels.create({ cache });

    expect(instance).toBeDefined();
  });
});

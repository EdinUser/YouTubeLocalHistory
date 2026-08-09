const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..', '..');
const localesRoot = path.join(root, 'src', '_locales');
const locales = ['en', 'bg', 'de', 'es', 'fr'];

function loadCatalog(locale) {
  const directory = path.join(localesRoot, locale);
  const catalog = {};
  const duplicates = [];
  fs.readdirSync(directory)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .forEach((file) => {
      const fragment = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
      Object.entries(fragment).forEach(([key, value]) => {
        if (catalog[key]) duplicates.push(key);
        catalog[key] = value;
      });
    });
  return { catalog, duplicates };
}

function placeholders(message) {
  return [...String(message || '').matchAll(/\$([1-9])/g)]
    .map((match) => match[1])
    .sort();
}

function sourceMessageKeys(source) {
  const keys = new Set();
  const patterns = [
    /tFeed\(\s*['"]([^'"]+)/g,
    /feedMessage\(\s*['"]([^'"]+)/g,
    /data-i18n(?:-title|-placeholder|-aria-label)?=['"]([^'"]+)/g
  ];
  patterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(source))) keys.add(match[1]);
  });
  return keys;
}

function productionSourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '_locales') return [];
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionSourceFiles(entryPath);
    return /\.(?:js|html|json)$/.test(entry.name) ? [entryPath] : [];
  });
}

describe('feed localization catalogs', () => {
  const catalogs = Object.fromEntries(locales.map((locale) => [locale, loadCatalog(locale)]));

  test('all supported locales have complete, collision-free catalogs', () => {
    const englishKeys = Object.keys(catalogs.en.catalog).sort();
    locales.forEach((locale) => {
      expect(catalogs[locale].duplicates).toEqual([]);
      expect(Object.keys(catalogs[locale].catalog).sort()).toEqual(englishKeys);
    });
  });

  test('translations preserve substitutions and contain no corruption markers', () => {
    const english = catalogs.en.catalog;
    locales.forEach((locale) => {
      Object.entries(catalogs[locale].catalog).forEach(([key, value]) => {
        expect(typeof value.message).toBe('string');
        expect(value.message).not.toContain('\uFFFD');
        expect(value.message).not.toMatch(/\?{2,}/);
        expect(value.message).not.toMatch(/[A-Za-zÀ-ÿА-Яа-я]\?[A-Za-zÀ-ÿА-Яа-я]/);
        expect(placeholders(value.message)).toEqual(placeholders(english[key].message));
      });
    });
  });

  test('feed page and active runtime keys exist in every locale', () => {
    const feedHtml = fs.readFileSync(path.join(root, 'src', 'feed.html'), 'utf8');
    const scriptNames = [...feedHtml.matchAll(/<script src="([^"]+\.js)"><\/script>/g)]
      .map((match) => match[1])
      .filter((name) => name.startsWith('feed-') || name === 'feed.js');
    const source = [feedHtml, ...scriptNames.map((name) => (
      fs.readFileSync(path.join(root, 'src', name), 'utf8')
    ))].join('\n');
    const directKeys = sourceMessageKeys(source);
    const pluralBases = [...source.matchAll(/feedPlural\(\s*['"]([^'"]+)/g)]
      .map((match) => match[1]);

    locales.forEach((locale) => {
      const catalog = catalogs[locale].catalog;
      directKeys.forEach((key) => expect(catalog[key]).toBeDefined());
      pluralBases.forEach((base) => {
        expect(catalog[`${base}_one`]).toBeDefined();
        expect(catalog[`${base}_other`]).toBeDefined();
      });
    });

    expect(feedHtml.indexOf('src="feed-localization.js"'))
      .toBeLessThan(feedHtml.indexOf('src="feed-state-utils.js"'));
    expect(feedHtml).toContain('data-i18n="feed_subscribe_with_rewatch"');
    expect(feedHtml).toContain('data-i18n-placeholder="feed_channel_input_placeholder"');
  });

  test('does not retain locale keys without production consumers', () => {
    const source = productionSourceFiles(path.join(root, 'src'))
      .map((file) => fs.readFileSync(file, 'utf8'))
      .join('\n');
    const pluralBases = [...source.matchAll(/feedPlural\(\s*['"]([^'"]+)/g)]
      .map((match) => match[1]);
    const pluralKeys = new Set(pluralBases.flatMap((base) => [
      `${base}_zero`, `${base}_one`, `${base}_two`,
      `${base}_few`, `${base}_many`, `${base}_other`
    ]));
    const unreferenced = Object.keys(catalogs.en.catalog).filter((key) => {
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const literalReference = new RegExp(`['"]${escaped}['"]`).test(source);
      const manifestReference = source.includes(`__MSG_${key}__`);
      return !literalReference && !manifestReference && !pluralKeys.has(key);
    });

    expect(unreferenced).toEqual([]);
  });
});

describe('feed localization runtime', () => {
  function makeContext(locale = 'en') {
    const dom = new JSDOM(`<!doctype html><body>
      <span id="text" data-i18n="feed_subscribe">Subscribe</span>
      <button id="title" data-i18n-title="feed_video_options"></button>
      <input id="input" data-i18n-placeholder="feed_channel_input_placeholder">
      <button id="aria" data-i18n-aria-label="feed_video_options"></button>
    </body>`);
    const { catalog } = loadCatalog(locale);
    const context = {
      chrome: {
        i18n: {
          getUILanguage: () => locale,
          getMessage: (key, substitutions = []) => {
            if (!catalog[key]) return '';
            const values = Array.isArray(substitutions) ? substitutions : [substitutions];
            return values.reduce(
              (message, value, index) => message.replaceAll(`$${index + 1}`, String(value)),
              catalog[key].message
            );
          }
        }
      },
      document: dom.window.document,
      navigator: dom.window.navigator,
      Intl,
      Date,
      console
    };
    vm.runInNewContext(
      fs.readFileSync(path.join(root, 'src', 'feed-localization.js'), 'utf8'),
      context
    );
    return context;
  }

  test('localizes static text and accessibility attributes', () => {
    const context = makeContext('de');
    context.localizeFeedPage();
    expect(context.document.getElementById('text').textContent).toBe('Abonnieren');
    expect(context.document.getElementById('title').title).toBe('Videooptionen');
    expect(context.document.getElementById('input').placeholder).toBe('Kanal-URL, UC-ID oder @Handle');
    expect(context.document.getElementById('aria').getAttribute('aria-label')).toBe('Videooptionen');
  });

  test('formats plural, number, relative-time, and placeholder fallbacks', () => {
    const context = makeContext('en');
    expect(context.feedPlural('feed_videos', 1, '$1 video', '$1 videos')).toBe('1 video');
    expect(context.feedPlural('feed_videos', 2, '$1 video', '$1 videos')).toBe('2 videos');
    expect(context.feedFormatNumber(1200)).toBe(new Intl.NumberFormat('en').format(1200));
    expect(context.feedRelativeTime(Date.now() - 24 * 60 * 60 * 1000)).toBe('yesterday');
    expect(context.feedVideoTitle('Unknown Title')).toBe('Unknown Title');
    expect(context.feedChannelTitle('Unknown Channel')).toBe('Unknown Channel');
    expect(context.tFeed('missing_key', 'Fallback')).toBe('Fallback');
  });
});

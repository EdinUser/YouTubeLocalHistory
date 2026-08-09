const {
  CONSENT_SURFACE_PATTERN,
  isConsentActionLabel,
  isConsentFrameUrl,
  normalizeConsentLabel,
} = require('../e2e/youtube-consent-labels');

describe('YouTube consent matching', () => {
  test.each([
    'Accept all',
    'Reject all',
    'Alle akzeptieren',
    'Refuser tout',
    'Aceptar todo',
    'Приемам всички',
    'Отхвърляне на всички',
  ])('accepts a specific consent action: %s', (label) => {
    expect(isConsentActionLabel(label)).toBe(true);
  });

  test.each([
    'More actions',
    'Like this comment along with 466 other people',
    'Consent preferences explained in this video',
    'OK',
    'Got it',
  ])('rejects an unrelated or ambiguous page action: %s', (label) => {
    expect(isConsentActionLabel(label)).toBe(false);
  });

  test('normalizes whitespace without combining independent accessible labels', () => {
    expect(normalizeConsentLabel('  Accept\n  all  ')).toBe('Accept all');
  });

  test('recognizes supported consent surfaces and dedicated consent frames', () => {
    expect(CONSENT_SURFACE_PATTERN.test('Преди да продължите към YouTube')).toBe(true);
    expect(isConsentFrameUrl('https://consent.youtube.com/m?continue=1')).toBe(true);
    expect(isConsentFrameUrl('https://www.youtube.com/watch?v=test')).toBe(false);
  });
});

const CONSENT_SURFACE_PATTERN = /before you continue to youtube|bevor du mit youtube fortfährst|avant d['’]accéder à youtube|antes de continuar a youtube|prije nego što nastavite na youtube|înainte de a continua pe youtube|преди да продължите към youtube/i;

const CONSENT_ACCEPT_ACTION_PATTERNS = [
  /^accept all$/i,
  /^i agree$/i,
  /^alle akzeptieren$/i,
  /^acceptez tout$/i,
  /^aceptar todo$/i,
  /^prihvati sve$/i,
  /^acceptă tot$/i,
  /^приемам всички$/i,
];

const CONSENT_REJECT_ACTION_PATTERNS = [
  /^reject all$/i,
  /^alle ablehnen$/i,
  /^refuser tout$/i,
  /^rechazar todo$/i,
  /^odbi sve$/i,
  /^respinge tot$/i,
  /^отхвърляне на всички$/i,
  /^отхвърлям всички$/i,
];

function normalizeConsentLabel(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isConsentActionLabel(value) {
  const label = normalizeConsentLabel(value);
  return !!label && [...CONSENT_ACCEPT_ACTION_PATTERNS, ...CONSENT_REJECT_ACTION_PATTERNS]
    .some((pattern) => pattern.test(label));
}

function isRejectConsentActionLabel(value) {
  const label = normalizeConsentLabel(value);
  return !!label && CONSENT_REJECT_ACTION_PATTERNS.some((pattern) => pattern.test(label));
}

function isConsentFrameUrl(value) {
  try {
    const hostname = new URL(value).hostname;
    return hostname === 'consent.youtube.com' || hostname === 'consent.google.com';
  } catch {
    return false;
  }
}

module.exports = {
  CONSENT_SURFACE_PATTERN,
  isConsentActionLabel,
  isConsentFrameUrl,
  isRejectConsentActionLabel,
  normalizeConsentLabel,
};

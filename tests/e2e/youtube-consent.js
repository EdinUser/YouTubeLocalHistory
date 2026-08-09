/**
 * Dismiss YouTube / Google cookie & consent UI that blocks automation.
 * CMP often lives in iframes; buttons vary by locale ("Accept all", "Alle akzeptieren", …).
 */

const {
  CONSENT_SURFACE_PATTERN,
  isConsentActionLabel,
  isConsentFrameUrl,
  isRejectConsentActionLabel,
  normalizeConsentLabel,
} = require('./youtube-consent-labels');

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ preferReject?: boolean }} [opts]
 */
async function dismissYouTubeConsent(page, opts = {}) {
  const preferReject = opts.preferReject === true;
  const actionSelector = 'button, a, input[type="submit"], [role="button"], tp-yt-paper-button, ytd-button-renderer, .eom-button';
  const observedActionLabels = new Set();
  const inspectionFrames = () => {
    const mainFrame = page.mainFrame();
    return page.frames().filter((frame) => frame === mainFrame || isConsentFrameUrl(frame.url()));
  };

  const inspectFrame = async (frame) => {
    const frameText = await frame.locator('body').innerText({ timeout: 750 }).catch(() => '');
    const consentDetected = CONSENT_SURFACE_PATTERN.test(frameText);
    if (!consentDetected && !isConsentFrameUrl(frame.url())) {
      return { clicked: false, consentDetected: false };
    }

    const candidates = frame.locator(actionSelector);
    const labels = await candidates.evaluateAll((elements) => elements.map((element, index) => ({
      index,
      labels: [
        element.textContent,
        element.getAttribute('aria-label'),
        element.getAttribute('value'),
      ],
    }))).catch(() => []);
    for (const candidate of labels) {
      for (const value of candidate.labels) {
        const label = normalizeConsentLabel(value);
        if (label && label.length <= 100) observedActionLabels.add(label);
      }
    }

    const orderedCandidates = preferReject
      ? [...labels].sort((left, right) => {
        const leftReject = left.labels.some(isRejectConsentActionLabel);
        const rightReject = right.labels.some(isRejectConsentActionLabel);
        return Number(rightReject) - Number(leftReject);
      })
      : labels;

    const actionableCandidates = orderedCandidates
      .filter((candidate) => candidate.labels.some(isConsentActionLabel))
      .slice(0, 6);
    for (const candidate of actionableCandidates) {
      const control = candidates.nth(candidate.index);
      try {
        await control.click({ force: true, timeout: 1500 });
        return { clicked: true, consentDetected };
      } catch {
        /* next */
      }
    }

    return { clicked: false, consentDetected };
  };

  const maxPasses = 8;
  let consentDetected = false;
  for (let pass = 0; pass < maxPasses; pass++) {
    let clicked = false;
    let detectedThisPass = false;

    /** @type {import('@playwright/test').Frame[]} */
    const frames = inspectionFrames();

    for (const frame of frames) {
      const result = await inspectFrame(frame);
      detectedThisPass = detectedThisPass || result.consentDetected;
      if (result.clicked) {
        clicked = true;
        break;
      }
    }
    consentDetected = consentDetected || detectedThisPass;

    if (clicked) {
      await page.waitForTimeout(500);
      continue;
    }

    if (detectedThisPass) {
      await page.waitForTimeout(500);
      continue;
    }

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }

  if (consentDetected) {
    const stillVisible = await Promise.all(inspectionFrames().map((frame) =>
      frame.locator('body').innerText({ timeout: 750 })
        .then((text) => CONSENT_SURFACE_PATTERN.test(text))
        .catch(() => false)
    )).then((results) => results.some(Boolean));
    if (stillVisible) {
      const labelDetails = [...observedActionLabels].slice(-30).join(' | ') || '(none)';
      throw new Error(
        `YouTube consent modal was detected but no supported consent action could be clicked. `
        + `Observed action labels: ${labelDetails}`
      );
    }
  }
}

module.exports = { dismissYouTubeConsent };

/**
 * Dismiss YouTube / Google cookie & consent UI that blocks automation.
 * CMP often lives in iframes; buttons vary by locale ("Accept all", "Alle akzeptieren", …).
 */

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ preferReject?: boolean }} [opts]
 */
async function dismissYouTubeConsent(page, opts = {}) {
  const preferReject = opts.preferReject === true;

  const acceptFirst = [
    /accept all/i,
    /acceptez tout/i,
    /alle akzeptieren/i,
    /aceptar todo/i,
    /prihvati sve/i,
    /acceptă tot/i,
    /^agree$/i,
    /i agree/i,
    /got it/i,
    /^ok$/i,
    /consent/i,
  ];

  const rejectFirst = [
    /reject all/i,
    /refuser tout/i,
    /alle ablehnen/i,
    /rechazar todo/i,
    /odbi sve/i,
  ];

  const ordered = preferReject ? [...rejectFirst, ...acceptFirst] : [...acceptFirst, ...rejectFirst];
  const actionSelector = 'button, a, input[type="submit"], [role="button"], tp-yt-paper-button, ytd-button-renderer, .eom-button';
  const consentSurfacePattern = /before you continue to youtube/i;

  const inspectFrame = async (frame) => {
    const consentDetected = await frame.getByText(consentSurfacePattern).first()
      .isVisible({ timeout: 150 })
      .catch(() => false);
    const candidates = frame.locator(actionSelector);
    const labels = await candidates.evaluateAll((elements) => elements.map((element, index) => ({
      index,
      label: [
        element.textContent,
        element.getAttribute('aria-label'),
        element.getAttribute('value'),
      ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(),
    }))).catch(() => []);

    for (const pattern of ordered) {
      for (const candidate of labels) {
        if (!pattern.test(candidate.label)) continue;

        const control = candidates.nth(candidate.index);
        try {
          if (!await control.isVisible({ timeout: 250 }).catch(() => false)) continue;
          await control.scrollIntoViewIfNeeded({ timeout: 3000 });
          await control.click({ timeout: 8000 });
          return { clicked: true, consentDetected };
        } catch {
          /* next */
        }
      }
    }

    return { clicked: false, consentDetected };
  };

  const maxPasses = 4;
  let consentDetected = false;
  for (let pass = 0; pass < maxPasses; pass++) {
    let clicked = false;
    let detectedThisPass = false;

    /** @type {import('@playwright/test').Frame[]} */
    const frames = page.frames();

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
    const stillVisible = await Promise.all(page.frames().map((frame) =>
      frame.getByText(consentSurfacePattern).first().isVisible({ timeout: 150 }).catch(() => false)
    )).then((results) => results.some(Boolean));
    if (stillVisible) {
      throw new Error('YouTube consent modal was detected but no supported consent action could be clicked.');
    }
  }
}

module.exports = { dismissYouTubeConsent };

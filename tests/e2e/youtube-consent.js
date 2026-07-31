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

  const tryFrame = async (frame) => {
    for (const pattern of ordered) {
      for (const role of ['button', 'link']) {
        try {
          const loc = frame.getByRole(role, { name: pattern }).first();
          if (await loc.isVisible({ timeout: 500 }).catch(() => false)) {
            await loc.click({ timeout: 10000 });
            await page.waitForTimeout(400);
            return true;
          }
        } catch {
          /* next */
        }
      }
    }
    return false;
  };

  const maxPasses = 4;
  for (let pass = 0; pass < maxPasses; pass++) {
    let clicked = false;

    /** @type {import('@playwright/test').Frame[]} */
    const frames = page.frames().filter((f) => {
      try {
        const u = f.url();
        return u && !u.startsWith('about:blank');
      } catch {
        return false;
      }
    });

    for (const frame of frames) {
      if (await tryFrame(frame)) {
        clicked = true;
        break;
      }
    }

    if (clicked) {
      continue;
    }

    // YouTube sometimes uses custom elements (no implicit role)
    try {
      const paper = page.locator('tp-yt-paper-button, ytd-button-renderer button, .eom-button').filter({
        hasText: preferReject ? /reject|ablehnen|refuser/i : /accept|akzeptieren|aceptar|agree/i,
      }).first();
      if (await paper.isVisible({ timeout: 600 }).catch(() => false)) {
        await paper.click({ timeout: 8000 });
        await page.waitForTimeout(400);
        continue;
      }
    } catch {
      /* ignore */
    }

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
}

module.exports = { dismissYouTubeConsent };

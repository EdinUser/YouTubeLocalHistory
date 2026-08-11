/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'content-css.js'), 'utf8');

test('keeps the dynamic overlay accent stylesheet after the reinjected base stylesheet', () => {
  const context = { document, window };
  vm.runInNewContext(source, context);

  context.window.YTVHTContentCss.updateOverlayCSS({ fontSize: 16, bar: 3 }, '#2ecc71');
  context.window.YTVHTContentCss.injectCSS();
  context.window.YTVHTContentCss.updateOverlayCSS({ fontSize: 16, bar: 3 }, '#2ecc71');

  const styles = [...document.head.querySelectorAll('style')];
  expect(styles.at(-1).id).toBe('ytvht-dynamic-styles');
  expect(styles.at(-1).textContent).toContain('background-color: #2ecc71 !important');
});

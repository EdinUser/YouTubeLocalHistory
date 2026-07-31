/**
 * Global setup for Playwright: ensure unpacked extension exists under build/e2e/chrome.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function globalSetup() {
  const root = path.resolve(__dirname, '../..');
  const manifest = path.join(root, 'build', 'e2e', 'chrome', 'manifest.json');

  if (!fs.existsSync(manifest)) {
    console.log('[e2e] Building unpacked extension (build/e2e/chrome)...');
    execSync('bash scripts/build-chrome-unpacked.sh', { cwd: root, stdio: 'inherit' });
  }

  if (!fs.existsSync(manifest)) {
    throw new Error(
      '[e2e] Missing build/e2e/chrome/manifest.json. Run manually: npm run build:e2e'
    );
  }
}

module.exports = globalSetup;

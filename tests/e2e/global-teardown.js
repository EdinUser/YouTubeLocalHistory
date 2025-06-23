/**
 * Global teardown for Playwright E2E tests
 */

async function globalTeardown(config) {
  console.log('Cleaning up E2E test environment...');
  
  // You can add global cleanup here, such as:
  // - Cleaning up test data
  // - Removing temporary files
  // - Closing browser instances
  // - Cleaning up test artifacts
  
  // Example: Clean up test artifacts
  // const fs = require('fs');
  // const path = require('path');
  // 
  // const testResultsDir = path.join(__dirname, '../test-results');
  // if (fs.existsSync(testResultsDir)) {
  //   fs.rmSync(testResultsDir, { recursive: true, force: true });
  //   console.log('Test results cleaned up');
  // }
  
  console.log('E2E test environment cleanup complete');
}

module.exports = globalTeardown; 
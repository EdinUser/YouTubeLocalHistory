/**
 * Global setup for Playwright E2E tests
 */

const { chromium } = require('@playwright/test');

async function globalSetup(config) {
  console.log('Setting up E2E test environment...');

  // You can add global setup here, such as:
  // - Building the extension
  // - Setting up test data
  // - Configuring browser extensions
  // - Setting up authentication

  // Example: Build the extension before running tests
  // const { execSync } = require('child_process');
  // try {
  //   execSync('npm run build', { stdio: 'inherit' });
  //   console.log('Extension built successfully');
  // } catch (error) {
  //   console.error('Failed to build extension:', error);
  //   throw error;
  // }

  console.log('E2E test environment setup complete');
}

module.exports = globalSetup;
// @ts-check
/* Playwright config for kyototrailplan05 E2E.
 *
 * Run via:
 *   npm install
 *   npx playwright install chromium
 *   npx playwright test --config tests/playwright/playwright.config.js
 *
 * BASE_URL override:
 *   BASE_URL=https://funmatu.github.io/kyototrailplan05/ npm run test:e2e
 *   (used by the weekly GitHub Actions job to smoke the prod URL)
 */

const { defineConfig, devices } = require('@playwright/test');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8081/';
const useExternalServer = !!process.env.BASE_URL;

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: '**/*.spec.js',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(__dirname, '../../playwright-report'), open: 'never' }]
  ],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    permissions: ['geolocation'],
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 414, height: 896 } }
    }
  ],
  webServer: useExternalServer ? undefined : {
    command: 'python3 -m http.server 8081',
    cwd: path.resolve(__dirname, '../..'),
    port: 8081,
    timeout: 30_000,
    reuseExistingServer: !process.env.CI
  }
});

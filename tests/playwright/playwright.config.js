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
      // The app is mobile-first; use Playwright's mobile device emulation so
      // touch / user-agent / DPR / viewport all match a real phone session.
      // Pixel 5 (Android Chrome) keeps us on chromium — no extra webkit install
      // needed (iPhone 11 would require `npx playwright install webkit`).
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] }
    }
  ],
  webServer: useExternalServer ? undefined : {
    // npx http-server is provided via devDependencies, removing the python3
    // host dependency. Disable the index page (-d) and CORS headers to mirror
    // GitHub Pages behavior.
    command: 'npx http-server . -p 8081 -c-1 --silent',
    cwd: path.resolve(__dirname, '../..'),
    port: 8081,
    timeout: 30_000,
    reuseExistingServer: !process.env.CI
  }
});

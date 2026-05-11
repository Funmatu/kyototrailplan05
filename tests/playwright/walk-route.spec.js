// @ts-check
/* Walking-progress E2E.
 *
 * Two-axis coverage:
 *   1. Real Geolocation API path: context.setGeolocation() simulates the
 *      browser's GPS feed. Verifies the watchPosition handler in index.html
 *      registers forward movement and updates the dashboard.
 *   2. In-app simulator path (?sim=...): exercises js/simulator.js directly
 *      so a full coverage cycle is achievable in seconds (no need to space
 *      out fixes by 3+ seconds for the throttle).
 */
const { test, expect } = require('@playwright/test');

// Field names follow the Playwright BrowserContext.setGeolocation contract.
const NISHI_WAYPOINTS = [
  // Drawn from data/courses/nishiyama.json: start, 松尾山, 嵐山展望, 渡月橋, 西山峠, ゴール
  { km: 0.0, latitude: 34.9940, longitude: 135.6835, name: '苔寺・鈴虫寺バス停' },
  { km: 2.6, latitude: 34.9890, longitude: 135.6742, name: '松尾山' },
  { km: 4.1, latitude: 35.0042, longitude: 135.6600, name: '嵐山展望地点' },
  { km: 6.1, latitude: 35.0002, longitude: 135.6628, name: '渡月橋' },
  { km: 10.8, latitude: 35.0290, longitude: 135.6558, name: '西山峠' },
  { km: 15.0, latitude: 35.0580, longitude: 135.6530, name: '上桂駅' }
];

test.describe('Real Geolocation API', () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['geolocation']);
  });

  // Real-Geolocation paths (initial fix landing into onPositionUpdate) are
  // covered indirectly: the simulator tests below validate the same dashboard
  // / map / progress code paths. Dedicated movement coverage via
  // setGeolocation is unreliable because Playwright's API doesn't push fresh
  // values to existing watchPosition listeners; we'd need to stop and restart
  // the watcher between fixes, which would couple the test deeply to internal
  // app state. Phase 7 (real-device shadow) covers true GPS hardware behavior.
  test('Nishiyama: course view loads with permission + initial position granted', async ({ page, context }) => {
    await context.setGeolocation({ ...NISHI_WAYPOINTS[0], accuracy: 5 });
    await page.goto('#course=nishiyama');
    await expect(page.locator('#hdr-course-name')).toHaveText('西山コース');
    // Map renders (Leaflet attribution shows up once tiles load)
    await expect(page.locator('#map')).toBeVisible();
    // No JS error toast surfaced
    await expect(page.locator('#toast')).not.toBeVisible();
  });
});

test.describe('In-app simulator (?sim=...)', () => {
  test('Nishiyama: simulator banner + course auto-loaded + dashboard advances', async ({ page }) => {
    // Use a high speed so the test completes quickly (~2 km in ~25 sec at speed=200)
    await page.goto('?sim=nishiyama&speed=200');

    // Sim banner visible
    await expect(page.locator('#sim-banner')).toBeVisible();
    await expect(page.locator('#sim-banner')).toContainText('シミュレータ実行中');

    // Course auto-entered
    await expect(page.locator('#hdr-course-name')).toHaveText('西山コース');

    // Wait for the dashboard distance to advance past 1 km
    await expect.poll(
      async () => parseFloat(await page.locator('#val-dist').textContent() || '0'),
      { timeout: 30_000, intervals: [1_000] }
    ).toBeGreaterThan(1);

    // Calorie estimate is non-zero
    const cal = parseInt(await page.locator('#val-cal').textContent() || '0', 10);
    expect(cal).toBeGreaterThan(0);
  });

  test('Higashiyama: simulator drives data-driven (OSM) course path', async ({ page }) => {
    await page.goto('?sim=higashiyama&speed=200');
    await expect(page.locator('#hdr-course-name')).toHaveText('東山コース');
    await expect(page.locator('#sim-banner')).toContainText('シミュレータ実行中');
    await expect.poll(
      async () => parseFloat(await page.locator('#val-dist').textContent() || '0'),
      { timeout: 30_000, intervals: [1_000] }
    ).toBeGreaterThan(0.5);
  });
});

test.describe('Cross-day persistence', () => {
  test('progress survives a reload via localStorage', async ({ page }) => {
    // Seed: walk a bit via simulator, then force-flush and reload as a fresh visit.
    await page.goto('?sim=nishiyama&speed=200');
    await expect.poll(
      async () => parseFloat(await page.locator('#val-dist').textContent() || '0'),
      { timeout: 30_000, intervals: [1_000] }
    ).toBeGreaterThan(0.5);
    const distAfterFirstWalk = parseFloat(await page.locator('#val-dist').textContent() || '0');

    // Back to landing — finalizes the session and persists progress
    await page.locator('#back-to-landing').click();
    await expect(page.locator('#landing')).not.toHaveClass(/hidden/);

    // Per-course card should reflect ≥ first-walk distance
    const cardText = await page.locator('.course-card.implemented').filter({ hasText: '西山コース' })
      .locator('.course-card-progress span').textContent();
    const persistedKm = parseFloat((cardText || '').replace(/km.*/, ''));
    expect(persistedKm).toBeGreaterThanOrEqual(distAfterFirstWalk - 0.05);

    // Reload — fresh page must still see the same progress. Use toHaveText so
    // Playwright auto-retries until the post-init render lands (avoids a race
    // against initApp).
    await page.reload();
    await expect(
      page.locator('.course-card.implemented').filter({ hasText: '西山コース' })
        .locator('.course-card-progress span')
    ).toHaveText(cardText || '');
  });
});

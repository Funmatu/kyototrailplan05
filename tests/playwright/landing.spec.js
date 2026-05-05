// @ts-check
/* Landing & course-selection regression smoke. */
const { test, expect } = require('@playwright/test');

test.describe('Landing page', () => {
  test('renders all 5 courses with implemented status', async ({ page }) => {
    await page.goto('/index.html');

    // Title + subtitle
    await expect(page.locator('.landing-title')).toHaveText('京都一周トレイル');

    // Loop progress card present
    await expect(page.locator('.loop-progress-card h2')).toHaveText('本線進捗');

    // After Phase 8 all 5 courses are implemented (京北 added via ibuki CC0 GPX).
    await expect(page.locator('.course-card.implemented')).toHaveCount(5);
    await expect(page.locator('.course-card.coming-soon')).toHaveCount(0);

    // Each loop course name appears
    for (const name of ['東山コース', '北山東部コース', '北山西部コース', '西山コース']) {
      await expect(page.locator('.course-card-name', { hasText: name })).toBeVisible();
    }

    // The 京北 card is now an implemented extension card
    await expect(
      page.locator('#extension-courses .course-card.implemented .course-card-name', { hasText: '京北コース' })
    ).toBeVisible();
  });

  test('clicking 西山 enters course view with all tabs', async ({ page }) => {
    await page.goto('/index.html');
    await page.locator('.course-card.implemented').filter({ hasText: '西山コース' }).click();

    await expect(page.locator('#hdr-course-name')).toHaveText('西山コース');
    await expect(page.locator('#course-view')).not.toHaveClass(/hidden/);

    // All 6 tabs render
    await expect(page.locator('#tab-elevation')).toBeVisible();
    await page.locator('[data-tab="tab-itinerary"]').click();
    await expect(page.locator('#tab-itinerary')).toContainText('行動計画タイムテーブル');
    await page.locator('[data-tab="tab-checkpoints"]').click();
    await expect(page.locator('#tab-checkpoints')).toContainText('苔寺・鈴虫寺バス停');
    await page.locator('[data-tab="tab-emergency"]').click();
    await expect(page.locator('#tab-emergency')).toContainText('075-751-4141');
  });

  test('Keihoku (Phase 8) loads and renders elevation + checkpoints', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
    });
    await page.goto('/index.html#course=keihoku');
    await expect(page.locator('#hdr-course-name')).toHaveText('京北コース');
    await expect(page.locator('#course-view'), errors.join('\n')).not.toHaveClass(/hidden/);
    // Elevation chart container must render
    await expect(page.locator('#tab-elevation')).toBeVisible();
    // CP tab contains start/end labels (defined in the keihoku CP fixture)
    await page.locator('[data-tab="tab-checkpoints"]').click();
    await expect(page.locator('#tab-checkpoints')).toContainText('京北コース 起点');
    await expect(page.locator('#tab-checkpoints')).toContainText('京北コース 終点');
  });

  test('back-to-landing returns to course list', async ({ page }) => {
    await page.goto('/index.html#course=nishiyama');
    await expect(page.locator('#hdr-course-name')).toHaveText('西山コース');
    await page.locator('#back-to-landing').click();
    await expect(page.locator('#landing')).not.toHaveClass(/hidden/);
    await expect(page.locator('.loop-progress-card')).toBeVisible();
  });
});

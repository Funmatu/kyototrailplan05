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

    // 4 implemented courses + 1 coming-soon course
    await expect(page.locator('.course-card.implemented')).toHaveCount(4);
    await expect(page.locator('.course-card.coming-soon')).toHaveCount(1);

    // Each loop course name appears
    for (const name of ['東山コース', '北山東部コース', '北山西部コース', '西山コース']) {
      await expect(page.locator('.course-card-name', { hasText: name })).toBeVisible();
    }

    // The 京北 coming-soon card is in the extension section
    await expect(page.locator('#extension-courses .course-card-name', { hasText: '京北コース' })).toBeVisible();
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

  test('back-to-landing returns to course list', async ({ page }) => {
    await page.goto('/index.html#course=nishiyama');
    await expect(page.locator('#hdr-course-name')).toHaveText('西山コース');
    await page.locator('#back-to-landing').click();
    await expect(page.locator('#landing')).not.toHaveClass(/hidden/);
    await expect(page.locator('.loop-progress-card')).toBeVisible();
  });
});

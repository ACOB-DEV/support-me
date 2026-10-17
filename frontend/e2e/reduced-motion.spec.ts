import { test, expect, type Page } from '@playwright/test';
import { setupE2EMocks } from './fixtures/test-mocks';

// Holds the creator request open so the profile stays on its loading skeleton.
async function gotoLoadingProfile(page: Page) {
  await setupE2EMocks(page);
  await page.route('**/api/creators/alice', () => {
    /* never fulfilled */
  });
  await page.goto('/alice');
  const skeleton = page.locator('[aria-busy="true"]').first();
  await expect(skeleton).toBeVisible();
  return skeleton;
}

const animatedPlaceholders = (page: Page) =>
  page.locator('[class*="animate-pulse"], [class*="animate-spin"]').evaluateAll((els) =>
    els.map((el) => getComputedStyle(el).animationName),
  );

test.describe('prefers-reduced-motion', () => {
  test('skeletons do not animate when reduced motion is requested', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await gotoLoadingProfile(page);

    const names = await animatedPlaceholders(page);
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((name) => name === 'none')).toBe(true);

    // Still visibly a placeholder: dimmed rather than invisible.
    const opacity = await page
      .locator('[class*="animate-pulse"]')
      .first()
      .evaluate((el) => Number(getComputedStyle(el).opacity));
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThan(1);
  });

  test('skeletons pulse when motion is allowed', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await gotoLoadingProfile(page);

    const names = await animatedPlaceholders(page);
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((name) => name === 'pulse')).toBe(true);
  });
});

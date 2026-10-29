import { expect, test } from '@playwright/test';

// Unknown URLs get the site's own 404 page (src/pages/404.astro), with a 404
// status, served by Nginx in prod (error_page) and by Astro in preview/dev.
test('an unknown URL shows the 404 page, not indexed, with a way back', async ({ page }) => {
  const response = await page.goto('/c/no-such-command');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  await page.getByRole('link', { name: 'Search all commands' }).click();
  await expect(page).toHaveURL(/\/$/);
});

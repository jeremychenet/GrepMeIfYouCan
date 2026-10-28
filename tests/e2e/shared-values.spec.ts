import { expect, test } from '@playwright/test';
import { LARGE_FILES, copied, resultCard } from './helpers';

// A value typed for a variable fills the variable of the same name in the
// other cards of the page, except destructive ones (SPEC §2.5).
test.describe('values carried over between cards', () => {
  test('fills the other cards of a page, never a destructive one', async ({ page }) => {
    await page.goto('/tools/find');
    const card = (id: string) => page.locator(`article[data-card="${id}"]`);
    await card(LARGE_FILES).getByLabel('Value for path').fill('/var/log');

    await expect(card('find-modified-recently').getByLabel('Value for path')).toHaveValue('/var/log');
    await expect(card('find-by-extension').getByLabel('Value for path')).toHaveValue('/var/log');
    await expect(card('find-delete-empty').getByLabel('Value for path')).toHaveValue('');

    // Clearing the field clears it everywhere: the defaults come back.
    await card(LARGE_FILES).getByLabel('Value for path').fill('');
    await expect(card('find-modified-recently').getByLabel('Value for path')).toHaveValue('');
  });

  test('fills search results shown later, and copies the carried value', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Search commands').fill('large files');
    await resultCard(page, LARGE_FILES).getByLabel('Value for path').fill('/srv');

    await page.getByLabel('Search commands').fill('modified recently');
    const card = resultCard(page, 'find-modified-recently');
    await expect(card.getByLabel('Value for path')).toHaveValue('/srv');
    await card.getByRole('button', { name: /^Copy command/ }).click();
    expect(await copied(page)).toBe('find /srv -type f -mtime -1');
  });
});

test.describe('key bar', () => {
  test('shows the active row while a list is visible', async ({ page }) => {
    await page.goto('/');
    const bar = page.locator('[data-keybar]');
    await expect(bar).toBeHidden();

    await page.keyboard.type('large files');
    await expect(bar).toBeVisible();
    await expect(page.locator('[data-key-position]')).toHaveText(/^--\/\d{2}$/);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('[data-key-position]')).toHaveText(/^02\/\d{2}$/);

    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(bar).toBeHidden();
  });
});

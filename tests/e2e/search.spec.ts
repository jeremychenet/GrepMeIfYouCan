import { expect, test } from '@playwright/test';
import { LARGE_FILES, LARGE_FILES_COMMAND, copied, resultCard, results } from './helpers';

test.describe('search', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('shows the categories until something is searched', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Browse by category' })).toBeVisible();
    await expect(results(page)).toBeHidden();
  });

  test('finds a command and keeps the query in the URL', async ({ page }) => {
    await page.getByLabel('Search commands').fill('large files');
    await expect(resultCard(page, LARGE_FILES)).toBeVisible();
    await expect(page.locator('[data-search-status]')).toContainText('found');
    await expect(page.getByRole('heading', { name: 'Browse by category' })).toBeHidden();
    await expect(page).toHaveURL(/\?q=large(\+|%20)files$/);

    await page.reload();
    await expect(page.getByLabel('Search commands')).toHaveValue('large files');
    await expect(resultCard(page, LARGE_FILES)).toBeVisible();
  });

  test('copies a result with an edited value', async ({ page }) => {
    await page.getByLabel('Search commands').fill('large files');
    const card = resultCard(page, LARGE_FILES);
    await card.getByLabel('Value for path').fill('/var/log');
    await card.getByRole('button', { name: /^Copy command/ }).click();
    expect(await copied(page)).toBe(LARGE_FILES_COMMAND.replace('find /', 'find /var/log'));
  });

  test('filters by category', async ({ page }) => {
    await page.getByRole('button', { name: 'Containers' }).click();
    await expect(page).toHaveURL(/cat=containers/);
    await expect(results(page).locator('article').first()).toBeVisible();
  });

  test('suggests a new command when nothing matches', async ({ page }) => {
    await page.getByLabel('Search commands').fill('qqqzzzxxx');
    const link = page.getByRole('link', { name: 'Suggest this command' });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', /^https:\/\/github\.com\//);
  });

  test('asks before copying a destructive command, once per session', async ({ page }) => {
    await page.getByLabel('Search commands').fill('git stash clear');
    const copy = resultCard(page, 'git-stash-clear').getByRole('button', { name: /^Copy command/ });
    await copy.click();
    const dialog = page.getByRole('dialog', { name: 'Copy a destructive command?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Copy anyway' }).click();
    expect(await copied(page)).toBe('git stash clear');

    await page.evaluate(() => navigator.clipboard.writeText(''));
    await copy.click();
    expect(await copied(page)).toBe('git stash clear');
    await expect(dialog).toBeHidden();
  });
});

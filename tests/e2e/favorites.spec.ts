import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { LARGE_FILES, copied, resultCard, results } from './helpers';

const FAVORITES_KEY = 'gmiyc:v1:favorites';
const HISTORY_KEY = 'gmiyc:v1:history';
const KEYS = { favorites: FAVORITES_KEY, history: HISTORY_KEY };
const readBoth = (k: typeof KEYS) => [localStorage.getItem(k.favorites), localStorage.getItem(k.history)];

const star = (page: Page, id = LARGE_FILES) => resultCard(page, id).locator('[data-favorite]');
const saved = (page: Page) => page.locator('[data-saved] [data-card-list]');
const savedIds = (page: Page) =>
  saved(page)
    .locator('article[data-card]')
    .evaluateAll((cards) => cards.map((c) => (c as HTMLElement).dataset['card']));

async function searchLargeFiles(page: Page): Promise<void> {
  await page.goto('/?q=large%20files');
  await expect(star(page)).toBeVisible();
}

test.describe('favorites and history', () => {
  test('a favorite persists after reload and shows on /favorites', async ({ page }) => {
    await searchLargeFiles(page);
    await star(page).click();
    await expect(page.locator('[data-toast]')).toHaveText('Added to favorites');
    await expect(star(page)).toHaveAttribute('aria-pressed', 'true');

    await page.reload();
    await expect(star(page)).toHaveAttribute('aria-pressed', 'true');

    await page.goto(`/c/${LARGE_FILES}`);
    await expect(page.locator('[data-favorite]')).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('link', { name: 'Favorites' }).click();
    await expect(page.locator('[data-saved-status]')).toHaveText('1 favorite');
    expect(await savedIds(page)).toEqual([LARGE_FILES]);

    // Removing it from the page takes it out of the list.
    await saved(page).locator('[data-favorite]').click();
    await expect(page.locator('[data-saved-empty]')).toBeVisible();
    await expect(saved(page).locator('article')).toHaveCount(0);
  });

  test('f adds and removes the selected command', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.type('large files');
    await expect(star(page)).toBeVisible();
    await page.keyboard.press('ArrowDown');
    const card = resultCard(page, LARGE_FILES);
    await expect(card).toBeFocused();
    await page.keyboard.press('f');
    await expect(star(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(card).toBeFocused();
    await page.keyboard.press('f');
    await expect(star(page)).toHaveAttribute('aria-pressed', 'false');

    await page.keyboard.press('?');
    await expect(page.getByRole('dialog')).toContainText('Add or remove the selected command from favorites');
  });

  test('history keeps copies only, and Clear history empties it', async ({ page }) => {
    await searchLargeFiles(page);
    await resultCard(page, LARGE_FILES).getByRole('button', { name: /^Copy command/ }).click();
    await copied(page);

    const stored = await page.evaluate(() => ({ ...localStorage }));
    expect(Object.keys(stored).sort()).toEqual([HISTORY_KEY]);
    expect(JSON.stringify(stored)).not.toContain('large files');

    await page.goto('/history');
    await expect(page.locator('[data-saved-status]')).toHaveText('1 copied command');
    expect(await savedIds(page)).toEqual([LARGE_FILES]);
    await page.reload();
    expect(await savedIds(page)).toEqual([LARGE_FILES]);

    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Clear history' }).click();
    await expect(page.locator('[data-saved-empty]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clear history' })).toBeHidden();
    expect(await page.evaluate((k) => localStorage.getItem(k), HISTORY_KEY)).toBeNull();
  });

  test('export then import in a fresh browser restores the same data', async ({ page, browser, baseURL }) => {
    await searchLargeFiles(page);
    await star(page).click();
    await resultCard(page, LARGE_FILES).getByRole('button', { name: /^Copy command/ }).click();
    await copied(page);
    await page.goto('/favorites');
    const before = await page.evaluate(readBoth, KEYS);

    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export JSON' }).click()]);
    expect(download.suggestedFilename()).toMatch(/^grepmeifyoucan-\d{4}-\d{2}-\d{2}\.json$/);
    const file = await download.path();

    const fresh = await browser.newContext({ baseURL: baseURL! });
    try {
      const other = await fresh.newPage();
      await other.goto('/favorites');
      await expect(other.locator('[data-saved-empty]')).toBeVisible();
      await other.locator('[data-import-file]').setInputFiles(file);
      await expect(other.locator('[data-backup-message]')).toHaveText(
        'Imported 1 new favorite and 1 new history entry.',
      );
      expect(await savedIds(other)).toEqual([LARGE_FILES]);
      const after = await other.evaluate(readBoth, KEYS);
      expect(after).toEqual(before);
    } finally {
      await fresh.close();
    }
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ format: 'grepmeifyoucan', version: 1 });
  });

  test('a malformed file is refused with a clear message', async ({ page }) => {
    await page.goto('/favorites');
    await page.locator('[data-import-file]').setInputFiles({
      name: 'broken.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"format": "grepmeifyoucan", '),
    });
    await expect(page.locator('[data-backup-message]')).toHaveText('Import failed: This file is not valid JSON.');
    expect(await page.evaluate((k) => localStorage.getItem(k), FAVORITES_KEY)).toBeNull();
  });

  test('ids of deleted cards are skipped', async ({ page }) => {
    await page.addInitScript(
      ({ key, id }) => {
        localStorage.setItem(key, JSON.stringify([{ id: 'card-that-was-deleted', at: 2 }, { id, at: 1 }]));
      },
      { key: FAVORITES_KEY, id: LARGE_FILES },
    );
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/favorites');
    await expect(page.locator('[data-saved-status]')).toHaveText('1 favorite');
    expect(await savedIds(page)).toEqual([LARGE_FILES]);
    expect(errors).toEqual([]);
  });

  test('the site works without errors when localStorage is blocked', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('The operation is insecure.', 'SecurityError');
        },
      });
    });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    await searchLargeFiles(page);
    await star(page).click();
    await expect(page.locator('[data-toast]')).toHaveText('Could not save: browser storage is unavailable');
    await expect(star(page)).toHaveAttribute('aria-pressed', 'false');
    await resultCard(page, LARGE_FILES).getByRole('button', { name: /^Copy command/ }).click();
    await copied(page);

    for (const path of ['/favorites', '/history']) {
      await page.goto(path);
      await expect(page.locator('[data-saved-status]')).toContainText('Browser storage is unavailable');
      await expect(page.locator('[data-saved-empty]')).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
});

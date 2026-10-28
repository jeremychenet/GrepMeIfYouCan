import { expect, type Page } from '@playwright/test';

export const LARGE_FILES = 'find-files-larger-than';
export const LARGE_FILES_COMMAND = 'find / -type f -size +1G 2>/dev/null';

export function readClipboard(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

/** Waits for the "Copied" toast, then returns the clipboard. */
export async function copied(page: Page): Promise<string> {
  await expect(page.locator('[data-toast]')).toHaveText('Copied');
  return readClipboard(page);
}

export const results = (page: Page) => page.locator('[data-search-results] [data-card-list]');

export const resultCard = (page: Page, id: string) => results(page).locator(`article[data-card="${id}"]`);

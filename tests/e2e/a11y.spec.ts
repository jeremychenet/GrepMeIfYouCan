import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { LARGE_FILES, resultCard } from './helpers';

// SPEC §3.4: WCAG 2.2 AA. axe finds no serious or critical violation, in
// both themes, on the main pages and with the dialogs open.
async function violations(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.addInitScript((t) => localStorage.setItem('gmiyc:v1:theme', t), theme);
}

const PAGES: { name: string; path: string; ready?: (page: Page) => Promise<void> }[] = [
  { name: 'home', path: '/' },
  {
    name: 'search results',
    path: '/?q=find%20files',
    ready: (page) => expect(page.locator('[data-search-results]')).toBeVisible(),
  },
  {
    name: 'empty search',
    path: '/?q=zqxj',
    ready: (page) => expect(page.locator('[data-search-empty]')).toBeVisible(),
  },
  { name: 'command page', path: `/c/${LARGE_FILES}` },
  { name: 'destructive command page', path: '/c/find-delete-empty' },
  { name: 'tool page', path: '/tools/find' },
  { name: 'favorites', path: '/favorites', ready: (page) => expect(page.locator('[data-saved-empty]')).toBeVisible() },
  { name: 'about', path: '/about' },
  { name: 'privacy', path: '/privacy' },
];

for (const theme of ['light', 'dark'] as const) {
  test.describe(`accessibility, ${theme} theme`, () => {
    test.beforeEach(async ({ page }) => setTheme(page, theme));

    for (const { name, path, ready } of PAGES) {
      test(name, async ({ page }) => {
        await page.goto(path);
        await ready?.(page);
        await page.waitForLoadState('networkidle');
        expect(await violations(page)).toEqual([]);
      });
    }

    test('active row of a result list', async ({ page }) => {
      await page.goto('/');
      await page.keyboard.type('find files');
      await page.keyboard.press('ArrowDown');
      await expect(page.locator('[data-search-results] [aria-current="true"]')).toHaveCount(1);
      expect(await violations(page)).toEqual([]);
    });

    test('destructive copy confirmation', async ({ page }) => {
      await page.goto('/?q=git%20stash%20clear');
      await resultCard(page, 'git-stash-clear').getByRole('button', { name: /^Copy command/ }).click();
      await expect(page.getByRole('dialog', { name: 'Copy a destructive command?' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test('keyboard shortcuts help', async ({ page }) => {
      await page.goto('/about');
      await page.keyboard.press('?');
      await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  });
}

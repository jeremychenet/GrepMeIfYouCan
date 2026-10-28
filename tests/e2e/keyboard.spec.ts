import { devices, expect, test, type Page } from '@playwright/test';
import { LARGE_FILES, LARGE_FILES_COMMAND, copied, readClipboard, results, row } from './helpers';

const search = (page: Page) => page.getByLabel('Search commands');

// The home page opens with the focus in the search box.
async function searchFor(page: Page, query: string): Promise<void> {
  await expect(search(page)).toBeFocused();
  await page.keyboard.type(query);
  await expect(results(page).locator('article').first()).toBeVisible();
}

test.describe('keyboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('focuses the search on arrival, keeping a query from the URL', async ({ page }) => {
    await expect(search(page)).toBeFocused();
    await page.goto('/?q=large%20files');
    await expect(search(page)).toBeFocused();
    await page.keyboard.type(' big');
    await expect(search(page)).toHaveValue('large files big');
  });

  test('does not steal the focus on an anchor or a page without search', async ({ page }) => {
    await page.goto('/#main');
    await expect(search(page)).not.toBeFocused();
    await page.goto('/tools/find');
    await expect(page.locator('body')).toBeFocused();
  });

  test('/ then ↓ then Enter copies the first result', async ({ page }) => {
    await page.keyboard.press('Escape');
    await expect(search(page)).not.toBeFocused();
    await page.keyboard.press('/');
    await searchFor(page, 'large files');
    await page.keyboard.press('ArrowDown');
    await expect(row(page, LARGE_FILES).locator('article')).toBeFocused();
    await expect(row(page, LARGE_FILES)).toHaveAttribute('aria-current', 'true');
    await page.keyboard.press('Enter');
    expect(await copied(page)).toBe(LARGE_FILES_COMMAND);
  });

  test('Cmd/Ctrl+K focuses the search from anywhere', async ({ page }) => {
    await page.getByRole('link', { name: 'About' }).focus();
    await page.keyboard.press('Control+k');
    await expect(search(page)).toBeFocused();
  });

  test('the arrows move the focus from card to card, each announced by its title', async ({ page }) => {
    await searchFor(page, 'large files');
    const list = results(page);
    await expect(list).toHaveRole('list');
    await expect(list).toHaveAccessibleName('Search results');
    const rows = list.locator('> li');
    const card = (i: number) => rows.nth(i).locator('> article');

    await page.keyboard.press('ArrowDown');
    await expect(card(0)).toBeFocused();
    await expect(card(0)).toHaveAccessibleName((await card(0).locator('.title').textContent())!.trim());
    await expect(rows.nth(0)).toHaveAttribute('aria-current', 'true');

    await page.keyboard.press('ArrowDown');
    await expect(card(1)).toBeFocused();
    await expect(rows.nth(1)).toHaveAttribute('aria-current', 'true');
    await expect(rows.nth(0)).not.toHaveAttribute('aria-current');

    await page.keyboard.press('ArrowUp');
    await expect(card(0)).toBeFocused();
    await page.keyboard.press('End');
    await expect(rows.last().locator('> article')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(card(0)).toBeFocused();
    // One Tab stop per list: only the active card is in the tab order.
    await expect(list.locator('article[tabindex="0"]')).toHaveCount(1);
  });

  test('Tab moves through the variables, Enter copies, Esc goes back', async ({ page }) => {
    await searchFor(page, 'large files');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Tab');
    const card = row(page, LARGE_FILES).locator('article');
    await expect(card.getByLabel('Value for path')).toBeFocused();
    await page.keyboard.type('/srv');
    await page.keyboard.press('Tab');
    await expect(card.getByLabel('Value for size')).toBeFocused();
    await page.keyboard.type('500M');
    await page.keyboard.press('Enter');
    expect(await copied(page)).toBe('find /srv -type f -size +500M 2>/dev/null');

    await page.keyboard.press('Escape');
    await expect(card).toBeFocused();
    await expect(row(page, LARGE_FILES)).toHaveAttribute('aria-current', 'true');
    await page.keyboard.press('Escape');
    await expect(search(page)).toBeFocused();
  });

  test('o opens the selected command page', async ({ page }) => {
    await searchFor(page, 'large files');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('o');
    await expect(page).toHaveURL(new RegExp(`/c/${LARGE_FILES}$`));
  });

  test('Esc clears the search, then leaves it', async ({ page }) => {
    await searchFor(page, 'large files');
    await page.keyboard.press('Escape');
    await expect(search(page)).toHaveValue('');
    await expect(search(page)).toBeFocused();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'Browse by category' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(search(page)).not.toBeFocused();
  });

  test('? shows the help, but is typed in the search box', async ({ page }) => {
    const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await page.keyboard.press('Escape');
    await page.keyboard.press('?');
    await expect(help).toBeVisible();
    await expect(help.getByText('Copy the selected command')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(help).toBeHidden();

    await page.keyboard.press('/');
    await expect(search(page)).toBeFocused();
    await page.keyboard.type('?');
    await expect(search(page)).toHaveValue('?');
    await expect(help).toBeHidden();

    await page.getByRole('button', { name: /Keyboard shortcuts/ }).click();
    await expect(help).toBeVisible();
  });

  test('Enter on a destructive result asks first, Esc cancels', async ({ page }) => {
    await page.evaluate(() => navigator.clipboard.writeText('unchanged'));
    await searchFor(page, 'git stash clear');
    await page.keyboard.press('ArrowDown');
    const card = row(page, 'git-stash-clear').locator('article');
    await expect(card).toBeFocused();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Copy a destructive command?' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(card).toBeFocused();
    expect(await readClipboard(page)).toBe('unchanged');
  });

  test('works on the card lists of tool pages', async ({ page }) => {
    await page.goto('/tools/find');
    const list = page.getByRole('list', { name: 'find commands' });
    const rows = list.locator('> li');
    await rows.first().locator('> article').focus();
    await expect(rows.first()).toHaveAttribute('aria-current', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(rows.nth(1).locator('> article')).toBeFocused();
    await expect(rows.nth(1)).toHaveAttribute('aria-current', 'true');
    await page.keyboard.press('Home');
    const id = (await rows.first().locator('article').getAttribute('data-card'))!;
    await page.keyboard.press('o');
    await expect(page).toHaveURL(new RegExp(`/c/${id}$`));
  });
});

// Touch screens: no shortcuts, no help, plain lists (SPEC §3.3).
const { defaultBrowserType: _, ...pixel } = devices['Pixel 7'];

test.describe('keyboard on a touch screen', () => {
  test.use(pixel);

  test('does not focus the search, which would open the on-screen keyboard', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByLabel('Search commands')).toBeVisible();
    await expect(page.getByLabel('Search commands')).not.toBeFocused();
  });

  test('hides and disables the shortcuts', async ({ page }) => {
    await page.goto('/tools/find');
    await expect(page.locator('[data-card-list] article[tabindex]')).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'find commands' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Keyboard shortcuts/ })).toBeHidden();
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeHidden();
  });
});

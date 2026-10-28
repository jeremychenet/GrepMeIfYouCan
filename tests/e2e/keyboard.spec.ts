import { devices, expect, test, type Page } from '@playwright/test';
import { LARGE_FILES, LARGE_FILES_COMMAND, copied, readClipboard, results } from './helpers';

const search = (page: Page) => page.getByLabel('Search commands');

async function searchFor(page: Page, query: string): Promise<void> {
  await page.keyboard.press('/');
  await expect(search(page)).toBeFocused();
  await page.keyboard.type(query);
  await expect(results(page).getByRole('option').first()).toBeVisible();
}

test.describe('keyboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('/ then ↓ then Enter copies the first result', async ({ page }) => {
    await searchFor(page, 'large files');
    await page.keyboard.press('ArrowDown');
    await expect(results(page)).toBeFocused();
    await expect(results(page).getByRole('option', { selected: true })).toHaveId(`option-${LARGE_FILES}`);
    await page.keyboard.press('Enter');
    expect(await copied(page)).toBe(LARGE_FILES_COMMAND);
  });

  test('Cmd/Ctrl+K focuses the search from anywhere', async ({ page }) => {
    await page.getByRole('link', { name: 'About' }).focus();
    await page.keyboard.press('Control+k');
    await expect(search(page)).toBeFocused();
  });

  test('the listbox announces its active option', async ({ page }) => {
    await searchFor(page, 'large files');
    const list = results(page);
    await expect(list).toHaveRole('listbox');
    await expect(list).toHaveAccessibleName('Search results');
    await page.keyboard.press('ArrowDown');
    const options = list.getByRole('option');
    await expect(list).toHaveAttribute('aria-activedescendant', (await options.nth(0).getAttribute('id'))!);

    await page.keyboard.press('ArrowDown');
    const second = (await options.nth(1).getAttribute('id'))!;
    await expect(list).toHaveAttribute('aria-activedescendant', second);
    await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(options.nth(0)).toHaveAttribute('aria-selected', 'false');

    await page.keyboard.press('ArrowUp');
    await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('End');
    await expect(options.last()).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Home');
    await expect(options.first()).toHaveAttribute('aria-selected', 'true');
  });

  test('Tab moves through the variables, Enter copies, Esc goes back', async ({ page }) => {
    await searchFor(page, 'large files');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Tab');
    const card = results(page).locator(`#option-${LARGE_FILES}`);
    await expect(card.getByLabel('Value for path')).toBeFocused();
    await page.keyboard.type('/srv');
    await page.keyboard.press('Tab');
    await expect(card.getByLabel('Value for size')).toBeFocused();
    await page.keyboard.type('500M');
    await page.keyboard.press('Enter');
    expect(await copied(page)).toBe('find /srv -type f -size +500M 2>/dev/null');

    await page.keyboard.press('Escape');
    await expect(results(page)).toBeFocused();
    await expect(card).toHaveAttribute('aria-selected', 'true');
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
    await page.keyboard.press('?');
    await expect(help).toBeVisible();
    await expect(help.getByText('Copy the selected command')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(help).toBeHidden();

    await page.keyboard.press('/');
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
    await expect(results(page).getByRole('option', { selected: true })).toHaveId('option-git-stash-clear');
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Copy a destructive command?' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(results(page)).toBeFocused();
    expect(await readClipboard(page)).toBe('unchanged');
  });

  test('works on the card lists of tool pages', async ({ page }) => {
    await page.goto('/tools/find');
    const list = page.getByRole('listbox', { name: 'find commands' });
    await list.focus();
    await expect(list.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(list.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Home');
    const id = (await list.getByRole('option').first().locator('article').getAttribute('data-card'))!;
    await page.keyboard.press('o');
    await expect(page).toHaveURL(new RegExp(`/c/${id}$`));
  });
});

// Touch screens: no shortcuts, no help, plain lists (SPEC §3.3).
const { defaultBrowserType: _, ...pixel } = devices['Pixel 7'];

test.describe('keyboard on a touch screen', () => {
  test.use(pixel);

  test('hides and disables the shortcuts', async ({ page }) => {
    await page.goto('/tools/find');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'find commands' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Keyboard shortcuts/ })).toBeHidden();
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeHidden();
  });
});

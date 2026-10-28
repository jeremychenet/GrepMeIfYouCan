import { expect, test } from '@playwright/test';
import { LARGE_FILES } from './helpers';

const ISSUE_URL = 'https://github.com/jeremychenet/GrepMeIfYouCan/issues/new';

function issueParams(href: string | null): URLSearchParams {
  expect(href).not.toBeNull();
  const url = new URL(href!);
  expect(url.origin + url.pathname).toBe(ISSUE_URL);
  return url.searchParams;
}

// Contributions go through prefilled GitHub issue forms (SPEC §2.9).
test.describe('contributions', () => {
  test('the footer suggests a command with a blank form', async ({ page }) => {
    await page.goto('/');
    const link = page.getByRole('contentinfo').getByRole('link', { name: 'Suggest a command' });
    const p = issueParams(await link.getAttribute('href'));
    expect(p.get('template')).toBe('suggest-command.yml');
    expect(p.get('title')).toBe('Suggest a command');
  });

  test('a search with no result suggests the query', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Search commands').fill('zqxj & wvq #?');
    const link = page.getByRole('link', { name: 'Suggest this command' });
    await expect(link).toBeVisible();
    const p = issueParams(await link.getAttribute('href'));
    expect(p.get('template')).toBe('suggest-command.yml');
    expect(p.get('title')).toBe('Suggest a command: zqxj & wvq #?');
    expect(p.get('need')).toBe('zqxj & wvq #?');
  });

  test('a command page reports an issue with its id', async ({ page }) => {
    await page.goto(`/c/${LARGE_FILES}`);
    const p = issueParams(await page.getByRole('link', { name: 'Report an issue' }).getAttribute('href'));
    expect(p.get('template')).toBe('report-issue.yml');
    expect(p.get('title')).toBe(`Report: ${LARGE_FILES}`);
    expect(p.get('card')).toBe(LARGE_FILES);
    expect(p.get('page')).toMatch(new RegExp(`/c/${LARGE_FILES}$`));
  });
});

test.describe('legal pages', () => {
  test('About credits tldr-pages under CC BY 4.0', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('contentinfo').getByRole('link', { name: 'About' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'About' })).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: 'tldr-pages' })).toHaveAttribute(
      'href',
      'https://github.com/tldr-pages/tldr',
    );
    await expect(page.getByRole('main').getByRole('link', { name: /CC BY 4\.0/ })).toHaveAttribute(
      'href',
      'https://creativecommons.org/licenses/by/4.0/',
    );
  });

  test('Privacy describes local storage and Umami', async ({ page }) => {
    await page.goto('/privacy');
    const main = page.getByRole('main');
    await expect(page.getByRole('heading', { level: 1, name: 'Privacy' })).toBeVisible();
    await expect(main).toContainText('gmiyc:v1:favorites');
    await expect(main).toContainText('Your searches are never recorded');
    await expect(main.getByRole('link', { name: 'Umami' })).toBeVisible();
  });
});

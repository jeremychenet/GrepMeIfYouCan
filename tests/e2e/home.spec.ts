import { devices, expect, test, type Page } from '@playwright/test';
import { SUGGEST_TEMPLATE } from '../../src/lib/github';

// Home page and header (SPEC §3.1): tagline, header links on the right,
// dark theme by default, and the footer links in view without scrolling.

const header = (page: Page) => page.getByRole('banner');

test.describe('header and home', () => {
  test('shows the tagline as the page heading', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Faster than asking your LLM: type a few words, copy the command you had in mind in under 5 seconds.',
    );
  });

  test('has Suggest a command, Favorites and History on the right, before the theme toggle', async ({ page }) => {
    await page.goto('/');
    const nav = header(page).getByRole('navigation', { name: 'Main' });
    const links = nav.getByRole('link');
    await expect(links).toHaveCount(3);
    await expect(links.nth(0)).toHaveAccessibleName('Suggest a command (opens in a new tab)');
    await expect(links.nth(1)).toHaveAccessibleName('Favorites');
    await expect(links.nth(2)).toHaveAccessibleName('History');
    await expect(nav.getByRole('link', { name: 'Search', exact: true })).toHaveCount(0);

    const suggest = nav.getByRole('link', { name: /Suggest a command/ });
    await expect(suggest).toHaveAttribute('target', '_blank');
    expect(new URL((await suggest.getAttribute('href'))!).searchParams.get('template')).toBe(SUGGEST_TEMPLATE);

    // Order on screen: wordmark, then the links, then the toggle at the far right.
    const box = async (l: ReturnType<Page['locator']>) => (await l.boundingBox())!;
    const brand = await box(header(page).getByRole('link', { name: 'GrepMeIfYouCan, home' }));
    const right = await box(nav);
    const toggle = await box(header(page).getByRole('button', { name: /Switch to/ }));
    expect(right.x).toBeGreaterThan(brand.x + brand.width);
    expect(toggle.x).toBeGreaterThanOrEqual(right.x + right.width);
    expect(right.x).toBeGreaterThan(page.viewportSize()!.width / 2);
  });

  test('is dark by default, even when the system prefers light; a light choice is kept', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await header(page).getByRole('button', { name: 'Switch to light theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('fits a laptop screen with the whole footer in view', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');
    await expect(page.getByRole('contentinfo')).toBeInViewport({ ratio: 1 });
  });
});

test.describe('home on a phone', () => {
  // iPhone 13 in Safari: 390×664 visible once the browser bars are drawn.
  const { defaultBrowserType: _, ...iphone } = devices['iPhone 13'];
  test.use(iphone);

  test('shows the footer links without scrolling, and the header on one line', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('contentinfo').getByRole('list')).toBeInViewport({ ratio: 1 });
    const nav = header(page).getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link').first()).toHaveAccessibleName('Suggest (opens in a new tab)');
    const bar = await header(page).evaluate((h) => {
      const b = h.querySelector('.bar')!;
      return { overflow: b.scrollWidth - b.clientWidth, height: b.getBoundingClientRect().height };
    });
    expect(bar.overflow).toBe(0);
    expect(bar.height).toBeLessThan(80);
  });
});

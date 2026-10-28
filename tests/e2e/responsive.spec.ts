import { devices, expect, test, type Page } from '@playwright/test';
import { LARGE_FILES } from './helpers';

// SPEC §3.3: no horizontal scroll of the page, touch targets of at least 44px.
const PAGES = [
  '/',
  '/?q=find%20files',
  '/?q=zqxj',
  `/c/${LARGE_FILES}`,
  '/c/find-delete-empty',
  '/tools/find',
  '/categories/linux',
  '/favorites',
  '/history',
  '/about',
  '/privacy',
];

async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  if (path.includes('?q=')) {
    await expect(page.locator('[data-search-results]:not([hidden]), [data-search-empty]:not([hidden])')).toHaveCount(1);
  }
  // Islands (Copy, Favorite, fields) are in place.
  await page.waitForLoadState('networkidle');
}

for (const width of [375, 768, 1280]) {
  test.describe(`${width}px wide`, () => {
    test.use({ viewport: { width, height: 800 } });

    for (const path of PAGES) {
      test(`${path} does not scroll sideways`, async ({ page }) => {
        await open(page, path);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }
  });
}

/**
 * Visible controls smaller than the minimum: 44px. Links inside a sentence
 * are exempt (WCAG 2.5.8 inline exception); the values inside a command line
 * are inline too, but need 24px to stay easy to tap.
 */
function smallTargets(page: Page) {
  return page.evaluate(() => {
    const SENTENCE_LINK = 'p a:not(.report a), .prose a';
    const found: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea')) {
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (box.width === 0 || box.height === 0 || style.visibility === 'hidden' || el.closest('[hidden], [aria-hidden="true"]')) continue;
      if (el.classList.contains('skip-link')) continue; // only shown on keyboard focus
      if (el.matches(SENTENCE_LINK)) continue;
      const min = el.matches('.var-input') ? 24 : 44;
      if (box.width < min || box.height < min) {
        const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30);
        found.push(`${el.tagName.toLowerCase()}.${el.className} "${name}" ${Math.round(box.width)}x${Math.round(box.height)} < ${min}`);
      }
    }
    return found;
  });
}

// A touch phone in Chromium (the device's own browser type would need a new worker).
const { defaultBrowserType: _, ...phone } = devices['Pixel 7'];

test.describe('touch screen (375px)', () => {
  test.use({ ...phone, viewport: { width: 375, height: 812 } });

  test('shows no keyboard hint, even on an active row', async ({ page }) => {
    await open(page, '/tools/find');
    // As if keyboard navigation had started (e.g. desktop device emulation).
    const row = page.locator('[data-card-list] > li').first();
    await row.evaluate((li) => li.setAttribute('aria-current', 'true'));
    await expect(row.locator('.keyhint')).toBeHidden();
    const arrow = await row.locator('[data-copy]').evaluate((b) => getComputedStyle(b, '::after').content);
    expect(arrow).toBe('none');
    await expect(page.locator('[data-keybar]')).toBeHidden();
  });

  for (const path of PAGES) {
    test(`${path} has touch targets of at least 44px`, async ({ page }) => {
      await open(page, path);
      expect(await smallTargets(page)).toEqual([]);
    });
  }
});

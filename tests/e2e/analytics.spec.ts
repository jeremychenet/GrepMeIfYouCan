import { expect, test, type Page } from '@playwright/test';
import { LARGE_FILES, copied, resultCard } from './helpers';

// Analytics (SPEC §6.4). Runs when the pages carry the tracker, i.e. when the
// site was built with PUBLIC_UMAMI_WEBSITE_ID (the CI e2e job sets a fake one).
// The real Umami script is used when the server has one (make up-analytics);
// otherwise a stub with the same API. Collected events never leave the browser.

interface Sent {
  type: string;
  payload: { name?: string; data?: Record<string, string>; url?: string };
}

const STUB = `window.umami = { track: (name, data) => fetch('/stats/api/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ type: 'event', payload: { name, data } }) }) };`;

async function withStats(page: Page): Promise<Sent[]> {
  const sent: Sent[] = [];
  await page.route('**/stats/script.js', async (route) => {
    const real = await route.fetch().catch(() => null);
    if (real?.ok()) return route.fulfill({ response: real });
    return route.fulfill({ contentType: 'application/javascript', body: STUB });
  });
  await page.route('**/stats/api/send', (route) => {
    sent.push(route.request().postDataJSON() as Sent);
    return route.fulfill({ json: {} });
  });
  return sent;
}

const events = (sent: Sent[], name: string) =>
  sent.filter((s) => s.type === 'event' && s.payload.name === name).map((s) => s.payload.data);

/** CSP violations and page errors, collected from the first script on. */
async function watchErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (/Content.Security.Policy/i.test(m.text())) errors.push(m.text());
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => console.error(`Content Security Policy: ${e.violatedDirective}`));
  });
  return errors;
}

async function skipWithoutTracker(page: Page): Promise<void> {
  await page.goto('/');
  const tracker = await page.locator('script[src="/stats/script.js"]').count();
  test.skip(tracker === 0, 'site built without PUBLIC_UMAMI_WEBSITE_ID');
}

const searchBox = (page: Page) => page.getByRole('searchbox');

test.describe('analytics', () => {
  test('sends copy, favorite and search_no_result, without cookies or CSP violations', async ({ page, context }) => {
    const errors = await watchErrors(page);
    const sent = await withStats(page);
    await skipWithoutTracker(page);
    await page.waitForFunction(() => 'umami' in window);

    // A search without result is sent once typing stops, cleaned and cut to 100 chars.
    const long = `Zzqx ${'y'.repeat(120)}`;
    await searchBox(page).fill(long);
    await expect(page.locator('[data-search-empty]')).toBeVisible();
    await expect.poll(() => events(sent, 'search_no_result'), { timeout: 5000 }).toEqual([
      { query: `zzqx ${'y'.repeat(95)}` },
    ]);

    await searchBox(page).fill('large files');
    const card = resultCard(page, LARGE_FILES);
    await card.getByRole('button', { name: /^Copy command/ }).click();
    await copied(page);
    await expect.poll(() => events(sent, 'copy')).toEqual([{ id: LARGE_FILES }]);

    // Adding counts, removing does not.
    const star = card.locator('[data-favorite]');
    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', 'true');
    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => events(sent, 'favorite')).toEqual([{ id: LARGE_FILES }]);

    // Page views never carry the search query (data-exclude-search).
    for (const s of sent) expect(s.payload.url ?? '').not.toContain('q=');
    expect(await context.cookies()).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('the site works normally when Umami is down', async ({ page }) => {
    const errors = await watchErrors(page);
    await page.route('**/stats/**', (route) => route.abort('connectionrefused'));
    await skipWithoutTracker(page);

    await searchBox(page).fill('large files');
    const card = resultCard(page, LARGE_FILES);
    await card.getByRole('button', { name: /^Copy command/ }).click();
    await copied(page);
    await card.locator('[data-favorite]').click();
    await expect(page.locator('[data-toast]')).toHaveText('Added to favorites');
    await searchBox(page).fill('zzqx qqqy');
    await expect(page.locator('[data-search-empty]')).toBeVisible();
    expect(errors).toEqual([]);
  });
});

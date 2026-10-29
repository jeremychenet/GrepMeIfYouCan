import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Lighthouse budgets (SPEC §8). CI (lighthouserc.json) simulates a slow 4G on
// dist/: LCP ≤ 1.6 s, except a search URL (`?q=`), whose results need the
// scripts and the index: ≤ 2.0 s. `make lighthouse-prod` (J20) checks the
// live site with the same category budgets and LCP ≤ 1.5 s.
type Assertions = Record<string, [string, Record<string, unknown>]>;
type Rc = {
  ci: {
    collect: { url: string[]; staticDistDir?: string; numberOfRuns: number; settings: unknown };
    assert: { assertions?: Assertions; assertMatrix?: { matchingUrlPattern: string; assertions: Assertions }[] };
  };
};
const read = (f: string) => JSON.parse(readFileSync(f, 'utf8')) as Rc;
const ci = read('lighthouserc.json').ci;
const prod = read('lighthouserc.prod.json').ci;

/** The assertions lhci applies to a URL (every matching entry of the matrix). */
function assertionsFor(url: string): Assertions {
  return Object.assign(
    {},
    ...(ci.assert.assertMatrix ?? [])
      .filter((m) => new RegExp(m.matchingUrlPattern).test(url))
      .map((m) => m.assertions),
  ) as Assertions;
}

describe('lighthouserc.json', () => {
  it('checks the four categories (≥ 0.95) and an LCP budget on every page', () => {
    for (const url of ci.collect.url) {
      const a = assertionsFor(url);
      for (const c of ['performance', 'accessibility', 'best-practices', 'seo']) {
        expect(a[`categories:${c}`]?.[1].minScore, `${c} on ${url}`).toBe(0.95);
      }
      expect(a['largest-contentful-paint']?.[1].maxNumericValue, url).toBe(url.includes('?q=') ? 2000 : 1600);
    }
  });

  it('tests a search URL', () => {
    expect(ci.collect.url.some((u) => u.includes('?q='))).toBe(true);
  });
});

describe('lighthouserc.prod.json', () => {
  it('tests the same pages as CI, on https://grepmeifyoucan.com', () => {
    expect(prod.collect.staticDistDir).toBeUndefined();
    const path = (u: string) => new URL(u).pathname.replace(/^\/index\.html$/, '/').replace(/\.html$/, '') + new URL(u).search;
    expect(prod.collect.url.map(path)).toEqual(ci.collect.url.map(path));
    for (const u of prod.collect.url) expect(new URL(u).origin).toBe('https://grepmeifyoucan.com');
  });

  it('keeps the CI runs, settings and category budgets, with LCP at 1.5 s everywhere', () => {
    expect(prod.collect.numberOfRuns).toBe(ci.collect.numberOfRuns);
    expect(prod.collect.settings).toEqual(ci.collect.settings);
    const { 'largest-contentful-paint': lcp, ...rest } = prod.assert.assertions ?? {};
    const { 'largest-contentful-paint': _lcp, ...ciRest } = assertionsFor(ci.collect.url[0]!);
    expect(rest).toEqual(ciRest);
    expect(lcp?.[1].maxNumericValue).toBe(1500);
  });
});

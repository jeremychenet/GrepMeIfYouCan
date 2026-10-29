import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// `make lighthouse-prod` (J20) checks the live site with the CI budgets
// (lighthouserc.json), except LCP: 1.5 s on the real server (SPEC §8), 1.6 s
// in CI's simulated run of dist/.
type Rc = {
  ci: {
    collect: { url: string[]; staticDistDir?: string; numberOfRuns: number; settings: unknown };
    assert: { assertions: Record<string, [string, Record<string, unknown>]> };
  };
};
const read = (f: string) => JSON.parse(readFileSync(f, 'utf8')) as Rc;
const ci = read('lighthouserc.json').ci;
const prod = read('lighthouserc.prod.json').ci;

describe('lighthouserc.prod.json', () => {
  it('tests the same pages as CI, on https://grepmeifyoucan.com', () => {
    expect(prod.collect.staticDistDir).toBeUndefined();
    const path = (u: string) => new URL(u).pathname.replace(/^\/index\.html$/, '/').replace(/\.html$/, '') + new URL(u).search;
    expect(prod.collect.url.map(path)).toEqual(ci.collect.url.map(path));
    for (const u of prod.collect.url) expect(new URL(u).origin).toBe('https://grepmeifyoucan.com');
  });

  it('keeps the CI runs, settings and budgets, with LCP at 1.5 s', () => {
    expect(prod.collect.numberOfRuns).toBe(ci.collect.numberOfRuns);
    expect(prod.collect.settings).toEqual(ci.collect.settings);
    const { 'largest-contentful-paint': lcp, ...rest } = prod.assert.assertions;
    const { 'largest-contentful-paint': _ciLcp, ...ciRest } = ci.assert.assertions;
    expect(rest).toEqual(ciRest);
    expect(lcp?.[1].maxNumericValue).toBe(1500);
  });
});

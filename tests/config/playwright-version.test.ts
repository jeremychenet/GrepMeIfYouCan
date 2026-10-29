import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// `make e2e` runs in the official Playwright image, CI installs the browser
// matching @playwright/test: both must use the same Playwright version.
describe('Playwright version', () => {
  it('is the same in package.json and the e2e image of compose.dev.yaml', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { devDependencies: Record<string, string> };
    const pinned = pkg.devDependencies['@playwright/test'];
    const compose = readFileSync('compose.dev.yaml', 'utf8');
    const fromImage = compose.match(/image: mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-/)?.[1];
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
    expect(fromImage).toBe(pinned);
  });
});

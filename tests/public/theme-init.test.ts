import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { THEME_KEY } from '../../src/lib/theme';

// public/theme-init.js is plain JS served as-is (it must run before first
// paint, so it is not bundled). Run it in a sandbox with fake browser APIs.
const source = readFileSync(new URL('../../public/theme-init.js', import.meta.url), 'utf8');

interface Env {
  saved?: string | null;
  prefersDark?: boolean;
  storageThrows?: boolean;
  matchMediaThrows?: boolean;
  search?: string;
}

function runFull(env: Env = {}): Record<string, string> {
  const html = { dataset: {} as Record<string, string> };
  const storage = {
    getItem: (k: string) => (k === THEME_KEY ? (env.saved ?? null) : null),
  };
  const sandbox = {
    document: { documentElement: html },
    location: { search: env.search ?? '' },
    get localStorage() {
      if (env.storageThrows) throw new Error('SecurityError');
      return storage;
    },
    matchMedia: (query: string) => {
      if (env.matchMediaThrows) throw new Error('no matchMedia');
      return { matches: query === '(prefers-color-scheme: dark)' && env.prefersDark === true };
    },
  };
  runInNewContext(source, sandbox);
  return html.dataset;
}
const run = (env: Env = {}) => runFull(env)['theme'];

describe('public/theme-init.js', () => {
  it('defaults to dark, whatever the system preference', () => {
    expect(run()).toBe('dark');
    expect(run({ prefersDark: false })).toBe('dark');
  });

  it('keeps the light theme chosen with the toggle', () => {
    expect(run({ saved: 'light', prefersDark: true })).toBe('light');
    expect(run({ saved: 'dark' })).toBe('dark');
  });

  it('ignores an invalid saved value', () => {
    expect(run({ saved: 'neon' })).toBe('dark');
  });

  it('falls back to dark when every browser API fails', () => {
    expect(run({ storageThrows: true, matchMediaThrows: true })).toBe('dark');
  });

  it('marks a page opened with a search in the URL', () => {
    for (const search of ['?q=find', '?cat=linux', '?tag=disk', '?x=1&q=a']) {
      expect(runFull({ search })['initialSearch'], search).toBe('');
    }
    for (const search of ['', '?x=1', '?query=a', '?faq=1']) {
      expect(runFull({ search })['initialSearch'], search).toBeUndefined();
    }
  });
});

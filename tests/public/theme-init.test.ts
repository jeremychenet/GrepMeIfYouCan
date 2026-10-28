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
}

function run(env: Env = {}): string | undefined {
  const html = { dataset: {} as Record<string, string> };
  const storage = {
    getItem: (k: string) => (k === THEME_KEY ? (env.saved ?? null) : null),
  };
  const sandbox = {
    document: { documentElement: html },
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
  return html.dataset['theme'];
}

describe('public/theme-init.js', () => {
  it('defaults to light', () => {
    expect(run()).toBe('light');
  });

  it('respects prefers-color-scheme: dark on first visit', () => {
    expect(run({ prefersDark: true })).toBe('dark');
  });

  it('prefers the saved choice over the system preference', () => {
    expect(run({ saved: 'light', prefersDark: true })).toBe('light');
    expect(run({ saved: 'dark', prefersDark: false })).toBe('dark');
  });

  it('ignores an invalid saved value', () => {
    expect(run({ saved: 'neon', prefersDark: true })).toBe('dark');
    expect(run({ saved: 'neon' })).toBe('light');
  });

  it('still follows the system when storage is blocked', () => {
    expect(run({ storageThrows: true, prefersDark: true })).toBe('dark');
  });

  it('falls back to light when every browser API fails', () => {
    expect(run({ storageThrows: true, matchMediaThrows: true })).toBe('light');
  });
});

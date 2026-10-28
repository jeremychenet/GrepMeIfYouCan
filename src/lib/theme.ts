// Theme preference (SPEC §3.1): light (paper) by default, `prefers-color-scheme`
// respected on first visit, explicit choice kept in localStorage.
// The first-paint logic lives in public/theme-init.js (it cannot be bundled
// without becoming deferred); keep both in sync, tests cover each.

export const THEMES = ['dark', 'light'] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_KEY = 'gmiyc:v1:theme';
export const DEFAULT_THEME: Theme = 'light';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

// Even reading `window.localStorage` can throw (blocked cookies, sandboxed
// iframe), so storage is passed as a getter and every access is guarded.
type GetStorage = () => StorageLike;
const browserStorage: GetStorage = () => globalThis.localStorage;

export function isTheme(value: unknown): value is Theme {
  return (THEMES as readonly unknown[]).includes(value);
}

export function otherTheme(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark';
}

export function toggleLabel(theme: Theme): string {
  return `Switch to ${otherTheme(theme)} theme`;
}

export function currentTheme(root: { dataset: Record<string, string | undefined> }): Theme {
  const value = root.dataset['theme'];
  return isTheme(value) ? value : DEFAULT_THEME;
}

export function readSavedTheme(getStorage: GetStorage = browserStorage): Theme | null {
  try {
    const value = getStorage().getItem(THEME_KEY);
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
}

export function saveTheme(theme: Theme, getStorage: GetStorage = browserStorage): boolean {
  try {
    getStorage().setItem(THEME_KEY, theme);
    return true;
  } catch {
    return false;
  }
}

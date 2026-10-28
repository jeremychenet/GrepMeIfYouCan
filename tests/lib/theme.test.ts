import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_THEME,
  THEME_KEY,
  currentTheme,
  isTheme,
  otherTheme,
  readSavedTheme,
  saveTheme,
  toggleLabel,
} from '../../src/lib/theme';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

const throwing = () => {
  throw new Error('SecurityError');
};

describe('theme', () => {
  it('uses a versioned storage key and light by default', () => {
    expect(THEME_KEY).toBe('gmiyc:v1:theme');
    expect(DEFAULT_THEME).toBe('light');
  });

  it('recognises only the two themes', () => {
    expect(isTheme('dark')).toBe(true);
    expect(isTheme('light')).toBe(true);
    expect(isTheme('auto')).toBe(false);
    expect(isTheme(null)).toBe(false);
  });

  it('flips between dark and light', () => {
    expect(otherTheme('dark')).toBe('light');
    expect(otherTheme('light')).toBe('dark');
  });

  it('labels the toggle with the action it performs', () => {
    expect(toggleLabel('dark')).toBe('Switch to light theme');
    expect(toggleLabel('light')).toBe('Switch to dark theme');
  });

  it('reads the theme set on <html>, falling back to light', () => {
    expect(currentTheme({ dataset: { theme: 'dark' } })).toBe('dark');
    expect(currentTheme({ dataset: { theme: 'bogus' } })).toBe('light');
    expect(currentTheme({ dataset: {} })).toBe('light');
  });

  describe('readSavedTheme', () => {
    it('returns a saved valid theme', () => {
      const s = memoryStorage({ [THEME_KEY]: 'light' });
      expect(readSavedTheme(() => s)).toBe('light');
    });

    it('ignores missing or invalid values', () => {
      expect(readSavedTheme(() => memoryStorage())).toBeNull();
      expect(readSavedTheme(() => memoryStorage({ [THEME_KEY]: 'neon' }))).toBeNull();
    });

    it('returns null when storage is unavailable', () => {
      expect(readSavedTheme(throwing)).toBeNull();
      expect(readSavedTheme(() => ({ getItem: throwing, setItem: throwing }))).toBeNull();
    });
  });

  it('uses window.localStorage by default', () => {
    const s = memoryStorage();
    vi.stubGlobal('localStorage', s);
    try {
      expect(saveTheme('light')).toBe(true);
      expect(readSavedTheme()).toBe('light');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  describe('saveTheme', () => {
    it('stores the theme under the versioned key', () => {
      const s = memoryStorage();
      expect(saveTheme('light', () => s)).toBe(true);
      expect(s.data.get(THEME_KEY)).toBe('light');
    });

    it('returns false instead of throwing when storage fails', () => {
      expect(saveTheme('dark', throwing)).toBe(false);
      expect(saveTheme('dark', () => ({ getItem: throwing, setItem: throwing }))).toBe(false);
    });
  });
});

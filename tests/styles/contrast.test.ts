import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// WCAG 2.2 AA (SPEC §3.4), checked on the design tokens themselves so a
// palette change that breaks contrast fails CI, in both themes.
const css = readFileSync(new URL('../../src/styles/tokens.css', import.meta.url), 'utf8');

function themeTokens(theme: 'dark' | 'light'): Map<string, string> {
  const block = new RegExp(`\\[data-theme='${theme}'\\][^{]*\\{([^}]*)\\}`).exec(css);
  if (!block?.[1]) throw new Error(`no [data-theme='${theme}'] block in tokens.css`);
  const tokens = new Map<string, string>();
  for (const m of block[1].matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    tokens.set(m[1]!, m[2]!.toLowerCase());
  }
  return tokens;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const BACKGROUNDS = ['--color-bg', '--color-surface', '--color-surface-2'];
// Text tokens: 4.5:1 on every background.
const TEXT = [
  '--color-text',
  '--color-text-muted',
  '--color-text-faint',
  '--color-accent',
  '--color-caution',
  '--color-destructive',
];
// Non-text UI (focus ring, control borders): 3:1 (WCAG 1.4.11).
const UI = ['--color-focus', '--color-border-strong'];

describe('contrast helper', () => {
  it('matches known WCAG values', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });
});

describe.each(['dark', 'light'] as const)('%s theme', (theme) => {
  const tokens = themeTokens(theme);
  const get = (name: string) => {
    const value = tokens.get(name);
    if (!value) throw new Error(`${name} missing in ${theme} theme`);
    return value;
  };

  it('defines the same tokens as the other theme', () => {
    const other = themeTokens(theme === 'dark' ? 'light' : 'dark');
    expect([...tokens.keys()].sort()).toEqual([...other.keys()].sort());
  });

  for (const bg of BACKGROUNDS) {
    for (const fg of TEXT) {
      it(`${fg} on ${bg} >= 4.5`, () => {
        expect(contrast(get(fg), get(bg))).toBeGreaterThanOrEqual(4.5);
      });
    }
    for (const fg of UI) {
      it(`${fg} on ${bg} >= 3`, () => {
        expect(contrast(get(fg), get(bg))).toBeGreaterThanOrEqual(3);
      });
    }
  }

  it('text on the accent fill (Copy button, position) >= 4.5', () => {
    expect(contrast(get('--color-on-accent'), get('--color-accent-fill'))).toBeGreaterThanOrEqual(4.5);
  });

  // Editable values: typed text and the default shown as placeholder.
  for (const fg of ['--color-on-hl', '--color-on-hl-muted']) {
    it(`${fg} on the value highlight >= 4.5`, () => {
      expect(contrast(get(fg), get('--color-hl'))).toBeGreaterThanOrEqual(4.5);
    });
  }

  // Black terminal bands (search prompt, key bar): the $ prompt is accent-fill.
  for (const fg of ['--color-term-text', '--color-term-muted', '--color-accent-fill']) {
    it(`${fg} on the terminal band >= 4.5`, () => {
      expect(contrast(get(fg), get('--color-term-bg'))).toBeGreaterThanOrEqual(4.5);
    });
  }

  for (const level of ['caution', 'destructive']) {
    it(`${level} text on its tinted background >= 4.5`, () => {
      expect(contrast(get(`--color-${level}`), get(`--color-${level}-bg`))).toBeGreaterThanOrEqual(
        4.5,
      );
    });
  }
});

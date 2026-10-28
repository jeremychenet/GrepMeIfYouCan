import { describe, expect, it } from 'vitest';
import { createSharedValues, receivesSharedValues } from '../../src/lib/shared-values';

const cp = (...points: number[]) => String.fromCodePoint(...points);

describe('receivesSharedValues', () => {
  it('fills safe and caution cards, never destructive ones', () => {
    expect(receivesSharedValues('safe')).toBe(true);
    expect(receivesSharedValues('caution')).toBe(true);
    expect(receivesSharedValues('destructive')).toBe(false);
  });
});

describe('createSharedValues', () => {
  it('carries a value typed in one card to the same variable of the others', () => {
    const shared = createSharedValues();
    expect(shared.set('path', '/var/log')).toBe('/var/log');
    expect(shared.valueFor('path', 'safe')).toBe('/var/log');
    expect(shared.valueFor('path', 'caution')).toBe('/var/log');
    expect(shared.valueFor('size', 'safe')).toBeUndefined();
  });

  it('never fills a destructive card: its values must be typed in it', () => {
    const shared = createSharedValues();
    shared.set('path', '/');
    expect(shared.valueFor('path', 'destructive')).toBeUndefined();
  });

  it('stores the sanitized value (invisible removed, control characters to a space)', () => {
    const shared = createSharedValues();
    expect(shared.set('path', `/tmp${cp(0x200b)}/x${cp(0x202e)}\ny`)).toBe('/tmp/x y');
    expect(shared.valueFor('path', 'safe')).toBe('/tmp/x y');
  });

  it('forgets a variable when its field is cleared', () => {
    const shared = createSharedValues();
    shared.set('path', '/var/log');
    expect(shared.set('path', '')).toBe('');
    expect(shared.valueFor('path', 'safe')).toBeUndefined();
  });

  it('handles variable names that exist on Object.prototype', () => {
    const shared = createSharedValues();
    expect(shared.valueFor('constructor', 'safe')).toBeUndefined();
    expect(shared.valueFor('__proto__', 'safe')).toBeUndefined();
    shared.set('__proto__', 'x');
    expect(shared.valueFor('__proto__', 'safe')).toBe('x');
    expect(({} as Record<string, unknown>)['x']).toBeUndefined();
  });

  it('keeps each page state separate', () => {
    const a = createSharedValues();
    const b = createSharedValues();
    a.set('path', '/a');
    expect(b.valueFor('path', 'safe')).toBeUndefined();
  });
});

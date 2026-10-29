import { describe, expect, it } from 'vitest';
import {
  SHORTCUTS,
  TOUCH_QUERY,
  isTouchOnly,
  moveIndex,
  positionLabel,
  resolveKey,
  type KeyContext,
  type KeyPress,
} from '../../src/lib/keyboard';

const key = (k: string, mods: Partial<KeyPress> = {}): KeyPress => ({ key: k, ...mods });

describe('resolveKey', () => {
  it('focuses the search with / from the page or the list', () => {
    expect(resolveKey(key('/'), 'page')).toBe('focus-search');
    expect(resolveKey(key('/'), 'list')).toBe('focus-search');
  });

  it('lets / be typed in the search box and in fields', () => {
    expect(resolveKey(key('/'), 'search')).toBeNull();
    expect(resolveKey(key('/'), 'field')).toBeNull();
  });

  it('focuses the search with Cmd+K or Ctrl+K from anywhere', () => {
    const contexts: KeyContext[] = ['page', 'list', 'search', 'field'];
    for (const ctx of contexts) {
      expect(resolveKey(key('k', { metaKey: true }), ctx)).toBe('focus-search');
      expect(resolveKey(key('K', { ctrlKey: true }), ctx)).toBe('focus-search');
    }
    expect(resolveKey(key('k', { ctrlKey: true, altKey: true }), 'page')).toBeNull();
    expect(resolveKey(key('k'), 'page')).toBeNull();
  });

  it('clears the search with Escape, and leaves the list or a field', () => {
    expect(resolveKey(key('Escape'), 'search')).toBe('clear');
    expect(resolveKey(key('Escape'), 'list')).toBe('back');
    expect(resolveKey(key('Escape'), 'field')).toBe('back');
    expect(resolveKey(key('Escape'), 'page')).toBeNull();
  });

  it('enters the results with ArrowDown from the search box only', () => {
    expect(resolveKey(key('ArrowDown'), 'search')).toBe('enter-list');
    expect(resolveKey(key('ArrowUp'), 'search')).toBeNull();
    expect(resolveKey(key('a'), 'search')).toBeNull();
  });

  it('moves between cards with the arrows from a variable, a link or a button of a card', () => {
    // KeyboardNav ignores the move (native key) when the focus is outside a card.
    for (const ctx of ['field', 'page'] as const) {
      expect(resolveKey(key('ArrowDown'), ctx)).toBe('next');
      expect(resolveKey(key('ArrowUp'), ctx)).toBe('prev');
      // Shift+arrows select text in a field; Home/End move its caret.
      expect(resolveKey(key('ArrowDown', { shiftKey: true }), ctx)).toBeNull();
      expect(resolveKey(key('ArrowUp', { altKey: true }), ctx)).toBeNull();
      expect(resolveKey(key('Home'), ctx)).toBeNull();
      expect(resolveKey(key('End'), ctx)).toBeNull();
    }
  });

  it('maps the list keys', () => {
    expect(resolveKey(key('ArrowDown'), 'list')).toBe('next');
    expect(resolveKey(key('ArrowUp'), 'list')).toBe('prev');
    expect(resolveKey(key('Home'), 'list')).toBe('first');
    expect(resolveKey(key('End'), 'list')).toBe('last');
    expect(resolveKey(key('Enter'), 'list')).toBe('copy');
    expect(resolveKey(key('Tab'), 'list')).toBe('edit');
    expect(resolveKey(key('o'), 'list')).toBe('open');
    expect(resolveKey(key('f'), 'list')).toBe('favorite');
    expect(resolveKey(key('?', { shiftKey: true }), 'list')).toBe('help');
  });

  it('keeps native Shift+Tab and modified keys in the list', () => {
    expect(resolveKey(key('Tab', { shiftKey: true }), 'list')).toBeNull();
    expect(resolveKey(key('o', { metaKey: true }), 'list')).toBeNull();
    expect(resolveKey(key('f', { ctrlKey: true }), 'list')).toBeNull();
    expect(resolveKey(key('F', { shiftKey: true }), 'list')).toBeNull();
    expect(resolveKey(key('Enter', { ctrlKey: true }), 'list')).toBeNull();
    expect(resolveKey(key('ArrowDown', { altKey: true }), 'list')).toBeNull();
    expect(resolveKey(key('x'), 'list')).toBeNull();
  });

  it('copies with Enter from a variable field, not Shift+Enter', () => {
    expect(resolveKey(key('Enter'), 'field')).toBe('copy');
    expect(resolveKey(key('Enter', { shiftKey: true }), 'field')).toBeNull();
    expect(resolveKey(key('o'), 'field')).toBeNull();
    expect(resolveKey(key('f'), 'field')).toBeNull();
    expect(resolveKey(key('?'), 'field')).toBeNull();
  });

  it('opens the help with ? outside text fields', () => {
    expect(resolveKey(key('?'), 'page')).toBe('help');
    expect(resolveKey(key('?'), 'search')).toBeNull();
  });

  it('ignores list keys outside the list', () => {
    expect(resolveKey(key('o'), 'page')).toBeNull();
    expect(resolveKey(key('f'), 'page')).toBeNull();
    expect(resolveKey(key('f'), 'search')).toBeNull();
    expect(resolveKey(key('Enter'), 'page')).toBeNull();
    expect(resolveKey(key('Tab'), 'page')).toBeNull();
  });
});

describe('moveIndex', () => {
  it('starts at the first option', () => {
    expect(moveIndex(-1, 'next', 5)).toBe(0);
    expect(moveIndex(-1, 'prev', 5)).toBe(0);
  });

  it('moves and stops at both ends', () => {
    expect(moveIndex(0, 'next', 3)).toBe(1);
    expect(moveIndex(2, 'next', 3)).toBe(2);
    expect(moveIndex(1, 'prev', 3)).toBe(0);
    expect(moveIndex(0, 'prev', 3)).toBe(0);
    expect(moveIndex(1, 'first', 3)).toBe(0);
    expect(moveIndex(0, 'last', 3)).toBe(2);
  });

  it('clamps an index that is out of range', () => {
    expect(moveIndex(9, 'prev', 3)).toBe(1);
    expect(moveIndex(9, 'next', 3)).toBe(2);
  });

  it('returns -1 for an empty list', () => {
    expect(moveIndex(0, 'next', 0)).toBe(-1);
    expect(moveIndex(-1, 'last', 0)).toBe(-1);
  });
});

describe('isTouchOnly', () => {
  it('asks for a screen without hover and with a coarse pointer', () => {
    const asked: string[] = [];
    expect(isTouchOnly((q) => (asked.push(q), true))).toBe(true);
    expect(isTouchOnly(() => false)).toBe(false);
    expect(asked).toEqual([TOUCH_QUERY]);
    expect(TOUCH_QUERY).toBe('(hover: none) and (pointer: coarse)');
  });
});

describe('SHORTCUTS', () => {
  it('documents every key the help shows', () => {
    const keys = SHORTCUTS.flatMap((s) => s.keys);
    for (const k of ['/', 'Ctrl K', '↑', '↓', 'Enter', 'Tab', 'o', 'f', 'Esc', '?']) expect(keys).toContain(k);
    for (const s of SHORTCUTS) expect(s.label.length).toBeGreaterThan(0);
  });
});

describe('positionLabel', () => {
  it('shows the active row and the row count on two digits', () => {
    expect(positionLabel(0, 7)).toBe('01/07');
    expect(positionLabel(6, 7)).toBe('07/07');
    expect(positionLabel(11, 50)).toBe('12/50');
  });

  it('shows dashes when no row is active', () => {
    expect(positionLabel(-1, 7)).toBe('--/07');
    expect(positionLabel(-1, 0)).toBe('--/00');
    expect(positionLabel(9, 3)).toBe('--/03');
  });

  it('grows past two digits', () => {
    expect(positionLabel(99, 120)).toBe('100/120');
  });
});

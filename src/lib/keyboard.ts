// Keyboard shortcuts (SPEC §3.2), as pure functions: which action a key
// triggers depends on where the focus is. src/components/KeyboardNav.ts
// applies the actions to the page.

/**
 * Where the focus is: the search box, a list of cards (listbox), another
 * text field (a command variable), or anywhere else on the page.
 */
export type KeyContext = 'search' | 'list' | 'field' | 'page';

export type KeyAction =
  | 'focus-search'
  | 'clear'
  | 'back'
  | 'enter-list'
  | 'next'
  | 'prev'
  | 'first'
  | 'last'
  | 'copy'
  | 'edit'
  | 'open'
  | 'favorite'
  | 'help';

export type MoveAction = Extract<KeyAction, 'next' | 'prev' | 'first' | 'last'>;

/** The parts of a KeyboardEvent the shortcuts depend on. */
export interface KeyPress {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

const LIST_KEYS: Readonly<Record<string, KeyAction>> = {
  ArrowDown: 'next',
  ArrowUp: 'prev',
  Home: 'first',
  End: 'last',
  Enter: 'copy',
  Tab: 'edit',
  o: 'open',
  f: 'favorite',
};

/**
 * Arrows that also move between cards from a control of a card (a variable
 * after Tab, a link, a button). KeyboardNav lets the browser handle them
 * when the focus is not inside a card (page scroll, caret).
 */
const CARD_ARROWS: Readonly<Record<string, KeyAction>> = {
  ArrowDown: 'next',
  ArrowUp: 'prev',
};

/** Keys that act anywhere except while typing in a text field. */
const PAGE_KEYS: Readonly<Record<string, KeyAction>> = {
  '/': 'focus-search',
  '?': 'help',
};

export function resolveKey(press: KeyPress, ctx: KeyContext): KeyAction | null {
  const { key } = press;
  if ((press.metaKey || press.ctrlKey) && !press.altKey && key.toLowerCase() === 'k') return 'focus-search';
  if (key === 'Escape') return ctx === 'search' ? 'clear' : ctx === 'page' ? null : 'back';
  if (press.metaKey || press.ctrlKey || press.altKey) return null;
  if (ctx !== 'search' && !press.shiftKey && Object.hasOwn(CARD_ARROWS, key)) return CARD_ARROWS[key]!;

  switch (ctx) {
    case 'search':
      return key === 'ArrowDown' ? 'enter-list' : null;
    case 'field':
      return key === 'Enter' && !press.shiftKey ? 'copy' : null;
    case 'list':
      if (key === 'Tab' && press.shiftKey) return null;
      return Object.hasOwn(LIST_KEYS, key) ? LIST_KEYS[key]! : (PAGE_KEYS[key] ?? null);
    case 'page':
      return Object.hasOwn(PAGE_KEYS, key) ? PAGE_KEYS[key]! : null;
  }
}

/** Index of the active option after a move, or -1 when the list is empty. */
export function moveIndex(index: number, action: MoveAction, length: number): number {
  if (length === 0) return -1;
  const last = length - 1;
  const current = Math.min(index, last);
  switch (action) {
    case 'first':
      return 0;
    case 'last':
      return last;
    case 'next':
      return current < 0 ? 0 : Math.min(current + 1, last);
    case 'prev':
      return Math.max(current - 1, 0);
  }
}

/** Position shown in the key bar, e.g. `01/07`; dashes when no row is active. */
export function positionLabel(index: number, length: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const current = index >= 0 && index < length ? pad(index + 1) : '--';
  return `${current}/${pad(length)}`;
}

/** Touch screens get no shortcuts and no help (SPEC §3.3). */
export const TOUCH_QUERY = '(hover: none) and (pointer: coarse)';

export function isTouchOnly(matches: (query: string) => boolean): boolean {
  return matches(TOUCH_QUERY);
}

/** Shown by the help dialog (ShortcutsHelp.astro). */
export const SHORTCUTS: readonly { keys: readonly string[]; label: string }[] = [
  { keys: ['/', 'Ctrl K', '⌘ K'], label: 'Focus the search' },
  { keys: ['↓', '↑'], label: 'Move through the results' },
  { keys: ['Enter'], label: 'Copy the selected command' },
  { keys: ['Tab'], label: 'Edit the values of the selected command' },
  { keys: ['o'], label: 'Open the selected command page' },
  { keys: ['f'], label: 'Add or remove the selected command from favorites' },
  { keys: ['Esc'], label: 'Clear the search, or leave the list' },
  { keys: ['?'], label: 'Show this help' },
];

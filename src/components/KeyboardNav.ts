// Keyboard navigation (SPEC §3.2). The key → action mapping lives in
// src/lib/keyboard.ts (tested); this file applies the actions to the page.
//
// Each card list (CardList.astro) becomes a listbox: it takes the focus and
// points to its active card with aria-activedescendant, so screen readers
// announce it. Search results are re-rendered on every keystroke, so a
// MutationObserver keeps their roles in place. Touch screens get none of this.
import { isTouchOnly, moveIndex, resolveKey, type KeyAction, type KeyContext } from '../lib/keyboard';
import { openShortcutsHelp } from './ShortcutsHelp';

const active = new WeakMap<HTMLElement, number>();

function options(list: HTMLElement): HTMLElement[] {
  return [...list.children].filter((el): el is HTMLElement => el instanceof HTMLLIElement && el.getAttribute('role') === 'option');
}

function setActive(list: HTMLElement, index: number, scroll = true): void {
  const all = options(list);
  active.set(list, index);
  all.forEach((li, i) => li.setAttribute('aria-selected', String(i === index)));
  const current = all[index];
  if (!current) {
    list.removeAttribute('aria-activedescendant');
    return;
  }
  list.setAttribute('aria-activedescendant', current.id);
  if (scroll) current.scrollIntoView({ block: 'nearest' });
}

function activeOption(list: HTMLElement): HTMLElement | undefined {
  return options(list)[active.get(list) ?? -1];
}

/** Gives each card of the list the option role and a stable id. */
function syncOptions(list: HTMLElement): void {
  for (const li of list.children) {
    if (!(li instanceof HTMLLIElement)) continue;
    const id = li.querySelector<HTMLElement>('article[data-card]')?.dataset['card'];
    if (!id) continue;
    li.setAttribute('role', 'option');
    li.id = `option-${id}`;
  }
  setActive(list, -1, false);
}

function setupList(list: HTMLElement): void {
  list.setAttribute('role', 'listbox');
  list.tabIndex = 0;
  syncOptions(list);
  new MutationObserver(() => syncOptions(list)).observe(list, { childList: true });
  list.addEventListener('focus', () => {
    if ((active.get(list) ?? -1) < 0) setActive(list, moveIndex(-1, 'first', options(list).length), false);
  });
  // Focus inside a card (a variable, a link) makes that card the active one.
  list.addEventListener('focusin', (event) => {
    const li = (event.target as Element).closest<HTMLElement>('[role="option"]');
    if (li && li.parentElement === list) setActive(list, options(list).indexOf(li), false);
  });
}

function isVisible(el: HTMLElement): boolean {
  return !el.closest('[hidden]');
}

function init(): void {
  const lists = [...document.querySelectorAll<HTMLElement>('[data-card-list]')];
  lists.forEach(setupList);
  const search = document.querySelector<HTMLInputElement>('[data-search-input]');

  function contextOf(target: EventTarget | null): KeyContext {
    if (!(target instanceof HTMLElement)) return 'page';
    if (target === search) return 'search';
    if (lists.includes(target)) return 'list';
    if (target.isContentEditable || target.matches('input, textarea, select')) return 'field';
    return 'page';
  }

  function focusSearch(): boolean {
    if (!search) return false;
    search.focus();
    search.select();
    return true;
  }

  /** Runs an action; false lets the browser handle the key as usual. */
  function run(action: KeyAction, target: HTMLElement): boolean {
    const list = lists.includes(target) ? target : target.closest<HTMLElement>('[data-card-list]');
    switch (action) {
      case 'focus-search':
        return focusSearch();
      case 'help':
        openShortcutsHelp();
        return true;
      case 'clear':
        if (!search) return false;
        if (search.value === '') search.blur();
        else {
          search.value = '';
          search.dispatchEvent(new Event('input', { bubbles: true }));
        }
        return true;
      case 'back':
        // From a variable back to its list, from a list back to the search.
        if (list && target !== list) {
          list.focus();
          return true;
        }
        if (focusSearch()) return true;
        target.blur();
        return true;
      case 'enter-list': {
        const results = lists.find((l) => isVisible(l) && options(l).length > 0);
        if (!results) return false;
        results.focus();
        setActive(results, 0);
        return true;
      }
      case 'next':
      case 'prev':
      case 'first':
      case 'last':
        if (!list) return false;
        setActive(list, moveIndex(active.get(list) ?? -1, action, options(list).length));
        return true;
      case 'copy': {
        const card = list === target ? activeOption(list) : target.closest('article[data-card]');
        const button = card?.querySelector<HTMLButtonElement>('[data-copy]');
        if (!button || button.hidden) return false;
        button.click();
        return true;
      }
      case 'edit': {
        const field = list && activeOption(list)?.querySelector<HTMLInputElement>('.var-input');
        if (!field) return false;
        field.focus();
        return true;
      }
      case 'open': {
        const link = list && activeOption(list)?.querySelector<HTMLAnchorElement>('.title a');
        if (!link) return false;
        window.location.assign(link.href);
        return true;
      }
    }
  }

  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.isComposing) return;
    // A modal dialog handles its own keys (Escape closes it).
    if (document.querySelector('dialog[open]')) return;
    const target = event.target instanceof HTMLElement ? event.target : document.body;
    const action = resolveKey(event, contextOf(target));
    if (action && run(action, target)) event.preventDefault();
  });
}

if (!isTouchOnly((q) => window.matchMedia(q).matches)) init();

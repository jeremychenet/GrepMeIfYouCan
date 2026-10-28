// Keyboard navigation (SPEC §3.2). The key → action mapping lives in
// src/lib/keyboard.ts (tested); this file applies the actions to the page.
//
// Each card list (CardList.astro) stays a plain list: the arrow keys move the
// real focus from card to card (roving tabindex: the active card is the one
// Tab stop of the list). Each card is an <article> named by its title, so
// screen readers announce it, and its links, values and buttons stay
// reachable (a listbox could not contain them). The active row is marked
// with aria-current. Search results are re-rendered on every keystroke, so a
// MutationObserver prepares the new cards. Touch screens get none of this.
import { isTouchOnly, moveIndex, positionLabel, resolveKey, type KeyAction, type KeyContext } from '../lib/keyboard';
import { openShortcutsHelp } from './ShortcutsHelp';

const CARD = 'article[data-card]';
const active = new WeakMap<HTMLElement, number>();
let lists: HTMLElement[] = [];
/** The list whose position the key bar shows (the last one used). */
let barList: HTMLElement | undefined;

/** The cards of a list, in order. */
function cards(list: HTMLElement): HTMLElement[] {
  return [...list.children].flatMap((li) => {
    const card = li instanceof HTMLLIElement ? li.querySelector<HTMLElement>(`:scope > ${CARD}`) : null;
    return card ? [card] : [];
  });
}

function isVisible(el: HTMLElement): boolean {
  return !el.closest('[hidden]');
}

/** Shows the key bar (KeyBar.astro) while a list is visible, with its `01/07` position. */
function refreshBar(): void {
  const bar = document.querySelector<HTMLElement>('[data-keybar]');
  const position = bar?.querySelector<HTMLElement>('[data-key-position]');
  if (!bar || !position) return;
  const list = barList && isVisible(barList) ? barList : lists.find(isVisible);
  bar.hidden = !list;
  if (list) position.textContent = positionLabel(active.get(list) ?? -1, cards(list).length);
}

/** Makes card `index` the active one; `focus` also moves the focus to it. */
function setActive(list: HTMLElement, index: number, focus = false): void {
  const all = cards(list);
  active.set(list, index);
  if (index >= 0) barList = list;
  all.forEach((card, i) => {
    const li = card.parentElement!;
    if (i === index) li.setAttribute('aria-current', 'true');
    else li.removeAttribute('aria-current');
    // One Tab stop per list: the active card, else the first one.
    card.tabIndex = i === Math.max(index, 0) ? 0 : -1;
  });
  refreshBar();
  const current = all[index];
  if (focus && current) {
    current.focus({ preventScroll: true });
    current.parentElement!.scrollIntoView({ block: 'nearest' });
  }
}

/** Names each card by its title, so the focused card is announced. */
function syncCards(list: HTMLElement): void {
  for (const card of cards(list)) {
    const title = card.querySelector<HTMLElement>('.title');
    if (title) {
      title.id ||= `title-${card.dataset['card']}`;
      card.setAttribute('aria-labelledby', title.id);
    }
    card.parentElement!.id = `row-${card.dataset['card']}`;
  }
  setActive(list, -1);
}

function setupList(list: HTMLElement): void {
  syncCards(list);
  new MutationObserver(() => syncCards(list)).observe(list, { childList: true });
  // Focus on or inside a card (a variable, a link) makes it the active one.
  list.addEventListener('focusin', (event) => {
    const card = (event.target as Element).closest<HTMLElement>(CARD);
    const index = card ? cards(list).indexOf(card) : -1;
    if (index >= 0 && index !== active.get(list)) setActive(list, index);
  });
}

function init(): void {
  lists = [...document.querySelectorAll<HTMLElement>('[data-card-list]')];
  lists.forEach(setupList);
  // The key bar follows the lists as they are shown or hidden (search
  // results, favorites).
  if (lists.length > 0) {
    refreshBar();
    new MutationObserver(refreshBar).observe(document.querySelector('main') ?? document.body, {
      attributes: true,
      attributeFilter: ['hidden'],
      subtree: true,
    });
  }
  const search = document.querySelector<HTMLInputElement>('[data-search-input]');

  /** The list of a card that has the focus itself (not one of its controls). */
  function listOfCard(target: HTMLElement): HTMLElement | undefined {
    if (!target.matches(CARD)) return undefined;
    return lists.find((l) => target.parentElement?.parentElement === l);
  }

  function contextOf(target: EventTarget | null): KeyContext {
    if (!(target instanceof HTMLElement)) return 'page';
    if (target === search) return 'search';
    if (listOfCard(target)) return 'list';
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
    const card = target.closest<HTMLElement>(CARD);
    const list = card ? lists.find((l) => l.contains(card)) : undefined;
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
        // From a variable back to its card, from a card back to the search.
        if (card && list && target !== card) {
          card.focus();
          return true;
        }
        if (focusSearch()) return true;
        target.blur();
        return true;
      case 'enter-list': {
        const results = lists.find((l) => isVisible(l) && cards(l).length > 0);
        if (!results) return false;
        setActive(results, 0, true);
        return true;
      }
      case 'next':
      case 'prev':
      case 'first':
      case 'last':
        if (!list || !card) return false;
        setActive(list, moveIndex(cards(list).indexOf(card), action, cards(list).length), true);
        return true;
      case 'copy': {
        const button = card?.querySelector<HTMLButtonElement>('[data-copy]');
        if (!button || button.hidden) return false;
        button.click();
        return true;
      }
      case 'edit': {
        const field = card?.querySelector<HTMLInputElement>('.var-input');
        if (!field) return false;
        field.focus();
        return true;
      }
      case 'favorite': {
        const button = card?.querySelector<HTMLButtonElement>('[data-favorite]');
        if (!button || button.hidden) return false;
        button.click();
        return true;
      }
      case 'open': {
        const link = card?.querySelector<HTMLAnchorElement>('.title a');
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

  // Search first: the home page opens with the cursor in the search box,
  // after any query restored from the URL. Not when the visitor already
  // moved the focus, nor when the URL targets an anchor (#main).
  if (search && document.activeElement === document.body && !location.hash) {
    search.focus({ preventScroll: true });
    search.setSelectionRange(search.value.length, search.value.length);
  }
}

if (!isTouchOnly((q) => window.matchMedia(q).matches)) init();

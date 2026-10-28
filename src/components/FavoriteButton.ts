// The ★ button of a command card (SPEC §2.8). Hidden until this script runs;
// every button of the page follows the stored favorites, even when another
// tab changes them.
import { FAVORITES_MAX, type ToggleResult } from '../lib/store';
import { onStoreChange, store } from './LocalStore';
import { trackEvent } from './Stats';
import { showToast } from './Toast';

const MESSAGES: Record<ToggleResult, string> = {
  added: 'Added to favorites',
  removed: 'Removed from favorites',
  full: `Favorites are full (${FAVORITES_MAX} max): remove one first`,
  invalid: 'This command cannot be saved',
  failed: 'Could not save: browser storage is unavailable',
};

const SELECTOR = 'button[data-favorite][data-enhanced]';

function syncAll(): void {
  const ids = new Set(store.favorites().map((e) => e.id));
  for (const button of document.querySelectorAll<HTMLButtonElement>(SELECTOR)) {
    const id = button.closest<HTMLElement>('article[data-card]')?.dataset['card'];
    button.setAttribute('aria-pressed', String(!!id && ids.has(id)));
  }
}

export function enhanceFavorite(article: HTMLElement): void {
  const id = article.dataset['card'];
  const button = article.querySelector<HTMLButtonElement>('button[data-favorite]');
  if (!id || !button || button.dataset['enhanced']) return;
  button.dataset['enhanced'] = 'true';
  button.setAttribute('aria-pressed', String(store.isFavorite(id)));
  button.hidden = false;
  button.addEventListener('click', () => {
    const result = store.toggleFavorite(id);
    // Only additions are counted (SPEC §6.4).
    if (result === 'added') trackEvent('favorite', { id });
    showToast(MESSAGES[result]);
    syncAll();
  });
}

onStoreChange((list) => {
  if (list === 'favorites') syncAll();
});

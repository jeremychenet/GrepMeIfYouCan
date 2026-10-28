// The page's store (src/lib/store.ts) on localStorage. Changes are announced
// with an event, also when another tab changes the same lists.
import { FAVORITES_KEY, HISTORY_KEY, createStore, type StoreList } from '../lib/store';

const CHANGE = 'gmiyc:store-change';

const announce = (list: StoreList) => window.dispatchEvent(new CustomEvent<StoreList>(CHANGE, { detail: list }));

export const store = createStore({ notify: announce });

export function onStoreChange(listener: (list: StoreList) => void): void {
  window.addEventListener(CHANGE, (event) => listener((event as CustomEvent<StoreList>).detail));
}

// Another tab wrote to localStorage (a null key means it was cleared).
window.addEventListener('storage', (event) => {
  if (event.key === FAVORITES_KEY || event.key === null) announce('favorites');
  if (event.key === HISTORY_KEY || event.key === null) announce('history');
});

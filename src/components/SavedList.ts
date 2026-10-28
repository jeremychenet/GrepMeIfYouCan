// Favorites and History pages (SPEC §2.8): shows the stored cards, newest
// first. Ids of cards that no longer exist are skipped. The list is redrawn
// when its set of cards changes (not when a copy only reorders the history,
// so cards do not jump under the pointer).
import type { SearchDoc } from '../lib/search';
import type { StoreList } from '../lib/store';
import { setupExportImport } from './ExportImport';
import { onStoreChange, store } from './LocalStore';
import { createResultsList } from './ResultsList';
import { showToast } from './Toast';

const isList = (v: string | undefined): v is StoreList => v === 'favorites' || v === 'history';

function count(list: StoreList, n: number): string {
  if (list === 'favorites') return `${n} ${n === 1 ? 'favorite' : 'favorites'}`;
  return `${n} copied ${n === 1 ? 'command' : 'commands'}`;
}

function init(root: HTMLElement): void {
  const kind = root.dataset['saved'];
  if (!isList(kind)) return;
  const list: StoreList = kind;
  const status = root.querySelector<HTMLElement>('[data-saved-status]')!;
  const results = root.querySelector<HTMLElement>('[data-saved-results]')!;
  const empty = root.querySelector<HTMLElement>('[data-saved-empty]')!;
  const actions = root.querySelector<HTMLElement>('[data-saved-actions]')!;
  const clear = root.querySelector<HTMLButtonElement>('[data-clear-history]');
  const cards = createResultsList(root);

  let index: Promise<Map<string, SearchDoc>> | null = null;
  let shown: string | null = null;
  let run = 0;

  function load(): Promise<Map<string, SearchDoc>> {
    index ??= fetch('/search-index.json')
      .then((res) => {
        if (!res.ok) throw new Error(`search index: HTTP ${res.status}`);
        return res.json() as Promise<SearchDoc[]>;
      })
      .then((docs) => new Map(docs.map((d) => [d.id, d])))
      .catch((err: unknown) => {
        index = null;
        throw err;
      });
    return index;
  }

  async function render(): Promise<void> {
    const entries = list === 'favorites' ? store.favorites() : store.history();
    const key = entries.map((e) => e.id).sort().join(' ');
    if (key === shown) return;
    const current = ++run;
    let byId: Map<string, SearchDoc>;
    try {
      byId = await load();
    } catch {
      if (current === run) status.textContent = 'Could not load the commands. Reload the page to try again.';
      return;
    }
    if (current !== run) return;
    shown = key;
    const docs = entries.flatMap((e) => byId.get(e.id) ?? []);
    cards.render(docs, Infinity);
    results.hidden = docs.length === 0;
    empty.hidden = docs.length > 0;
    if (clear) clear.hidden = docs.length === 0;
    status.textContent = store.available()
      ? docs.length
        ? count(list, docs.length)
        : ''
      : 'Browser storage is unavailable (private mode or blocked): nothing can be saved here.';
  }

  actions.hidden = false;
  setupExportImport(root);
  clear?.addEventListener('click', () => {
    if (!window.confirm('Clear your copy history? This cannot be undone.')) return;
    showToast(store.clearHistory() ? 'History cleared' : 'Could not clear: browser storage is unavailable');
  });

  void render();
  onStoreChange((changed) => {
    if (changed === list) void render();
  });
}

const root = document.querySelector<HTMLElement>('[data-saved]');
if (root) init(root);

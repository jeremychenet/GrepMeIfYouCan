// Home page search island (SPEC §2.3): wires the search box, the filter chips
// and the results list. The state lives in the URL (?q=…&cat=…&tag=…), so a
// search can be shared and survives a reload. The index is fetched once, on
// first interaction or when the browser is idle.
import { suggestCommandUrl } from '../lib/github';
// The engine (MiniSearch) is loaded with the index, not with the page (SPEC §8).
import type { SearchDoc, SearchEngine } from '../lib/search';
import {
  isEmptyState,
  parseState,
  serializeState,
  toggleTag,
  type SearchState,
} from '../lib/search-state';
import { createFilterChips } from './FilterChips';
import { RESULTS_MAX, createResultsList } from './ResultsList';

const root = document.querySelector<HTMLElement>('[data-search]');
if (root) init(root);

function init(root: HTMLElement): void {
  const form = root.querySelector<HTMLFormElement>('[data-search-form]')!;
  const input = root.querySelector<HTMLInputElement>('[data-search-input]')!;
  const status = root.querySelector<HTMLElement>('[data-search-status]')!;
  const results = root.querySelector<HTMLElement>('[data-search-results]')!;
  const empty = root.querySelector<HTMLElement>('[data-search-empty]')!;
  const suggest = root.querySelector<HTMLAnchorElement>('[data-suggest-link]')!;
  // Shown when there is nothing to search (no query, no filter).
  const browse = document.querySelector<HTMLElement>('[data-browse]');

  const list = createResultsList(root);
  const chips = createFilterChips(root, (patch) => update(patch(state)));

  let state: SearchState = parseState(location.search);
  let engine: Promise<SearchEngine> | null = null;
  let run = 0;

  function load(): Promise<SearchEngine> {
    engine ??= fetch('/search-index.json')
      .then((res) => {
        if (!res.ok) throw new Error(`search index: HTTP ${res.status}`);
        return res.json() as Promise<SearchDoc[]>;
      })
      .then(async (docs) => (await import('../lib/search')).createSearch(docs))
      .catch((err: unknown) => {
        engine = null; // retry on the next interaction
        throw err;
      });
    return engine;
  }

  function show(mode: 'browse' | 'results' | 'empty'): void {
    if (browse) browse.hidden = mode !== 'browse';
    results.hidden = mode !== 'results';
    empty.hidden = mode !== 'empty';
  }

  function render(): void {
    const current = ++run;
    if (isEmptyState(state)) {
      status.textContent = '';
      show('browse');
      return;
    }
    load().then(
      (search) => {
        if (current !== run) return;
        const found = search.search(state.q, state);
        list.render(found);
        if (found.length === 0) {
          status.textContent = '';
          suggest.href = suggestCommandUrl(state.q);
          show('empty');
          return;
        }
        const noun = found.length === 1 ? 'command' : 'commands';
        const more = found.length > RESULTS_MAX ? `, showing the first ${RESULTS_MAX}` : '';
        status.textContent = `${found.length} ${noun} found${more}`;
        show('results');
      },
      () => {
        if (current !== run) return;
        status.textContent = 'Search is unavailable right now. Browse the categories below.';
        show('browse');
      },
    );
  }

  function update(next: SearchState): void {
    state = next;
    history.replaceState(history.state, '', `${location.pathname}${serializeState(state)}${location.hash}`);
    chips.update(state);
    render();
  }

  input.value = state.q;
  update(state);

  input.addEventListener('input', () => update({ ...state, q: input.value }));
  // Results update on every keystroke: Enter has nothing left to submit.
  form.addEventListener('submit', (event) => event.preventDefault());
  for (const type of ['focus', 'pointerenter'] as const) {
    input.addEventListener(type, () => void load().catch(() => {}), { once: true });
  }

  // A tag on a result card adds that tag filter instead of reloading the page.
  results.addEventListener('click', (event) => {
    const mouse = event as MouseEvent;
    if (mouse.button !== 0 || mouse.metaKey || mouse.ctrlKey || mouse.shiftKey || mouse.altKey) return;
    const link = (event.target as Element).closest<HTMLAnchorElement>('a[data-tag]');
    if (!link) return;
    event.preventDefault();
    const tag = link.dataset['tag']!;
    if (!state.tags.includes(tag)) update(toggleTag(state, tag));
  });

  const idle = window.requestIdleCallback?.bind(window) ?? ((cb: () => void) => window.setTimeout(cb, 1500));
  idle(() => void load().catch(() => {}));
}

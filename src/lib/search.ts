// Client-side search (SPEC §2.3): MiniSearch over the cards of
// /search-index.json, typo-tolerant and prefix-based. The same code runs in
// the browser and in the relevance tests.
import MiniSearch from 'minisearch';
import type { Command } from '../content/schema';

/** One entry of /search-index.json: the card fields the results list needs. */
export type SearchDoc = Pick<
  Command,
  'id' | 'title' | 'description' | 'command' | 'tool' | 'category' | 'tags' | 'danger'
>;

export function toSearchDoc(c: Command): SearchDoc {
  const { id, title, description, command, tool, category, tags, danger } = c;
  return { id, title, description, command, tool, category, tags, danger };
}

export interface Filters {
  cat: string | null;
  tags: readonly string[];
}

/** Field weights: title > tool > tags > command > description. */
export const BOOST = { title: 5, tool: 4, tags: 3, command: 2, description: 1 } as const;
const FIELDS = Object.keys(BOOST);

/**
 * Typos allowed per word: none up to 3 letters, 1 up to 6, then 2, so a
 * swapped pair of letters ("restrat", "kubetcl") is still found.
 */
export function maxTypos(term: string): number {
  if (term.length <= 3) return 0;
  return term.length <= 6 ? 1 : 2;
}

export interface SearchEngine {
  search(query: string, filters: Filters): SearchDoc[];
}

const byTitle = (a: SearchDoc, b: SearchDoc) =>
  a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }) || a.id.localeCompare(b.id);

export function matchesFilters(doc: SearchDoc, { cat, tags }: Filters): boolean {
  return (cat === null || doc.category === cat) && tags.every((t) => doc.tags.includes(t));
}

export function createSearch(docs: readonly SearchDoc[]): SearchEngine {
  const byId = new Map(docs.map((d) => [d.id, d]));
  const index = new MiniSearch<SearchDoc>({
    fields: FIELDS,
    extractField: (doc, field) => {
      const value = doc[field as keyof SearchDoc];
      return Array.isArray(value) ? value.join(' ') : value;
    },
    searchOptions: { boost: { ...BOOST }, prefix: true, fuzzy: maxTypos },
  });
  index.addAll(docs);

  return {
    search(query, filters) {
      const q = query.trim();
      if (!q) return docs.filter((d) => matchesFilters(d, filters)).sort(byTitle);
      const filter = (r: { id: string }) => matchesFilters(byId.get(r.id)!, filters);
      // Cards matching every word come first, then those matching any word
      // ("list open ports" still finds a card that never says "open").
      const all = index.search(q, { combineWith: 'AND', filter });
      const seen = new Set(all.map((h) => h.id));
      for (const h of index.search(q, { combineWith: 'OR', filter })) {
        if (!seen.has(h.id)) all.push(h);
      }
      return all.map((h) => byId.get(h.id)!);
    },
  };
}

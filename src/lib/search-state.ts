// Search state mirrored in the URL (SPEC §2.3): ?q=large+files&cat=linux&tag=disk.
// Values from the URL are untrusted: unknown categories and malformed tags
// are dropped, and the query is capped.
import { CATEGORIES, TAGS_MAX } from '../content/schema';

type Category = (typeof CATEGORIES)[number];

export interface SearchState {
  q: string;
  cat: Category | null;
  tags: string[];
}

export const QUERY_MAX = 200;
const TAG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const EMPTY_STATE: SearchState = { q: '', cat: null, tags: [] };

const isCategory = (v: string | null): v is Category =>
  v !== null && (CATEGORIES as readonly string[]).includes(v);

export function parseState(search: string): SearchState {
  const params = new URLSearchParams(search);
  const cat = params.get('cat');
  const tags = [...new Set(params.getAll('tag').filter((t) => TAG.test(t)))].slice(0, TAGS_MAX);
  return {
    q: (params.get('q') ?? '').slice(0, QUERY_MAX),
    cat: isCategory(cat) ? cat : null,
    tags,
  };
}

/** "" for the empty state, else "?q=…&cat=…&tag=…" (spaces as "+"). */
export function serializeState({ q, cat, tags }: SearchState): string {
  const params = new URLSearchParams();
  if (q.trim()) params.set('q', q);
  if (cat) params.set('cat', cat);
  for (const t of tags) params.append('tag', t);
  const s = params.toString();
  return s ? `?${s}` : '';
}

export function isEmptyState({ q, cat, tags }: SearchState): boolean {
  return !q.trim() && cat === null && tags.length === 0;
}

export function toggleTag(state: SearchState, tag: string): SearchState {
  const tags = state.tags.includes(tag)
    ? state.tags.filter((t) => t !== tag)
    : [...state.tags, tag].slice(0, TAGS_MAX);
  return { ...state, tags };
}

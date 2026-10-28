// Favorites and copy history (SPEC §2.8), kept in this browser only.
// This is the single layer that touches their storage, so v2 can add a
// server sync without changing the UI. Every access is guarded: the site
// works when storage is blocked or full (lists are then empty, writes fail).
// Stored data and imported files are untrusted: entries are re-validated on
// every read.

export const FAVORITES_KEY = 'gmiyc:v1:favorites';
export const HISTORY_KEY = 'gmiyc:v1:history';
export const FAVORITES_MAX = 500;
export const HISTORY_MAX = 100;
export const IMPORT_MAX_BYTES = 1_000_000;

const EXPORT_FORMAT = 'grepmeifyoucan';
const EXPORT_VERSION = 1;
const PROBE_KEY = 'gmiyc:v1:probe';

/** Same rule as a card id in src/content/schema.ts (kebab-case, 80 chars max). */
const CARD_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CARD_ID_MAX = 80;

export function isCardId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= CARD_ID_MAX && CARD_ID.test(value);
}

/** A card id and when it was added (favorites) or last copied (history), in ms. */
export interface Entry {
  id: string;
  at: number;
}

export type StoreList = 'favorites' | 'history';
export type StoreStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type ToggleResult = 'added' | 'removed' | 'full' | 'invalid' | 'failed';
export type ImportResult =
  | { ok: true; favorites: number; history: number; skipped: number }
  | { ok: false; error: string };

export interface StoreOptions {
  /** Returns the storage; may throw (even reading `localStorage` can). */
  storage?: () => StoreStorage;
  now?: () => number;
  /** Called after a list changed, so the UI can refresh. */
  notify?: (list: StoreList) => void;
}

const LISTS: Record<StoreList, { key: string; max: number }> = {
  favorites: { key: FAVORITES_KEY, max: FAVORITES_MAX },
  history: { key: HISTORY_KEY, max: HISTORY_MAX },
};

const NOT_SAVED = 'Could not save: browser storage is unavailable.';

/** Keeps valid entries only, once per id (first wins), at most `max`. */
function cleanEntries(value: unknown, max: number): Entry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: Entry[] = [];
  for (const item of value) {
    if (out.length >= max) break;
    if (typeof item !== 'object' || item === null) continue;
    const { id, at } = item as Record<string, unknown>;
    if (!isCardId(id) || typeof at !== 'number' || !Number.isFinite(at) || at < 0 || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, at });
  }
  return out;
}

/** Union of two lists, newest date per id, newest first, at most `max`. */
function merge(current: Entry[], incoming: Entry[], max: number): Entry[] {
  const byId = new Map<string, number>();
  for (const { id, at } of [...current, ...incoming]) byId.set(id, Math.max(at, byId.get(id) ?? at));
  return [...byId]
    .map(([id, at]) => ({ id, at }))
    .sort((a, b) => b.at - a.at)
    .slice(0, max);
}

export function createStore(options: StoreOptions = {}) {
  const {
    storage = () => globalThis.localStorage,
    now = Date.now,
    notify = () => {},
  } = options;

  function read(list: StoreList): Entry[] {
    const { key, max } = LISTS[list];
    try {
      const raw = storage().getItem(key);
      return raw === null ? [] : cleanEntries(JSON.parse(raw), max);
    } catch {
      return [];
    }
  }

  function write(list: StoreList, entries: Entry[]): boolean {
    try {
      storage().setItem(LISTS[list].key, JSON.stringify(entries));
    } catch {
      return false;
    }
    notify(list);
    return true;
  }

  return {
    /** False when the browser blocks storage or it is full. */
    available(): boolean {
      try {
        storage().setItem(PROBE_KEY, '1');
        storage().removeItem(PROBE_KEY);
        return true;
      } catch {
        return false;
      }
    },

    favorites: (): Entry[] => read('favorites'),
    history: (): Entry[] => read('history'),

    isFavorite(id: string): boolean {
      return read('favorites').some((e) => e.id === id);
    },

    toggleFavorite(id: string): ToggleResult {
      if (!isCardId(id)) return 'invalid';
      const list = read('favorites');
      const rest = list.filter((e) => e.id !== id);
      if (rest.length < list.length) return write('favorites', rest) ? 'removed' : 'failed';
      if (list.length >= FAVORITES_MAX) return 'full';
      return write('favorites', [{ id, at: now() }, ...list]) ? 'added' : 'failed';
    },

    /** Records a copy: the card moves to the top, the oldest entries go past the limit. */
    addHistory(id: string): boolean {
      if (!isCardId(id)) return false;
      const rest = read('history').filter((e) => e.id !== id);
      return write('history', [{ id, at: now() }, ...rest].slice(0, HISTORY_MAX));
    },

    clearHistory(): boolean {
      try {
        storage().removeItem(HISTORY_KEY);
      } catch {
        return false;
      }
      notify('history');
      return true;
    },

    exportData(): string {
      const data = {
        format: EXPORT_FORMAT,
        version: EXPORT_VERSION,
        exportedAt: new Date(now()).toISOString(),
        favorites: read('favorites'),
        history: read('history'),
      };
      return `${JSON.stringify(data, null, 2)}\n`;
    },

    /** Merges an export into the current lists. Nothing is written when the file is refused. */
    importData(text: string): ImportResult {
      if (text.length > IMPORT_MAX_BYTES) return { ok: false, error: 'This file is too large (1 MB max).' };
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        return { ok: false, error: 'This file is not valid JSON.' };
      }
      if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        return { ok: false, error: 'This file is not a GrepMeIfYouCan export.' };
      }
      const { format, version, favorites, history } = data as Record<string, unknown>;
      if (format !== EXPORT_FORMAT) return { ok: false, error: 'This file is not a GrepMeIfYouCan export.' };
      if (version !== EXPORT_VERSION) {
        return { ok: false, error: `This export version (${String(version)}) is not supported.` };
      }
      if (!Array.isArray(favorites) || !Array.isArray(history)) {
        return { ok: false, error: 'This export is damaged: favorites and history must be lists.' };
      }

      const result = { ok: true as const, favorites: 0, history: 0, skipped: 0 };
      const merged: [StoreList, Entry[]][] = [];
      for (const [list, incoming] of [
        ['favorites', favorites],
        ['history', history],
      ] as const) {
        const current = read(list);
        const known = new Set(current.map((e) => e.id));
        // No cap on the imported entries themselves: the merge applies the limit.
        const entries = cleanEntries(incoming, Infinity);
        const next = merge(current, entries, LISTS[list].max);
        const kept = new Set(next.map((e) => e.id));
        const added = new Set(entries.map((e) => e.id).filter((id) => !known.has(id))).size;
        result[list] = next.filter((e) => !known.has(e.id)).length;
        // Entries over the limit, imported or already there (the oldest go).
        result.skipped += added - result[list] + current.filter((e) => !kept.has(e.id)).length;
        merged.push([list, next]);
      }
      try {
        for (const [list, next] of merged) storage().setItem(LISTS[list].key, JSON.stringify(next));
      } catch {
        return { ok: false, error: NOT_SAVED };
      }
      for (const [list] of merged) notify(list);
      return result;
    },
  };
}

export type Store = ReturnType<typeof createStore>;

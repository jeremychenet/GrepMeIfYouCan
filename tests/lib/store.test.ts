import { describe, expect, it, vi } from 'vitest';
import { commandSchema } from '../../src/content/schema';
import {
  FAVORITES_KEY,
  FAVORITES_MAX,
  HISTORY_KEY,
  HISTORY_MAX,
  IMPORT_MAX_BYTES,
  createStore,
  isCardId,
  type Entry,
  type StoreStorage,
} from '../../src/lib/store';

function memory(initial: Record<string, string> = {}): StoreStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

function setup(initial: Record<string, string> = {}) {
  const storage = memory(initial);
  let t = 1000;
  const notify = vi.fn();
  const store = createStore({ storage: () => storage, now: () => ++t, notify });
  return { storage, store, notify };
}

const throwing: StoreStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

const entries = (n: number, prefix = 'card'): Entry[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${i}`, at: 10_000 - i }));

const exported = (favorites: unknown, history: unknown = [], extra: object = {}) =>
  JSON.stringify({ format: 'grepmeifyoucan', version: 1, favorites, history, ...extra });

describe('isCardId', () => {
  const card = {
    id: 'x',
    title: 'List files',
    description: 'Lists the files of a folder.',
    command: 'ls -la',
    tool: 'ls',
    category: 'linux',
    tags: ['files'],
    danger: 'safe',
    source: { type: 'original' },
  };

  it.each(['find-files', 'a', 'k8s-get-pods', 'constructor', 'x'.repeat(80), '', 'Find', '-a', 'a-', 'a--b', 'a_b', 'x'.repeat(81), '__proto__'])(
    'agrees with the content schema on %j',
    (id) => {
      expect(isCardId(id)).toBe(commandSchema.safeParse({ ...card, id }).success);
    },
  );

  it('refuses non-strings', () => {
    for (const id of [1, null, undefined, {}]) expect(isCardId(id)).toBe(false);
  });
});

describe('favorites', () => {
  it('starts empty, adds newest first, removes, and persists', () => {
    const { store, storage, notify } = setup();
    expect(store.favorites()).toEqual([]);
    expect(store.toggleFavorite('a')).toBe('added');
    expect(store.toggleFavorite('b')).toBe('added');
    expect(store.favorites().map((e) => e.id)).toEqual(['b', 'a']);
    expect(store.isFavorite('a')).toBe(true);
    expect(notify).toHaveBeenLastCalledWith('favorites');

    expect(store.toggleFavorite('a')).toBe('removed');
    expect(store.isFavorite('a')).toBe(false);
    expect(JSON.parse(storage.data.get(FAVORITES_KEY)!)).toEqual([{ id: 'b', at: 1002 }]);

    const again = createStore({ storage: () => storage });
    expect(again.favorites()).toEqual([{ id: 'b', at: 1002 }]);
  });

  it(`refuses a new favorite past ${FAVORITES_MAX}, but still removes`, () => {
    const { store, notify } = setup({ [FAVORITES_KEY]: JSON.stringify(entries(FAVORITES_MAX)) });
    expect(store.toggleFavorite('new-one')).toBe('full');
    expect(notify).not.toHaveBeenCalled();
    expect(store.favorites()).toHaveLength(FAVORITES_MAX);
    expect(store.toggleFavorite('card-3')).toBe('removed');
    expect(store.toggleFavorite('new-one')).toBe('added');
  });

  it('refuses an invalid id', () => {
    const { store } = setup();
    expect(store.toggleFavorite('Not An Id')).toBe('invalid');
    expect(store.isFavorite('Not An Id')).toBe(false);
  });

  it('handles an id named like an Object.prototype key', () => {
    const { store } = setup();
    expect(store.isFavorite('constructor')).toBe(false);
    expect(store.toggleFavorite('constructor')).toBe('added');
    expect(store.isFavorite('constructor')).toBe(true);
  });
});

describe('history', () => {
  it('keeps copied cards newest first, moving a copied-again card to the top', () => {
    const { store, notify } = setup();
    expect(store.addHistory('a')).toBe(true);
    store.addHistory('b');
    store.addHistory('a');
    expect(store.history()).toEqual([
      { id: 'a', at: 1003 },
      { id: 'b', at: 1002 },
    ]);
    expect(notify).toHaveBeenLastCalledWith('history');
  });

  it(`keeps the last ${HISTORY_MAX} entries (FIFO)`, () => {
    const { store, storage } = setup();
    for (let i = 0; i < HISTORY_MAX + 5; i++) store.addHistory(`c-${i}`);
    const ids = store.history().map((e) => e.id);
    expect(ids).toHaveLength(HISTORY_MAX);
    expect(ids[0]).toBe(`c-${HISTORY_MAX + 4}`);
    expect(ids).not.toContain('c-4');
    expect(ids).toContain('c-5');
    expect(JSON.parse(storage.data.get(HISTORY_KEY)!)).toHaveLength(HISTORY_MAX);
  });

  it('ignores an invalid id', () => {
    const { store } = setup();
    expect(store.addHistory('../x')).toBe(false);
    expect(store.history()).toEqual([]);
  });

  it('clears', () => {
    const { store, storage, notify } = setup();
    store.addHistory('a');
    expect(store.clearHistory()).toBe(true);
    expect(store.history()).toEqual([]);
    expect(storage.data.has(HISTORY_KEY)).toBe(false);
    expect(notify).toHaveBeenLastCalledWith('history');
  });
});

describe('reading stored data', () => {
  it.each([
    ['not JSON', '{oops'],
    ['not a list', '{"id":"a"}'],
    ['null', 'null'],
  ])('treats %s as empty', (_, raw) => {
    const { store } = setup({ [FAVORITES_KEY]: raw, [HISTORY_KEY]: raw });
    expect(store.favorites()).toEqual([]);
    expect(store.history()).toEqual([]);
  });

  it('drops invalid and duplicate entries, and caps the list', () => {
    const raw = JSON.stringify([
      { id: 'ok', at: 5 },
      { id: 'ok', at: 4 },
      { id: 'Bad Id', at: 3 },
      { id: 'no-date' },
      { id: 'nan', at: 'x' },
      { id: 'negative', at: -1 },
      { id: 'infinite', at: 1e400 },
      'string',
      null,
      { id: 'also-ok', at: 2, extra: true },
    ]);
    const { store } = setup({ [FAVORITES_KEY]: raw });
    expect(store.favorites()).toEqual([
      { id: 'ok', at: 5 },
      { id: 'also-ok', at: 2 },
    ]);

    const many = setup({ [HISTORY_KEY]: JSON.stringify(entries(HISTORY_MAX + 10)) });
    expect(many.store.history()).toHaveLength(HISTORY_MAX);
  });
});

describe('unavailable storage', () => {
  it.each([
    ['throws on every call', () => throwing],
    ['cannot even be reached', () => {
      throw new Error('SecurityError');
    }],
  ])('keeps working when storage %s', (_, getter) => {
    const notify = vi.fn();
    const store = createStore({ storage: getter as () => StoreStorage, notify });
    expect(store.available()).toBe(false);
    expect(store.favorites()).toEqual([]);
    expect(store.isFavorite('a')).toBe(false);
    expect(store.toggleFavorite('a')).toBe('failed');
    expect(store.addHistory('a')).toBe(false);
    expect(store.clearHistory()).toBe(false);
    expect(store.importData(exported([{ id: 'a', at: 1 }]))).toEqual({
      ok: false,
      error: 'Could not save: browser storage is unavailable.',
    });
    expect(JSON.parse(store.exportData())).toMatchObject({ favorites: [], history: [] });
    expect(notify).not.toHaveBeenCalled();
  });

  it('fails a removal that cannot be saved', () => {
    const storage = memory({ [FAVORITES_KEY]: JSON.stringify([{ id: 'a', at: 1 }]) });
    storage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    const store = createStore({ storage: () => storage });
    expect(store.available()).toBe(false);
    expect(store.toggleFavorite('a')).toBe('failed');
    expect(store.isFavorite('a')).toBe(true);
  });

  it('reports available storage', () => {
    const { store, storage } = setup();
    expect(store.available()).toBe(true);
    expect(storage.data.size).toBe(0);
  });

  it('uses localStorage by default', () => {
    vi.stubGlobal('localStorage', memory());
    try {
      const store = createStore();
      expect(store.toggleFavorite('a')).toBe('added');
      expect(globalThis.localStorage.getItem(FAVORITES_KEY)).toContain('"a"');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('export / import', () => {
  it('round-trips into an empty browser', () => {
    const a = setup();
    a.store.toggleFavorite('fav-1');
    a.store.toggleFavorite('fav-2');
    a.store.addHistory('copied-1');
    const json = a.store.exportData();
    expect(JSON.parse(json)).toMatchObject({ format: 'grepmeifyoucan', version: 1 });

    const b = setup();
    expect(b.store.importData(json)).toEqual({ ok: true, favorites: 2, history: 1, skipped: 0 });
    expect(b.store.favorites()).toEqual(a.store.favorites());
    expect(b.store.history()).toEqual(a.store.history());
    expect(b.notify).toHaveBeenCalledWith('favorites');
    expect(b.notify).toHaveBeenCalledWith('history');
  });

  it('merges with existing data, keeping the newest date of each card', () => {
    const { store } = setup({
      [FAVORITES_KEY]: JSON.stringify([
        { id: 'mine', at: 50 },
        { id: 'both', at: 10 },
      ]),
      [HISTORY_KEY]: JSON.stringify([{ id: 'h', at: 5 }]),
    });
    const result = store.importData(
      exported(
        [
          { id: 'both', at: 20 },
          { id: 'theirs', at: 30 },
        ],
        [{ id: 'h', at: 1 }],
      ),
    );
    expect(result).toEqual({ ok: true, favorites: 1, history: 0, skipped: 0 });
    expect(store.favorites()).toEqual([
      { id: 'mine', at: 50 },
      { id: 'theirs', at: 30 },
      { id: 'both', at: 20 },
    ]);
    expect(store.history()).toEqual([{ id: 'h', at: 5 }]);
  });

  it('keeps the newest entries when the merge goes past the limits', () => {
    const { store } = setup({ [FAVORITES_KEY]: JSON.stringify(entries(FAVORITES_MAX, 'old')) });
    const newer = Array.from({ length: 10 }, (_, i) => ({ id: `new-${i}`, at: 20_000 + i }));
    const result = store.importData(exported(newer));
    expect(result).toEqual({ ok: true, favorites: 10, history: 0, skipped: 10 });
    const ids = store.favorites().map((e) => e.id);
    expect(ids).toHaveLength(FAVORITES_MAX);
    expect(ids[0]).toBe('new-9');
    expect(ids).not.toContain(`old-${FAVORITES_MAX - 1}`);
  });

  it('skips invalid entries of a valid export', () => {
    const { store } = setup();
    const result = store.importData(exported([{ id: 'ok', at: 1 }, { id: 'Bad', at: 2 }, 3]));
    expect(result).toEqual({ ok: true, favorites: 1, history: 0, skipped: 0 });
  });

  it.each([
    ['malformed JSON', '{"format":', 'This file is not valid JSON.'],
    ['an array', '[]', 'This file is not a GrepMeIfYouCan export.'],
    ['null', 'null', 'This file is not a GrepMeIfYouCan export.'],
    ['another format', JSON.stringify({ format: 'other', version: 1, favorites: [], history: [] }), 'This file is not a GrepMeIfYouCan export.'],
    ['another version', exported([], [], { version: 2 }), 'This export version (2) is not supported.'],
    ['missing lists', JSON.stringify({ format: 'grepmeifyoucan', version: 1 }), 'This export is damaged: favorites and history must be lists.'],
    ['lists of the wrong type', exported('a', []), 'This export is damaged: favorites and history must be lists.'],
    ['a too large file', ' '.repeat(IMPORT_MAX_BYTES + 1), 'This file is too large (1 MB max).'],
  ])('refuses %s with a clear message', (_, text, error) => {
    const { store, notify } = setup({ [FAVORITES_KEY]: JSON.stringify([{ id: 'kept', at: 1 }]) });
    expect(store.importData(text)).toEqual({ ok: false, error });
    expect(store.favorites()).toEqual([{ id: 'kept', at: 1 }]);
    expect(notify).not.toHaveBeenCalled();
  });
});

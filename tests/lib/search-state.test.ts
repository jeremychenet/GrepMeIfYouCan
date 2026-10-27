import { describe, expect, it } from 'vitest';
import {
  EMPTY_STATE,
  QUERY_MAX,
  isEmptyState,
  parseState,
  serializeState,
  toggleTag,
} from '../../src/lib/search-state';

describe('parseState', () => {
  it('reads the query, category and tags', () => {
    expect(parseState('?q=large+files&cat=linux&tag=disk&tag=find')).toEqual({
      q: 'large files',
      cat: 'linux',
      tags: ['disk', 'find'],
    });
  });

  it('returns the empty state for an empty URL', () => {
    expect(parseState('')).toEqual(EMPTY_STATE);
  });

  it('drops unknown categories and malformed or duplicate tags', () => {
    expect(parseState('?cat=windows&tag=Disk&tag=a%20b&tag=ok&tag=ok&tag=<x>')).toEqual({
      q: '',
      cat: null,
      tags: ['ok'],
    });
  });

  it('caps the query length and the number of tags', () => {
    const long = 'a'.repeat(QUERY_MAX + 50);
    const tags = Array.from({ length: 12 }, (_, i) => `tag=t${i}`).join('&');
    const s = parseState(`?q=${long}&${tags}`);
    expect(s.q).toHaveLength(QUERY_MAX);
    expect(s.tags).toHaveLength(8);
  });
});

describe('serializeState', () => {
  it('writes spaces as "+" and repeats tag', () => {
    expect(serializeState({ q: 'large files', cat: 'linux', tags: ['disk', 'find'] })).toBe(
      '?q=large+files&cat=linux&tag=disk&tag=find',
    );
  });

  it('returns "" for the empty state and skips a blank query', () => {
    expect(serializeState(EMPTY_STATE)).toBe('');
    expect(serializeState({ q: '   ', cat: 'git-ci', tags: [] })).toBe('?cat=git-ci');
  });

  it('round-trips through parseState', () => {
    const state = { q: 'a&b=c #d', cat: 'cloud-iac' as const, tags: ['x-y'] };
    expect(parseState(serializeState(state))).toEqual(state);
  });
});

describe('isEmptyState', () => {
  it('is true only without query, category and tags', () => {
    expect(isEmptyState(EMPTY_STATE)).toBe(true);
    expect(isEmptyState({ ...EMPTY_STATE, q: '  ' })).toBe(true);
    expect(isEmptyState({ ...EMPTY_STATE, q: 'x' })).toBe(false);
    expect(isEmptyState({ ...EMPTY_STATE, cat: 'linux' })).toBe(false);
    expect(isEmptyState({ ...EMPTY_STATE, tags: ['x'] })).toBe(false);
  });
});

describe('toggleTag', () => {
  it('adds a missing tag and removes a present one', () => {
    const added = toggleTag(EMPTY_STATE, 'disk');
    expect(added.tags).toEqual(['disk']);
    expect(toggleTag(added, 'disk').tags).toEqual([]);
  });

  it('never keeps more than 8 tags', () => {
    const full = { ...EMPTY_STATE, tags: Array.from({ length: 8 }, (_, i) => `t${i}`) };
    expect(toggleTag(full, 'extra').tags).toHaveLength(8);
  });
});

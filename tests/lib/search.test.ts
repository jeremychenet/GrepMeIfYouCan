import { describe, expect, it } from 'vitest';
import type { Command } from '../../src/content/schema';
import { validateEntries } from '../../src/content/validate';
import { createSearch, matchesFilters, maxTypos, toSearchDoc, type SearchDoc } from '../../src/lib/search';
import { readEntries } from '../../scripts/validate-content';

function loadDocs(): SearchDoc[] {
  const { entries } = readEntries('content/commands');
  return validateEntries(entries).commands.map(toSearchDoc);
}

const docs = loadDocs();
const engine = createSearch(docs);
const none = { cat: null, tags: [] };
const ids = (query: string, filters = none) => engine.search(query, filters).map((d) => d.id);

const doc = (over: Partial<SearchDoc>): SearchDoc => ({
  id: 'x',
  title: 'Untitled',
  description: 'Nothing.',
  command: 'true',
  tool: 'sh',
  category: 'linux',
  tags: ['misc'],
  danger: 'safe',
  ...over,
});

describe('relevance (SPEC §8.2: the right card is in the top 3)', () => {
  const cases: [query: string, id: string][] = [
    ['large files', 'find-files-larger-than'],
    ['restart service', 'systemctl-restart-service'],
    ['delete pod', 'kubectl-delete-pod'],
    ['undo last commit', 'git-undo-commit'],
    ['terraform plan', 'terraform-plan'],
    ['list open ports', 'ss-listening'],
    ['larg fles', 'find-files-larger-than'],
    // A typo in every word: prefix search alone cannot find these.
    ['restrat sevrice', 'systemctl-restart-service'],
    ['kubetcl delte pod', 'kubectl-delete-pod'],
    ['undo lsat comit', 'git-undo-commit'],
  ];

  it.each(cases)('"%s" -> %s', (query, id) => {
    expect(docs.some((d) => d.id === id)).toBe(true);
    expect(ids(query).slice(0, 3)).toContain(id);
  });
});

describe('createSearch', () => {
  it('matches word prefixes', () => {
    expect(ids('terra').length).toBeGreaterThan(0);
    expect(ids('terra').every((id) => docs.find((d) => d.id === id)!.tool === 'terraform')).toBe(true);
  });

  it('indexes tags, commands and descriptions', () => {
    const e = createSearch([
      doc({ id: 'by-tag', tags: ['zebra-stripes'] }),
      doc({ id: 'by-command', command: 'quokka --fast' }),
      doc({ id: 'by-description', description: 'Feeds the wombat.' }),
    ]);
    expect(e.search('stripes', none).map((d) => d.id)).toEqual(['by-tag']);
    expect(e.search('quokka', none).map((d) => d.id)).toEqual(['by-command']);
    expect(e.search('wombat', none).map((d) => d.id)).toEqual(['by-description']);
  });

  it('ranks a title match above a description match', () => {
    const e = createSearch([
      doc({ id: 'desc', title: 'Other', description: 'Mentions rotate here.' }),
      doc({ id: 'title', title: 'Rotate logs', description: 'Does it.' }),
    ]);
    expect(e.search('rotate', none).map((d) => d.id)).toEqual(['title', 'desc']);
  });

  it('ranks cards matching every word before cards matching any word', () => {
    const e = createSearch([
      doc({ id: 'one', title: 'Alpha alpha alpha' }),
      doc({ id: 'both', title: 'Alpha beta' }),
      doc({ id: 'other', title: 'Gamma' }),
    ]);
    expect(e.search('alpha beta', none).map((d) => d.id)).toEqual(['both', 'one']);
    // "xyzzy" matches nothing, so no card has every word: any-word matches remain.
    expect(e.search('alpha xyzzy', none).map((d) => d.id)).toEqual(['one', 'both']);
  });

  it('returns nothing for a query that matches no card', () => {
    expect(ids('qwxzvbnmplk')).toEqual([]);
  });

  it('combines the query with category and tag filters', () => {
    const cat = engine.search('list', { cat: 'containers', tags: [] });
    expect(cat.length).toBeGreaterThan(0);
    expect(cat.every((d) => d.category === 'containers')).toBe(true);

    const tag = docs[0]!.tags[0]!;
    const tagged = engine.search('', { cat: null, tags: [tag] });
    expect(tagged.length).toBeGreaterThan(0);
    expect(tagged.every((d) => d.tags.includes(tag))).toBe(true);
  });

  it('lists every filtered card by title when the query is empty', () => {
    const all = engine.search('  ', { cat: 'git-ci', tags: [] });
    expect(all.length).toBe(docs.filter((d) => d.category === 'git-ci').length);
    const titles = all.map((d) => d.title);
    expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
  });

  it('sorts equal titles by id', () => {
    const e = createSearch([
      doc({ id: 'b', title: 'Same' }),
      doc({ id: 'a', title: 'same' }),
    ]);
    expect(e.search('', none).map((d) => d.id)).toEqual(['a', 'b']);
  });
});

describe('maxTypos', () => {
  it('allows no typo up to 3 letters, 1 up to 6, then 2', () => {
    expect(['ls', 'tar'].map(maxTypos)).toEqual([0, 0]);
    expect(['pods', 'commit'].map(maxTypos)).toEqual([1, 1]);
    expect(['restart', 'terraform'].map(maxTypos)).toEqual([2, 2]);
  });
});

describe('matchesFilters', () => {
  const first = docs[0]!;
  it('needs the category and every tag', () => {
    expect(matchesFilters(first, { cat: first.category, tags: first.tags })).toBe(true);
    expect(matchesFilters(first, { cat: null, tags: [...first.tags, 'not-a-tag'] })).toBe(false);
    const other = first.category === 'linux' ? 'git-ci' : 'linux';
    expect(matchesFilters(first, { cat: other, tags: [] })).toBe(false);
  });
});

describe('toSearchDoc', () => {
  it('keeps only the fields the results list needs', () => {
    const card: Command = {
      id: 'a',
      title: 'A',
      description: 'Does a.',
      command: 'a',
      tool: 'a',
      category: 'linux',
      tags: ['a'],
      danger: 'caution',
      platforms: ['linux'],
      source: { type: 'original' },
    };
    expect(toSearchDoc(card)).toEqual({
      id: 'a',
      title: 'A',
      description: 'Does a.',
      command: 'a',
      tool: 'a',
      category: 'linux',
      tags: ['a'],
      danger: 'caution',
    });
  });
});

describe('performance (SPEC §8.3: < 50 ms on ~1000 cards)', () => {
  const WORDS = 'list show delete restart copy find large files service pod image volume network port user disk log process archive branch commit'.split(' ');
  const TOOLS = ['ls', 'find', 'kubectl', 'docker', 'git', 'terraform', 'systemctl', 'tar', 'ss', 'aws'];
  const CATS = ['linux', 'containers', 'cloud-iac', 'git-ci'] as const;
  const pick = (i: number, n: number) => WORDS[(i * 7 + n * 13) % WORDS.length]!;

  const generated: SearchDoc[] = Array.from({ length: 1000 }, (_, i) => ({
    id: `card-${i}`,
    title: `${pick(i, 1)} ${pick(i, 2)} ${pick(i, 3)} ${i}`,
    description: `Does ${pick(i, 4)} ${pick(i, 5)} with ${pick(i, 6)} and ${pick(i, 7)} options.`,
    command: `${TOOLS[i % TOOLS.length]} --${pick(i, 8)} {{${pick(i, 9)}}} {{path:.}}`,
    tool: TOOLS[i % TOOLS.length]!,
    category: CATS[i % CATS.length]!,
    tags: [pick(i, 10), pick(i, 11)].filter((t, k, a) => a.indexOf(t) === k),
    danger: 'safe',
  }));

  it('answers a query in under 50 ms (median of 50 runs)', () => {
    const e = createSearch(generated);
    const queries = ['large files', 'restart service', 'delet pod', 'li', 'git commit branch'];
    const times: number[] = [];
    for (let run = 0; run < 50; run++) {
      const start = performance.now();
      e.search(queries[run % queries.length]!, { cat: run % 2 ? 'linux' : null, tags: [] });
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    expect(times[25]!).toBeLessThan(50);
  });
});

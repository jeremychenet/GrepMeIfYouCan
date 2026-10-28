import { describe, expect, it } from 'vitest';
import type { Command } from '../../src/content/schema';
import {
  CATEGORY_LABELS,
  cardPath,
  categoryPageMeta,
  categoryPath,
  expectedPages,
  groupBy,
  sortByTitle,
  sourceUrl,
  toolPageMeta,
  tagSearchPath,
  toolPath,
} from '../../src/lib/pages';

function card(over: Partial<Command>): Command {
  return {
    id: 'x',
    title: 'X',
    description: 'Does x.',
    command: 'x',
    tool: 'x',
    category: 'linux',
    tags: ['x'],
    danger: 'safe',
    source: { type: 'original' },
    ...over,
  };
}

const cards = [
  card({ id: 'b', title: 'Beta', tool: 'git', category: 'git-ci' }),
  card({ id: 'a', title: 'alpha', tool: 'git', category: 'git-ci' }),
  card({ id: 'c', title: 'Gamma', tool: 'ls', category: 'linux' }),
];

describe('paths', () => {
  it('builds the public URLs without trailing slash', () => {
    expect(cardPath('chmod-executable')).toBe('/c/chmod-executable');
    expect(toolPath('kubectl')).toBe('/tools/kubectl');
    expect(tagSearchPath('large-files')).toBe('/?tag=large-files');
    expect(categoryPath('cloud-iac')).toBe('/categories/cloud-iac');
  });

  it('labels every category', () => {
    expect(CATEGORY_LABELS).toEqual({
      linux: 'Linux',
      containers: 'Containers',
      'cloud-iac': 'Cloud & IaC',
      'git-ci': 'Git & CI',
    });
  });
});

describe('sortByTitle / groupBy', () => {
  it('sorts by title, case-insensitively, without mutating the input', () => {
    expect(sortByTitle(cards).map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(cards.map((c) => c.id)).toEqual(['b', 'a', 'c']);
  });

  it('groups by key, keys sorted, cards sorted by title', () => {
    const groups = groupBy(cards, (c) => c.tool);
    expect([...groups.keys()]).toEqual(['git', 'ls']);
    expect(groups.get('git')!.map((c) => c.id)).toEqual(['a', 'b']);
  });
});

describe('page meta', () => {
  it('describes a tool page with its count and first titles', () => {
    const meta = toolPageMeta('git', cards.slice(0, 2));
    expect(meta.title).toBe('git commands');
    expect(meta.description).toBe('2 ready-to-copy git commands: alpha, Beta.');
  });

  it('uses the singular for a single command', () => {
    expect(toolPageMeta('ls', [cards[2]!]).description).toBe('1 ready-to-copy ls command: Gamma.');
  });

  it('keeps descriptions under 160 characters', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      card({ id: `c${i}`, title: `A rather long command title number ${i}` }),
    );
    const meta = categoryPageMeta('linux', many);
    expect(meta.title).toBe('Linux commands');
    expect(meta.description.length).toBeLessThanOrEqual(160);
    expect(meta.description.startsWith('30 ready-to-copy Linux commands: ')).toBe(true);
    expect(meta.description.endsWith(String.fromCodePoint(0x2026))).toBe(true);
  });
});

describe('sourceUrl', () => {
  it('links a tldr card to the page at the pinned commit', () => {
    const c = card({
      source: {
        type: 'tldr',
        page: 'common/chmod.md',
        commit: 'd7b9f2143e12f36efd46a71a08645e2392dc9c0f',
        license: 'CC-BY-4.0',
      },
    });
    expect(sourceUrl(c)).toBe(
      'https://github.com/tldr-pages/tldr/blob/d7b9f2143e12f36efd46a71a08645e2392dc9c0f/pages/common/chmod.md',
    );
  });

  it('returns null for original content', () => {
    expect(sourceUrl(card({}))).toBeNull();
  });
});

describe('expectedPages', () => {
  it('lists home, the static pages, one page per card, per tool and per category', () => {
    expect(expectedPages(cards)).toEqual([
      '/',
      '/about',
      '/c/a',
      '/c/b',
      '/c/c',
      '/categories/git-ci',
      '/categories/linux',
      '/favorites',
      '/history',
      '/privacy',
      '/tools/git',
      '/tools/ls',
    ]);
  });
});

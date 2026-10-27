import { describe, expect, it } from 'vitest';
import { commandSchema, countSentences, DESCRIPTION_MAX } from '../../src/content/schema';

const valid = {
  id: 'find-files-larger-than',
  title: 'Find files larger than a given size',
  description: 'Recursively lists regular files bigger than the given size under a directory.',
  command: 'find {{path:/}} -type f -size +{{size:1G}}',
  tool: 'find',
  category: 'linux',
  tags: ['disk', 'files'],
  danger: 'safe',
  source: { type: 'original' },
};

/** Returns the error messages for `data`, keyed by field path. */
function errorsFor(data: unknown): Record<string, string[]> {
  const result = commandSchema.safeParse(data);
  if (result.success) return {};
  const out: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '(root)';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

describe('commandSchema', () => {
  it('accepts a valid original card', () => {
    expect(errorsFor(valid)).toEqual({});
  });

  it('accepts a valid tldr card with platforms', () => {
    expect(
      errorsFor({
        ...valid,
        platforms: ['linux', 'macos'],
        source: { type: 'tldr', page: 'common/find.md', commit: 'a'.repeat(40), license: 'CC-BY-4.0' },
      }),
    ).toEqual({});
  });

  describe('description', () => {
    it('is required', () => {
      expect(errorsFor({ ...valid, description: '   ' }).description).toContain('is required');
      expect(errorsFor({ ...valid, description: undefined }).description).toBeDefined();
    });

    it(`accepts exactly ${DESCRIPTION_MAX} characters and rejects more`, () => {
      const at = 'a'.repeat(DESCRIPTION_MAX - 1) + '.';
      expect(errorsFor({ ...valid, description: at })).toEqual({});
      expect(errorsFor({ ...valid, description: at + 'a' }).description).toContain(
        `must be at most ${DESCRIPTION_MAX} characters`,
      );
    });

    it('must be a single sentence', () => {
      expect(errorsFor({ ...valid, description: 'Lists big files. Hides errors.' }).description).toContain(
        'must be a single sentence',
      );
    });

    it('must not repeat the title (case and final punctuation ignored)', () => {
      expect(errorsFor({ ...valid, description: 'find files LARGER than a given size.' }).description).toContain(
        'must explain what the command does, not repeat the title',
      );
    });
  });

  it.each([
    ['id', { id: 'Not_Kebab' }],
    ['id', { id: 'a'.repeat(81) }],
    ['title', { title: '' }],
    ['title', { title: 'a'.repeat(81) }],
    ['command', { command: ' ' }],
    ['tool', { tool: 'Find' }],
    ['category', { category: 'windows' }],
    ['danger', { danger: 'dangerous' }],
    ['tags', { tags: [] }],
    ['tags', { tags: ['disk', 'disk'] }],
    ['tags.0', { tags: ['Disk'] }],
    ['tags', { tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] }],
    ['platforms.0', { platforms: ['windows'] }],
    ['source.commit', { source: { type: 'tldr', page: 'common/find.md', commit: 'abc', license: 'CC-BY-4.0' } }],
    ['source.page', { source: { type: 'tldr', page: 'find', commit: 'a'.repeat(40), license: 'CC-BY-4.0' } }],
    ['source.license', { source: { type: 'tldr', page: 'common/find.md', commit: 'a'.repeat(40), license: 'MIT' } }],
    ['source.type', { source: { type: 'blog' } }],
  ])('rejects an invalid %s', (field, patch) => {
    expect(errorsFor({ ...valid, ...patch })[field]).toBeDefined();
  });

  it('rejects unknown fields', () => {
    expect(Object.keys(errorsFor({ ...valid, author: 'me' }))).toHaveLength(1);
  });
});

describe('countSentences', () => {
  it.each([
    ['Lists files.', 1],
    ['Lists files', 1],
    ['Lists files, e.g. logs under /var.', 1],
    ['Upgrades to v1.2 safely.', 1],
    ['Lists files. Shows sizes.', 2],
    ['Really? Yes! Done.', 3],
  ])('%s → %i', (text, n) => {
    expect(countSentences(text)).toBe(n);
  });
});

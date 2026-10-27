import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import {
  buildDrafts,
  cachedReader,
  cleanTitle,
  cli,
  convertCommand,
  DEFAULTS,
  loadSelection,
  main,
  makeId,
  parsePage,
  readPublished,
  renderDraft,
  writeDrafts,
  type Card,
  type Selection,
} from '../../scripts/import-tldr';
import { DEFAULT_ROOT } from '../../scripts/validate-content';
import { checkSafety } from '../../src/content/validate';

const FIXTURES = 'tests/fixtures/tldr';
const SHA = 'a'.repeat(40);
const readFixture = async (page: string) => readFileSync(join(FIXTURES, page), 'utf8');

const selection = (pages: Selection['categories']['linux'], category: 'linux' | 'containers' = 'linux'): Selection => ({
  tldr: { repo: 'tldr-pages/tldr', commit: SHA },
  categories: { linux: [], containers: [], 'cloud-iac': [], 'git-ci': [], [category]: pages },
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'import-tldr-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('parsePage', () => {
  it('extracts every example with its 1-based number, title and command', async () => {
    const examples = parsePage(await readFixture('common/demo.md'));
    expect(examples).toHaveLength(8);
    expect(examples[0]).toEqual({
      number: 1,
      title: 'List [a]ll files in a directory:',
      command: 'demo {{[-a|--all]}} {{path/to/directory}}',
    });
    expect(examples[7]!.number).toBe(8);
  });

  it('ignores the header, description and a dangling title', () => {
    expect(parsePage('# x\n\n> Desc `x`.\n\n- Orphan title:\n')).toEqual([]);
  });
});

describe('cleanTitle', () => {
  it('drops tldr mnemonics, backticks and the trailing colon', () => {
    expect(cleanTitle('E[x]tract a (compressed) archive [f]ile [v]erbosely:')).toBe('Extract a (compressed) archive file verbosely');
    expect(cleanTitle('Search for an exact string (disables `regex`es):')).toBe('Search for an exact string (disables regexes)');
  });

  it('capitalizes the first letter', () => {
    expect(cleanTitle('[c]reate an archive:')).toBe('Create an archive');
  });
});

describe('convertCommand', () => {
  it('keeps plain placeholders unchanged (tldr-compatible syntax)', () => {
    expect(convertCommand('find {{path/to/directory}} -name {{*.ext}}')).toEqual({
      ok: true,
      command: 'find {{path/to/directory}} -name {{*.ext}}',
      notes: [],
    });
  });

  it('writes the long form of [short|long] option placeholders', () => {
    expect(convertCommand('grep {{[-rI|--recursive --binary-files=without-match]}} {{pattern}}')).toMatchObject({
      command: 'grep --recursive --binary-files=without-match {{pattern}}',
    });
    expect(convertCommand('docker {{[ps|container ls]}}')).toMatchObject({ command: 'docker container ls' });
  });

  it('replaces ":" inside a placeholder so it is not read as a default value, with a review note', () => {
    expect(convertCommand('docker run {{image:tag}}')).toEqual({
      ok: true,
      command: 'docker run {{image_tag}}',
      notes: ['placeholder "{{image:tag}}" renamed "{{image_tag}}" (":" means a default value)'],
    });
  });

  it('turns a URL placeholder into a "url" variable with the URL as default value', () => {
    expect(convertCommand('curl {{https://example.com/a.zip}}')).toEqual({
      ok: true,
      command: 'curl {{url:https://example.com/a.zip}}',
      notes: [],
    });
  });

  it('skips commands with escaped or ambiguous braces', () => {
    expect(convertCommand('docker ps --format "\\{\\{.ID\\}\\}"')).toEqual({
      ok: false,
      reason: 'escaped braces (\\{\\{) cannot be written in {{…}} templates',
    });
    expect(convertCommand(`curl -d '{{{"a":1}}}'`)).toMatchObject({ ok: false, reason: expect.stringContaining('ambiguous') });
    expect(convertCommand('echo {{}} x')).toMatchObject({ ok: false, reason: expect.stringContaining('ambiguous') });
    expect(convertCommand('echo {{a x')).toMatchObject({ ok: false, reason: expect.stringContaining('ambiguous') });
  });
});

describe('makeId', () => {
  it('prefixes the tool unless the title already starts with it', () => {
    expect(makeId('git', 'Show unstaged changes')).toBe('git-show-unstaged-changes');
    expect(makeId('find', 'Find files by extension')).toBe('find-files-by-extension');
    expect(makeId('df', 'df')).toBe('df');
  });

  it('cuts long ids on a word boundary, at 60 characters max', () => {
    const id = makeId('rsync', 'Use archive mode (recursively copy directories, copy symlinks without resolving)');
    expect(id.length).toBeLessThanOrEqual(60);
    expect(id).toBe('rsync-use-archive-mode-recursively-copy-directories-copy');
    expect(makeId('x', 'a'.repeat(70))).toHaveLength(60);
  });
});

describe('buildDrafts', () => {
  const demo = { page: 'common/demo.md', tool: 'demo', tags: ['files'] };

  it('builds a complete draft card with the full tldr source block', async () => {
    const { drafts } = await buildDrafts(selection([{ ...demo, examples: [1] }]), readFixture);
    expect(drafts).toEqual([
      {
        category: 'linux',
        card: {
          id: 'demo-list-all-files-in-a-directory',
          title: 'List all files in a directory',
          description: '',
          command: 'demo --all {{path/to/directory}}',
          tool: 'demo',
          category: 'linux',
          tags: ['files'],
          danger: 'safe',
          source: { type: 'tldr', page: 'common/demo.md', commit: SHA, license: 'CC-BY-4.0' },
        },
      },
    ]);
  });

  it('prefills danger with suggestDanger()', async () => {
    const { drafts } = await buildDrafts(selection([{ ...demo, examples: [3] }]), readFixture);
    expect(drafts[0]!.card).toMatchObject({ command: 'rm --recursive --force {{path/to/directory}}', danger: 'destructive' });
  });

  it('reports skipped examples and review notes, and dedupes ids', async () => {
    const { drafts, skipped, notes } = await buildDrafts(selection([demo]), readFixture);
    expect(drafts.map((d) => d.card.id)).toEqual([
      'demo-list-all-files-in-a-directory',
      'demo-run-a-container-from-a-tagged-image',
      'demo-remove-a-directory-and-its-contents-recursively-use-dry',
      'demo-do-something-with-a-very-long-title-that-goes-on-and-on',
      'demo-list-all-files-in-a-directory-2',
    ]);
    expect(skipped).toEqual([
      { page: 'common/demo.md', number: 4, reason: expect.stringContaining('escaped braces') },
      { page: 'common/demo.md', number: 5, reason: expect.stringContaining('ambiguous') },
      { page: 'common/demo.md', number: 6, reason: 'command: unsafe characters: non-ascii U+00E9 at col 15' },
    ]);
    expect(notes).toEqual([
      { id: 'demo-run-a-container-from-a-tagged-image', note: expect.stringContaining('{{image_tag}}') },
      { id: 'demo-do-something-with-a-very-long-title-that-goes-on-and-on', note: 'title is 107 chars (max 80)' },
    ]);
  });

  it('marks linux/ pages as linux-only', async () => {
    const sel = selection([{ page: 'linux/demo-linux.md', tool: 'demo-linux', tags: ['services'] }]);
    const { drafts } = await buildDrafts(sel, readFixture);
    expect(drafts[0]!.card.platforms).toEqual(['linux']);
  });

  it('skips a title with invisible or bidi characters', async () => {
    const page = `- Show ${String.fromCodePoint(0x202e)}files:\n\n\`ls\`\n`;
    const { drafts, skipped } = await buildDrafts(selection([demo]), async () => page);
    expect(drafts).toEqual([]);
    expect(skipped).toEqual([{ page: 'common/demo.md', number: 1, reason: expect.stringMatching(/^title: unsafe characters: bidi/) }]);
  });

  it('fails on an example number the page does not have', async () => {
    await expect(buildDrafts(selection([{ ...demo, examples: [9] }]), readFixture)).rejects.toThrow(
      'common/demo.md: example 9 does not exist (the page has 8)',
    );
  });
});

describe('renderDraft', () => {
  it('writes YAML that reads back to the same card and passes the danger lint', async () => {
    const { drafts } = await buildDrafts(selection([{ page: 'common/demo.md', tool: 'demo', tags: ['files'] }]), readFixture);
    for (const { card } of drafts) {
      const text = renderDraft(card);
      expect(text.startsWith('# Draft imported from tldr-pages')).toBe(true);
      expect(text).toContain('description: ""');
      expect(text).toContain('tags: [ files ]');
      expect(parse(text)).toEqual(card);
      expect(checkSafety('x.yaml', parse(text))).toEqual([]);
    }
  });
});

describe('writeDrafts', () => {
  const draft = (id: string, command = 'ls') => ({
    category: 'linux' as const,
    card: { id, title: 'T', description: '', command, tool: 'ls', category: 'linux', tags: ['x'], danger: 'safe' } as Card,
  });
  const published = { ids: new Set(['published']), sources: new Set(['common/ls.md\nls -la']) };
  const opts = (force = false) => ({ outDir: join(dir, 'drafts'), published, force });
  const file = (id: string) => join(dir, 'drafts', 'linux', `${id}.yaml`);

  it('creates drafts, then changes nothing on a second run (idempotent)', () => {
    expect(writeDrafts([draft('a'), draft('b')], opts())).toMatchObject({ created: 2, unchanged: 0 });
    const mtime = statSync(file('a')).mtimeMs;
    expect(writeDrafts([draft('a'), draft('b')], opts())).toMatchObject({ created: 0, unchanged: 2 });
    expect(statSync(file('a')).mtimeMs).toBe(mtime);
  });

  it('keeps a locally modified draft unless forced', () => {
    writeDrafts([draft('a')], opts());
    writeFileSync(file('a'), 'edited');
    expect(writeDrafts([draft('a')], opts())).toMatchObject({ kept: 1 });
    expect(readFileSync(file('a'), 'utf8')).toBe('edited');
    expect(writeDrafts([draft('a')], opts(true))).toMatchObject({ updated: 1 });
    expect(readFileSync(file('a'), 'utf8')).toBe(renderDraft(draft('a').card));
  });

  it('does not recreate a card that is already published', () => {
    expect(writeDrafts([draft('published')], opts())).toMatchObject({ published: 1, created: 0 });
    expect(existsSync(file('published'))).toBe(false);
  });

  it('recognizes a published card renamed during review by its source page and command', () => {
    const renamed = draft('old-id', 'ls -la');
    renamed.card.source = { type: 'tldr', page: 'common/ls.md' };
    expect(writeDrafts([renamed], opts())).toMatchObject({ published: 1, created: 0 });
  });
});

describe('readPublished', () => {
  it('indexes ids and tldr sources, and tolerates broken or original cards', () => {
    mkdirSync(join(dir, 'linux'));
    writeFileSync(join(dir, 'linux', 'a.yaml'), 'command: ls -la\nsource: { type: tldr, page: common/ls.md }\n');
    writeFileSync(join(dir, 'linux', 'b.yaml'), 'command: x\nsource: { type: original }\n');
    writeFileSync(join(dir, 'linux', 'c.yaml'), 'command: [unclosed\n');
    writeFileSync(join(dir, 'linux', 'notes.txt'), 'ignored');
    expect(readPublished(join(dir))).toEqual({
      ids: new Set(['a', 'b', 'c']),
      sources: new Set(['common/ls.md\nls -la']),
    });
    expect(readPublished(join(dir, 'missing'))).toEqual({ ids: new Set(), sources: new Set() });
  });
});

describe('cachedReader', () => {
  const page = 'common/x.md';
  const ok = (text: string) => vi.fn(async () => new Response(text, { status: 200 }));

  it('downloads the page at the pinned commit once, then reads the cache', async () => {
    const fetchFn = ok('# x');
    const read = cachedReader({ repo: 'tldr-pages/tldr', commit: SHA, cacheDir: dir, fetchFn });
    expect(await read(page)).toBe('# x');
    expect(await read(page)).toBe('# x');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith(`https://raw.githubusercontent.com/tldr-pages/tldr/${SHA}/pages/common/x.md`);
    expect(readFileSync(join(dir, SHA, page), 'utf8')).toBe('# x');
  });

  it('fails on an HTTP error without caching anything', async () => {
    const fetchFn = vi.fn(async () => new Response('nope', { status: 404 }));
    const read = cachedReader({ repo: 'tldr-pages/tldr', commit: SHA, cacheDir: dir, fetchFn });
    await expect(read(page)).rejects.toThrow('HTTP 404');
    expect(existsSync(join(dir, SHA, page))).toBe(false);
  });
});

describe('loadSelection', () => {
  it('accepts the real selection, which covers every category', () => {
    const sel = loadSelection(DEFAULTS.selectionPath);
    expect(sel.tldr.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(Object.keys(sel.categories).sort()).toEqual(['cloud-iac', 'containers', 'git-ci', 'linux']);
  });

  it('rejects an invalid selection with the offending path', () => {
    const path = join(dir, 'sel.yaml');
    writeFileSync(path, 'tldr: { repo: tldr-pages/tldr, commit: main }\ncategories: {}\n');
    expect(() => loadSelection(path)).toThrow(/tldr\.commit/);
  });
});

describe('main / cli', () => {
  const setup = () => {
    const sel = join(dir, 'sel.yaml');
    writeFileSync(
      sel,
      `tldr: { repo: tldr-pages/tldr, commit: ${SHA} }\ncategories:\n  linux: [{ page: common/demo.md, tool: demo, tags: [files] }]\n  containers: []\n  cloud-iac: []\n  git-ci: []\n`,
    );
    mkdirSync(join(dir, 'published', 'linux'), { recursive: true });
    writeFileSync(join(dir, 'published', 'linux', 'demo-list-all-files-in-a-directory.yaml'), 'id: x\n');
    return {
      selectionPath: sel,
      outDir: join(dir, 'drafts'),
      publishedRoot: join(dir, 'published'),
      read: readFixture,
    };
  };
  const capture = () => {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, log: (m: string) => out.push(m), error: (m: string) => err.push(m) };
  };

  it('imports, reports, and is a no-op when run again', async () => {
    const io = capture();
    expect(await cli([], { ...setup(), ...io })).toBe(0);
    const report = io.out.join('\n');
    expect(report).toContain('linux: 5 draft(s)');
    expect(report).toContain('4 created, 0 updated, 0 unchanged, 0 kept, 1 already published');
    expect(report).toContain('common/demo.md #4: escaped braces');
    expect(report).toContain('linux/demo-run-a-container-from-a-tagged-image: placeholder');

    const again = capture();
    expect(await cli([], { ...setup(), ...again })).toBe(0);
    expect(again.out.join('\n')).toContain('0 created, 0 updated, 4 unchanged');
  });

  it('passes --force through', async () => {
    const opts = setup();
    await cli([], { ...opts, ...capture() });
    const first = join(opts.outDir, 'linux', 'demo-run-a-container-from-a-tagged-image.yaml');
    writeFileSync(first, 'edited');
    const io = capture();
    expect(await cli(['--force'], { ...opts, ...io })).toBe(0);
    expect(io.out.join('\n')).toContain('1 updated');
  });

  it('rejects unknown arguments', async () => {
    const io = capture();
    expect(await cli(['--nope'], io)).toBe(2);
    expect(io.err.join('\n')).toContain('usage: import-tldr [--force]');
  });

  it('returns 1 with the error message when the import fails', async () => {
    const io = capture();
    const read = async () => {
      throw new Error('network down');
    };
    expect(await main({ ...DEFAULTS, ...setup(), read, force: false, ...io })).toBe(1);
    expect(io.err.join('\n')).toContain('network down');
  });

  it('handles a missing published folder', async () => {
    const io = capture();
    expect(await cli([], { ...setup(), publishedRoot: join(dir, 'missing'), ...io })).toBe(0);
    expect(io.out.join('\n')).toContain('5 created');
  });
});

describe('drafts stay out of the build', () => {
  it('only content/commands is loaded by Astro and validated by lint-content', () => {
    expect(DEFAULT_ROOT).toBe('content/commands');
    expect(readFileSync('src/content.config.ts', 'utf8')).toMatch(/base: '\.\/content\/commands'/);
    expect(DEFAULTS.outDir).toBe('content/drafts');
  });
});

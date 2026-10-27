import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cli, main } from '../../scripts/lint-danger';
import { cli as lintContentCli, main as lintContent } from '../../scripts/validate-content';
import { checkSafety } from '../../src/content/validate';

const c = (cp: number) => String.fromCodePoint(cp);

const card = (patch: Record<string, string>) =>
  Object.entries({
    id: 'x',
    title: 'Remove a directory',
    description: 'Deletes the directory and everything inside it.',
    command: 'rm -rf {{path}}',
    tool: 'rm',
    category: 'linux',
    tags: '[files]',
    danger: 'destructive',
    'source.type': 'original',
    ...patch,
  })
    .map(([k, v]) => (k === 'source.type' ? `source:\n  type: ${v}` : `${k}: ${JSON.stringify(v).replace(/^"\[(.*)\]"$/, '[$1]')}`))
    .join('\n');

let root: string;
const write = (file: string, content: string) => {
  mkdirSync(join(root, file, '..'), { recursive: true });
  writeFileSync(join(root, file), content);
};
const run = (fn: typeof main, arg: string[]) => {
  const err: string[] = [];
  const out: string[] = [];
  const code = fn(arg, (m) => out.push(m), (m) => err.push(m));
  return { code, stderr: err.join('\n'), stdout: out.join('\n') };
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lint-danger-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('lint-danger CLI', () => {
  it('passes when the danger level is high enough', () => {
    write('linux/x.yaml', card({}));
    expect(run(main, [root])).toMatchObject({ code: 0, stdout: expect.stringContaining('1 card(s) pass') });
  });

  it('fails with file, rule and expected level when under-declared', () => {
    write('linux/x.yaml', card({ danger: 'safe' }));
    const { code, stderr } = run(main, [root]);
    expect(code).toBe(1);
    expect(stderr).toContain(`${root}/linux/x.yaml: danger → declared "safe" but matches "recursive delete (rm -r)" [rm-recursive], requires "destructive"`);
  });

  it('checks drafts that have no description yet', () => {
    write('linux/x.yaml', 'command: kubectl delete ns prod\ndanger: caution\n');
    expect(run(main, [root]).stderr).toContain('[kubectl-delete]');
  });

  it('reports invalid YAML', () => {
    write('linux/x.yaml', 'command: [oops\n');
    expect(run(main, [root]).stderr).toContain('invalid YAML');
  });

  it('defaults to the console', () => {
    write('linux/x.yaml', card({}));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(main([root])).toBe(0);
    log.mockRestore();
  });
});

describe('command-line entries', () => {
  it('lint-danger defaults to content/commands and accepts several roots', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    write('linux/x.yaml', card({}));
    expect(cli([])).toBe(0);
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining('in content/commands'));
    expect(cli([root, 'content/commands'])).toBe(0);
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining(`in ${root}, content/commands`));
    log.mockRestore();
  });

  it('lint-content defaults to content/commands', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(lintContentCli([])).toBe(0);
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining('in content/commands'));
    log.mockRestore();
  });
});

describe('lint-content applies the same safety checks', () => {
  it('rejects an under-declared card', () => {
    write('linux/x.yaml', card({ danger: 'safe' }));
    const { code, stderr } = run((r, l, e) => lintContent(r[0], l, e), [root]);
    expect(code).toBe(1);
    expect(stderr).toContain('[rm-recursive]');
  });

  it('rejects a bidi override hidden in a command', () => {
    write('linux/x.yaml', card({ command: `rm -rf {{path}}${c(0x202e)}` }));
    const { stderr } = run((r, l, e) => lintContent(r[0], l, e), [root]);
    expect(stderr).toContain('command → unsafe characters: bidi U+202E at col 16');
  });
});

describe('checkSafety', () => {
  it('checks raw values, before the schema trims them', () => {
    const errors = checkSafety('f.yaml', { command: `ls${c(0xfeff)}`, title: `T${c(0x0a)}`, description: 'ok', danger: 'safe' });
    expect(errors.map((e) => e.field)).toEqual(['command', 'title']);
  });

  it('allows typographic characters in text fields but not in commands', () => {
    const errors = checkSafety('f.yaml', { command: `ls ${c(0x2013)}la`, description: `Lists files ${c(0x2013)} fast.`, danger: 'safe' });
    expect(errors.map((e) => e.field)).toEqual(['command']);
  });

  it('ignores non-object data and unknown danger levels', () => {
    expect(checkSafety('f.yaml', null)).toEqual([]);
    expect(checkSafety('f.yaml', { command: 'rm -rf /', danger: 'nope' })).toEqual([]);
  });
});

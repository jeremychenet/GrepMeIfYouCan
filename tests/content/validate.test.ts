import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { main, readEntries } from '../../scripts/validate-content';
import { formatErrors, validateEntries } from '../../src/content/validate';

const FIXTURES = join(import.meta.dirname, '../fixtures');

/** Runs the CLI on a fixture folder and returns its exit code and stderr. */
function run(root: string) {
  const err: string[] = [];
  const out: string[] = [];
  const code = main(root, (m) => out.push(m), (m) => err.push(m));
  return { code, stderr: err.join('\n'), stdout: out.join('\n') };
}

describe('validate-content CLI', () => {
  it('passes on valid cards', () => {
    const { code, stdout } = run(join(FIXTURES, 'valid'));
    expect(code).toBe(0);
    expect(stdout).toContain('2 command card(s) valid');
  });

  it('passes on the real content', () => {
    expect(run('content/commands').code).toBe(0);
  });

  // One folder per broken rule; each must fail with a message naming the problem.
  const expected: Record<string, string> = {
    'description-empty': 'description → is required',
    'description-too-long': 'description → must be at most 180 characters',
    'description-two-sentences': 'description → must be a single sentence',
    'description-equals-title': 'description → must explain what the command does',
    'danger-unknown': 'danger →',
    'category-unknown': 'category →',
    'duplicate-id': 'id → duplicate id, already used by',
    'id-mismatch-filename': 'id → must match the file name "find-files-larger-than"',
    'category-mismatch-folder': 'category → must match the folder "containers"',
    'yaml-syntax': 'invalid YAML',
  };

  it('has a test case for every invalid fixture', () => {
    expect(readdirSync(join(FIXTURES, 'invalid')).sort()).toEqual(Object.keys(expected).sort());
  });

  it.each(Object.entries(expected))('rejects %s', (dir, message) => {
    const { code, stderr } = run(join(FIXTURES, 'invalid', dir));
    expect(code).toBe(1);
    expect(stderr).toContain(message);
  });

  it('logs to the console by default', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(main(join(FIXTURES, 'valid'))).toBe(0);
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
  });
});

describe('validateEntries', () => {
  it('reports a root-level error for a non-object card', () => {
    const { errors } = validateEntries([{ file: 'linux/x.yaml', data: null }]);
    expect(formatErrors(errors)).toContain('linux/x.yaml: (root) →');
  });

  it('reports a card placed directly under the root as a folder mismatch', () => {
    const { entries } = readEntries(join(FIXTURES, 'valid'));
    const flat = entries.map((e) => ({ ...e, file: e.file.split('/').pop()! }));
    const { errors } = validateEntries(flat);
    expect(errors.some((e) => e.field === 'category' && e.message.includes('folder ""'))).toBe(true);
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  CONFIRMED_KEY,
  buildCopyText,
  copyCard,
  markConfirmed,
  missingValues,
  needsConfirmation,
  sanitizeValue,
  type CopyCard,
  type CopyDeps,
  type StorageGetter,
} from '../../src/lib/copy';
import { findUnsafeChars } from '../../src/lib/unsafe-chars';

const cp = (...points: number[]) => String.fromCodePoint(...points);
const ZWSP = cp(0x200b);
const RLO = cp(0x202e);
const BOM = cp(0xfeff);
const LS = cp(0x2028);

/** In-memory sessionStorage. */
function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const store = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
  return { data, get: (() => store) as StorageGetter };
}

describe('sanitizeValue', () => {
  it('keeps ordinary text, including shell metacharacters and non-ASCII', () => {
    expect(sanitizeValue('/var/log/*.log; echo $HOME | café')).toBe('/var/log/*.log; echo $HOME | café');
  });

  it('removes invisible and bidi characters', () => {
    expect(sanitizeValue(`a${ZWSP}b${RLO}c${BOM}d`)).toBe('abcd');
  });

  it('turns newlines, tabs and control characters into spaces', () => {
    expect(sanitizeValue(`a\nb\r\nc\td${LS}e${cp(0x07)}f`)).toBe('a b  c d e f');
  });
});

describe('buildCopyText', () => {
  it('matches the rendered command with the typed values', () => {
    expect(buildCopyText('find {{path:.}} -size +{{size}}', { path: '/var', size: '100M' })).toBe(
      'find /var -size +100M',
    );
  });

  it('uses the default, else the name, for an empty or blank value', () => {
    expect(buildCopyText('find {{path:.}} -size +{{size}}', { path: '  ' })).toBe('find . -size +size');
  });

  it('fills every occurrence of a variable with the same value', () => {
    expect(buildCopyText('cp {{f}} {{f}}.bak', { f: 'a.txt' })).toBe('cp a.txt a.txt.bak');
  });

  it('inserts values as plain text, without escaping or HTML handling', () => {
    const value = '<img src=x onerror=alert(1)>';
    expect(buildCopyText('echo {{msg}}', { msg: value })).toBe(`echo ${value}`);
    expect(buildCopyText('echo {{msg}}', { msg: '"; rm -rf / #' })).toBe('echo "; rm -rf / #');
  });

  it('never ends with a newline, even when a value does', () => {
    expect(buildCopyText('ls {{dir}}', { dir: 'tmp\n' })).toBe('ls tmp');
    expect(buildCopyText('ls {{dir}}', { dir: `tmp${LS}` })).toBe('ls tmp');
    expect(buildCopyText('ls {{dir:}}', {})).toBe('ls');
  });

  it('never contains an invisible character', () => {
    const text = buildCopyText('rm {{file}}', { file: `${RLO}gpj.exe${ZWSP}\n` });
    expect(text).toBe('rm gpj.exe');
    expect(findUnsafeChars(text)).toEqual([]);
  });

  it('ignores values that are not variables of the command', () => {
    expect(buildCopyText('ls {{constructor}}', {})).toBe('ls constructor');
    expect(buildCopyText('ls', { extra: 'x' })).toBe('ls');
  });
});

describe('missingValues', () => {
  it('lists empty variables without default, once each, in order', () => {
    expect(missingValues('rm {{a}} {{b:x}} {{c}} {{a}}', { c: ' ' })).toEqual(['a', 'c']);
  });

  it('accepts typed values and ignores variables with a default', () => {
    expect(missingValues('rm {{a}} {{b:}}', { a: 'file' })).toEqual([]);
  });

  it('counts a value made only of invisible characters as empty', () => {
    expect(missingValues('rm {{a}}', { a: `${ZWSP}${BOM}` })).toEqual(['a']);
  });
});

describe('needsConfirmation / markConfirmed', () => {
  const destructive = { id: 'rm-dir', danger: 'destructive' } as const;

  it('never asks for safe or caution cards', () => {
    const { get } = memoryStorage();
    expect(needsConfirmation({ id: 'a', danger: 'safe' }, get)).toBe(false);
    expect(needsConfirmation({ id: 'b', danger: 'caution' }, get)).toBe(false);
  });

  it('asks once per destructive card in the session', () => {
    const { get, data } = memoryStorage();
    expect(needsConfirmation(destructive, get)).toBe(true);
    markConfirmed('rm-dir', get);
    expect(needsConfirmation(destructive, get)).toBe(false);
    expect(needsConfirmation({ id: 'dd-disk', danger: 'destructive' }, get)).toBe(true);
    markConfirmed('dd-disk', get);
    expect(JSON.parse(data.get(CONFIRMED_KEY)!)).toEqual(['rm-dir', 'dd-disk']);
  });

  it('asks every time when storage is missing, blocked or full', () => {
    const none: StorageGetter = () => undefined;
    markConfirmed('rm-dir', none);
    expect(needsConfirmation(destructive, none)).toBe(true);

    const throwing: StorageGetter = () => {
      throw new Error('SecurityError');
    };
    markConfirmed('rm-dir', throwing);
    expect(needsConfirmation(destructive, throwing)).toBe(true);

    const full: StorageGetter = () => ({
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    });
    expect(() => markConfirmed('rm-dir', full)).not.toThrow();
    expect(needsConfirmation(destructive, full)).toBe(true);
  });

  it('ignores a corrupted stored value', () => {
    expect(needsConfirmation(destructive, memoryStorage({ [CONFIRMED_KEY]: '{bad' }).get)).toBe(true);
    expect(needsConfirmation(destructive, memoryStorage({ [CONFIRMED_KEY]: '"rm-dir"' }).get)).toBe(true);
    const mixed = memoryStorage({ [CONFIRMED_KEY]: '[1, "rm-dir"]' });
    expect(needsConfirmation(destructive, mixed.get)).toBe(false);
  });
});

describe('copyCard', () => {
  const card = (over: Partial<CopyCard> = {}): CopyCard => ({
    id: 'find-large',
    command: 'find {{path:.}} -size +{{size:100M}}',
    danger: 'safe',
    ...over,
  });

  function deps(over: Partial<CopyDeps> = {}) {
    const storage = memoryStorage();
    const d = {
      writeText: vi.fn(async (_text: string) => {}),
      confirm: vi.fn(async (_text: string) => true),
      storage: storage.get,
      ...over,
    };
    return d;
  }

  it('copies the exact rendered text without asking for a safe card', async () => {
    const d = deps();
    expect(await copyCard(card(), { path: '/srv' }, d)).toEqual({ status: 'copied', text: 'find /srv -size +100M' });
    expect(d.writeText).toHaveBeenCalledWith('find /srv -size +100M');
    expect(d.confirm).not.toHaveBeenCalled();
  });

  it('confirms the first copy of a destructive card, not the next ones', async () => {
    const d = deps();
    const rm = card({ id: 'rm-dir', command: 'rm -rf {{dir}}', danger: 'destructive' });
    expect(await copyCard(rm, { dir: 'build' }, d)).toEqual({ status: 'copied', text: 'rm -rf build' });
    expect(d.confirm).toHaveBeenCalledWith('rm -rf build');
    await copyCard(rm, { dir: 'dist' }, d);
    expect(d.confirm).toHaveBeenCalledTimes(1);
    expect(d.writeText).toHaveBeenLastCalledWith('rm -rf dist');
  });

  it('copies nothing when the confirmation is cancelled, and asks again next time', async () => {
    const d = deps({ confirm: vi.fn(async () => false) });
    const rm = card({ id: 'rm-dir', command: 'rm -rf {{dir}}', danger: 'destructive' });
    expect(await copyCard(rm, { dir: 'build' }, d)).toEqual({ status: 'cancelled' });
    expect(d.writeText).not.toHaveBeenCalled();
    await copyCard(rm, { dir: 'build' }, d);
    expect(d.confirm).toHaveBeenCalledTimes(2);
  });

  it('refuses a destructive copy while a target is empty, before any confirmation', async () => {
    const d = deps();
    const rm = card({ id: 'rm-dir', command: 'rm -rf {{dir}} {{other}}', danger: 'destructive' });
    expect(await copyCard(rm, { dir: '' }, d)).toEqual({ status: 'missing', missing: ['dir', 'other'] });
    expect(d.confirm).not.toHaveBeenCalled();
    expect(d.writeText).not.toHaveBeenCalled();
  });

  it('copies a non-destructive card with an empty variable as its name', async () => {
    const d = deps();
    expect(await copyCard(card({ command: 'systemctl restart {{service}}', danger: 'caution' }), {}, d)).toEqual({
      status: 'copied',
      text: 'systemctl restart service',
    });
  });

  it('reports a clipboard failure and does not remember the confirmation', async () => {
    const d = deps({ writeText: vi.fn(async () => Promise.reject(new Error('denied'))) });
    const rm = card({ id: 'rm-dir', command: 'rm -rf {{dir}}', danger: 'destructive' });
    expect(await copyCard(rm, { dir: 'x' }, d)).toEqual({ status: 'failed' });
    expect(needsConfirmation(rm, d.storage)).toBe(true);
  });
});

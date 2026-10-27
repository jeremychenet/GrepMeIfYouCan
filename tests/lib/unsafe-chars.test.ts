import { describe, expect, it } from 'vitest';
import { describeUnsafe, findUnsafeChars } from '../../src/lib/unsafe-chars';

// Built from code points so this file stays pure ASCII.
const c = (cp: number) => String.fromCodePoint(cp);

describe('findUnsafeChars', () => {
  it('accepts plain ASCII commands', () => {
    expect(findUnsafeChars('find {{path:/}} -size +1G 2>/dev/null | sort -h', { asciiOnly: true })).toEqual([]);
  });

  it.each([
    ['line feed', 0x0a, 'newline'],
    ['carriage return', 0x0d, 'newline'],
    ['line separator', 0x2028, 'newline'],
    ['tab', 0x09, 'control'],
    ['escape', 0x1b, 'control'],
    ['delete', 0x7f, 'control'],
    ['right-to-left override', 0x202e, 'bidi'],
    ['left-to-right mark', 0x200e, 'bidi'],
    ['first strong isolate', 0x2068, 'bidi'],
    ['zero-width space', 0x200b, 'invisible'],
    ['zero-width joiner', 0x200d, 'invisible'],
    ['byte order mark', 0xfeff, 'invisible'],
    ['soft hyphen', 0x00ad, 'invisible'],
    ['tag character', 0xe0041, 'invisible'],
  ])('rejects %s everywhere', (_name, cp, kind) => {
    const text = `ls ${c(cp)}-la`;
    expect(findUnsafeChars(text)).toEqual([{ col: 4, codePoint: `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`, kind }]);
  });

  it.each([
    ['cyrillic a (homoglyph)', 0x0430],
    ['en dash', 0x2013],
    ['left double quote', 0x201c],
    ['no-break space', 0x00a0],
    ['emoji', 0x1f600],
  ])('rejects %s in commands only', (_name, cp) => {
    const text = `ls ${c(cp)}`;
    expect(findUnsafeChars(text, { asciiOnly: true })[0]?.kind).toBe('non-ascii');
    expect(findUnsafeChars(text)).toEqual([]);
  });

  it('reports columns in code points and formats them', () => {
    const found = findUnsafeChars(`${c(0x1f600)}a${c(0x200b)}`, { asciiOnly: true });
    expect(describeUnsafe(found)).toBe('non-ascii U+1F600 at col 1, invisible U+200B at col 3');
  });
});

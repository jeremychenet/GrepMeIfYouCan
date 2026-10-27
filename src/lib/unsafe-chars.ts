/**
 * Detects characters that can make a copied command differ from what the
 * reader sees (SPEC §7.2, §7.3): invisible, bidi, control and look-alike chars.
 *
 * Ranges are written as numeric code points on purpose: this file must stay
 * pure ASCII so it can never contain the characters it detects.
 */

export type UnsafeKind = 'newline' | 'control' | 'bidi' | 'invisible' | 'non-ascii';

export interface UnsafeChar {
  /** 1-based column (in code points). */
  col: number;
  codePoint: string;
  kind: UnsafeKind;
}

type Range = readonly [number, number];

const NEWLINE: Range[] = [[0x0a, 0x0a], [0x0d, 0x0d], [0x85, 0x85], [0x2028, 0x2029]];
const CONTROL: Range[] = [[0x00, 0x1f], [0x7f, 0x9f]];
const BIDI: Range[] = [[0x061c, 0x061c], [0x200e, 0x200f], [0x202a, 0x202e], [0x2066, 0x2069]];
const INVISIBLE: Range[] = [
  [0x00ad, 0x00ad], // soft hyphen
  [0x034f, 0x034f], // combining grapheme joiner
  [0x115f, 0x1160], // hangul fillers
  [0x180e, 0x180e], // mongolian vowel separator
  [0x200b, 0x200d], // zero-width space / non-joiner / joiner
  [0x2060, 0x2064], // word joiner, invisible operators
  [0x3164, 0x3164], // hangul filler
  [0xfeff, 0xfeff], // zero-width no-break space (BOM)
  [0xffa0, 0xffa0], // halfwidth hangul filler
  [0xe0000, 0xe007f], // tag characters
];

const inRanges = (cp: number, ranges: Range[]) => ranges.some(([lo, hi]) => cp >= lo && cp <= hi);

/** Kind of an unsafe code point, or undefined when it is safe. */
export function classify(cp: number, asciiOnly = false): UnsafeKind | undefined {
  if (inRanges(cp, NEWLINE)) return 'newline';
  if (inRanges(cp, CONTROL)) return 'control';
  if (inRanges(cp, BIDI)) return 'bidi';
  if (inRanges(cp, INVISIBLE)) return 'invisible';
  if (asciiOnly && (cp < 0x20 || cp > 0x7e)) return 'non-ascii';
  return undefined;
}

/**
 * Lists unsafe characters in `text`. With `asciiOnly` (used for `command`),
 * anything outside printable ASCII is rejected too: homoglyphs, en dashes,
 * smart quotes, non-breaking spaces.
 */
export function findUnsafeChars(text: string, { asciiOnly = false } = {}): UnsafeChar[] {
  const found: UnsafeChar[] = [];
  [...text].forEach((ch, i) => {
    const cp = ch.codePointAt(0)!;
    const kind = classify(cp, asciiOnly);
    if (kind) {
      found.push({ col: i + 1, codePoint: 'U+' + cp.toString(16).toUpperCase().padStart(4, '0'), kind });
    }
  });
  return found;
}

export function describeUnsafe(chars: UnsafeChar[]): string {
  return chars.map((c) => `${c.kind} ${c.codePoint} at col ${c.col}`).join(', ');
}

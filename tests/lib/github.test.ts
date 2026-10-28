import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  REPORT_TEMPLATE,
  REPO_URL,
  SUGGEST_TEMPLATE,
  reportIssueUrl,
  suggestCommandUrl,
} from '../../src/lib/github';

const cp = (...points: number[]) => String.fromCodePoint(...points);

function params(url: string): URLSearchParams {
  const u = new URL(url);
  expect(u.origin + u.pathname).toBe(`${REPO_URL}/issues/new`);
  return u.searchParams;
}

/** Ids of the fields of an issue form in .github/ISSUE_TEMPLATE/. */
function formFieldIds(template: string): string[] {
  const form = parse(readFileSync(new URL(`../../.github/ISSUE_TEMPLATE/${template}`, import.meta.url), 'utf8')) as {
    body: { id?: string }[];
  };
  return form.body.flatMap((field) => (field.id ? [field.id] : []));
}

describe('suggestCommandUrl', () => {
  it('opens the suggestion form with the query in the title and in "need"', () => {
    const p = params(suggestCommandUrl('  rotate nginx logs '));
    expect(p.get('template')).toBe(SUGGEST_TEMPLATE);
    expect(p.get('title')).toBe('Suggest a command: rotate nginx logs');
    expect(p.get('need')).toBe('rotate nginx logs');
  });

  it('encodes special characters and caps the query', () => {
    const url = suggestCommandUrl(`a&b=#?${'x'.repeat(200)}`);
    expect(url).not.toContain('#');
    const p = params(url);
    expect(p.get('title')).toBe(`Suggest a command: a&b=#?${'x'.repeat(94)}`);
    expect(p.get('need')).toHaveLength(100);
  });

  it('keeps non-ASCII text, but drops invisible characters', () => {
    const p = params(suggestCommandUrl(`trouver fichiers ${cp(0x00e9)}t${cp(0x00e9)}${cp(0x202e)}${cp(0x200b)}`));
    expect(p.get('need')).toBe(`trouver fichiers ${cp(0x00e9)}t${cp(0x00e9)}`);
  });

  it('uses a generic title and no "need" for a blank query (global button)', () => {
    for (const q of [undefined, '', '   ']) {
      const p = params(suggestCommandUrl(q));
      expect(p.get('template')).toBe(SUGGEST_TEMPLATE);
      expect(p.get('title')).toBe('Suggest a command');
      expect(p.has('need')).toBe(false);
    }
  });
});

describe('reportIssueUrl', () => {
  it('opens the report form with the card id and page', () => {
    const p = params(reportIssueUrl('find-files-larger-than', 'https://grepmeifyoucan.com/c/find-files-larger-than'));
    expect(p.get('template')).toBe(REPORT_TEMPLATE);
    expect(p.get('title')).toBe('Report: find-files-larger-than');
    expect(p.get('card')).toBe('find-files-larger-than');
    expect(p.get('page')).toBe('https://grepmeifyoucan.com/c/find-files-larger-than');
  });

  it('encodes the page URL', () => {
    const url = reportIssueUrl('a-b', 'https://example.com/c/a-b?x=1&y=2#top');
    expect(url).not.toContain('#top');
    expect(params(url).get('page')).toBe('https://example.com/c/a-b?x=1&y=2#top');
  });
});

describe('issue forms', () => {
  it('have the fields the site prefills', () => {
    expect(formFieldIds(SUGGEST_TEMPLATE)).toEqual(expect.arrayContaining(['need', 'command']));
    expect(formFieldIds(REPORT_TEMPLATE)).toEqual(expect.arrayContaining(['card', 'page']));
  });
});

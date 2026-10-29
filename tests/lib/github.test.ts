import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { PLATFORMS } from '../../src/content/constants';
import { CATEGORY_LABELS } from '../../src/lib/pages';
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

interface FormField {
  id?: string;
  attributes?: { options?: (string | { label: string })[] };
}

function formFields(template: string): FormField[] {
  const form = parse(readFileSync(new URL(`../../.github/ISSUE_TEMPLATE/${template}`, import.meta.url), 'utf8')) as {
    body: FormField[];
  };
  return form.body;
}

/** Ids of the fields of an issue form in .github/ISSUE_TEMPLATE/. */
function formFieldIds(template: string): string[] {
  return formFields(template).flatMap((field) => (field.id ? [field.id] : []));
}

/** Option labels of a dropdown or checkboxes field. */
function formOptions(template: string, id: string): string[] {
  const field = formFields(template).find((f) => f.id === id);
  return (field?.attributes?.options ?? []).map((o) => (typeof o === 'string' ? o : o.label));
}

describe('suggestCommandUrl', () => {
  it('opens the suggestion form with the query in the title and in the card title', () => {
    const p = params(suggestCommandUrl('  rotate nginx logs '));
    expect(p.get('template')).toBe(SUGGEST_TEMPLATE);
    expect(p.get('title')).toBe('Suggest a command: rotate nginx logs');
    expect(p.get('card-title')).toBe('rotate nginx logs');
  });

  it('encodes special characters and caps the query', () => {
    const url = suggestCommandUrl(`a&b=#?${'x'.repeat(200)}`);
    expect(url).not.toContain('#');
    const p = params(url);
    expect(p.get('title')).toBe(`Suggest a command: a&b=#?${'x'.repeat(94)}`);
    expect(p.get('card-title')).toHaveLength(100);
  });

  it('keeps non-ASCII text, but drops invisible characters', () => {
    const p = params(suggestCommandUrl(`trouver fichiers ${cp(0x00e9)}t${cp(0x00e9)}${cp(0x202e)}${cp(0x200b)}`));
    expect(p.get('card-title')).toBe(`trouver fichiers ${cp(0x00e9)}t${cp(0x00e9)}`);
  });

  it('uses a generic title and no card title for a blank query (global button)', () => {
    for (const q of [undefined, '', '   ']) {
      const p = params(suggestCommandUrl(q));
      expect(p.get('template')).toBe(SUGGEST_TEMPLATE);
      expect(p.get('title')).toBe('Suggest a command');
      expect(p.has('card-title')).toBe(false);
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
  it('never use `title` as a field id: it is the issue title parameter', () => {
    expect(formFieldIds(SUGGEST_TEMPLATE)).not.toContain('title');
    expect(formFieldIds(REPORT_TEMPLATE)).not.toContain('title');
  });

  it('have the fields the site prefills', () => {
    expect(formFieldIds(SUGGEST_TEMPLATE)).toEqual(
      expect.arrayContaining(['card-title', 'command', 'description', 'category', 'tags', 'platforms', 'danger']),
    );
    expect(formFieldIds(REPORT_TEMPLATE)).toEqual(expect.arrayContaining(['card', 'page']));
  });

  it('offer every category and platform of the schema, in the same order', () => {
    expect(formOptions(SUGGEST_TEMPLATE, 'category')).toEqual(Object.values(CATEGORY_LABELS));
    const names: Record<(typeof PLATFORMS)[number], string> = { linux: 'Linux', macos: 'macOS', unix: 'Unix' };
    expect(formOptions(SUGGEST_TEMPLATE, 'platforms')).toEqual(PLATFORMS.map((p) => names[p]));
  });
});

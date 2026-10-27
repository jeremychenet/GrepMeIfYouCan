import { describe, expect, it } from 'vitest';
import { REPO_URL, suggestCommandUrl } from '../../src/lib/github';

describe('suggestCommandUrl', () => {
  it('prefills the issue title with the query', () => {
    const url = new URL(suggestCommandUrl('  rotate nginx logs '));
    expect(url.origin + url.pathname).toBe(`${REPO_URL}/issues/new`);
    expect(url.searchParams.get('title')).toBe('Suggest a command: rotate nginx logs');
  });

  it('encodes special characters and caps the query', () => {
    const url = new URL(suggestCommandUrl(`a&b=#${'x'.repeat(200)}`));
    const title = url.searchParams.get('title')!;
    expect(title.startsWith('Suggest a command: a&b=#')).toBe(true);
    expect(title).toHaveLength('Suggest a command: '.length + 100);
  });

  it('uses a generic title for a blank query', () => {
    expect(new URL(suggestCommandUrl(' ')).searchParams.get('title')).toBe('Suggest a command');
  });
});

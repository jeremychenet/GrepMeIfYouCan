import { describe, expect, it } from 'vitest';
import { DEFAULT_SITE, canonicalUrl, siteUrl } from '../../src/lib/site';

describe('siteUrl', () => {
  it('defaults to the production domain', () => {
    expect(DEFAULT_SITE).toBe('https://grepmeifyoucan.com');
    expect(siteUrl({})).toBe(DEFAULT_SITE);
    expect(siteUrl({ PUBLIC_BASE_URL: '  ' })).toBe(DEFAULT_SITE);
  });

  it('uses PUBLIC_BASE_URL without its trailing slash', () => {
    expect(siteUrl({ PUBLIC_BASE_URL: 'http://localhost:8080/' })).toBe('http://localhost:8080');
  });

  it('rejects a value that is not an http(s) origin', () => {
    expect(() => siteUrl({ PUBLIC_BASE_URL: 'grepmeifyoucan.com' })).toThrow(/PUBLIC_BASE_URL/);
    expect(() => siteUrl({ PUBLIC_BASE_URL: 'ftp://x.org' })).toThrow(/PUBLIC_BASE_URL/);
    expect(() => siteUrl({ PUBLIC_BASE_URL: 'https://x.org/sub' })).toThrow(/PUBLIC_BASE_URL/);
  });
});

describe('canonicalUrl', () => {
  it('joins the site and the path, without trailing slash except for home', () => {
    expect(canonicalUrl('https://grepmeifyoucan.com', '/c/ls-all')).toBe(
      'https://grepmeifyoucan.com/c/ls-all',
    );
    expect(canonicalUrl('https://grepmeifyoucan.com', '/c/ls-all/')).toBe(
      'https://grepmeifyoucan.com/c/ls-all',
    );
    expect(canonicalUrl('https://grepmeifyoucan.com', '/')).toBe('https://grepmeifyoucan.com/');
  });

  it('maps the index file to home', () => {
    expect(canonicalUrl('https://x.org', '/index.html')).toBe('https://x.org/');
    expect(canonicalUrl('https://x.org', '/index')).toBe('https://x.org/');
    expect(canonicalUrl('https://x.org', '/tools/index-files')).toBe('https://x.org/tools/index-files');
  });

  it('drops a .html suffix', () => {
    expect(canonicalUrl('http://localhost:8080', '/tools/git.html')).toBe(
      'http://localhost:8080/tools/git',
    );
  });
});

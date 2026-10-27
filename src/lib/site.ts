// Public site origin, used for canonical URLs and the sitemap (SPEC §6.1).
// Also imported by astro.config.mjs, so keep it dependency-free.

export const DEFAULT_SITE = 'https://grepmeifyoucan.com';

/** Reads PUBLIC_BASE_URL (an http(s) origin), defaulting to the production domain. */
export function siteUrl(env: Record<string, string | undefined>): string {
  const raw = env['PUBLIC_BASE_URL']?.trim();
  if (!raw) return DEFAULT_SITE;
  let url: URL | undefined;
  try {
    url = new URL(raw);
  } catch {
    url = undefined;
  }
  if (!url || !/^https?:$/.test(url.protocol) || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`PUBLIC_BASE_URL must be an http(s) origin like https://example.com, got "${raw}"`);
  }
  return url.origin;
}

/** Absolute URL of a page: no trailing slash (except home) and no `.html`. */
export function canonicalUrl(site: string, pathname: string): string {
  // With build.format 'file', Astro reports home as /index.html.
  const path = pathname.replace(/\.html$/, '').replace(/\/+$/, '').replace(/^\/index$/, '') || '/';
  return new URL(path, site).href;
}

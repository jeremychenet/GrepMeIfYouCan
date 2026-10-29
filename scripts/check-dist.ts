// Checks the built site in dist/ (PLAN J10): one page per card, tool and
// category; a title, meta description and canonical URL on every page;
// danger badges/warnings on card pages; a sitemap listing every page; a
// search index with one up-to-date entry per card (J11); the 404 page, not
// indexed and without canonical URL (J18).
// Runs in CI after `npm run build`: `tsx scripts/check-dist.ts [--dist dir] [--site url]`.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { validateEntries } from '../src/content/validate';
import type { Command } from '../src/content/schema';
import { cardPath, ERROR_PAGES, expectedPages } from '../src/lib/pages';
import { toSearchDoc } from '../src/lib/search';
import { canonicalUrl, siteUrl } from '../src/lib/site';
import { readEntries } from './validate-content';

export interface Options {
  dist: string;
  content: string;
  site: string;
}

function listHtml(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return listHtml(path);
    return name.endsWith('.html') ? [path] : [];
  });
}

/** dist/c/x.html -> /c/x ; dist/index.html -> / */
export function pagePath(dist: string, file: string): string {
  const rel = relative(dist, file).split(sep).join('/');
  return rel === 'index.html' ? '/' : `/${rel.replace(/\.html$/, '')}`;
}

/** Decodes the entities Astro emits in text and attribute values. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (e[0] !== '#') return named[e.toLowerCase()]!;
    return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
  });
}

const first = (html: string, re: RegExp) => {
  const m = re.exec(html);
  return m?.[1] === undefined ? undefined : decodeEntities(m[1]).trim();
};

function checkPage(path: string, html: string, site: string, card: Command | undefined): string[] {
  const errors: string[] = [];
  const title = first(html, /<title>([^<]*)<\/title>/);
  const description = first(html, /<meta name="description" content="([^"]*)"/);
  const canonical = first(html, /<link rel="canonical" href="([^"]*)"/);

  if (!title) errors.push(`${path}: missing <title>`);
  if (!description) errors.push(`${path}: missing meta description`);
  else if (card && description !== card.description) {
    errors.push(`${path}: meta description differs from the card description`);
  }
  const expected = canonicalUrl(site, path);
  if (canonical !== expected) {
    errors.push(`${path}: canonical is ${canonical ?? 'missing'}, expected ${expected}`);
  }

  if (card) {
    const caution = html.includes('class="badge badge--caution');
    const destructive = html.includes('class="badge badge--destructive');
    const note = /<p class="danger-note[^"]*" role="note"[\s>]/.test(html);
    const want = { caution: card.danger === 'caution', destructive: card.danger === 'destructive' };
    if (caution !== want.caution) errors.push(`${path}: caution badge ${caution ? 'unexpected' : 'missing'}`);
    if (destructive !== want.destructive) {
      errors.push(`${path}: destructive badge ${destructive ? 'unexpected' : 'missing'}`);
    }
    if (note !== want.destructive) errors.push(`${path}: destructive warning ${note ? 'unexpected' : 'missing'}`);
  }
  return errors;
}

/** Error pages have no URL of their own: noindex, no canonical. */
function checkErrorPage(path: string, html: string): string[] {
  const errors: string[] = [];
  if (!first(html, /<title>([^<]*)<\/title>/)) errors.push(`${path}: missing <title>`);
  if (!/<meta name="robots" content="noindex"/.test(html)) errors.push(`${path}: missing robots noindex`);
  if (/<link rel="canonical"/.test(html)) errors.push(`${path}: must not have a canonical URL`);
  return errors;
}

function checkSitemap(dist: string, urls: string[]): string[] {
  if (!existsSync(join(dist, 'sitemap-index.xml'))) return ['sitemap-index.xml is missing'];
  const listed = new Set(
    readdirSync(dist)
      .filter((f) => /^sitemap-\d+\.xml$/.test(f))
      .flatMap((f) => [...readFileSync(join(dist, f), 'utf8').matchAll(/<loc>([^<]*)<\/loc>/g)])
      .map((m) => decodeEntities(m[1]!)),
  );
  const errors = urls.filter((u) => !listed.has(u)).map((u) => `sitemap: ${u} is not listed`);
  const expected = new Set(urls);
  errors.push(...[...listed].filter((u) => !expected.has(u)).map((u) => `sitemap: unexpected ${u}`));
  return errors;
}

const SEARCH_INDEX = 'search-index.json';

function checkSearchIndex(dist: string, commands: readonly Command[]): string[] {
  const file = join(dist, SEARCH_INDEX);
  if (!existsSync(file)) return [`${SEARCH_INDEX} is missing`];
  let entries: unknown;
  try {
    entries = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    entries = null;
  }
  if (!Array.isArray(entries)) return [`${SEARCH_INDEX} is not a JSON array`];

  const cards = new Map(commands.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const errors: string[] = [];
  for (const entry of entries as { id?: string }[]) {
    const id = String(entry?.id);
    const card = cards.get(id);
    if (!card) errors.push(`${SEARCH_INDEX}: ${id} matches no card`);
    else if (seen.has(id)) errors.push(`${SEARCH_INDEX}: ${id} is listed twice`);
    else if (!isDeepStrictEqual(entry, toSearchDoc(card))) errors.push(`${SEARCH_INDEX}: ${id} is out of date`);
    seen.add(id);
  }
  for (const id of cards.keys()) if (!seen.has(id)) errors.push(`${SEARCH_INDEX}: ${id} is missing`);
  return errors;
}

export function checkDist({ dist, content, site }: Options): { errors: string[]; pages: number } {
  if (!existsSync(dist)) return { errors: [`${dist} does not exist: run the build first`], pages: 0 };
  const { entries, parseErrors } = readEntries(content);
  const { commands, errors: contentErrors } = validateEntries(entries);
  if (parseErrors.length || contentErrors.length) {
    return { errors: [`${content} has invalid cards: run lint-content`], pages: 0 };
  }

  const expected = expectedPages(commands);
  const files = new Map(listHtml(dist).map((f) => [pagePath(dist, f), f]));
  const cards = new Map(commands.map((c) => [cardPath(c.id), c]));
  const errors: string[] = [];

  for (const path of expected) {
    const file = files.get(path);
    if (!file) errors.push(`${path}: page missing`);
    else errors.push(...checkPage(path, readFileSync(file, 'utf8'), site, cards.get(path)));
  }
  for (const path of ERROR_PAGES) {
    const file = files.get(path);
    if (!file) errors.push(`${path}: page missing`);
    else errors.push(...checkErrorPage(path, readFileSync(file, 'utf8')));
  }
  const wanted = new Set<string>([...expected, ...ERROR_PAGES]);
  for (const path of files.keys()) if (!wanted.has(path)) errors.push(`${path}: unexpected page`);
  errors.push(...checkSitemap(dist, expected.map((p) => canonicalUrl(site, p))));
  errors.push(...checkSearchIndex(dist, commands));
  return { errors, pages: expected.length };
}

export function main(opts: Options, log = console.log, error = console.error): number {
  const { errors, pages } = checkDist(opts);
  if (errors.length) {
    error(errors.join('\n'));
    error(`\n✗ ${errors.length} problem(s) in ${opts.dist}`);
    return 1;
  }
  log(`✓ ${pages} page(s) checked in ${opts.dist} (title, description, canonical, danger, sitemap, search index, 404)`);
  return 0;
}

export function cli(args: string[], env: Record<string, string | undefined> = process.env): number {
  const value = (flag: string) => {
    const i = args.indexOf(flag);
    return i === -1 ? undefined : args[i + 1];
  };
  return main({
    dist: value('--dist') ?? 'dist',
    content: value('--content') ?? 'content/commands',
    site: siteUrl({ PUBLIC_BASE_URL: value('--site') ?? env['PUBLIC_BASE_URL'] }),
  });
}

/* v8 ignore next 3 -- process entry point, its logic is covered through cli() */
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = cli(process.argv.slice(2));
}

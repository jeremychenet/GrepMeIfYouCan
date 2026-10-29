import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stringify } from 'yaml';
import { checkDist, cli, decodeEntities, main, pagePath } from '../../scripts/check-dist';

const SITE = 'https://example.com';

const CARDS = [
  { id: 'ls-all', danger: 'safe', tool: 'ls', description: 'Lists all files, "hidden" & not.' },
  { id: 'svc-restart', danger: 'caution', tool: 'systemctl', description: 'Restarts the service.' },
  { id: 'rm-dir', danger: 'destructive', tool: 'rm', description: 'Deletes the directory.' },
] as const;

let root: string;
let dist: string;
let content: string;

const write = (file: string, text: string) => {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, text);
};

const esc = (s: string) => s.replaceAll('&', '&amp;').replaceAll('"', '&quot;');

function html(path: string, description: string, body = ''): string {
  const canonical = path === '/' ? `${SITE}/` : `${SITE}${path}`;
  return `<!doctype html><html><head><title>T</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}"></head><body>${body}</body></html>`;
}

function cardBody(danger: string): string {
  if (danger === 'safe') return '';
  const badge = `<span class="badge badge--${danger}" data-danger="${danger}" data-astro-cid-x>`;
  return danger === 'destructive'
    ? `${badge}<p class="danger-note" role="note" data-astro-cid-y>`
    : badge;
}

function notFound(head = '<meta name="robots" content="noindex">'): string {
  return `<!doctype html><html><head><title>Page not found</title>
<meta name="description" content="Missing.">${head}</head><body></body></html>`;
}

const pageFile = (path: string) =>
  join(dist, path === '/' ? 'index.html' : `${path.slice(1)}.html`);

function buildSite() {
  for (const c of CARDS) {
    write(
      join(content, 'linux', `${c.id}.yaml`),
      stringify({
        id: c.id,
        title: `Title of ${c.id}`,
        description: c.description,
        command: `${c.tool} x`,
        tool: c.tool,
        category: 'linux',
        tags: ['x'],
        danger: c.danger,
        source: { type: 'original' },
      }),
    );
    write(pageFile(`/c/${c.id}`), html(`/c/${c.id}`, c.description, cardBody(c.danger)));
    write(pageFile(`/tools/${c.tool}`), html(`/tools/${c.tool}`, 'Tool page.'));
  }
  write(pageFile('/'), html('/', 'Home.'));
  write(pageFile('/favorites'), html('/favorites', 'Favorites.'));
  write(pageFile('/history'), html('/history', 'History.'));
  write(pageFile('/about'), html('/about', 'About.'));
  write(pageFile('/privacy'), html('/privacy', 'Privacy.'));
  write(pageFile('/categories/linux'), html('/categories/linux', 'Linux page.'));
  write(pageFile('/404'), notFound());
  write(join(dist, 'sitemap-index.xml'), '<sitemapindex/>');
  const urls = [
    '/',
    ...CARDS.flatMap((c) => [`/c/${c.id}`, `/tools/${c.tool}`]),
    '/categories/linux',
    '/favorites',
    '/history',
    '/about',
    '/privacy',
  ].map((p) => `<url><loc>${p === '/' ? `${SITE}/` : SITE + p}</loc></url>`);
  write(join(dist, 'sitemap-0.xml'), `<urlset>${urls.join('')}</urlset>`);
  write(join(dist, 'search-index.json'), JSON.stringify(CARDS.map(searchDoc)));
}

function searchDoc(c: (typeof CARDS)[number]) {
  return {
    id: c.id,
    title: `Title of ${c.id}`,
    description: c.description,
    command: `${c.tool} x`,
    tool: c.tool,
    category: 'linux',
    tags: ['x'],
    danger: c.danger,
  };
}

const check = () => checkDist({ dist, content, site: SITE });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'check-dist-'));
  dist = join(root, 'dist');
  content = join(root, 'content');
  buildSite();
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('checkDist', () => {
  it('accepts a complete site', () => {
    expect(check()).toEqual({ errors: [], pages: 12 });
  });

  it('reports a missing card page', () => {
    rmSync(pageFile('/c/ls-all'));
    expect(check().errors).toContain('/c/ls-all: page missing');
  });

  it('reports a page that matches no card, tool or category', () => {
    write(pageFile('/c/ghost'), html('/c/ghost', 'Ghost.'));
    expect(check().errors).toContain('/c/ghost: unexpected page');
  });

  it('reports a missing title, description or canonical', () => {
    write(pageFile('/tools/ls'), '<html><head><title> </title></head></html>');
    expect(check().errors).toEqual(
      expect.arrayContaining([
        '/tools/ls: missing <title>',
        '/tools/ls: missing meta description',
        `/tools/ls: canonical is missing, expected ${SITE}/tools/ls`,
      ]),
    );
  });

  it('requires the card description as meta description (entities decoded)', () => {
    write(pageFile('/c/ls-all'), html('/c/ls-all', 'Something else.'));
    expect(check().errors).toEqual(['/c/ls-all: meta description differs from the card description']);
  });

  it('rejects a canonical with a trailing slash or another host', () => {
    write(pageFile('/tools/rm'), html('/tools/rm', 'X.').replace(`${SITE}/tools/rm`, `${SITE}/tools/rm/`));
    expect(check().errors).toEqual([
      `/tools/rm: canonical is ${SITE}/tools/rm/, expected ${SITE}/tools/rm`,
    ]);
  });

  it('requires the right danger badge and warning on card pages', () => {
    write(pageFile('/c/rm-dir'), html('/c/rm-dir', 'Deletes the directory.', cardBody('caution')));
    write(pageFile('/c/svc-restart'), html('/c/svc-restart', 'Restarts the service.'));
    write(pageFile('/c/ls-all'), html('/c/ls-all', CARDS[0].description, cardBody('destructive')));
    expect(check().errors.sort()).toEqual(
      [
        '/c/ls-all: destructive badge unexpected',
        '/c/ls-all: destructive warning unexpected',
        '/c/rm-dir: caution badge unexpected',
        '/c/rm-dir: destructive badge missing',
        '/c/rm-dir: destructive warning missing',
        '/c/svc-restart: caution badge missing',
      ].sort(),
    );
  });

  it('requires the sitemap index and every page in the sitemap', () => {
    write(join(dist, 'sitemap-0.xml'), `<urlset><url><loc>${SITE}/old</loc></url></urlset>`);
    const { errors } = check();
    expect(errors).toContain(`sitemap: ${SITE}/c/ls-all is not listed`);
    expect(errors).toContain(`sitemap: unexpected ${SITE}/old`);
    rmSync(join(dist, 'sitemap-index.xml'));
    expect(check().errors).toContain('sitemap-index.xml is missing');
  });

  it('requires a search index with exactly one up-to-date entry per card', () => {
    const index = join(dist, 'search-index.json');
    const [a, b, c] = CARDS.map(searchDoc);
    write(index, JSON.stringify([a, { ...b, title: 'Stale' }, b, { ...c, id: 'ghost' }]));
    expect(check().errors).toEqual([
      'search-index.json: svc-restart is out of date',
      'search-index.json: svc-restart is listed twice',
      'search-index.json: ghost matches no card',
      'search-index.json: rm-dir is missing',
    ]);
    write(index, '{"not": "a list"}');
    expect(check().errors).toEqual(['search-index.json is not a JSON array']);
    write(index, '[');
    expect(check().errors).toEqual(['search-index.json is not a JSON array']);
    rmSync(index);
    expect(check().errors).toEqual(['search-index.json is missing']);
  });

  it('requires the 404 page, not indexed and without canonical', () => {
    write(pageFile('/404'), notFound(`<link rel="canonical" href="${SITE}/404">`));
    expect(check().errors).toEqual(['/404: missing robots noindex', '/404: must not have a canonical URL']);
    write(pageFile('/404'), '<html><head><meta name="robots" content="noindex"></head></html>');
    expect(check().errors).toEqual(['/404: missing <title>']);
    rmSync(pageFile('/404'));
    expect(check().errors).toEqual(['/404: page missing']);
  });

  it('fails clearly when dist or the content is unusable', () => {
    expect(checkDist({ dist: join(root, 'nope'), content, site: SITE }).errors).toEqual([
      `${join(root, 'nope')} does not exist: run the build first`,
    ]);
    write(join(content, 'linux', 'bad.yaml'), 'id: [');
    expect(check().errors).toEqual([`${content} has invalid cards: run lint-content`]);
  });
});

describe('helpers', () => {
  it('maps files to public paths', () => {
    expect(pagePath('/d', '/d/index.html')).toBe('/');
    expect(pagePath('/d', '/d/c/ls.html')).toBe('/c/ls');
  });

  it('decodes named and numeric entities', () => {
    expect(decodeEntities('a &amp; b &quot;c&quot; &#39;d&#x27; &lt;e&gt; &apos;')).toBe(
      `a & b "c" 'd' <e> '`,
    );
  });
});

describe('main / cli', () => {
  it('prints a summary and returns 0 on success', () => {
    const log = vi.fn();
    expect(main({ dist, content, site: SITE }, log, vi.fn())).toBe(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('12 page(s) checked'));
  });

  it('prints every problem and returns 1 on failure', () => {
    rmSync(pageFile('/'));
    const error = vi.fn();
    expect(main({ dist, content, site: SITE }, vi.fn(), error)).toBe(1);
    expect(error).toHaveBeenCalledWith('/: page missing');
  });

  it('reads --dist, --content and --site, else PUBLIC_BASE_URL', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      expect(cli(['--dist', dist, '--content', content, '--site', SITE])).toBe(0);
      expect(cli(['--dist', dist, '--content', content], { PUBLIC_BASE_URL: SITE })).toBe(0);
    } finally {
      spy.mockRestore();
    }
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // Default site is the prod domain: canonicals of this fixture do not match.
      expect(cli(['--dist', dist, '--content', content], {})).toBe(1);
    } finally {
      err.mockRestore();
    }
  });
});

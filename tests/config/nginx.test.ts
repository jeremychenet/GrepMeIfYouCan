import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Nginx configs (SPEC §6.4, §7.4): dev and prod must stay in step.
const read = (file: string) => readFileSync(`docker/nginx/${file}`, 'utf8');
const strip = (conf: string) => conf.replace(/#.*$/gm, '');

const DEV = strip(read('nginx.conf'));
const PROD = strip(read('nginx.prod.conf'));

/** Every `location ... { ... }` block, with nested braces (limit_except). */
function locations(conf: string): { head: string; body: string }[] {
  const out: { head: string; body: string }[] = [];
  const re = /location\s+([^{]+)\{/g;
  for (let m = re.exec(conf); m; m = re.exec(conf)) {
    let depth = 1;
    let i = re.lastIndex;
    while (depth > 0 && i < conf.length) {
      if (conf[i] === '{') depth++;
      else if (conf[i] === '}') depth--;
      i++;
    }
    out.push({ head: m[1]!.trim(), body: conf.slice(re.lastIndex, i - 1) });
    re.lastIndex = i;
  }
  return out;
}

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
const cspOf = (file: string) => read(file).match(/Content-Security-Policy "([^"]+)"/)?.[1];
const statsBlocks = (conf: string) =>
  Object.fromEntries(locations(conf).filter((l) => l.head.includes('/stats')).map((l) => [l.head, normalize(l.body)]));

describe('nginx configs', () => {
  it('re-includes the security headers in any location with its own add_header', () => {
    for (const [name, conf] of [['nginx.conf', DEV], ['nginx.prod.conf', PROD]] as const) {
      const bad = locations(conf)
        .filter((l) => /\badd_header\b/.test(l.body) && !/include \/etc\/nginx\/snippets\/(security-headers|headers\.prod)\.conf/.test(l.body))
        .map((l) => `${name}: location ${l.head}`);
      expect(bad).toEqual([]);
    }
  });

  it('proxies /stats the same way in dev and prod', () => {
    const dev = statsBlocks(DEV);
    expect(Object.keys(dev).sort()).toEqual(['= /stats', '= /stats/api/send', '= /stats/script.js', '^~ /stats/']);
    expect(statsBlocks(PROD)).toEqual(dev);
  });

  it('serves /c/<id> from c/<id>.html in prod', () => {
    expect(PROD).toMatch(/try_files \$uri \$uri\.html =404;/);
  });

  it('uses the dev CSP minus the two hot-reload relaxations in prod', () => {
    const dev = cspOf('csp.dev.conf')!;
    const prod = cspOf('csp.prod.conf')!;
    expect(prod).toContain("default-src 'self'");
    expect(prod).not.toMatch(/unsafe-inline|unsafe-eval|ws:/);
    expect(dev.replace("style-src 'self' 'unsafe-inline'", "style-src 'self'").replace(' ws://$http_host', '')).toBe(prod);
  });

  it('sends HSTS for the public domain only, never for localhost', () => {
    const map = PROD.match(/map \$host \$hsts \{([^}]*)\}/)?.[1] ?? '';
    // 1 year since the go-live (J20), without preload (hard to undo).
    expect(map).toMatch(/^\s*grepmeifyoucan\.com\s+"max-age=31536000";/m);
    expect(map).not.toContain('preload');
    expect(map).toMatch(/^\s*default\s+"";/m);
    expect(map).not.toContain('localhost');
    expect(read('headers.prod.conf')).toContain('add_header Strict-Transport-Security $hsts always;');
  });
});

describe('nginx image', () => {
  it('is the same for the dev proxy and the prod image', () => {
    const dockerfile = readFileSync('docker/web.Dockerfile', 'utf8');
    const compose = readFileSync('compose.dev.yaml', 'utf8');
    const prodImage = dockerfile.match(/^FROM (nginxinc\/nginx-unprivileged:\S+) AS prod$/m)?.[1];
    const devImage = compose.match(/image: (nginxinc\/nginx-unprivileged:\S+)/)?.[1];
    expect(prodImage).toMatch(/:\d+\.\d+\.\d+-alpine[\d.]+-slim$/);
    expect(devImage).toBe(prodImage);
  });
});

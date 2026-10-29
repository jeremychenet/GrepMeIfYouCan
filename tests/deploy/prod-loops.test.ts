import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// Long-running shell loops of the production stack (J20), run for real with
// fake nginx / certbot / pg_dump / sleep in the PATH:
//   - docker/web-prod-entrypoint.sh: nginx + reload every RELOAD_INTERVAL;
//   - the certbot and backup loops written inline in compose.prod.yaml.
type Service = { entrypoint?: string[]; healthcheck?: { test?: string[] } };
const prod = (parse(readFileSync('compose.prod.yaml', 'utf8'), { merge: true }) as { services: Record<string, Service> })
  .services;

/** The `sh -c` script of a service, as the container runs it ($$ is Compose's escaped $). */
function loop(name: string): string {
  const ep = prod[name]?.entrypoint;
  expect(ep?.slice(0, 2)).toEqual(['/bin/sh', '-c']);
  return (ep?.[2] ?? '').replaceAll('$$', '$');
}

let dir: string;
let bin: string;
const log = () => (existsSync(join(dir, 'calls.log')) ? readFileSync(join(dir, 'calls.log'), 'utf8') : '');

function stub(name: string, body: string) {
  writeFileSync(join(bin, name), `#!/bin/sh\n${body}`);
  chmodSync(join(bin, name), 0o755);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'prod-loops-'));
  bin = join(dir, 'bin');
  mkdirSync(bin);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const env = (extra: Record<string, string> = {}) => ({
  PATH: `${bin}:${process.env.PATH}`,
  CALLS: join(dir, 'calls.log'),
  ...extra,
});

describe('web-prod-entrypoint.sh', () => {
  const SCRIPT = resolve('docker/web-prod-entrypoint.sh');

  beforeEach(() => {
    // Like the real nginx, it installs its own signal handlers: a process
    // started with `&` by a non-interactive sh inherits SIGINT and SIGQUIT
    // ignored, and only a program that sets handlers (nginx, node) gets
    // them back. `nginx -s reload` is logged; NGINX_EXIT makes it stop alone.
    writeFileSync(
      join(bin, 'nginx'),
      `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const say = (m) => appendFileSync(process.env.CALLS, m + '\\n');
const args = process.argv.slice(2);
if (args[0] === '-s') { say('reload'); process.exit(process.env.RELOAD_FAILS ? 1 : 0); }
if (process.env.NGINX_EXIT) process.exit(Number(process.env.NGINX_EXIT));
for (const s of ['SIGQUIT', 'SIGTERM', 'SIGINT']) process.on(s, () => { say('stopped-' + s.slice(3)); process.exit(0); });
say('started ' + args.join(' '));
setInterval(() => {}, 1000);
`,
    );
    chmodSync(join(bin, 'nginx'), 0o755);
  });

  function start(extra: Record<string, string> = {}) {
    const child = spawn('sh', [SCRIPT], { env: env({ RELOAD_INTERVAL: '0.1', ...extra }) });
    const exited = new Promise<number | null>((done) => child.on('exit', (code) => done(code)));
    return { child, exited };
  }
  const until = async (cond: () => boolean, ms = 3000) => {
    for (let t = 0; t < ms && !cond(); t += 20) await new Promise((r) => setTimeout(r, 20));
    expect(cond()).toBe(true);
  };

  it('starts nginx in the foreground and reloads it periodically', async () => {
    const { child, exited } = start();
    await until(() => (log().match(/^reload$/gm) ?? []).length >= 2);
    expect(log()).toContain('started -g daemon off;');
    child.kill('SIGQUIT');
    expect(await exited).toBe(0);
  });

  for (const sig of ['SIGQUIT', 'SIGTERM', 'SIGINT'] as const) {
    it(`passes ${sig} on to nginx and exits with its status`, async () => {
      const { child, exited } = start({ RELOAD_INTERVAL: '3600' });
      await until(() => log().includes('started'));
      child.kill(sig);
      expect(await exited).toBe(0);
      expect(log()).toContain(`stopped-${sig.slice(3)}`);
    });
  }

  it('exits with the status of nginx when nginx stops on its own', async () => {
    const { exited } = start({ NGINX_EXIT: '3' });
    expect(await exited).toBe(3);
  });

  it('keeps nginx running when a reload fails', async () => {
    const { child, exited } = start({ RELOAD_FAILS: '1' });
    await until(() => (log().match(/^reload$/gm) ?? []).length >= 2);
    child.kill('SIGTERM');
    expect(await exited).toBe(0);
  });
});

describe('certbot and backup loops (compose.prod.yaml)', () => {
  // `sleep` ends the loop: it sends TERM to the shell, which the loop traps.
  beforeEach(() => stub('sleep', 'echo "sleep $*" >> "$CALLS"\nkill -TERM $PPID\n'));

  describe('certbot', () => {
    const run = (extra: Record<string, string> = {}) => {
      const script = loop('certbot').replaceAll('/tmp/last-run', join(dir, 'last-run'));
      return spawnSync('sh', ['-c', script], { encoding: 'utf8', env: env(extra) });
    };

    beforeEach(() => stub('certbot', 'echo "certbot $*" >> "$CALLS"\n[ -z "${FAIL:-}" ] || exit 1\n'));

    it('renews as a non-root user with writable dirs in /tmp, then sleeps 12 hours', () => {
      const r = run();
      expect(r.status).toBe(0);
      expect(log()).toContain(
        'certbot renew --quiet --config-dir /etc/letsencrypt --work-dir /tmp/certbot --logs-dir /tmp/certbot/logs',
      );
      expect(log()).toContain('sleep 43200');
      expect(existsSync(join(dir, 'last-run'))).toBe(true);
    });

    it('keeps looping (and stays healthy) when a renewal fails', () => {
      const r = run({ FAIL: '1' });
      expect(r.status).toBe(0);
      expect(r.stderr).toContain('certbot renew failed');
      expect(log()).toContain('sleep 43200');
      expect(existsSync(join(dir, 'last-run'))).toBe(true);
    });

    it('is healthy only after a recent pass of the loop', () => {
      const test = (prod.certbot?.healthcheck?.test?.[1] ?? '').replaceAll('/tmp/last-run', join(dir, 'last-run'));
      expect(spawnSync('sh', ['-c', test]).status).not.toBe(0);
      run();
      expect(spawnSync('sh', ['-c', test]).status).toBe(0);
      const old = new Date(Date.now() - 14 * 3600 * 1000);
      utimesSync(join(dir, 'last-run'), old, old);
      expect(spawnSync('sh', ['-c', test]).status).not.toBe(0);
    });
  });

  describe('backup', () => {
    let backups: string;
    const run = (extra: Record<string, string> = {}) => {
      const script = loop('backup').replaceAll('/backups', backups);
      return spawnSync('sh', ['-c', script], { encoding: 'utf8', env: env(extra) });
    };
    const dumps = () => readdirSync(backups).sort();

    beforeEach(() => {
      backups = join(dir, 'backups');
      mkdirSync(backups);
      // Writes "dump" into --file=..., or fails half-way with FAIL.
      stub(
        'pg_dump',
        `echo "pg_dump $*" >> "$CALLS"
for a; do case "$a" in --file=*) f="\${a#--file=}" ;; esac; done
echo partial > "$f"
[ -z "\${FAIL:-}" ] || exit 1
echo dump > "$f"
`,
      );
    });

    it('writes a dated custom-format dump, readable by the group only, then sleeps a day', () => {
      const r = run();
      expect(r.status).toBe(0);
      expect(log()).toMatch(/pg_dump --format=custom --file=\S+\.tmp/);
      const [file] = dumps();
      expect(file).toMatch(/^umami-\d{8}T\d{6}Z\.dump$/);
      expect(readFileSync(join(backups, file!), 'utf8')).toBe('dump\n');
      expect(statSync(join(backups, file!)).mode & 0o777).toBe(0o640);
      expect(log()).toContain('sleep 86400');
    });

    it('never leaves a partial dump behind', () => {
      const r = run({ FAIL: '1' });
      expect(r.status).toBe(0);
      expect(r.stderr).toContain('backup FAILED');
      expect(dumps()).toEqual([]);
    });

    it('deletes dumps older than 14 days and keeps the others', () => {
      const old = join(backups, 'umami-20200101T000000Z.dump');
      const recent = join(backups, 'umami-20200110T000000Z.dump');
      const other = join(backups, 'notes.txt');
      for (const f of [old, recent, other]) writeFileSync(f, 'x');
      const days = (n: number) => new Date(Date.now() - n * 86400 * 1000);
      utimesSync(old, days(20), days(20));
      utimesSync(recent, days(5), days(5));
      utimesSync(other, days(30), days(30));
      run();
      expect(existsSync(old)).toBe(false);
      expect(existsSync(recent)).toBe(true);
      expect(existsSync(other)).toBe(true);
    });

    it('is healthy only with a dump younger than 26 hours', () => {
      const test = (prod.backup?.healthcheck?.test?.[1] ?? '').replaceAll('/backups', backups);
      expect(spawnSync('sh', ['-c', test]).status).not.toBe(0);
      run();
      expect(spawnSync('sh', ['-c', test]).status).toBe(0);
      for (const f of dumps()) utimesSync(join(backups, f), new Date(Date.now() - 27 * 3600 * 1000), new Date(Date.now() - 27 * 3600 * 1000));
      expect(spawnSync('sh', ['-c', test]).status).not.toBe(0);
    });
  });
});

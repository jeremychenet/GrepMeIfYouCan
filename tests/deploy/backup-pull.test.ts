import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// deploy/backup-pull.sh (J20): off-server copy of the Umami dumps, then a
// restore test of the newest one. Run for real with fake rsync and docker.
const SCRIPT = resolve('deploy/backup-pull.sh');

const STUBS: Record<string, string> = {
  // Copies the files of $REMOTE (stands for the server folder) into the
  // destination (last argument).
  rsync: `echo "rsync $*" >> "$CALLS"
for a; do dest="$a"; done
[ -z "\${RSYNC_FAILS:-}" ] || exit 23
cp "$REMOTE"/* "$dest" 2>/dev/null || true
`,
  // run / exec / rm of the throwaway PostgreSQL. pg_restore stores its stdin.
  docker: `echo "docker $*" >> "$CALLS"
case "$*" in
  "run "*) echo cid ;;
  *" pg_isready "*) [ -z "\${NEVER_READY:-}" ] ;;
  *" pg_restore "*) cat > "$RESTORED"; [ -z "\${RESTORE_FAILS:-}" ] ;;
  *"information_schema.tables"*) echo "\${TABLES:-12}" ;;
  *" psql "*) echo 3 ;;
  *) exit 0 ;;
esac
`,
  sleep: 'exit 0\n',
};

let dir: string;
let remote: string;
let dest: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'backup-pull-'));
  const bin = join(dir, 'bin');
  remote = join(dir, 'remote');
  dest = join(dir, 'home', 'Backups', 'grepmeifyoucan');
  for (const d of [bin, remote]) mkdirSync(d, { recursive: true });
  for (const [name, body] of Object.entries(STUBS)) {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}`);
    chmodSync(join(bin, name), 0o755);
  }
  writeFileSync(join(remote, 'umami-20261027T020000Z.dump'), 'old');
  writeFileSync(join(remote, 'umami-20261028T020000Z.dump'), 'newest');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(env: Record<string, string> = {}) {
  const r = spawnSync('sh', [SCRIPT], {
    encoding: 'utf8',
    env: {
      PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
      HOME: join(dir, 'home'),
      CALLS: join(dir, 'calls.log'),
      REMOTE: remote,
      RESTORED: join(dir, 'restored'),
      PG_IMAGE: 'postgres:18.6-alpine3.24',
      ...env,
    },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const calls = () => readFileSync(join(dir, 'calls.log'), 'utf8');

describe('backup-pull.sh', () => {
  it('copies the dumps from the server into a private folder, without deleting local ones', () => {
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, 'umami-20250101T020000Z.dump'), 'kept');
    const r = run();
    expect(r.code).toBe(0);
    expect(calls()).toContain(`rsync -a -e ssh -o BatchMode=yes jeremy@77.37.86.163:/opt/grepmeifyoucan/backups/ ${dest}/`);
    expect(calls()).not.toContain('--delete');
    expect(statSync(dest).mode & 0o777).toBe(0o700);
    expect(existsSync(join(dest, 'umami-20250101T020000Z.dump'))).toBe(true);
    expect(existsSync(join(dest, 'umami-20261028T020000Z.dump'))).toBe(true);
  });

  it('restores the newest dump into a blank throwaway database, then removes it', () => {
    const r = run();
    expect(r.code).toBe(0);
    expect(readFileSync(join(dir, 'restored'), 'utf8')).toBe('newest');
    expect(calls()).toMatch(/docker run -d --rm --name gmiyc-restore-test-\d+ .* postgres:18\.6-alpine3\.24/);
    expect(calls()).toContain('pg_isready -q -h 127.0.0.1');
    expect(calls()).toContain('pg_restore --no-owner --exit-on-error');
    expect(calls()).toMatch(/docker rm -f gmiyc-restore-test-\d+\s*$/);
    expect(r.out).toContain('restore OK: 12 tables, 3 website(s), 3 event(s)');
  });

  it('uses the settings from the environment', () => {
    run({ BACKUP_HOST: 'admin@example.test', BACKUP_SRC: '/srv/b', BACKUP_DEST: join(dir, 'elsewhere') });
    expect(calls()).toContain(`admin@example.test:/srv/b/ ${join(dir, 'elsewhere')}/`);
  });

  it('requires the PostgreSQL image', () => {
    const r = run({ PG_IMAGE: '' });
    expect(r.code).not.toBe(0);
    expect(r.err).toContain('set PG_IMAGE');
  });

  const failures: [string, Record<string, string>, RegExp][] = [
    ['the copy fails', { RSYNC_FAILS: '1' }, /^/],
    ['the restore fails', { RESTORE_FAILS: '1' }, /^/],
    ['PostgreSQL never starts', { NEVER_READY: '1' }, /did not start/],
    ['the restored database is empty', { TABLES: '0' }, /no table/],
  ];
  for (const [what, env, message] of failures) {
    it(`fails, and removes the throwaway database, when ${what}`, () => {
      const r = run(env);
      expect(r.code).not.toBe(0);
      expect(r.err).toMatch(message);
      expect(r.out).not.toContain('restore OK');
      if (!env.RSYNC_FAILS) expect(calls()).toMatch(/docker rm -f gmiyc-restore-test-\d+\s*$/);
    });
  }

  it('fails when there is no dump at all', () => {
    rmSync(remote, { recursive: true });
    mkdirSync(remote);
    const r = run();
    expect(r.code).toBe(1);
    expect(r.err).toContain('no dump');
    expect(calls()).not.toContain('docker run');
  });
});

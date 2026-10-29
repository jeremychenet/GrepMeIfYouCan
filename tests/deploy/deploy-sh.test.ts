import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// deploy/deploy.sh is the forced command of the deploy SSH key (SPEC §6.5).
// It runs here for real, with fake docker, curl and flock in the PATH that
// record their calls in calls.log.
const SCRIPT = resolve('deploy/deploy.sh');
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

const STUBS: Record<string, string> = {
  // Records "IMAGE_TAG=<tag> <args>". `up` fails for the tag in FAIL_UP (or
  // always with FAIL_UP_ALL), `pull` for the tag in FAIL_PULL. `image ls`
  // prints IMAGE_TAGS.
  docker: `#!/bin/sh
echo "IMAGE_TAG=\${IMAGE_TAG:-} $*" >> "$CALLS"
case " $* " in
  *" image ls "*) for t in $IMAGE_TAGS; do echo "$t"; done ;;
  *" up "*) [ -z "\${FAIL_UP_ALL:-}" ] && [ "\${IMAGE_TAG:-}" != "\${FAIL_UP:-}" ] || exit 1 ;;
  *" pull "*) [ "\${IMAGE_TAG:-}" != "\${FAIL_PULL:-}" ] || exit 1 ;;
esac
exit 0
`,
  // Writes the requested URL into the -o file.
  curl: `#!/bin/sh
echo "curl $*" >> "$CALLS"
[ -z "\${FAIL_CURL:-}" ] || exit 22
out=""; url=""
while [ $# -gt 0 ]; do
  case "$1" in -o) out="$2"; shift ;; https://*) url="$1" ;; esac
  shift
done
echo "$url" > "$out"
`,
  flock: `#!/bin/sh
[ -z "\${LOCKED:-}" ] || exit 1
exit 0
`,
};

let base: string;
let bin: string;

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'deploy-sh-'));
  base = join(root, 'srv');
  bin = join(root, 'bin');
  mkdirSync(base);
  mkdirSync(bin);
  for (const [name, body] of Object.entries(STUBS)) {
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  }
});

afterEach(() => rmSync(join(base, '..'), { recursive: true, force: true }));

function run(command: string | undefined, env: Record<string, string> = {}) {
  const r = spawnSync('sh', [SCRIPT], {
    encoding: 'utf8',
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      GMIYC_BASE: base,
      CALLS: join(base, 'calls.log'),
      IMAGE_TAGS: '',
      ...(command === undefined ? {} : { SSH_ORIGINAL_COMMAND: command }),
      ...env,
    },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const calls = () => (existsSync(join(base, 'calls.log')) ? readFileSync(join(base, 'calls.log'), 'utf8') : '');
const current = () => readFileSync(join(base, 'current'), 'utf8').trim();

describe('deploy.sh refuses every other command', () => {
  const refused = [
    undefined, // interactive session
    '',
    'ls',
    'sh',
    'deploy',
    'deploy ',
    `deploy ${SHA_A.slice(0, 7)}`,
    `deploy ${SHA_A}0`,
    `deploy ${SHA_A.toUpperCase()}`,
    `deploy ${SHA_A}; id`,
    `deploy ${SHA_A} && id`,
    `deploy ${SHA_A}\nid`,
    `deploy $(id)${SHA_A.slice(5)}`,
    `deploy ../../${SHA_A.slice(6)}`,
    `deploy  ${SHA_A}`,
    `deploy --help`,
    `status; id`,
    `scp -t /tmp`,
    'internal-sftp',
  ];
  for (const command of refused) {
    it(`refuses ${JSON.stringify(command)}`, () => {
      const r = run(command);
      expect(r.code).toBe(2);
      expect(r.err).toMatch(/^refused: /);
      expect(calls()).toBe('');
      expect(existsSync(join(base, 'releases'))).toBe(false);
    });
  }
});

describe('deploy.sh deploy <sha>', () => {
  it('fetches the compose files of that commit, pulls and starts its image', () => {
    const r = run(`deploy ${SHA_A}`);
    expect(r.code).toBe(0);
    expect(current()).toBe(SHA_A);

    const rel = join(base, 'releases', SHA_A);
    const raw = `https://raw.githubusercontent.com/jeremychenet/GrepMeIfYouCan/${SHA_A}`;
    expect(readFileSync(join(rel, 'compose.yaml'), 'utf8').trim()).toBe(`${raw}/compose.yaml`);
    expect(readFileSync(join(rel, 'compose.prod.yaml'), 'utf8').trim()).toBe(`${raw}/compose.prod.yaml`);
    expect(calls()).toContain("--proto =https");

    const compose = `compose --project-directory ${base} -f ${rel}/compose.yaml -f ${rel}/compose.prod.yaml --profile analytics`;
    expect(calls()).toContain(`IMAGE_TAG=${SHA_A} ${compose} pull --quiet`);
    expect(calls()).toContain(`IMAGE_TAG=${SHA_A} ${compose} up -d --no-build --remove-orphans --wait --wait-timeout 180`);
    expect(readFileSync(join(base, 'deploy.log'), 'utf8')).toMatch(new RegExp(`deployed ${SHA_A}`));
  });

  it('downloads the compose files of a commit only once', () => {
    run(`deploy ${SHA_A}`);
    run(`deploy ${SHA_A}`);
    expect(calls().match(/^curl /gm)).toHaveLength(2);
  });

  it('stops before touching the containers when the compose files cannot be fetched', () => {
    const r = run(`deploy ${SHA_A}`, { FAIL_CURL: '1' });
    expect(r.code).not.toBe(0);
    expect(calls()).not.toMatch(/IMAGE_TAG=/);
    expect(existsSync(join(base, 'releases', SHA_A))).toBe(false);
    expect(existsSync(join(base, 'current'))).toBe(false);
  });

  it('starts the previous release again when the new one is not healthy', () => {
    run(`deploy ${SHA_A}`);
    const r = run(`deploy ${SHA_B}`, { FAIL_UP: SHA_B });
    expect(r.code).toBe(1);
    expect(current()).toBe(SHA_A);
    const log = readFileSync(join(base, 'deploy.log'), 'utf8');
    expect(log).toContain(`FAILED ${SHA_B}`);
    expect(log).toContain(`rolled back to ${SHA_A}`);
    expect(calls().trim().split('\n').at(-1)).toMatch(new RegExp(`^IMAGE_TAG=${SHA_A} .* up -d `));
  });

  it('does not start anything new when the image cannot be pulled', () => {
    run(`deploy ${SHA_A}`);
    const r = run(`deploy ${SHA_B}`, { FAIL_PULL: SHA_B });
    expect(r.code).toBe(1);
    expect(current()).toBe(SHA_A);
    expect(calls()).not.toMatch(new RegExp(`IMAGE_TAG=${SHA_B} .* up `));
  });

  it('reports a failed rollback', () => {
    run(`deploy ${SHA_A}`);
    const r = run(`deploy ${SHA_B}`, { FAIL_UP_ALL: '1' });
    expect(r.code).toBe(1);
    expect(readFileSync(join(base, 'deploy.log'), 'utf8')).toContain(`ROLLBACK FAILED to ${SHA_A}`);
  });

  it('fails without rollback on the first deploy', () => {
    const r = run(`deploy ${SHA_A}`, { FAIL_UP: SHA_A });
    expect(r.code).toBe(1);
    expect(existsSync(join(base, 'current'))).toBe(false);
    expect(readFileSync(join(base, 'deploy.log'), 'utf8')).not.toContain('rolled back');
  });

  it('refuses to run while another deploy holds the lock', () => {
    const r = run(`deploy ${SHA_A}`, { LOCKED: '1' });
    expect(r.code).toBe(2);
    expect(r.err).toContain('another deploy is running');
    expect(calls()).toBe('');
  });

  it('keeps the 5 most recent releases and their images, and removes the others', () => {
    const shas = ['1', '2', '3', '4', '5', '6'].map((c) => c.repeat(40));
    shas.forEach((sha, i) => {
      run(`deploy ${sha}`, { IMAGE_TAGS: `${shas.slice(0, i + 1).join(' ')} local` });
      // Distinct modification times, oldest first.
      const t = new Date(Date.UTC(2026, 0, 1, 0, i));
      utimesSync(join(base, 'releases', sha), t, t);
    });
    expect(readdirSync(join(base, 'releases')).sort()).toEqual(shas.slice(1).sort());
    expect(calls()).toContain(`image rm ghcr.io/jeremychenet/grepmeifyoucan-web:${shas[0]}`);
    expect(calls()).toContain('image rm ghcr.io/jeremychenet/grepmeifyoucan-web:local');
    expect(calls()).not.toContain(`image rm ghcr.io/jeremychenet/grepmeifyoucan-web:${shas[5]}`);
  });

  it('a rollback to an older commit makes it the newest release (never pruned)', () => {
    run(`deploy ${SHA_A}`);
    const old = new Date(Date.UTC(2020, 0, 1));
    utimesSync(join(base, 'releases', SHA_A), old, old);
    run(`deploy ${SHA_B}`);
    run(`deploy ${SHA_A}`);
    expect(current()).toBe(SHA_A);
    const mtime = (sha: string) => statSync(join(base, 'releases', sha)).mtimeMs;
    expect(mtime(SHA_A)).toBeGreaterThanOrEqual(mtime(SHA_B));
    expect(mtime(SHA_A)).toBeGreaterThan(old.getTime());
  });
});

describe('deploy.sh status', () => {
  it('prints the current commit and the last deploys', () => {
    expect(run('status').out).toContain('current: none');
    run(`deploy ${SHA_A}`);
    const r = run('status');
    expect(r.code).toBe(0);
    expect(r.out).toContain(`current: ${SHA_A}`);
    expect(r.out).toContain(`deployed ${SHA_A}`);
  });
});

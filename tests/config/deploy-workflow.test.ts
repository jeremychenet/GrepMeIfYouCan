import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// Deploy pipeline (SPEC §6.5, PLAN J19): nothing reaches GHCR or the server
// without passing the Trivy scan, and the deploy job only holds the secrets
// it needs.
interface Step {
  name?: string;
  uses?: string;
  if?: string;
  run?: string;
  with?: Record<string, unknown>;
}
interface Job {
  if?: string;
  needs?: string | string[];
  environment?: string;
  permissions?: Record<string, string>;
  steps: Step[];
}
interface Workflow {
  on: { push?: { branches?: string[] }; workflow_dispatch?: { inputs?: Record<string, unknown> } };
  permissions: Record<string, string>;
  concurrency: { group: string; 'cancel-in-progress': boolean };
  jobs: Record<string, Job>;
}

const text = readFileSync('.github/workflows/deploy.yml', 'utf8');
const wf = parse(text) as Workflow;
function job(name: string): Job {
  const j = wf.jobs[name];
  if (!j) throw new Error(`no job ${name}`);
  return j;
}
const image = job('image');
const deploy = job('deploy');
const indexOf = (j: Job, name: RegExp) => j.steps.findIndex((s) => name.test(s.name ?? ''));
function step(j: Job, name: RegExp): Step {
  const s = j.steps[indexOf(j, name)];
  if (!s) throw new Error(`no step ${name}`);
  return s;
}

describe('deploy.yml', () => {
  it('runs on every push to main, and by hand for a rollback', () => {
    expect(wf.on.push?.branches).toEqual(['main']);
    expect(wf.on.workflow_dispatch?.inputs).toHaveProperty('sha');
  });

  it('runs one deploy at a time and never cancels one half-way', () => {
    expect(wf.concurrency).toEqual({ group: 'deploy', 'cancel-in-progress': false });
  });

  it('only grants write access to packages, in the image job', () => {
    expect(wf.permissions).toEqual({ contents: 'read' });
    expect(image.permissions).toEqual({ contents: 'read', packages: 'write' });
    expect(deploy.permissions).toEqual({ contents: 'read' });
  });

  it('pins every action by commit SHA', () => {
    const uses = Object.values(wf.jobs).flatMap((j) => j.steps.map((s) => s.uses).filter(Boolean));
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
  });

  it('builds the prod target without pushing, then scans before pushing', () => {
    const build = step(image, /^Build prod image$/);
    expect(build.with).toMatchObject({ target: 'prod', push: false, load: true });

    const scan = indexOf(image, /Trivy/);
    const push = indexOf(image, /Push to GHCR/);
    expect(scan).toBeGreaterThan(indexOf(image, /^Build prod image$/));
    expect(push).toBeGreaterThan(scan);
    expect(image.steps.filter((s) => /docker push/.test(s.run ?? ''))).toHaveLength(1);
  });

  it('fails the scan on a critical vulnerability, with the Trivy image of `make scan`', () => {
    const run = step(image, /Trivy/).run ?? '';
    expect(run).toMatch(/--severity CRITICAL --exit-code 1/);
    expect(run).toContain("sed -n 's/^TRIVY_IMAGE := //p' Makefile");
    expect(readFileSync('Makefile', 'utf8')).toMatch(/^TRIVY_IMAGE := aquasec\/trivy:\d+\.\d+\.\d+$/m);
  });

  it('pushes the image tagged with the commit SHA and main, from main only', () => {
    const push = step(image, /Push to GHCR/);
    expect(push.if).toBe("github.ref == 'refs/heads/main'");
    expect(push.run).toContain('docker push "$IMAGE:$GITHUB_SHA"');
    expect(push.run).toContain('docker push "$IMAGE:main"');
    expect(text).toContain('IMAGE: ghcr.io/jeremychenet/grepmeifyoucan-web');
  });

  it('deploys only from main, after the image job or for a rollback', () => {
    expect(deploy.needs).toBe('image');
    expect(deploy.if).toContain("github.ref == 'refs/heads/main'");
    expect(deploy.if).toContain("needs.image.result == 'success'");
    expect(deploy.if).toContain("needs.image.result == 'skipped' && inputs.sha != ''");
    expect(image.if).toBe("inputs.sha == ''");
  });

  it('keeps the SSH secrets in the production environment and checks the host key', () => {
    expect(deploy.environment).toBe('production');
    expect(image.steps.some((s) => /DEPLOY_SSH_KEY/.test(JSON.stringify(s)))).toBe(false);
    const ssh = step(deploy, /SSH/).run ?? '';
    expect(ssh).toContain('StrictHostKeyChecking=yes');
    expect(ssh).toContain('BatchMode=yes');
    expect(ssh).toContain('"deploy@$DEPLOY_HOST" "deploy $SHA"');
  });

  it('checks the SHA before using it', () => {
    expect(deploy.steps[0]?.run).toContain('^[0-9a-f]{40}$');
    expect(indexOf(deploy, /SSH/)).toBeGreaterThan(0);
  });

  it('ends with a healthcheck through the public Nginx', () => {
    const last = deploy.steps.at(-1);
    expect(last?.run).toContain('https://grepmeifyoucan.com/healthz');
  });
});

describe('deploy scripts', () => {
  const setup = readFileSync('deploy/setup-server.sh', 'utf8');
  const deploySh = readFileSync('deploy/deploy.sh', 'utf8');

  it('install deploy.sh as the forced command of the deploy key', () => {
    const path = /^COMMAND=(\S+)$/m.exec(setup)?.[1];
    expect(path).toBe('/usr/local/bin/grepmeifyoucan-deploy');
    expect(setup).toContain('install -o root -g root -m 755 "$HERE/deploy.sh" "$COMMAND"');
    expect(setup).toContain(`printf 'restrict,command="%s" %s\\n' "$COMMAND" "$PUBKEY"`);
    expect(setup).toMatch(/Match User \$DEPLOY_USER\n\s+ForceCommand \$COMMAND/);
    expect(deploySh).toContain(`/usr/local/bin/grepmeifyoucan-deploy`);
  });

  it('agree on the server directory and the image name', () => {
    expect(setup).toMatch(/^BASE=\/opt\/grepmeifyoucan$/m);
    expect(deploySh).toContain('BASE="${GMIYC_BASE:-/opt/grepmeifyoucan}"');
    expect(deploySh).toContain('IMAGE="ghcr.io/jeremychenet/grepmeifyoucan-web"');
    expect(readFileSync('compose.prod.yaml', 'utf8')).toContain('image: ghcr.io/jeremychenet/grepmeifyoucan-web:${IMAGE_TAG');
  });
});

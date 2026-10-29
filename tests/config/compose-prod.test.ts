import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// Production containers (SPEC §6.7, PLAN J18): every service is hardened the
// same way, and the site comes from the image, never from mounted code.
interface Service {
  image?: string;
  restart?: string;
  read_only?: boolean;
  user?: string;
  cap_drop?: string[];
  cap_add?: string[];
  security_opt?: string[];
  privileged?: boolean;
  logging?: { driver?: string; options?: Record<string, string> };
  deploy?: { resources?: { limits?: { cpus?: string; memory?: string; pids?: number } } };
  healthcheck?: { test?: string[] };
  volumes?: string[];
  ports?: string[];
  network_mode?: string;
  networks?: string[];
  build?: { target?: string };
}
type Compose = { services: Record<string, Service> };

const load = (file: string) => parse(readFileSync(file, 'utf8'), { merge: true }) as Compose;
const prod = load('compose.prod.yaml').services;
const base = load('compose.yaml').services;

describe('compose.prod.yaml', () => {
  it('covers every service of compose.yaml, plus the prod-only certbot and backup', () => {
    expect(Object.keys(prod).sort()).toEqual([...Object.keys(base), 'certbot', 'backup'].sort());
  });

  for (const [name, s] of Object.entries(prod)) {
    describe(name, () => {
      it('restarts, drops every capability and forbids new privileges', () => {
        expect(s.restart).toBe('unless-stopped');
        expect(s.cap_drop).toEqual(['ALL']);
        expect(s.cap_add).toBeUndefined();
        expect(s.security_opt).toContain('no-new-privileges:true');
        expect(s.privileged).toBeUndefined();
        expect(s.network_mode).toBeUndefined();
      });

      it('has a read-only file system', () => {
        expect(s.read_only).toBe(true);
      });

      it('has memory, CPU and process limits', () => {
        expect(s.deploy?.resources?.limits?.memory).toMatch(/^\d+M$/);
        expect(s.deploy?.resources?.limits?.cpus).toMatch(/^\d+(\.\d+)?$/);
        expect(s.deploy?.resources?.limits?.pids).toBeGreaterThan(0);
      });

      it('rotates its logs', () => {
        expect(s.logging?.driver).toBe('json-file');
        expect(s.logging?.options?.['max-size']).toBeDefined();
        expect(s.logging?.options?.['max-file']).toBeDefined();
      });

      it('has a healthcheck (here or in compose.yaml)', () => {
        expect((s.healthcheck ?? base[name]?.healthcheck)?.test?.length).toBeGreaterThan(0);
      });

      it('never mounts the Docker socket', () => {
        const all = [...(s.volumes ?? []), ...(base[name]?.volumes ?? [])];
        expect(all.filter((v) => v.includes('docker.sock'))).toEqual([]);
      });
    });
  }

  it('runs db, backup and certbot as explicit non-root users (web and umami images are non-root already)', () => {
    for (const name of ['db', 'backup', 'certbot']) expect(prod[name]?.user).toMatch(/^[1-9]\d*:[1-9]\d*$/);
  });

  describe('certbot', () => {
    const certbot = prod['certbot']!;

    it('runs as nginx (uid 101), so web can read the private key it writes', () => {
      expect(certbot.user).toBe('101:101');
    });

    it('pins its image and writes only the certificate and ACME webroot volumes', () => {
      expect(certbot.image).toMatch(/^certbot\/certbot:v\d+\.\d+\.\d+$/);
      expect(certbot.volumes).toEqual(['letsencrypt:/etc/letsencrypt', 'certbot-webroot:/var/www/certbot']);
      expect(certbot.ports).toBeUndefined();
    });

    it('uses the same image as deploy/setup-server.sh (first certificate)', () => {
      const setup = readFileSync('deploy/setup-server.sh', 'utf8');
      expect(/^CERTBOT_IMAGE=(\S+)$/m.exec(setup)?.[1]).toBe(certbot.image);
    });
  });

  describe('backup', () => {
    const backup = prod['backup']!;

    it('uses the image of db and its non-root user', () => {
      expect(backup.image).toBe(base['db']?.image);
      expect(backup.user).toBe(prod['db']?.user);
    });

    it('only reaches the internal network and writes only BACKUP_DIR', () => {
      expect(backup.networks).toEqual(['analytics']);
      expect(backup.volumes).toEqual(['${BACKUP_DIR:-./.cache/backups}:/backups']);
      expect(backup.ports).toBeUndefined();
    });
  });

  describe('web', () => {
    const web = prod['web']!;

    it('runs the prod target, tagged by IMAGE_TAG', () => {
      expect(web.build?.target).toBe('prod');
      expect(web.image).toMatch(/^ghcr\.io\/[a-z0-9-]+\/grepmeifyoucan-web:\$\{IMAGE_TAG:\?/);
    });

    it('mounts no code: only certificates and the ACME webroot, read-only', () => {
      expect(web.volumes).toEqual([
        '${LETSENCRYPT_DIR:-letsencrypt}:/etc/letsencrypt:ro',
        'certbot-webroot:/var/www/certbot:ro',
      ]);
    });

    it('publishes only 80 and 443, on loopback unless WEB_BIND says otherwise', () => {
      expect(web.ports).toEqual(['${WEB_BIND:-127.0.0.1}:80:8080', '${WEB_BIND:-127.0.0.1}:443:8443']);
    });
  });

  it('publishes no port for db and umami (internal network only)', () => {
    for (const name of ['db', 'umami']) {
      expect(prod[name]?.ports).toBeUndefined();
      expect(base[name]?.ports).toBeUndefined();
    }
  });
});

describe('compose.yaml', () => {
  it('keeps dev-only services out of the shared file', () => {
    expect(Object.keys(base)).not.toContain('proxy');
    expect(Object.keys(base)).not.toContain('e2e');
  });
});

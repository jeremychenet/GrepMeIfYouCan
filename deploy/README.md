# Deployment

Every merge on `main` deploys automatically (SPEC §6.5,
[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)):

1. **build** the `prod` image of `docker/web.Dockerfile`;
2. **scan** it with Trivy (same image as `make scan`): a critical
   vulnerability stops the run, nothing is pushed or deployed;
3. **push** it to GHCR as `ghcr.io/jeremychenet/grepmeifyoucan-web:<sha>`
   (and `:main`);
4. **deploy** over SSH: the deploy key can only run
   [`deploy.sh`](./deploy.sh), which fetches `compose.yaml` and
   `compose.prod.yaml` at that commit, pulls the image, starts it and waits
   for every healthcheck. If the new release is not healthy, the previous one
   is started again and the run fails;
5. **healthcheck** `https://grepmeifyoucan.com/healthz` from outside.

Production stack (`compose.prod.yaml`): `web` (Nginx: site + `/stats`
proxy), `db` + `umami` (analytics), `certbot` (certificate renewal) and
`backup` (daily dump), all non-root, read-only, without capability.

## Server layout

| Path | Owner | Content |
|---|---|---|
| `/usr/local/bin/grepmeifyoucan-deploy` | root, 755 | `deploy.sh`, the only command the deploy key can run |
| `/home/deploy/.ssh/authorized_keys` | root, 644 | the deploy key, `restrict,command="…"` |
| `/etc/ssh/sshd_config.d/10-grepmeifyoucan.conf` | root | keys only, no root login, `ForceCommand` for `deploy` |
| `/opt/grepmeifyoucan/.env` | deploy, 600 | `WEB_BIND=0.0.0.0`, `BACKUP_DIR`, Umami secrets (`LETSENCRYPT_DIR` only until the first Let's Encrypt certificate) |
| `/opt/grepmeifyoucan/releases/<sha>/` | deploy | compose files of the last 5 deploys |
| `/opt/grepmeifyoucan/current`, `deploy.log` | deploy | deployed commit, history |
| `/opt/grepmeifyoucan/backups/` | uid 70 (postgres), group admin, 2750 | daily Umami dumps, 14 days |
| volume `grepmeifyoucan-prod_letsencrypt` | uid 101 | Let's Encrypt account and certificates (certbot writes, nginx reads) |
| volume `grepmeifyoucan-prod_certbot-webroot` | uid 101 | HTTP-01 challenge files |
| `/opt/grepmeifyoucan/tls/` | root | temporary self-signed certificate of a new server, removed once Let's Encrypt has issued one |

The `deploy` user is in the `docker` group, which is equivalent to root: its
key is only safe because it cannot run anything but `deploy.sh`. The CI never
updates `deploy.sh` on the server; only an admin does, with
`setup-server.sh`.

## Preparing the server (once)

Requirements: Ubuntu LTS with Docker Engine and the Compose plugin
([official repository](https://docs.docker.com/engine/install/ubuntu/)), an
admin user who logs in with an SSH key and has `sudo`, automatic security
updates (`unattended-upgrades`, enabled by default on Ubuntu).

**Firewall**: at the hosting provider (Hostinger: VPS > Security > Firewall),
accept only TCP 22, 80 and 443; everything else is dropped. It sits outside
the server, so Docker (which bypasses `ufw`) cannot open a port by mistake.
Other admin tools (Grafana, Prometheus…) are reached through an SSH tunnel:
`ssh -L 4000:localhost:4000 <admin>@<server>`.

1. Create a deploy key (on your machine, never committed):

   ```bash
   ssh-keygen -t ed25519 -N '' -C gha-deploy@grepmeifyoucan -f deploy_key
   ```

2. Copy the scripts and run the setup (it asks for your sudo password):

   ```bash
   scp -r deploy <admin>@<server>:gmiyc-setup
   ssh -t <admin>@<server> "sudo bash gmiyc-setup/setup-server.sh '$(cat deploy_key.pub)'"
   ```

   Keep your SSH session open and check that a new one still works: the setup
   disables password and root logins (it refuses to run if your admin user
   has no SSH key), removes the `PermitRootLogin yes` line of the main
   `sshd_config` (backup: `sshd_config.orig`) and prints the effective values
   (`sshd -T`).

   Recent OpenSSH (`PerSourcePenalties`) blocks an address for a while after
   repeated failed logins: the connection is then reset before
   authentication, even with a valid key. It lifts on its own (at most
   10 minutes); avoid scripts that retry with a wrong key.

3. Let the server pull the private image: create a **classic** personal
   access token with only `read:packages` (fine-grained tokens do not cover
   GHCR yet), then:

   ```bash
   ssh -t <admin>@<server> 'sudo -u deploy -H docker login ghcr.io -u jeremychenet --password-stdin'
   # paste the token, then Ctrl-D
   ```

4. GitHub, environment `production` (Settings > Environments, deployment
   branches: protected branches only):

   ```bash
   gh api -X PUT repos/jeremychenet/GrepMeIfYouCan/environments/production \
     -f 'deployment_branch_policy[protected_branches]=true' \
     -F 'deployment_branch_policy[custom_branch_policies]=false'
   gh secret set DEPLOY_SSH_KEY --env production < deploy_key
   ssh-keygen -F <server> | grep -v '^#' > known_hosts   # the host key you already trust
   gh secret set DEPLOY_KNOWN_HOSTS --env production < known_hosts
   gh variable set DEPLOY_HOST --env production --body <server IP>
   rm deploy_key known_hosts
   ```

   `PUBLIC_UMAMI_WEBSITE_ID` (repository variable, optional) is passed to the
   image build: create the site in Umami first (admin through an SSH tunnel to
   the `umami` container), then set it; the next deploy adds the tracker.

5. Check that the key can do nothing else:

   ```bash
   ssh -i deploy_key deploy@<server> ls            # refused: only 'deploy <sha>' and 'status' are allowed
   ssh -i deploy_key deploy@<server>               # refused (no shell, no TTY)
   ssh -i deploy_key -W 127.0.0.1:22 deploy@<server>      # forwarding refused (administratively prohibited)
   ssh -i deploy_key deploy@<server> status        # current commit and last deploys
   ```

To update `deploy.sh` later, run step 2 again: it is safe to re-run, and it
keeps the existing `.env` and certificate.

## DNS

At the registrar (Hostinger: Domains > DNS):

| Name | Type | Value |
|---|---|---|
| `@` | A | server IPv4 |
| `www` | A | server IPv4 |
| `@` | CAA | `0 issue "letsencrypt.org"` (no other authority may issue a certificate) |

No AAAA record: Docker publishes 80/443 in IPv4 only (`WEB_BIND=0.0.0.0`).
An AAAA record without IPv6 listeners breaks the site for IPv6 visitors, and
Let's Encrypt tries IPv6 first. IPv6 needs its own change (IPv6 Docker
network, `listen [::]` in Nginx, provider firewall rules).

## Certificate (Let's Encrypt)

The `certbot` service of `compose.prod.yaml` renews the certificate twice a
day (certbot only acts within 30 days of expiry), and `web` reloads its
config every 6 hours to pick it up. certbot runs as nginx's uid (101), so the
private key stays `600` and readable by `web`. Let's Encrypt no longer sends
expiry emails: the account has no email.

The first certificate needs a running site to answer the HTTP-01 challenge,
and the site needs a certificate to start. On a **new server**:

1. run `setup-server.sh`: no certificate yet, it writes a temporary
   self-signed one and `LETSENCRYPT_DIR` in `.env`;
2. deploy once (merge, or Actions > Deploy with the current `sha`);
3. run `setup-server.sh` again: with `web` running, it asks Let's Encrypt
   (a staging dry run first, then the real one), then removes
   `LETSENCRYPT_DIR` from `.env`;
4. deploy again: `web` now reads the certbot volume; a last run of
   `setup-server.sh` removes the temporary certificate.

Test the renewal (staging, changes nothing):

```bash
ssh <admin>@<server> 'docker exec grepmeifyoucan-prod-certbot-1 certbot renew --dry-run \
  --config-dir /etc/letsencrypt --work-dir /tmp/certbot --logs-dir /tmp/certbot/logs'
```

## Backups

The `backup` service dumps the Umami database every day
(`pg_dump --format=custom`) into `/opt/grepmeifyoucan/backups`, keeps
14 days, and is unhealthy if the newest dump is older than 26 hours.

**Off-server copy**, from the Mac, at least once a week:

```bash
make backup-pull
```

It copies every dump to `~/Backups/grepmeifyoucan` (never deleted there),
then restores the newest one into a blank, throwaway PostgreSQL (same image
as `db`) and prints the number of tables, websites and events: a backup is
only trusted once restored.

**Restore in production** (replaces the Umami data; stop the writers first):

```bash
scp ~/Backups/grepmeifyoucan/umami-<date>.dump <admin>@<server>:/tmp/umami.dump
ssh <admin>@<server>
docker stop grepmeifyoucan-prod-umami-1 grepmeifyoucan-prod-backup-1
docker exec -i grepmeifyoucan-prod-db-1 pg_restore --clean --if-exists --no-owner \
  -U umami -d umami < /tmp/umami.dump
docker start grepmeifyoucan-prod-umami-1 grepmeifyoucan-prod-backup-1
rm /tmp/umami.dump
```

## Umami admin

Never public: `/stats` only exposes the tracker and the collection endpoint.
Through an SSH tunnel to the `umami` container:

```bash
# Both lines in the same terminal ($ip does not cross terminals).
ip=$(ssh <admin>@<server> "docker inspect -f '{{(index .NetworkSettings.Networks \"grepmeifyoucan-prod_default\").IPAddress}}' grepmeifyoucan-prod-umami-1")
echo "$ip"                                   # e.g. 172.20.0.3; empty = stop here
ssh -N -L 3002:$ip:3000 <admin>@<server>     # then http://localhost:3002
```

Port 3002 locally: 3001 is the dev stack's Umami. The address changes when
a deploy recreates the container: run the first line again.

On the first login (`admin` / `umami`), change the password right away. Add
the website `grepmeifyoucan.com`, then set its id for the next builds:
`gh variable set PUBLIC_UMAMI_WEBSITE_ID --body <id>`. The next deploy adds
the tracker.

## Rollback

Redeploy an earlier commit. Its image is still in GHCR, and its compose files
are fetched at that commit, so the whole stack goes back:

- **GitHub**: Actions > Deploy > Run workflow, branch `main`, `sha` = the
  full commit SHA (previous ones: `ssh deploy@<server> status`, or the
  history of the Deploy workflow). Build and scan are skipped.
- **From a machine holding the deploy key**:
  `ssh -i deploy_key deploy@<server> "deploy <sha>"`.

The next merge on `main` deploys the new commit again. A failed deploy rolls
back on its own (see above): the site keeps running the previous release.

Database data (Umami) lives in a named volume and is not rolled back: an
Umami upgrade that migrates the database cannot be undone this way; restore a
backup taken before it (see Backups).

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

## Server layout

| Path | Owner | Content |
|---|---|---|
| `/usr/local/bin/grepmeifyoucan-deploy` | root, 755 | `deploy.sh`, the only command the deploy key can run |
| `/home/deploy/.ssh/authorized_keys` | root, 644 | the deploy key, `restrict,command="…"` |
| `/etc/ssh/sshd_config.d/10-grepmeifyoucan.conf` | root | keys only, no root login, `ForceCommand` for `deploy` |
| `/opt/grepmeifyoucan/.env` | deploy, 600 | `WEB_BIND=0.0.0.0`, `LETSENCRYPT_DIR`, Umami secrets |
| `/opt/grepmeifyoucan/releases/<sha>/` | deploy | compose files of the last 5 deploys |
| `/opt/grepmeifyoucan/current`, `deploy.log` | deploy | deployed commit, history |
| `/opt/grepmeifyoucan/tls/` | root | temporary self-signed certificate (Let's Encrypt in J20) |

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
   has no SSH key).

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
   ssh -i deploy_key -N -L 5432:db:5432 deploy@<server>   # port forwarding refused
   ssh -i deploy_key deploy@<server> status        # current commit and last deploys
   ```

To update `deploy.sh` later, run step 2 again: it is safe to re-run, and it
keeps the existing `.env` and certificate.

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
Umami upgrade that migrates the database cannot be undone this way (backups:
J20).

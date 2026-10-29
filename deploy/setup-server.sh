#!/bin/bash
# One-time (and re-runnable) preparation of the production server, Ubuntu LTS
# with Docker Engine + Compose already installed (deploy/README.md).
#
#   scp -r deploy <admin>@<server>:gmiyc-setup
#   ssh -t <admin>@<server> 'sudo bash gmiyc-setup/setup-server.sh "<deploy public key>"'
#
# What it does, each step safe to run again:
#   - user `deploy` (no password, group docker) whose only SSH key can run
#     nothing but /usr/local/bin/grepmeifyoucan-deploy (installed from
#     deploy.sh next to this file, owned by root);
#   - /opt/grepmeifyoucan with a .env (generated secrets, kept if present)
#     and the backups folder;
#   - the certificate: a temporary self-signed one on a new server; once the
#     site runs, the Let's Encrypt one (webroot, staging dry run first), then
#     .env switches to it (redeploy to apply);
#   - SSH: keys only, no root login, nothing but the forced command for
#     `deploy` (refuses to run if the admin user has no key: no lock-out);
#   - disables the host nginx (ports 80/443 belong to the `web` container).
# The firewall is the hosting provider's (only 22, 80, 443 allowed): it sits
# outside the server, so Docker cannot bypass it.
set -euo pipefail

DEPLOY_USER=deploy
BASE=/opt/grepmeifyoucan
COMMAND=/usr/local/bin/grepmeifyoucan-deploy
SSHD_DROPIN=/etc/ssh/sshd_config.d/10-grepmeifyoucan.conf
# Compose project and image of the certbot service (compose.prod.yaml, kept
# equal by tests/config/compose-prod.test.ts).
PROJECT=grepmeifyoucan-prod
CERTBOT_IMAGE=certbot/certbot:v5.8.0
DOMAIN=grepmeifyoucan.com
HERE="$(cd "$(dirname "$0")" && pwd)"

die() {
  echo "error: $*" >&2
  exit 1
}
step() { echo "==> $*"; }

[ "$(id -u)" -eq 0 ] || die "run with sudo"
[ $# -eq 1 ] || die "usage: setup-server.sh \"<deploy public key>\""
PUBKEY="$1"
[[ "$PUBKEY" =~ ^ssh-ed25519\ [A-Za-z0-9+/]+=*(\ [^[:cntrl:]]*)?$ ]] || die "expected one ssh-ed25519 public key"
[ -f "$HERE/deploy.sh" ] || die "deploy.sh must sit next to this script"
command -v docker > /dev/null || die "Docker is not installed"
docker compose version > /dev/null || die "the Docker Compose plugin is not installed"

# Never lock the admin out: password login is only disabled when the user
# running sudo already logs in with a key.
ADMIN="${SUDO_USER:-}"
[ -n "$ADMIN" ] && [ "$ADMIN" != root ] || die "run through sudo from your admin user"
ADMIN_HOME="$(getent passwd "$ADMIN" | cut -d: -f6)"
grep -qE '^(ssh-|ecdsa-|sk-)' "$ADMIN_HOME/.ssh/authorized_keys" 2> /dev/null \
  || die "$ADMIN has no SSH key in $ADMIN_HOME/.ssh/authorized_keys"

step "User $DEPLOY_USER"
if ! id "$DEPLOY_USER" > /dev/null 2>&1; then
  useradd --create-home --shell /bin/sh "$DEPLOY_USER"
fi
usermod -aG docker "$DEPLOY_USER"
passwd -l "$DEPLOY_USER" > /dev/null

step "Deploy command $COMMAND (owned by root)"
install -o root -g root -m 755 "$HERE/deploy.sh" "$COMMAND"

step "Deploy key: forced command only"
DEPLOY_HOME="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
# Owned by root: the deploy user cannot change its own keys.
install -d -o root -g root -m 755 "$DEPLOY_HOME/.ssh"
printf 'restrict,command="%s" %s\n' "$COMMAND" "$PUBKEY" > "$DEPLOY_HOME/.ssh/authorized_keys"
chown root:root "$DEPLOY_HOME/.ssh/authorized_keys"
chmod 644 "$DEPLOY_HOME/.ssh/authorized_keys"

step "$BASE"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 755 "$BASE"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 755 "$BASE/releases"
if [ ! -f "$BASE/.env" ]; then
  umask 077
  cat > "$BASE/.env" << EOF
# Production settings, read by docker compose (deploy.sh). Never commit.
WEB_BIND=0.0.0.0
# Temporary self-signed certificate until the Let's Encrypt one exists
# (setup-server.sh removes this line once it is issued).
LETSENCRYPT_DIR=$BASE/tls
BACKUP_DIR=$BASE/backups
UMAMI_DB_PASSWORD=$(openssl rand -hex 32)
UMAMI_APP_SECRET=$(openssl rand -hex 32)
EOF
  umask 022
fi
grep -q '^BACKUP_DIR=' "$BASE/.env" || echo "BACKUP_DIR=$BASE/backups" >> "$BASE/.env"
chown "$DEPLOY_USER:$DEPLOY_USER" "$BASE/.env"
chmod 600 "$BASE/.env"

step "Backups ($BASE/backups)"
# Written by the backup container (postgres, uid 70), readable by the admin
# group for `make backup-pull` (setgid: new dumps inherit the group).
install -d -o 70 -g "$ADMIN" -m 2750 "$BASE/backups"

step "Certificate volumes (written by certbot as uid 101, read by nginx)"
[ -f "$HERE/init-cert-volumes.sh" ] || die "init-cert-volumes.sh must sit next to this script"
sh "$HERE/init-cert-volumes.sh" "$PROJECT" "$CERTBOT_IMAGE"

# certbot as in compose.prod.yaml: uid 101, read-only, no capability.
certbot() {
  docker run --rm --user 101:101 --read-only --tmpfs /tmp:uid=101,gid=101 \
    --cap-drop ALL --security-opt no-new-privileges \
    -v "${PROJECT}_letsencrypt:/etc/letsencrypt" \
    -v "${PROJECT}_certbot-webroot:/var/www/certbot" \
    "$CERTBOT_IMAGE" "$@" \
    --config-dir /etc/letsencrypt --work-dir /tmp/certbot --logs-dir /tmp/certbot/logs
}
has_certificate() {
  docker run --rm --user 101:101 --entrypoint test \
    -v "${PROJECT}_letsencrypt:/etc/letsencrypt:ro" "$CERTBOT_IMAGE" \
    -s "/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
}
# The web container answers the HTTP-01 challenge.
web_running() {
  [ -n "$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" \
    --filter "label=com.docker.compose.service=web" --filter status=running)" ]
}

# A running container still mounts the temporary certificate.
tls_in_use() {
  docker ps -q | xargs -r docker inspect -f '{{range .Mounts}}{{.Source}} {{end}}' \
    | grep -q "$BASE/tls"
}

step "Let's Encrypt certificate ($DOMAIN, www.$DOMAIN)"
if has_certificate; then
  echo "already issued (renewed by the certbot service)"
elif web_running; then
  issue=(certonly --webroot -w /var/www/certbot --cert-name "$DOMAIN"
    -d "$DOMAIN" -d "www.$DOMAIN" --non-interactive --agree-tos
    --register-unsafely-without-email --key-type ecdsa)
  # Staging first: a mistake never counts against the production rate limits.
  certbot "${issue[@]}" --dry-run
  certbot "${issue[@]}"
else
  echo "no web container yet: deploy once with the temporary certificate, then run this script again"
fi

if has_certificate; then
  # From the next deploy on, web reads the certbot volume (compose.prod.yaml
  # default).
  sed -i '/^LETSENCRYPT_DIR=/d;/^# Temporary self-signed certificate/d;/^# (setup-server.sh removes this line/d' "$BASE/.env"
  if [ -d "$BASE/tls" ] && ! tls_in_use; then
    rm -rf "$BASE/tls"
    echo "temporary certificate removed"
  elif [ -d "$BASE/tls" ]; then
    echo "REDEPLOY NOW: web still uses the temporary certificate (removed on the next run)"
  fi
else
  LIVE="$BASE/tls/live/$DOMAIN"
  if [ ! -f "$LIVE/fullchain.pem" ]; then
    install -d -m 755 "$LIVE"
    openssl req -x509 -newkey rsa:2048 -nodes -days 90 -subj "/CN=$DOMAIN" \
      -addext "subjectAltName=DNS:$DOMAIN,DNS:www.$DOMAIN" \
      -keyout "$LIVE/privkey.pem" -out "$LIVE/fullchain.pem" 2> /dev/null
    # Read by nginx (uid 101) in the container. Throwaway key until the
    # Let's Encrypt certificate exists.
    chmod 644 "$LIVE/privkey.pem"
  fi
fi

step "SSH hardening ($SSHD_DROPIN)"
# 10- is read before the image's 50-cloud-init.conf: the first value wins.
cat > "$SSHD_DROPIN" << EOF
# Written by grepmeifyoucan deploy/setup-server.sh
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PermitUserEnvironment no

Match User $DEPLOY_USER
    ForceCommand $COMMAND
    AllowTcpForwarding no
    AllowAgentForwarding no
    AllowStreamLocalForwarding no
    PermitTunnel no
    PermitTTY no
    X11Forwarding no
EOF
chmod 644 "$SSHD_DROPIN"
# The drop-in already wins (first value read), but a `PermitRootLogin yes`
# left in the main file is misleading: remove it (backup kept once).
if grep -qE '^[[:space:]]*PermitRootLogin[[:space:]]+yes[[:space:]]*$' /etc/ssh/sshd_config; then
  [ -f /etc/ssh/sshd_config.orig ] || cp -p /etc/ssh/sshd_config /etc/ssh/sshd_config.orig
  sed -i -E '/^[[:space:]]*PermitRootLogin[[:space:]]+yes[[:space:]]*$/d' /etc/ssh/sshd_config
fi
sshd -t || {
  rm -f "$SSHD_DROPIN"
  [ ! -f /etc/ssh/sshd_config.orig ] || cp -p /etc/ssh/sshd_config.orig /etc/ssh/sshd_config
  die "invalid sshd configuration, nothing changed"
}
echo "effective: $(sshd -T | grep -iE '^(permitrootlogin|passwordauthentication) ' | tr '\n' ' ')"
# Socket-activated on recent Ubuntu: reload only if running (open sessions
# stay up; new ones read the new configuration either way).
systemctl try-reload-or-restart ssh

step "Host nginx"
if systemctl list-unit-files nginx.service > /dev/null 2>&1; then
  systemctl disable --now nginx > /dev/null 2>&1 || true
  echo "nginx: $(systemctl is-active nginx || true), $(systemctl is-enabled nginx || true)"
fi

step "Done"
cat << EOF
Next (deploy/README.md):
  1. Log the deploy user in to GHCR with a read:packages token:
       sudo -u $DEPLOY_USER -H docker login ghcr.io -u jeremychenet --password-stdin
  2. Keep an SSH session open and check from your Mac that you can still log in.
EOF

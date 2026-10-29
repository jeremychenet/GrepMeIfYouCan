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
#     and a temporary self-signed certificate (Let's Encrypt comes in J20);
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
# Temporary self-signed certificate until Let's Encrypt (J20).
LETSENCRYPT_DIR=$BASE/tls
UMAMI_DB_PASSWORD=$(openssl rand -hex 32)
UMAMI_APP_SECRET=$(openssl rand -hex 32)
EOF
  umask 022
fi
chown "$DEPLOY_USER:$DEPLOY_USER" "$BASE/.env"
chmod 600 "$BASE/.env"

LIVE="$BASE/tls/live/grepmeifyoucan.com"
if [ ! -f "$LIVE/fullchain.pem" ]; then
  install -d -m 755 "$LIVE"
  openssl req -x509 -newkey rsa:2048 -nodes -days 90 -subj "/CN=grepmeifyoucan.com" \
    -addext "subjectAltName=DNS:grepmeifyoucan.com,DNS:www.grepmeifyoucan.com" \
    -keyout "$LIVE/privkey.pem" -out "$LIVE/fullchain.pem" 2> /dev/null
  # Read by nginx (uid 101) in the container. Throwaway key, replaced in J20.
  chmod 644 "$LIVE/privkey.pem"
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
sshd -t || {
  rm -f "$SSHD_DROPIN"
  die "invalid sshd configuration, nothing changed"
}
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

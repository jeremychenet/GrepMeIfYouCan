#!/bin/sh
# `make backup-pull` (J20, deploy/README.md): copies the Umami dumps of the
# server to this machine (the off-server copy), then restores the newest one
# into a blank, throwaway PostgreSQL to prove it can be restored.
# Runs on the maintainer's Mac: needs ssh, rsync and Docker only.
#
# Settings (environment):
#   BACKUP_HOST  admin login on the server   (jeremy@77.37.86.163)
#   BACKUP_SRC   dumps on the server         (/opt/grepmeifyoucan/backups)
#   BACKUP_DEST  local copies, never deleted ($HOME/Backups/grepmeifyoucan)
#   PG_IMAGE     PostgreSQL image of the db service (set by the Makefile)
set -eu

HOST="${BACKUP_HOST:-jeremy@77.37.86.163}"
SRC="${BACKUP_SRC:-/opt/grepmeifyoucan/backups}"
DEST="${BACKUP_DEST:-$HOME/Backups/grepmeifyoucan}"
PG_IMAGE="${PG_IMAGE:?set PG_IMAGE (the db image of compose.yaml)}"

mkdir -p "$DEST"
chmod 700 "$DEST"

echo "==> Copy $HOST:$SRC to $DEST"
# No --delete: local copies outlive the 14 days kept on the server.
rsync -a -e "ssh -o BatchMode=yes" "$HOST:$SRC/" "$DEST/"
# -a also copies the server folder's mode (2750) onto DEST: private again.
chmod 700 "$DEST"

latest="$(find "$DEST" -maxdepth 1 -name 'umami-*.dump' | sort | tail -n 1)"
[ -n "$latest" ] || {
  echo "error: no dump in $DEST" >&2
  exit 1
}

echo "==> Restore $(basename "$latest") into a blank database"
name="gmiyc-restore-test-$$"
docker run -d --rm --name "$name" -e POSTGRES_USER=umami -e POSTGRES_DB=umami \
  -e POSTGRES_PASSWORD=restore-test "$PG_IMAGE" > /dev/null
trap 'docker rm -f "$name" > /dev/null 2>&1 || true' EXIT

# Over TCP: the image's first-start server only listens on its socket, and
# restarts once initialised.
ready=""
for _ in $(seq 60); do
  if docker exec "$name" pg_isready -q -h 127.0.0.1 -U umami -d umami; then
    ready=1
    break
  fi
  sleep 1
done
[ -n "$ready" ] || {
  echo "error: the throwaway PostgreSQL did not start" >&2
  exit 1
}

docker exec -i "$name" pg_restore --no-owner --exit-on-error -h 127.0.0.1 -U umami -d umami < "$latest"

q() { docker exec "$name" psql -h 127.0.0.1 -U umami -d umami -tAc "$1"; }
tables="$(q "select count(*) from information_schema.tables where table_schema = 'public'")"
[ "$tables" -gt 0 ] || {
  echo "error: the restored database has no table" >&2
  exit 1
}
echo "restore OK: $tables tables, $(q 'select count(*) from website') website(s), $(q 'select count(*) from website_event') event(s)"

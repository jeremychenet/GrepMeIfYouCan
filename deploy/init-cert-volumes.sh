#!/bin/sh
# Certificate volumes of the prod stack (J20), owned by uid 101: the certbot
# service writes them as nginx's user, so the private key it creates (600)
# stays readable by `web`, which mounts them read-only. A new named volume
# belongs to root: this creates both volumes the way Compose would (same
# labels) and hands them to uid 101. Safe to run again.
# Used by deploy/setup-server.sh (server) and `make prod-local` (Mac).
# Usage: init-cert-volumes.sh <compose project> <certbot image>
set -eu

project="$1"
image="$2"

for v in letsencrypt certbot-webroot; do
  if ! docker volume inspect "${project}_$v" > /dev/null 2>&1; then
    docker volume create --label "com.docker.compose.project=$project" \
      --label "com.docker.compose.volume=$v" "${project}_$v" > /dev/null
  fi
done
docker run --rm --user 0 --entrypoint chown \
  -v "${project}_letsencrypt:/le" -v "${project}_certbot-webroot:/webroot" \
  "$image" 101:101 /le /webroot

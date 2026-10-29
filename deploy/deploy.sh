#!/bin/sh
# Forced command of the deploy SSH key (SPEC §6.5, deploy/README.md).
# setup-server.sh installs it as /usr/local/bin/grepmeifyoucan-deploy, owned
# by root: CI can run it, never change it. To update it, run setup-server.sh
# again.
#
# Accepted commands (read from $SSH_ORIGINAL_COMMAND, anything else is
# refused):
#   deploy <commit SHA, 40 hex>   deploy (or roll back to) that commit
#   status                        current commit and the last deploys
#
# A deploy fetches compose.yaml and compose.prod.yaml at that commit, pulls
# the image tagged with it, starts it and waits for every healthcheck. If that
# fails, the previous release is started again and the script exits non-zero.
# Plain POSIX sh: runs the same on the server and in the tests (Alpine).
set -eu

# GMIYC_BASE only exists for the tests: sshd does not pass client variables
# to the deploy user (no PermitUserEnvironment, AcceptEnv is LANG/LC_* only).
BASE="${GMIYC_BASE:-/opt/grepmeifyoucan}"
REPO_RAW="https://raw.githubusercontent.com/jeremychenet/GrepMeIfYouCan"
IMAGE="ghcr.io/jeremychenet/grepmeifyoucan-web"
KEEP=5
WAIT_TIMEOUT=180

refuse() {
  echo "refused: $1" >&2
  exit 2
}

log() {
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" >> "$BASE/deploy.log"
  echo "$*"
}

# docker compose on the release of commit $1 (the rest are compose arguments).
# --project-directory keeps the server's .env and the named volumes the same
# for every release.
compose() {
  rel="$BASE/releases/$1"
  tag="$1"
  shift
  IMAGE_TAG="$tag" docker compose --project-directory "$BASE" \
    -f "$rel/compose.yaml" -f "$rel/compose.prod.yaml" --profile analytics "$@"
}

# Compose files of commit $1, downloaded once (a commit never changes).
fetch() {
  dir="$BASE/releases/$1"
  if [ ! -f "$dir/compose.prod.yaml" ]; then
    rm -rf "$dir.tmp"
    mkdir -p "$dir.tmp"
    for f in compose.yaml compose.prod.yaml; do
      curl -fsS --proto '=https' --max-time 30 -o "$dir.tmp/$f" "$REPO_RAW/$1/$f"
    done
    mv "$dir.tmp" "$dir"
  fi
  # Newest first in prune(), even when an old commit is deployed again.
  touch "$dir"
}

# Keeps the KEEP most recent releases and their images (the rollback targets).
prune() {
  cd "$BASE/releases"
  # shellcheck disable=SC2012 # names are commit SHAs (hex), ls -t is safe
  ls -1t | tail -n +$((KEEP + 1)) | while read -r old; do rm -rf "./$old"; done
  docker image ls "$IMAGE" --format '{{.Tag}}' | while read -r t; do
    [ -d "./$t" ] || docker image rm "$IMAGE:$t" > /dev/null 2>&1 || true
  done
}

up() {
  compose "$1" up -d --no-build --remove-orphans --wait --wait-timeout "$WAIT_TIMEOUT"
}

status() {
  echo "current: $(cat "$BASE/current" 2> /dev/null || echo none)"
  tail -n 10 "$BASE/deploy.log" 2> /dev/null || true
}

deploy() {
  sha="$1"
  exec 9> "$BASE/.deploy.lock"
  flock -n 9 || refuse "another deploy is running"

  prev="$(cat "$BASE/current" 2> /dev/null || true)"
  fetch "$sha"
  log "deploy $sha (previous: ${prev:-none})"

  if compose "$sha" pull --quiet && up "$sha"; then
    echo "$sha" > "$BASE/current.tmp"
    mv "$BASE/current.tmp" "$BASE/current"
    log "deployed $sha"
    prune
    return 0
  fi

  log "FAILED $sha"
  if [ -n "$prev" ] && [ "$prev" != "$sha" ]; then
    if up "$prev"; then
      log "rolled back to $prev"
    else
      log "ROLLBACK FAILED to $prev"
    fi
  fi
  exit 1
}

cmd="${SSH_ORIGINAL_COMMAND:-}"
case "$cmd" in
  status)
    status
    ;;
  "deploy "*)
    sha="${cmd#deploy }"
    # Exactly 40 lowercase hex characters: no option, path, space or newline.
    case "$sha" in
      *[!0-9a-f]* | "") refuse "not a commit SHA" ;;
    esac
    [ "${#sha}" -eq 40 ] || refuse "not a full commit SHA"
    deploy "$sha"
    ;;
  *)
    refuse "only 'deploy <sha>' and 'status' are allowed"
    ;;
esac

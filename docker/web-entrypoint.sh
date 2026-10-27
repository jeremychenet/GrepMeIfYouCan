#!/bin/sh
# Installs dependencies only when package-lock.json changed since the last install.
set -eu

HASH_FILE=node_modules/.lock-hash

if [ -f package-lock.json ]; then
  current=$(sha256sum package-lock.json | cut -d' ' -f1)
  if [ "$(cat "$HASH_FILE" 2>/dev/null || true)" != "$current" ]; then
    echo "[entrypoint] package-lock.json changed: running npm ci"
    npm ci --no-audit --no-fund
    echo "$current" > "$HASH_FILE"
  fi
elif [ -f package.json ]; then
  echo "[entrypoint] no package-lock.json: running npm install"
  npm install --no-audit --no-fund
  sha256sum package-lock.json | cut -d' ' -f1 > "$HASH_FILE"
fi

# Astro writes a dev-server lock file into the bind-mounted .astro/ folder.
# A container stop can leave it behind and block the next start; inside a
# fresh container no other dev server can be running, so drop it.
rm -f .astro/dev.json

exec "$@"

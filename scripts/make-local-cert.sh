#!/bin/sh
# Self-signed certificate for `make prod-local`, in the Let's Encrypt layout
# that nginx.prod.conf reads (/etc/letsencrypt/live/grepmeifyoucan.com/).
# Valid for localhost and the public names, so the redirects can be tested
# with `curl --resolve`. Local only: never used on the server (certbot, J20).
# Usage: scripts/make-local-cert.sh [dir]   (default: .cache/tls)
set -eu

DIR="${1:-.cache/tls}"
LIVE="$DIR/live/grepmeifyoucan.com"

if [ -f "$LIVE/fullchain.pem" ] && [ -f "$LIVE/privkey.pem" ]; then
  exit 0
fi

mkdir -p "$LIVE"
openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,DNS:grepmeifyoucan.com,DNS:www.grepmeifyoucan.com" \
  -keyout "$LIVE/privkey.pem" -out "$LIVE/fullchain.pem" 2>/dev/null
# nginx runs as uid 101 in the container: the key must be readable by it.
# Acceptable for a throwaway local key only.
chmod 644 "$LIVE/privkey.pem"
echo "Self-signed certificate written to $LIVE"

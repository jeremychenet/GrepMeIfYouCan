#!/bin/sh
# Checks that the site answers 200 with the security headers of SPEC §7.4.
# Usage: scripts/check-headers.sh [base_url]   (default: http://localhost:8080)
# CURL_INSECURE=1 accepts a self-signed certificate (prod-local, check-prod.sh).
# Runs on the host: needs only curl.
set -eu

URL="${1:-http://localhost:8080}"
fail=0

insecure=""
[ "${CURL_INSECURE:-0}" = 1 ] && insecure=-k

headers=$(curl -sS $insecure -D - -o /dev/null --max-time 10 "$URL/") || {
  echo "FAIL  cannot reach $URL"; exit 1;
}

status=$(printf '%s\n' "$headers" | head -1 | tr -d '\r')
case "$status" in
  *" 200"*) echo "ok    $status" ;;
  *) echo "FAIL  expected 200, got: $status"; fail=1 ;;
esac

# expect <header-name> <substring that must appear in its value>
expect() {
  value=$(printf '%s\n' "$headers" | tr -d '\r' | grep -i "^$1:" | head -1 | cut -d: -f2- || true)
  if [ -z "$value" ]; then
    echo "FAIL  missing header $1"; fail=1
  elif ! printf '%s' "$value" | grep -qF -- "$2"; then
    echo "FAIL  $1 does not contain \"$2\":$value"; fail=1
  else
    echo "ok    $1 contains \"$2\""
  fi
}

expect Content-Security-Policy "default-src 'self'"
expect Content-Security-Policy "script-src 'self';"
expect Content-Security-Policy "object-src 'none'"
expect Content-Security-Policy "frame-ancestors 'none'"
expect X-Content-Type-Options "nosniff"
expect Referrer-Policy "strict-origin-when-cross-origin"
expect Permissions-Policy "camera=()"
expect Cross-Origin-Opener-Policy "same-origin"

if printf '%s\n' "$headers" | grep -qi '^server:.*nginx/[0-9]'; then
  echo "FAIL  Server header leaks the nginx version"; fail=1
else
  echo "ok    no server version leak"
fi

# The proxy must only listen on loopback (local dev only).
case "$URL" in
  http://localhost:*|http://127.0.0.1:*)
    port=${URL##*:}; port=${port%%/*}
    if command -v lsof >/dev/null 2>&1; then
      listeners=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {print $9}' | sort -u)
      if printf '%s\n' "$listeners" | grep -qvE '^(127\.0\.0\.1|\[::1\]):'; then
        echo "FAIL  port $port listens beyond loopback: $(echo $listeners)"; fail=1
      else
        echo "ok    port $port bound to loopback only"
      fi
    fi
    ;;
esac

[ "$fail" -eq 0 ] && echo "All header checks passed." || { echo "Header checks FAILED."; exit 1; }

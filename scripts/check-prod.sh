#!/bin/sh
# Checks the production containers started by `make prod-local` (PLAN J18):
# security headers and strict CSP, HSTS on the public domain only, redirects,
# routes, cache and compression, container hardening, image size.
# Runs on the host: needs curl and docker. The certificate is self-signed (-k).
# Usage: scripts/check-prod.sh
set -eu

BASE=https://localhost
PROJECT=grepmeifyoucan-prod
IMAGE=ghcr.io/jeremychenet/grepmeifyoucan-web:local
MAX_IMAGE_MB=50
DOMAIN=grepmeifyoucan.com
# Public names resolved to this machine, ports 80/443 (prod-local).
RESOLVE="--resolve $DOMAIN:443:127.0.0.1 --resolve www.$DOMAIN:443:127.0.0.1 --resolve $DOMAIN:80:127.0.0.1 --resolve www.$DOMAIN:80:127.0.0.1"
fail=0

ok() { echo "ok    $1"; }
ko() { echo "FAIL  $1"; fail=1; }

# Status, Location and headers of one request (no redirect followed).
# shellcheck disable=SC2086
fetch() { curl -ksS $RESOLVE -o /dev/null -D - --max-time 10 "$@" | tr -d '\r'; }
status() { printf '%s\n' "$1" | head -1 | cut -d' ' -f2; }
header() { printf '%s\n' "$1" | grep -i "^$2:" | head -1 | cut -d: -f2- | sed 's/^ //' || true; }

# expect_status <label> <code> [<location>] -- <curl args>
expect_status() {
  label=$1 code=$2 location=$3; shift 4
  h=$(fetch "$@") || { ko "$label: no answer"; return; }
  got=$(status "$h")
  loc=$(header "$h" location)
  if [ "$got" != "$code" ]; then ko "$label: expected $code, got $got"
  elif [ -n "$location" ] && [ "$loc" != "$location" ]; then ko "$label: Location is '$loc', expected '$location'"
  else ok "$label: $code${location:+ → $location}"; fi
}

echo "== Headers ($BASE)"
CURL_INSECURE=1 "$(dirname "$0")/check-headers.sh" "$BASE" || fail=1
home=$(fetch "$BASE/")
csp=$(header "$home" content-security-policy)
case "$csp" in
  *unsafe-inline*|*unsafe-eval*|*ws:*) ko "CSP is not the strict prod one: $csp" ;;
  *) ok "strict CSP (no unsafe-inline, no ws:)" ;;
esac
[ -z "$(header "$home" strict-transport-security)" ] && ok "no HSTS on localhost" || ko "HSTS sent on localhost"
hsts=$(header "$(fetch "https://$DOMAIN/")" strict-transport-security)
case "$hsts" in
  max-age=[0-9]*) ok "HSTS on $DOMAIN: $hsts" ;;
  *) ko "no HSTS on $DOMAIN" ;;
esac

echo "== Redirects"
expect_status "http → https" 301 "https://localhost/c/x?y=1" -- "http://localhost/c/x?y=1"
expect_status "http apex → https apex" 301 "https://$DOMAIN/" -- "http://$DOMAIN/"
expect_status "http www → https apex" 301 "https://$DOMAIN/about" -- "http://www.$DOMAIN/about"
expect_status "https www → https apex" 301 "https://$DOMAIN/about" -- "https://www.$DOMAIN/about"
expect_status "trailing slash" 301 "/about" -- "$BASE/about/"
if curl -sS -o /dev/null --max-time 5 -H 'Host: unknown.example' http://127.0.0.1/ 2>/dev/null; then
  ko "unknown host on HTTP gets an answer"
else
  ok "unknown host on HTTP: connection closed"
fi
if curl -ksS -o /dev/null --max-time 5 --resolve unknown.example:443:127.0.0.1 https://unknown.example/ 2>/dev/null; then
  ko "unknown host on HTTPS: handshake accepted"
else
  ok "unknown host on HTTPS: handshake refused"
fi

echo "== Routes"
card=$(curl -ksS --max-time 10 "$BASE/search-index.json" | sed -n 's/^\[{"id":"\([^"]*\)".*/\1/p')
[ -n "$card" ] || ko "cannot read a card id from /search-index.json"
expect_status "card page /c/$card" 200 "" -- "$BASE/c/$card"
expect_status "home" 200 "" -- "$BASE/"
expect_status "healthz (https)" 200 "" -- "$BASE/healthz"
expect_status "healthz (http, no redirect)" 200 "" -- "http://localhost/healthz"
expect_status "unknown page" 404 "" -- "$BASE/no-such-page"
if curl -ksS --max-time 10 "$BASE/no-such-page" | grep -q '<title>Page not found'; then
  ok "styled 404 page"
else
  ko "the 404 page is not the site's one"
fi
expect_status "/404.html is internal" 404 "" -- "$BASE/404.html"
expect_status "Umami admin not public" 404 "" -- "$BASE/stats/login"
expect_status "POST on a page" 403 "" -- -X POST "$BASE/"

echo "== Cache and compression"
asset=$(curl -ksS --max-time 10 "$BASE/" | grep -o '/_astro/[^"]*\.css' | head -1)
cc=$(header "$(fetch "$BASE$asset")" cache-control)
[ "$cc" = "max-age=31536000" ] && ok "hashed asset cached 1 year" || ko "asset $asset Cache-Control: '$cc'"
[ "$(header "$home" cache-control)" = "no-cache" ] && ok "HTML revalidated (no-cache)" || ko "HTML Cache-Control: '$(header "$home" cache-control)'"
enc=$(header "$(fetch -H 'Accept-Encoding: gzip' "$BASE/")" content-encoding)
[ "$enc" = "gzip" ] && ok "gzip" || ko "no gzip on HTML"

echo "== Containers"
for svc in web db umami certbot backup; do
  c="$PROJECT-$svc-1"
  if ! docker inspect "$c" >/dev/null 2>&1; then ko "$c is not running"; continue; fi
  info=$(docker inspect -f '{{.Config.User}}|{{.HostConfig.ReadonlyRootfs}}|{{.HostConfig.CapDrop}}|{{.HostConfig.CapAdd}}|{{.HostConfig.SecurityOpt}}|{{.HostConfig.Privileged}}|{{.State.Health.Status}}' "$c")
  IFS='|' read -r user ro capdrop capadd secopt privileged health <<EOF
$info
EOF
  case "$user" in ''|0|root|0:*|root:*) ko "$svc runs as root" ;; *) ok "$svc user: $user" ;; esac
  [ "$ro" = true ] && ok "$svc read-only root file system" || ko "$svc file system is writable"
  [ "$capdrop" = "[ALL]" ] && [ "$capadd" = "[]" ] && ok "$svc capabilities: none" || ko "$svc capabilities: drop=$capdrop add=$capadd"
  case "$secopt" in *no-new-privileges:true*) ok "$svc no-new-privileges" ;; *) ko "$svc without no-new-privileges" ;; esac
  [ "$privileged" = false ] || ko "$svc is privileged"
  [ "$health" = healthy ] && ok "$svc healthy" || ko "$svc health: $health"
done
code=$(docker inspect -f '{{range .Mounts}}{{.Destination}} {{end}}' "$PROJECT-web-1" 2>/dev/null || true)
case " $code " in
  *" /usr/share/nginx/html"*|*" /etc/nginx"*) ko "web mounts code or config: $code" ;;
  *) ok "web mounts no code: $code" ;;
esac

echo "== Image"
size=$(docker image inspect -f '{{.Size}}' "$IMAGE" 2>/dev/null || echo 0)
mb=$((size / 1000000))
if [ "$size" -gt 0 ] && [ "$mb" -lt "$MAX_IMAGE_MB" ]; then ok "web image: $mb MB (< $MAX_IMAGE_MB)"; else ko "web image: $mb MB (limit $MAX_IMAGE_MB)"; fi

if [ "$fail" -ne 0 ]; then echo "✗ prod checks failed"; exit 1; fi
echo "✓ prod checks passed"

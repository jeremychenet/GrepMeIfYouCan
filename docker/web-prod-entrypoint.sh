#!/bin/sh
# Entry point of the prod web image (J20): runs nginx and reloads it every
# RELOAD_INTERVAL seconds (6 hours), so a certificate renewed by the certbot
# container is picked up. certbot cannot signal nginx itself: the Docker
# socket is never mounted. A reload keeps open connections.
# Stop signals are passed on to nginx (the image's STOPSIGNAL is SIGQUIT:
# graceful shutdown).
set -eu

nginx -g 'daemon off;' &
nginx_pid=$!

(
  while sleep "${RELOAD_INTERVAL:-21600}"; do
    nginx -s reload || echo "nginx reload failed" >&2
  done
) &
reload_pid=$!

stop() {
  kill -"$1" "$nginx_pid" 2> /dev/null || true
}
trap 'stop QUIT' QUIT
trap 'stop TERM' TERM
trap 'stop INT' INT

# wait returns early when a trapped signal arrives: wait again for nginx.
code=0
wait "$nginx_pid" || code=$?
while kill -0 "$nginx_pid" 2> /dev/null; do
  wait "$nginx_pid" && code=0 || code=$?
done
kill "$reload_pid" 2> /dev/null || true
exit "$code"

# GrepMeIfYouCan

Find, adapt and copy the right Linux / Infra / DevOps command in under 10 seconds.

- Specification: [SPEC.md](./SPEC.md)
- Milestones: [PLAN.md](./PLAN.md)

## Requirements

- Docker Desktop (or OrbStack) and `make`. Node.js is **not** needed on the host: everything runs in containers.

## Quick start

```bash
cp .env.example .env
make up          # http://localhost:8080
```

## Make targets

| Target | Description |
|---|---|
| `make up` | Build and start the dev stack (hot reload) |
| `make up-analytics` | Same, plus Umami analytics and its PostgreSQL (see below) |
| `make down` | Stop the stack |
| `make logs` | Follow the web container logs |
| `make sh` | Shell inside the web container |
| `make npm ARGS="run build"` | Run any npm command inside the container |
| `make clean` | Stop and delete volumes (forces a fresh `npm ci`, deletes local Umami data) |
| `make check-headers` | Check the security headers served on :8080 |
| `make nginx-test` | Validate the Nginx configuration |

The site is only reachable through the Nginx proxy on `127.0.0.1:8080`, which adds the security headers (CSP…); the Astro dev server has no published port.

Dependencies are installed automatically at container start whenever `package-lock.json` changes.
If hot reload does not pick up file changes, set `WATCH_POLLING=true` in `.env` and run `make up` again.

## Local analytics (Umami)

1. In `.env`, set `UMAMI_DB_PASSWORD` and `UMAMI_APP_SECRET` (each from `openssl rand -hex 32`).
2. `make up-analytics`, then open the Umami admin at http://127.0.0.1:3001 (only on this machine, never through the proxy). Log in with `admin` / `umami` and change the password.
3. Settings > Websites > Add website (domain `localhost`), copy its id into `PUBLIC_UMAMI_WEBSITE_ID` in `.env`, then `docker restart grepmeifyoucan-web-1`.

Page views and the `copy`, `favorite` and `search_no_result` events then show up in the dashboard. Umami ignores headless browsers, so automated tests are not counted. Without `PUBLIC_UMAMI_WEBSITE_ID`, pages carry no tracker at all.

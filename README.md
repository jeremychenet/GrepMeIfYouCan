# GrepMeIfYouCan

Find, adapt and copy the right Linux / Infra / DevOps command in under 10 seconds.

- Specification: [SPEC.md](./SPEC.md)
- Milestones: [PLAN.md](./PLAN.md)

## Requirements

- Docker Desktop (or OrbStack) and `make`. Node.js is **not** needed on the host: everything runs in containers.

## Quick start

```bash
cp .env.example .env
make up          # http://localhost:4321
```

## Make targets

| Target | Description |
|---|---|
| `make up` | Build and start the dev stack (hot reload) |
| `make down` | Stop the stack |
| `make logs` | Follow the web container logs |
| `make sh` | Shell inside the web container |
| `make npm ARGS="run build"` | Run any npm command inside the container |
| `make clean` | Stop and delete volumes (forces a fresh `npm ci`) |

Dependencies are installed automatically at container start whenever `package-lock.json` changes.
If hot reload does not pick up file changes, set `WATCH_POLLING=true` in `.env` and run `make up` again.

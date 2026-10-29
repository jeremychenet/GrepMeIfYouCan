# CLAUDE.md

Guidance for Claude Code in this repository.

## Project

GrepMeIfYouCan (https://grepmeifyoucan.com, live since 2026-10-29) lets Linux / Infra / DevOps engineers find, adapt and copy the right shell command in under 5 seconds. v1 is shipped; v2 is being planned.

- `SPEC.md`: source of truth for behavior, security rules and scope (French). If an implementation choice contradicts it, update the spec in the same PR. SPEC §9 lists what is out of scope.
- `PLAN.md`: v2 milestones (French), each with objective, files and validation boxes, ticked in the milestone's PR. The v1 plan is archived in `docs/archive/PLAN-v1.md`.
- `deploy/README.md`: server, deployment, certificates, backups, Umami admin, rollback.
- Language: site UI and command content in **English only**; docs and conversation with the maintainer in French.

## How we work

- Present a plan in French first and wait for the maintainer's approval before coding.
- One branch and one PR per change; never push to `main` (protected). The maintainer merges, and every merge deploys. Extra fixes for an open PR go to the same branch.
- After pushing, stay on the PR branch until it is merged: the dev stack bind-mounts the working tree, so localhost shows the PR. Say which branch the working copy is on.
- **Every feature or bug fix ships with its tests in the same PR** (SPEC §8.1): Vitest for `src/lib/` and `scripts/`, Playwright for user flows, fixtures for every schema or danger rule. For a bug, write the failing test first. Prove a new test catches the problem by breaking the code once and watching it fail.
- Coverage thresholds are per file (`perFile: true`) and never lowered to pass a PR: ≥ 80 % (lines/functions/branches) on `src/lib/**` and `scripts/**`, ≥ 95 % on `copy.ts`, `template.ts`, `danger-patterns.ts`, `store.ts`, `schema.ts`, `lint-danger.ts` (add any new security-critical module to `thresholds` in `vitest.config.ts`).
- Server admin commands (ssh as the admin user, sudo, `gh` secrets/variables, production workflow runs) are run by the maintainer: give them the exact command (`! <command>` lands its output here).
- Run the full check before opening a PR: typecheck, `make coverage`, `make lint-content`, `make build` + `make check-dist`, `make e2e`; `make lighthouse` when the home page or loading changes.

## Commands

Everything runs in Docker; nothing (not even Node) is installed on the macOS host. `make` wraps `docker compose`; keep this table in sync with the `Makefile`.

| Target | Purpose |
|---|---|
| `make up` / `down` / `logs` / `sh` | Dev stack (`proxy` + `web`) at http://localhost:8080; `web` has no published port |
| `make up-analytics` | Adds `db` + `umami` (profile `analytics`; admin on 127.0.0.1:3001) |
| `make npm ARGS="<args>"` | npm inside `web` (e.g. `ARGS="run typecheck"`, `ARGS="install -E <pkg>@<version>"`: exact versions only) |
| `make clean` | `down -v` (fresh `npm ci`, drops local Umami data) |
| `make test` / `make coverage` | Vitest / Vitest with the CI thresholds |
| `make e2e` | Playwright against the dev stack (`ARGS=tests/e2e/search.spec.ts` for one spec) |
| `make lint-content` / `make lint-danger` | Schema + danger lint of `content/commands/**` / danger lint only (`ARGS=<dir>`, e.g. drafts) |
| `make build` / `make check-dist` | Build `dist/`, then check every page, meta, sitemap, search index, 404 |
| `make import-tldr` | Drafts from tldr-pages at the pinned SHA (`ARGS=--force` overwrites drafts) |
| `make lighthouse` | Lighthouse CI (mobile) on `dist/`, budgets in `lighthouserc.json` |
| `make check-headers` / `make nginx-test` | Security headers on :8080 / `nginx -t` on the dev proxy |
| `make prod-local` / `prod-down` / `prod-logs` | Production images on https://localhost (self-signed cert), project `grepmeifyoucan-prod` |
| `make check-prod` / `make e2e-prod` | Headers, CSP, redirects, cache, container hardening, image < 50 MB / whole E2E suite on prod-local |
| `make scan` | Trivy on the prod image (`docker save`, no Docker socket); fails on a critical vulnerability |
| `make lighthouse-prod` | Lighthouse on the live site (`lighthouserc.prod.json`) |
| `make backup-pull` | Copy the server's Umami dumps to `~/Backups/grepmeifyoucan` and test-restore the newest |

Single test: `make npm ARGS="exec vitest run tests/lib/search.test.ts"` (add `-t '<name>'`). Make does not forward `--`: pass everything via `ARGS=`.

Dev container (`docker/web-entrypoint.sh`): `npm ci` runs only when the sha256 of `package-lock.json` changes; the stale `.astro/dev.json` lock is removed at start. After adding a dependency or changing `astro.config.mjs`, run `docker restart grepmeifyoucan-web-1` (a long-running dev server can keep a stale content store and 404 every dynamic page). `@astrojs/check` caps TypeScript at 6.x.

Browser checks (screenshots, measurements): run `mcr.microsoft.com/playwright` (same tag as `@playwright/test`) with `--network container:grepmeifyoucan-proxy-1`, so `localhost:8080` works. Host Node is too old.

## Architecture

**Fully static site.** Astro + TypeScript builds every page; Nginx serves it. The only dynamic part is self-hosted Umami (own PostgreSQL), proxied under `/stats/`. No application API or database.

**Content pipeline:**
1. `scripts/import-tldr.ts` turns tldr-pages examples (pinned commit, `scripts/tldr-selection.yaml`) into drafts in `content/drafts/<category>/` (one example = one card). Idempotent; published cards are never recreated. When rejecting a draft, also remove its example number from the selection.
2. A human writes the one-sentence `description` (≤ 180 chars, says what the command does, ≠ title), reviews `danger`, and moves the file to `content/commands/<category>/<id>.yaml`. Visitor suggestions (GitHub issues) end up the same way, through a reviewed PR.
3. `src/content/schema.ts` (Zod from `astro/zod`, never a separate `zod` dependency) validates each card; `src/content/validate.ts` adds cross-file rules (unique id, id == file name, category == folder) and safety checks on raw YAML values (danger level via `src/lib/danger-patterns.ts`, unsafe characters via `src/lib/unsafe-chars.ts`). `scripts/validate-content.ts` runs before every build. New danger rule: add it to `RULES` with positive examples in `tests/lib/danger-patterns.test.ts` (a test fails if a rule has none), false-positive guards in `SAFE`. Invalid-card fixtures: `tests/fixtures/invalid/<rule>/<category>/<id>.yaml`.
4. The build produces `/c/<id>`, `/tools/<tool>`, `/categories/<category>` and `/search-index.json` (client-side MiniSearch). No trailing slash (`build.format: 'file'`). Paths and page meta live in `src/lib/pages.ts`, shared with `scripts/check-dist.ts`; pages not derived from content go in `STATIC_PAGES`.

Categories: `linux`, `unix` (other Unix systems), `containers`, `cloud-iac`, `git-ci`. Adding one: `CATEGORIES` + `CATEGORY_LABELS` + the suggestion form dropdown (a test keeps them equal) + an entry in `scripts/tldr-selection.yaml`. Platforms: `linux | macos | unix` (form checkboxes kept equal by the same test); a `unix` card names its system in the title ("(OpenBSD)") and in a tag. Danger levels: `safe | caution | destructive`.

**Invariants that are easy to break:**
- Copy builds the text from the card data (`copyCard` in `src/lib/copy.ts`), never from the DOM; never ends with `\n`; the first copy of each `destructive` card per session asks for confirmation (`sessionStorage`, every time if storage fails); a destructive copy is refused while a variable without default is empty. Values are sanitized (invisible/bidi removed, control chars → space) and inserted as plain text, never as HTML. `renderTemplate` reads own keys only (a variable named `constructor`).
- Favorites/history only through `src/lib/store.ts` (`localStorage`, keys `gmiyc:v1:*`, every access in `try/catch`, 500 favorites / 100 copied commands, never search queries, data re-validated on read, import merges). This layer exists so v2 can add server sync without touching the UI. In the browser use the `store` singleton of `src/components/LocalStore.ts` and `onStoreChange`.
- Result cards are clones of a `<template>` rendering a real `CommandCard`, filled by `ResultsList.ts` with `textContent` only: keep `ResultsList.ts` in sync with `CommandCard.astro`. Each relevance bug becomes a "card X in top 3 for query Y" case in `tests/lib/search.test.ts`.
- Strict CSP (`default-src 'self'`, no inline script or style): no third-party scripts, fonts or CDNs. The build never inlines CSS/JS (`inlineStylesheets: 'never'`, `assetsInlineLimit: 0`).
- Browser code must not import `src/content/schema.ts` (it bundles Zod): import from `src/content/constants.ts`. MiniSearch is loaded with the index, by dynamic import. One stylesheet, one shared entry script in `Base.astro`.
- CLS stays 0: a `<var>` and the `.var-input` replacing it have the same box; buttons hidden until JS keep their place (`visibility: hidden`); fonts are `font-display: optional` with width-matched fallbacks.
- `public/theme-init.js` (blocking, before first paint) sets `data-theme` (dark by default, light only when chosen; `src/lib/theme.ts` mirrors it, keep both in sync) and `data-initial-search` when the URL has `q`/`cat`/`tag`: only then does the home `main` reserve `100dvh` for late results. Otherwise the home fits the screen with the footer links in view (`tests/e2e/home.spec.ts`, 1280×720 and iPhone 13).
- Design ("terminal on paper", SPEC §3.1): reuse the shared blocks (`$` prompt band, square chips, numbered rows of `CardList.astro`, `.btn`, yellow `.var-input`, `.page-head`, `KeyBar.astro`); no new colors, radii, shadows or gradients. `--color-accent-fill` is for backgrounds only; orange text uses `--color-accent`. Colors are 6-digit hex tokens in `src/styles/tokens.css` (`:root` + `[data-theme='dark']`, then `[data-theme='light']`); add any new text/background pair to `tests/styles/contrast.test.ts` (WCAG AA).
- Mobile (SPEC §3.3): touch targets ≥ 44 px (`tests/e2e/responsive.spec.ts`); links that open GitHub forms use `NewTab.astro` (SVG arrow, announced to screen readers).
- Values typed in a field fill the same variable on the other cards of the page (`src/lib/shared-values.ts`), in memory only; destructive cards never receive one.
- Keyboard: `src/lib/keyboard.ts` maps key + focus context (`search | list | field | page`) to an action (pure, tested); `KeyboardNav.ts` applies it. Card lists stay plain lists with roving focus on the `article`s (never `listbox`/`option`: axe `nested-interactive`); the active `li` gets `aria-current`. Nothing runs on touch screens; keys are ignored while a `<dialog>` is open. New shortcut: add it to `SHORTCUTS` too. The CSS reset removes the `margin: auto` of modal dialogs: set it back on any new one.
- Analytics (SPEC §6.4) never block rendering and never throw (`trackEvent` → `track` in `src/lib/analytics.ts`). The tracker is added only when `PUBLIC_UMAMI_WEBSITE_ID` is set (GitHub variable for production builds), with `data-exclude-search`; Do Not Track is not followed. Nginx exposes only `/stats/script.js` and `/stats/api/send`. Umami ignores headless browsers: check the dashboard with a normal one.
- Nginx: headers in `docker/nginx/security-headers.conf` + CSP snippets. An `add_header` inside a `location` drops the inherited headers: re-include the snippets. `/stats` locations stay identical in dev and prod, and the dev CSP equals the prod one plus the two hot-reload relaxations (`tests/config/nginx.test.ts`).
- Astro treats `{...}` as expressions: literal shell text with braces goes through a variable (`<code>{cmd}</code>`).
- **Never type `\u` escapes in source files** (the editing tools turn them into raw characters): write code points numerically (`0x202e`, `String.fromCodePoint`). Check with `LC_ALL=C grep -n '[^[:print:][:space:]]' <files>`.
- Script entry points: argument handling in an exported, tested `cli(args)`; only the `import.meta.url` guard stays under `/* v8 ignore next 3 */`.
- E2E specs are `tests/e2e/*.spec.ts` (Vitest picks `*.test.ts`). Chromium only, no retries. The `e2e` image tag equals `@playwright/test` (a test checks it): bump both together. Console checks tolerate failed `/stats/` loads.

**Contributions** go through GitHub issue forms (`suggest-command.yml`, `report-issue.yml`), prefilled by `src/lib/github.ts` (query parameters named after the form field `id`s; `tests/lib/github.test.ts` checks them). "Suggest a command" is in the header, the footer and the empty search result; "Report an issue" on `/c/<id>`. Nothing is published without a reviewed, merged PR.

**Docker:** `compose.yaml` (shared `web`, `db`, `umami`) + `compose.dev.yaml` (dev `proxy`, `e2e`, bind mounts, ports on 127.0.0.1 only) + `compose.prod.yaml` (project `grepmeifyoucan-prod`, GHCR image, plus `certbot` and `backup`). Every prod service is non-root, read-only with tmpfs, `cap_drop: [ALL]`, `no-new-privileges`, with limits under `deploy.resources.limits`, a healthcheck and log rotation (`tests/config/compose-prod.test.ts`). One `docker/web.Dockerfile` with `dev`, `build` and `prod` stages; the prod Nginx image tag equals the dev proxy's (a test checks it). Pin every image version (no `latest`). Inline `sh -c` loops in Compose escape `$` as `$$` (`tests/deploy/prod-loops.test.ts` runs them).

**CI** (`.github/workflows/ci.yml`): jobs `checks` (Node from `.node-version`: typecheck, coverage, lint-content, build), `e2e`, `lighthouse`, `docker` (both images, `nginx -t`, prod image < 50 MB). Actions are pinned by commit SHA (`gh api repos/<owner>/<action>/commits/<tag> -q .sha`). Dependabot skips major Node/TypeScript/`@types/node` and nginx minor bumps: upgrade those deliberately in a dedicated PR.

**Deploy** (details in `deploy/README.md`): every merge to `main` builds the prod image, scans it with Trivy **before** any push, pushes to GHCR, then runs `ssh deploy@host "deploy <sha>"` and a healthcheck on https://grepmeifyoucan.com/healthz. A manual run on `main` with input `sha` is a rollback. On the server, `deploy/deploy.sh` is a forced SSH command accepting only `deploy <40 hex>` and `status`; it is installed by `deploy/setup-server.sh` (run by the maintainer with sudo), never updated by the CI. It is POSIX `sh`, tested on Alpine with stub binaries. Names shared across files (image, base dir, command path, certbot image) are kept equal by tests in `tests/config/` and `tests/deploy/`. Umami admin: SSH tunnel to the container (local port 3002).

## Licensing

tldr-pages content is CC BY 4.0: imported cards keep their `source` block, and attribution appears on the card and on `/about`. Code: MIT (`LICENSE`); `CONTENT_LICENSE` covers `content/`.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

GrepMeIfYouCan is a responsive website where Linux / Infra / DevOps engineers find, adapt and copy the right shell command in under 10 seconds. Production domain: `grepmeifyoucan.com`.

**No code exists yet.** The repo contains only the design documents:
- `SPEC.md` — the v1 specification (source of truth for behavior, security rules, scope). Written in French.
- `PLAN.md` — the MVP broken into 20 milestones (J1 → J20), each with objective, files and validation criteria as a checklist.

**Every new feature or bug fix ships with its tests in the same commit/PR** (SPEC §8.1): Vitest for logic in `src/lib/` and `scripts/`, Playwright for user flows, and fixtures for every new schema or danger rule. For a bug, write the failing test first. Coverage thresholds are enforced in CI and must never be lowered to make a PR pass. They apply **per file** (`perFile: true`): ≥ 80 % (lines/functions/branches) on `src/lib/**` and `scripts/**`, ≥ 95 % on security-critical modules (`copy.ts`, `template.ts`, `danger-patterns.ts`, `store.ts`, `schema.ts`, `lint-danger.ts`).

Work milestone by milestone, in order. A milestone is done only when every validation box in `PLAN.md` is checked; tick them in `PLAN.md` as part of the milestone's commit. If an implementation choice contradicts `SPEC.md`, update the spec in the same change rather than silently diverging. Things listed in SPEC §9 (accounts/OAuth, API, AI search, admin panel, web terminal, i18n) are out of scope for v1 — don't add them.

Language: site UI and command content are **English only**; spec/plan docs and conversation with the maintainer are in French.

## Commands (planned — defined in PLAN.md J1–J18)

Everything runs in Docker; nothing (not even Node) is installed on the macOS host. Use `make` targets, which wrap `docker compose`:

| Target | Purpose |
|---|---|
| `make up` / `make down` / `make logs` | Dev stack (`proxy` + `web`) at http://localhost:8080; `web` has no published port |
| `make check-headers` | Asserts status 200 + security headers + loopback-only binding (`scripts/check-headers.sh [url]`, host-side, curl only) |
| `make nginx-test` | `nginx -t` on the proxy config |
| `make up-analytics` | Adds `db` (PostgreSQL) + `umami` (Compose profile `analytics`) |
| `make npm ARGS="<args>"` / `make sh` | Run npm / a shell inside the `web` container (e.g. `make npm ARGS="run typecheck"`) |
| `make clean` | `down -v`: drops the `node_modules` volume (forces a fresh `npm ci`) |
| `make test` | Vitest unit tests |
| `make coverage` | Vitest with coverage thresholds (same check as CI). Add each new security-critical module to `thresholds` in `vitest.config.ts` |
| `make e2e` | Playwright E2E against the dev stack (service `e2e`, official Playwright image, Compose profile `test`; starts the stack if needed). Single spec: `make e2e ARGS=tests/e2e/search.spec.ts` |
| `make lint-content` | Schema validation + danger lint of `content/commands/**` |
| `make build` / `make check-dist` | Build `dist/`, then check it: one page per card/tool/category, title, meta description, canonical, danger badge/warning, sitemap (CI runs both) |
| `make import-tldr` | Regenerate drafts from tldr-pages at the pinned SHA (`ARGS=--force` overwrites edited drafts) |
| `make prod-local` | Run the production images locally |

Single test: `make npm ARGS="exec vitest run tests/lib/search.test.ts"` (or add `-t '<name>'`). Make does not forward `--` arguments, so always pass them via `ARGS=`. Keep this table in sync with the real `Makefile` (implemented so far: `help up down logs sh npm clean check-headers nginx-test test coverage e2e lint-content lint-danger import-tldr build check-dist`).

Dev container mechanics (`docker/web-entrypoint.sh`): dependencies are reinstalled with `npm ci` only when the sha256 of `package-lock.json` differs from `node_modules/.lock-hash`; the stale Astro lock `.astro/dev.json` is removed at each start (otherwise a restart fails with "Another astro dev server is already running"). To add a dependency: `make npm ARGS="install -E <pkg>@<version>"` (exact versions only). `@astrojs/check` caps TypeScript at 6.x. Astro telemetry and npm update notices are disabled in the image. After adding a dependency or changing `astro.config.mjs`, restart the dev server (`docker restart grepmeifyoucan-web-1`): a long-running one can keep a stale content store and 404 every dynamic page.

## Architecture (v1)

**Fully static site, no backend.** Astro + TypeScript generates every page at build time; Nginx serves it. The only dynamic component is self-hosted Umami analytics (with its own PostgreSQL). There is no application API or database in v1.

**Content pipeline** — the core of the project:
1. `scripts/import-tldr.ts` reads tldr-pages at a pinned commit (`scripts/tldr-selection.yaml`: page, tool, tags, example numbers per category) and writes **drafts** to `content/drafts/<category>/`. One tldr *example* becomes one card (not one card per tool). Pages are fetched from raw.githubusercontent.com (no `git` in the image) and cached in `.cache/tldr/<sha>/`. Placeholders: `{{[-x|--long]}}` → long form literally, URL → `{{url:<URL>}}`, other `:` → `_`; escaped/ambiguous braces and non-ASCII commands are skipped and reported. Idempotent: existing drafts are kept unless `ARGS=--force`, and published cards (same id, or same `source.page` + `source.example`) are never recreated. When rejecting a draft, also remove its number from the selection. CI runs `lint-danger` on `content/drafts`.
2. A human writes the mandatory one-sentence `description` (≤ 180 chars, explains what the command does, ≠ title), reviews `danger`, and moves the file to `content/commands/<category>/<id>.yaml`. Drafts are excluded from the build.
3. `src/content/schema.ts` (Zod from `astro/zod`, never a separate `zod` dependency) validates each card; `src/content/validate.ts` adds cross-file rules (unique id, id == file name, category == folder); `scripts/validate-content.ts` is the CLI and runs before every `npm run build`. Safety checks (`checkSafety` in `validate.ts`: danger level via `src/lib/danger-patterns.ts`, unsafe characters via `src/lib/unsafe-chars.ts`) run on the raw YAML values inside both `lint-content` and `lint-danger`. To add a danger rule: add it to `RULES` and add positive examples in `tests/lib/danger-patterns.test.ts` (a test fails if a rule has none); add any false-positive guard to `SAFE`. Invalid-card fixtures live in `tests/fixtures/invalid/<rule>/<category>/<id>.yaml`, and a test asserts each folder has an expected message; `scripts/lint-danger.ts` fails CI when a risky pattern (SPEC §7.2) is labeled `safe`, or when a command contains invisible/bidi Unicode or newlines.
4. At build, Astro produces `/c/<id>`, `/tools/<tool>`, `/categories/<category>` pages plus `/search-index.json` consumed by client-side MiniSearch. URLs have no trailing slash (`build.format: 'file'`, `trailingSlash: 'never'`); `site` comes from `PUBLIC_BASE_URL` via `src/lib/site.ts` (default: prod domain). Paths, grouping and page meta live in `src/lib/pages.ts`, shared with `scripts/check-dist.ts`. `src/lib/template.ts` parses `{{name}}` / `{{name:default}}`; any other braces stay text. Search (J11): `src/lib/search.ts` (MiniSearch config, cards matching every word first, then any word) and `src/lib/search-state.ts` (URL state, untrusted input sanitized) are pure and tested; `src/components/SearchBox.ts` wires the home page. Result cards are clones of a `<template>` that renders a real `CommandCard`, filled by `ResultsList.ts` with `textContent` only — keep `ResultsList.ts` in sync when `CommandCard.astro` markup changes. Each relevance bug becomes a "card X in top 3 for query Y" case in `tests/lib/search.test.ts`. `check-dist` also checks `search-index.json` has one up-to-date entry per card.

Categories are fixed: `linux`, `containers`, `cloud-iac`, `git-ci`. Danger levels: `safe | caution | destructive`.

**Client-side islands** (light TS, no framework unless needed): search + filters (state mirrored in the URL), command templates (`{{name}}` / `{{name:default}}` placeholders, tldr-compatible), copy, keyboard navigation, favorites/history.

**Invariants that are easy to break:**
- Copy builds the text from the card data (`data-command` + field values, via `copyCard` in `src/lib/copy.ts`), never from the displayed text; never ends with `\n`; the first copy of each `destructive` card per session requires confirmation (`sessionStorage`, asks every time if storage fails), and a destructive copy is refused while a variable without default is empty. Variable values are sanitized (invisible/bidi removed, control chars → space) and inserted as plain text (no shell escaping, never as HTML). `src/components/CommandTemplate.ts` turns `<var>` into inputs on every card, including search results (`ResultsList.ts` calls `enhanceCard`). `renderTemplate` reads own keys only (a variable named `constructor` must not hit `Object.prototype`).
- All favorites/history access goes through `src/lib/store.ts` (`localStorage`, versioned keys `gmiyc:v1:*`, every access in `try/catch`, limits 500 favorites / 100 history entries of *copied* commands only — never search queries). This single layer exists so v2 can add server sync without touching the UI. Stored data and imports are re-validated on every read (card id rule duplicated from `schema.ts`, a test keeps them equal). Import merges (never replaces). In the browser, use the `store` singleton of `src/components/LocalStore.ts` and `onStoreChange` (also fired by other tabs). The ★ button (`[data-favorite]`) is part of `CommandCard.astro` and enabled by `enhanceCard`; `/favorites` and `/history` (`SavedList.astro` + `.ts`) render cards on the client from `/search-index.json` with `ResultsList.ts` and the shared `CardTemplates.astro`, skipping unknown ids. Pages not derived from content are listed in `STATIC_PAGES` (`src/lib/pages.ts`) so `check-dist` expects them.
- Strict CSP (`default-src 'self'`, no inline scripts): no third-party scripts, fonts or CDNs; fonts are self-hosted, the theme script is an external file, Umami is proxied under `/stats/`. `astro.config.mjs` sets `build.inlineStylesheets: 'never'` and `vite.build.assetsInlineLimit: 0` so the build never inlines CSS/JS; check `dist/*.html` has no `<style>` or src-less `<script>`.
- The global CSS reset removes the `margin: auto` that centers a modal `<dialog>`: set it back on any new dialog.
- Design (SPEC §3.1, "terminal on paper"): reuse the shared blocks (black `$` prompt band, square chips, numbered rows from `CardList.astro`, `.btn` square mono buttons, yellow `.var-input` values, `.page-head` title band, `KeyBar.astro`), never new colors, radii, shadows or gradients. Full-width bands use `--gutter` (`.bleed` from inside `.container`). `--color-accent-fill` (#ff4a12) is for backgrounds only; orange text uses `--color-accent`. Fonts are self-hosted woff2 subsets in `public/fonts/` (DejaVu Sans Mono, TeX Gyre Heros / Heros Cn, licenses alongside).
- Values carried over (`src/lib/shared-values.ts`, used by `CommandTemplate.ts`): a typed value fills the same variable on the other cards of the page, in memory only; destructive cards never receive one.
- Key bar (`KeyBar.astro`): shown by `KeyboardNav.ts` while a card list is visible, with `positionLabel` (`01/07`) from `keyboard.ts`; decorative (`aria-hidden`).
- Theme: light (paper) by default, dark when `prefers-color-scheme: dark`. `public/theme-init.js` (plain JS, blocking, in `<head>`) sets `data-theme` before first paint; `src/lib/theme.ts` holds the same logic for the toggle (key `gmiyc:v1:theme`). Keep both in sync (tests cover each). Colors live in `src/styles/tokens.css` as 6-digit hex in `[data-theme='light'|'dark']` blocks; `tests/styles/contrast.test.ts` enforces WCAG AA on every pair, so add any new text/background token to its lists.
- Astro templates treat `{...}` as expressions: literal shell text containing braces (`{}`, `${VAR}`) must go through a variable (`<code>{cmd}</code>`), never be typed inline.
- Analytics must never block rendering; the site must work with Umami down.
- Nginx: headers live in `docker/nginx/security-headers.conf` (shared) + `csp.dev.conf` (dev CSP, mounted as `/etc/nginx/snippets/csp.conf`). Any `add_header` inside a `location` drops the inherited server-level headers, so re-include the snippets there. The Astro dev toolbar stays disabled because it injects an inline script.
- **Never type `\u` escape sequences in source files**: the editing tools turn them into the raw characters, which silently corrupts regexes. Write code points numerically (`0x202e`, `String.fromCodePoint(...)`), as `src/lib/unsafe-chars.ts` and its tests do. Check with `LC_ALL=C grep -n '[^[:print:][:space:]]' <files>`.
- Script entry points: put argument handling in an exported `cli(args)` (tested) and keep only the `if (import.meta.url === …)` guard under a `/* v8 ignore next 3 */` comment.
- Keyboard (J13): `src/lib/keyboard.ts` maps a key + focus context (`search | list | field | page`) to an action (pure, tested); `src/components/KeyboardNav.ts` applies it. Every `CardList` (`data-card-list`) becomes a `listbox` with `option` items `option-<card id>` and `aria-activedescendant`, re-applied by a MutationObserver when results re-render. On desktop it also focuses the home search on load (not with a URL hash or if focus already moved). Nothing runs on touch screens (`TOUCH_QUERY`). Keys are ignored while a modal `<dialog>` is open. The help dialog lists `SHORTCUTS` from `keyboard.ts`: add a new shortcut there too.
- E2E: specs in `tests/e2e/*.spec.ts` (Vitest only picks up `*.test.ts`). `make e2e` sets `E2E_BASE_URL` (dev stack, warmed up by `tests/e2e/wait-for-site.ts`); without it (CI job `e2e`), Playwright serves `dist/` with `astro preview`, so build first. Chromium only, clipboard permissions granted, no retries. The `e2e` image tag must equal `@playwright/test` in `package.json` (`tests/config/playwright-version.test.ts`): bump both together. Vite ignores `playwright-report/` and `test-results/` so reports do not reload the dev server mid-test.
- Browser checks run in Docker (host Node is too old): `mcr.microsoft.com/playwright` with `--network container:grepmeifyoucan-proxy-1`, so `localhost:8080` works and Vite's host check passes.

**Contributions** go through GitHub issue forms (`.github/ISSUE_TEMPLATE/`), linked prefilled from the site — no in-site submission form. Nothing is published without a reviewed, merged PR (branch protection + CODEOWNERS).

**Docker layout:** shared `compose.yaml` + `compose.dev.yaml` (bind mounts, `astro dev`, `node_modules` in a named volume, ports on 127.0.0.1 only) + `compose.prod.yaml` (GHCR images tagged by commit SHA, read-only, non-root, `cap_drop: ALL`). One `docker/web.Dockerfile` with `dev` and `prod` targets; the prod image is Nginx serving the static build and proxying `/stats`. Pin every image version (no `latest`).

**CI** (`.github/workflows/ci.yml`): job `checks` runs Node from `.node-version` directly (not Docker: bind-mount permissions break on runners) → `npm ci`, typecheck, coverage, lint-content, build; job `e2e` builds and runs Playwright (Chromium installed from the lock file's version); job `docker` builds the dev image and runs `nginx -t`. `tests/config/node-version.test.ts` keeps `.node-version` equal to the Dockerfile's Node. Actions are pinned by commit SHA (resolve with `gh api repos/<owner>/<action>/commits/<tag> -q .sha`). `main` is protected: PR + green `checks`/`docker` on an up-to-date branch, no direct or force push (admins included), 0 required approvals. Never push to `main`; open a PR and let the maintainer merge. Dependabot ignores major bumps of Node, TypeScript and `@types/node`, and minor bumps of nginx (odd minors are mainline): upgrade those deliberately, together, in a dedicated PR.

**Deploy:** merge to `main` → GitHub Actions builds the image, pushes to GHCR, scans with Trivy, then SSH to the server (forced command `deploy/deploy.sh`) → `docker compose pull && up -d` → healthcheck `/healthz`. Rollback = redeploy the previous SHA tag.

## Licensing

Content imported from tldr-pages is CC BY 4.0: every imported card keeps its `source` block (page, pinned commit, license), and attribution appears on the card and on `/about`. Code license is not decided yet (MIT proposed).

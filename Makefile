COMPOSE := docker compose -f compose.yaml -f compose.dev.yaml
# Production images on this machine (J18): 127.0.0.1:80/443, self-signed TLS.
PROD := IMAGE_TAG=local LETSENCRYPT_DIR=./.cache/tls WEB_BIND=127.0.0.1 \
  docker compose -f compose.yaml -f compose.prod.yaml --profile analytics
PROD_WEB := grepmeifyoucan-prod-web-1
PROD_IMAGE := ghcr.io/jeremychenet/grepmeifyoucan-web:local
TRIVY_IMAGE := aquasec/trivy:0.76.1
PLAYWRIGHT_IMAGE = $(shell sed -n 's/^ *image: *\(mcr\.microsoft\.com\/playwright:.*\)$$/\1/p' compose.dev.yaml)
ARGS ?=

.DEFAULT_GOAL := help
.PHONY: help up up-analytics down logs sh npm clean check-headers nginx-test test coverage e2e lint-content lint-danger import-tldr build check-dist lighthouse check-secrets prod-local prod-down prod-logs check-prod scan e2e-prod

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

up: ## Build and start the dev stack (http://localhost:8080)
	$(COMPOSE) up -d --build

check-secrets:
	@for v in UMAMI_DB_PASSWORD UMAMI_APP_SECRET; do \
	  grep -Eq "^$$v=[0-9a-f]{32,}$$" .env 2>/dev/null || { echo "Set $$v in .env (openssl rand -hex 32), see .env.example"; exit 1; }; \
	done

up-analytics: check-secrets ## Dev stack + Umami analytics (admin on http://127.0.0.1:3001), needs the secrets in .env
	$(COMPOSE) --profile analytics up -d --build --wait

down: ## Stop the dev stack (analytics included)
	$(COMPOSE) --profile analytics down

logs: ## Follow logs (web + proxy)
	$(COMPOSE) logs -f web proxy

sh: ## Open a shell in the web container
	$(COMPOSE) run --rm web sh

npm: ## Run npm in the web container, e.g. make npm ARGS="run build"
	$(COMPOSE) run --rm web npm $(ARGS)

clean: ## Stop the stack and delete volumes (node_modules, Umami data)
	$(COMPOSE) --profile analytics down -v

check-headers: ## Check the security headers served on http://localhost:8080
	./scripts/check-headers.sh

nginx-test: ## Validate the Nginx configuration
	$(COMPOSE) run --rm --no-deps proxy nginx -t

test: ## Run unit tests (Vitest)
	$(COMPOSE) run --rm --no-deps web npm test

coverage: ## Run unit tests with coverage thresholds (same check as CI)
	$(COMPOSE) run --rm --no-deps web npm run coverage

e2e: ## Run Playwright end-to-end tests against the dev stack (started if needed), e.g. ARGS=tests/e2e/search.spec.ts
	$(COMPOSE) up -d --wait proxy
	$(COMPOSE) run --rm e2e npx playwright test $(ARGS)

lighthouse: ## Lighthouse CI (mobile) on the built site, same budgets as CI (lighthouserc.json)
	@# No tracker: Umami is not served here, its 404 would count as a console error.
	$(COMPOSE) run --rm --no-deps -e PUBLIC_UMAMI_WEBSITE_ID= web npm run build
	$(COMPOSE) run --rm --no-deps e2e sh -c 'CHROME_PATH=$$(ls -d /ms-playwright/chromium-*/chrome-linux*/chrome | head -n 1) npx lhci autorun'

lint-content: ## Validate every command card in content/commands (schema + danger + characters)
	$(COMPOSE) run --rm --no-deps web npm run lint-content

lint-danger: ## Danger + unsafe-character lint only, e.g. make lint-danger ARGS=content/drafts
	$(COMPOSE) run --rm --no-deps web npm run lint-danger -- $(ARGS)

build: ## Build the static site into dist/ (runs lint-content first)
	$(COMPOSE) run --rm --no-deps web npm run build

check-dist: ## Check the built site in dist/ (pages, title, description, canonical, danger, sitemap)
	$(COMPOSE) run --rm --no-deps web npm run check-dist -- $(ARGS)

import-tldr: ## Regenerate drafts in content/drafts from tldr-pages at the pinned commit (ARGS=--force to overwrite)
	$(COMPOSE) run --rm --no-deps web npm run import-tldr -- $(ARGS)

prod-local: check-secrets ## Build and run the production images (https://localhost, self-signed certificate)
	./scripts/make-local-cert.sh
	$(PROD) up -d --build --wait

prod-down: ## Stop the production images started by prod-local
	$(PROD) down

prod-logs: ## Follow the logs of the production images
	$(PROD) logs -f

check-prod: ## Check prod-local: headers, redirects, routes, container hardening, image size
	./scripts/check-prod.sh

scan: ## Trivy scan of the prod web image (fails on a critical vulnerability)
	@mkdir -p .cache/trivy
	docker save -o .cache/trivy/web.tar $(PROD_IMAGE)
	@# Reads the saved archive: the Docker socket is never mounted.
	docker run --rm -v "$(CURDIR)/.cache/trivy:/work" $(TRIVY_IMAGE) image \
	  --cache-dir /work/db --input /work/web.tar --scanners vuln \
	  --severity HIGH,CRITICAL --no-progress
	docker run --rm -v "$(CURDIR)/.cache/trivy:/work" $(TRIVY_IMAGE) image \
	  --cache-dir /work/db --skip-db-update --input /work/web.tar --scanners vuln \
	  --severity CRITICAL --exit-code 1 --quiet
	@rm -f .cache/trivy/web.tar

e2e-prod: ## Playwright end-to-end tests against prod-local (strict CSP, real Nginx), e.g. ARGS=tests/e2e/search.spec.ts
	@# Inside the web container's network: the site is https://localhost:8443.
	docker run --rm --init --ipc=host --network container:$(PROD_WEB) \
	  -v "$(CURDIR):/app" -v grepmeifyoucan_node_modules:/app/node_modules -w /app \
	  -e E2E_BASE_URL=https://localhost:8443 -e E2E_IGNORE_HTTPS_ERRORS=1 -e NODE_TLS_REJECT_UNAUTHORIZED=0 -e NPM_CONFIG_UPDATE_NOTIFIER=false \
	  $(PLAYWRIGHT_IMAGE) npx playwright test $(ARGS)

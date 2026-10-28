COMPOSE := docker compose -f compose.yaml -f compose.dev.yaml
ARGS ?=

.DEFAULT_GOAL := help
.PHONY: help up down logs sh npm clean check-headers nginx-test test coverage e2e lint-content lint-danger import-tldr build check-dist lighthouse

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

up: ## Build and start the dev stack (http://localhost:8080)
	$(COMPOSE) up -d --build

down: ## Stop the dev stack
	$(COMPOSE) down

logs: ## Follow logs (web + proxy)
	$(COMPOSE) logs -f web proxy

sh: ## Open a shell in the web container
	$(COMPOSE) run --rm web sh

npm: ## Run npm in the web container, e.g. make npm ARGS="run build"
	$(COMPOSE) run --rm web npm $(ARGS)

clean: ## Stop the stack and delete volumes (node_modules)
	$(COMPOSE) down -v

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
	$(COMPOSE) run --rm --no-deps web npm run build
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

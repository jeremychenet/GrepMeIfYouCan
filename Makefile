COMPOSE := docker compose -f compose.yaml -f compose.dev.yaml
ARGS ?=

.DEFAULT_GOAL := help
.PHONY: help up down logs sh npm clean

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \\033[36m%-8s\\033[0m %s\\n", $$1, $$2}'

up: ## Build and start the dev stack (http://localhost:4321)
	$(COMPOSE) up -d --build

down: ## Stop the dev stack
	$(COMPOSE) down

logs: ## Follow web container logs
	$(COMPOSE) logs -f web

sh: ## Open a shell in the web container
	$(COMPOSE) run --rm web sh

npm: ## Run npm in the web container, e.g. make npm ARGS="run build"
	$(COMPOSE) run --rm web npm $(ARGS)

clean: ## Stop the stack and delete volumes (node_modules)
	$(COMPOSE) down -v

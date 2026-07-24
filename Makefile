SHELL := /bin/bash
.DEFAULT_GOAL := help

MODULE ?= all
SUPPORTED_MODULES := all server cli web

.PHONY: help check build lint test test-e2e test-skill validate-module
.PHONY: build-all build-server build-cli build-web
.PHONY: lint-all lint-server lint-cli lint-web
.PHONY: test-all test-server test-cli test-web

help:
	@printf '%s\n' \
		'Taskline repository targets:' \
		'  make check                  Full lint, test, build, and skill gate' \
		'  make build [MODULE=...]     Build all, server, cli, or web' \
		'  make lint [MODULE=...]      Lint all, server, cli, or web' \
		'  make test [MODULE=...]      Test all, server, cli, or web' \
		'  make test-e2e               Run the focused server e2e package' \
		'  make test-skill             Validate public and internal skills' \
		'' \
		'MODULE defaults to all; accepted values: all, server, cli, web.'

validate-module:
	@case " $(SUPPORTED_MODULES) " in \
		*" $(MODULE) "*) ;; \
		*) echo "unsupported MODULE=$(MODULE); expected one of: $(SUPPORTED_MODULES)" >&2; exit 2 ;; \
	esac

check:
	@$(MAKE) --no-print-directory lint MODULE=all
	@$(MAKE) --no-print-directory test MODULE=all
	@$(MAKE) --no-print-directory build MODULE=all
	@$(MAKE) --no-print-directory test-skill

build: validate-module
	@$(MAKE) --no-print-directory build-$(MODULE)

build-all: build-server build-cli

build-server: build-web
	@echo "[build] taskline-server" >&2
	@mkdir -p dist
	@( cd server && go build -o ../dist/taskline-server ./cmd/taskline-server )

build-cli:
	@echo "[build] taskline (CLI)" >&2
	@mkdir -p dist
	@( cd cli && go build -o ../dist/taskline . )

build-web:
	@echo "[build] web (pnpm build -> server/web/dist/)" >&2
	@( cd web && pnpm install --frozen-lockfile --silent && pnpm build )

lint: validate-module
	@$(MAKE) --no-print-directory lint-$(MODULE)

lint-all: lint-server lint-cli lint-web

lint-server:
	@echo "[lint] server" >&2
	@( cd server && golangci-lint run --config ../.golangci.yml ./... )

lint-cli:
	@echo "[lint] cli" >&2
	@( cd cli && golangci-lint run --config ../.golangci.yml ./... )

lint-web:
	@echo "[lint] web" >&2
	@( cd web && pnpm install --frozen-lockfile --silent && pnpm lint )

test: validate-module
	@$(MAKE) --no-print-directory test-$(MODULE)

test-all: test-server test-cli test-web

test-server:
	@echo "[test] server" >&2
	@( cd server && go test ./... -count=1 )

test-cli:
	@echo "[test] cli" >&2
	@( cd cli && go test ./... -count=1 )

test-web:
	@echo "[test] web" >&2
	@( cd web && pnpm install --frozen-lockfile --silent && pnpm test )

test-e2e:
	@echo "[test] server e2e" >&2
	@( cd server && go test ./tests -count=1 )

test-skill:
	@echo "[test] skills" >&2
	@./scripts/test-skill.sh

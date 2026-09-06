# ═══════════════════════════════════════════════════════════════════════════
# BabaHakim — operator surface (PHASE 19) · `make help` lists everything
# ═══════════════════════════════════════════════════════════════════════════
.DEFAULT_GOAL := help
SHELL := /bin/bash

.PHONY: help
help: ## list targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

# ── development ─────────────────────────────────────────────────────────────
.PHONY: dev
dev: ## run the dev server (:3000, seed-ready)
	bun install
	bun run db:push
	@bun run db:seed 2>/dev/null || echo "(db already seeded)"
	bun run dev

.PHONY: dev-docker
dev-docker: ## one-command docker dev stack (spec §71)
	docker compose up -d

.PHONY: db-reset
db-reset: ## rebuild the dev DB from schema + seed
	bun run db:push && bun run db:seed

# ── quality / CI ────────────────────────────────────────────────────────────
.PHONY: lint
lint: ## eslint
	bun run lint

.PHONY: typecheck
typecheck: ## tsc --noEmit
	bunx tsc --noEmit

.PHONY: test
test: ## unit tests (src/)
	bun test src/

.PHONY: qa
qa: ## FULL QA suite on the production server (chaos + 593 tests)
	bash scripts/qa-run.sh

.PHONY: ci
ci: ## the whole local CI pipeline (9 stages, fail-stops)
	bash scripts/ci-local.sh

.PHONY: audit
audit: ## all 11 phase gates (backend…qa + devops)
	for g in backend frontend media ai integrations reporting observability perf reliability qa devops; do npm run --silent audit:$$g || exit 1; done

# ── security ────────────────────────────────────────────────────────────────
.PHONY: security
security: ## secret scan + pentest (server must be up) + security stage
	bash scripts/secret-scan.sh

.PHONY: pentest
pentest: ## 45-scenario pentest (needs a running server)
	bash tests/security-pentest.sh

# ── build / deploy / rollback ───────────────────────────────────────────────
.PHONY: build
build: ## production standalone build
	bun run build

.PHONY: deploy
deploy: ## health-gated release deploy (atomic, auto-rollback)
	bash scripts/deploy.sh --target local

.PHONY: rollback
rollback: ## roll back to the previous release (health-gated)
	bash scripts/rollback.sh

.PHONY: releases
releases: ## list releases + current
	bash scripts/rollback.sh --list

.PHONY: drill
drill: ## deploy → rollback → redeploy drill (proves the runbook)
	bash scripts/rollback-drill.sh

# ── data ────────────────────────────────────────────────────────────────────
.PHONY: backup
backup: ## consistent DB + storage backup with integrity check
	bash scripts/backup.sh

.PHONY: restore
restore: ## restore the latest backup (stops the live writer first)
	bash scripts/restore.sh

.PHONY: secrets
secrets: ## generate production-grade secrets (stdout only)
	bash scripts/gen-secrets.sh

# ── production stack ────────────────────────────────────────────────────────
.PHONY: prod-up
prod-up: ## production compose (BH_VERSION + .env.production required)
	docker compose -f docker-compose.prod.yml --env-file .env.production up -d

.PHONY: prod-down
prod-down: ## stop the production stack
	docker compose -f docker-compose.prod.yml --env-file .env.production down

.PHONY: certs
certs: ## self-signed dev/staging TLS pair (production: Let's Encrypt)
	bash deploy/nginx/gen-self-signed.sh

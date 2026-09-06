# CHANGELOG — BabaHakim

All notable changes, per phase (Persian command phases; one line each — details in `docs/` + `worklog.md`).

## Phase 19 — DevOps & Deployment (2026-09-06)
4-environment matrix (dev/test/staging/prod) · `.env.example` (coverage-enforced) · multi-stage Docker (non-root, tini, migrate-on-boot) · dev/prod compose · nginx TLS reverse proxy (headers, rate zones, upload budget) · 9-stage CI/CD (GH Actions + local mirror) · health-gated atomic releases + auto-rollback + drill · backup/restore with integrity self-check · 69 latent type errors fixed (type-check gate now zero) · README/CONTRIBUTING/CHANGELOG.

## Phase 18 — Complete Quality Assurance (2026-09-06)
10-type test catalog (Database/Load/Contract/Regression new) · explicit Critical-Path map (quality > numbers) · bug memory REG-01..07 · unified qa-run.sh with port-ownership guard · **REG-02 root cause found: bare `test` gitignore pattern swallowed a route dir since Phase 13** · 593/593 twice · Critical Bug = 0.

## Phase 17 — Reliability Engineering (2026-09-06)
Chaos-tested 9 live failure scenarios (FS-1..FS-9) · DurableJob queue (atomic claims, crash recovery, DB-backed DLQ + replay console) · request-level idempotency on money routes · SERVICE_UNAVAILABLE taxonomy + Retry-After · disposable cache layer · honest storage probe · 3 real bugs caught by chaos itself.

## Phase 16 — Performance Engineering (2026-09-06)
Measurement-first: 5 tagged harnesses + baseline artifacts · 28 EXPLAIN-derived indexes (full-scans 24→2) · WAL (writes ×7.5) · identity cache (auth/me p95 −65%) · dashboard batching (21→9+1 queries) · CDN seam + explicit compression.

## Phase 15 — Logging, Monitoring & Observability (2026-09-06)
Trace-first ALS + W3C traceparent · two-layer PII redaction · bounded metrics engine (8 families) · `/health` `/readiness` `/liveness` probes · 11-rule alert engine with auto-resolve · admin observatory console.

## Phase 14 — Search, Reporting & Analytics (2026-09-05)
SQL-side Persian-normalized search engine (4-way needles) · 19 permission-aware reports in 6 categories · CSV/XLSX(RTL)/PDF(RTL) exports + async queue · unbounded-query prevention (hard bounds, 422/504).

## Phase 13 — External Integration Architecture (2026-09-05)
9 integration domains as adapters + unified resilience core (timeout/retry/breaker/idempotency) · credential fail-safe + presence-only reporting · mock strategy · SMS/payment bug fixes.

## Phase 12 — Business Workflow Engineering (2026-09-05)
11 state machines × 11 dimensions · governance runtime (drift detection, SLA enforcement) · 3-layer recovery · 7 bypass routes closed.

## Phase 11 — Security Hardening (2026-09-04)
Pentest suite (45 scenarios) · CSRF double-submit · rate-limit taxonomy · signed expiring media URLs · brute-force locks · field-level encryption.

## Phases 01–10 (2026-09-03 → 2026-09-04)
PRD/user-stories/RTM · RBAC (6 roles × 31 permissions) · media pipeline (sharp, 4 variants, quality gates, ClamAV seam) · AI engine v1 (explainable TPM indicators + review workflow) · payments (Zarinpal mock + card-to-card + idempotency) · notifications · observability foundations · branding (official BabaHakim palette) · golden-path E2E.

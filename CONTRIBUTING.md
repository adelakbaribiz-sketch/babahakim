# CONTRIBUTING — BabaHakim

The project runs on a non-negotiable engineering cycle (project charter). Every change — no exceptions — follows:

```
Implement → Test → Fix → Security Check → Documentation → Git Commit
```

## The cycle, concretely

1. **Implement** — thin API routes (logic in `src/server/application`, ED-93), typed, Persian/English bilingual user-facing strings.
2. **Test** — `bash scripts/qa-run.sh` boots the production standalone server (BH_CHAOS=1) and runs the full suite (593 tests). New behavior gets a test in the matching suite type (`docs/QA.md` §2 — the 10-type catalog).
3. **Fix** — every bug found gets a REG-* lock in `tests/regression/regression.test.ts` (a fix without a regression test is just a postponed bug).
4. **Security check** — `bash scripts/ci-security.sh` (secret scan + 11 architecture gates) and `bash tests/security-pentest.sh` (45 scenarios, needs a running server).
5. **Documentation** — the matching `docs/<TOPIC>.md` + `BUSINESS-RULES.md` (BR-*) + an ED entry when a new engineering decision is made; `worklog.md` gets a stage record.
6. **Git commit** — logical, prefixed (`feat(scope)`, `fix(scope)`, `test(scope)`, `docs(scope)`); never `update`/`final`.

## Hard rules

- **No secrets in git** — `.env*` is ignored (`.env.example` is the only committed template); production boot fails without real secrets (ED-59). New env vars MUST be added to `.env.example` — gate DEV1 enforces this mechanically.
- **Runtime state is not source** — `db/`, `storage/`, `releases/`, `current`, `backups/`, `dist/` are ignored. Deploy preflight refuses a dirty tree.
- **Anti-unbounded** — every query is bounded (`SEARCH_BOUNDS`/`REPORT_BOUNDS`); every new list route paginates.
- **Every rule is testable** — decisions that can't be enforced in CI/tests belong in an ADR's "Consequences", not in the rule set.
- **Coverage quality > coverage numbers** — new tests map to a Critical Path (golden journey / money / RBAC / route inventory), not to a percentage.

## Local checks before pushing

```bash
bun run lint              # 0 errors (warnings pre-listed)
bunx tsc --noEmit         # 0 errors — the CI type-check gate
bash scripts/qa-run.sh    # 593/593
npm run audit             # all 11 gates (backend…devops)
bash scripts/ci-local.sh  # the full 9-stage pipeline
```

CI (GitHub Actions) runs the same stages plus gitleaks/osv-scanner/semgrep/trivy — a failing stage stops deployment (spec §76).

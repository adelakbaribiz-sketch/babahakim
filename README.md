# BabaHakim — باباحکیم

**پلتفرم هوشمند تشخیص از تصویر زبان** · Persian-first (RTL) / English (LTR) bilingual AI health platform — 6 roles, 18 modules, permission-aware data isolation, explainable AI with mandatory human review (AI-CDS).

| | |
|---|---|
| Stack | Next.js 16 (App Router, standalone) · TypeScript · Tailwind 4 · shadcn/ui · Prisma + SQLite (WAL) · Bun |
| Quality | 593 automated tests · 11 CI architecture gates · 45-scenario pentest · chaos-tested reliability |
| Deployment | Docker (multi-stage, non-root) · nginx TLS reverse proxy · health-gated atomic releases with auto-rollback |

## Quickstart

```bash
bun install
bun run db:push          # schema
bun run db:seed          # 6 demo roles + catalog (09120000001–6 · Pass1234)
bun run dev              # http://localhost:3000
```

One-command docker (spec §71): `docker compose up -d`

## Operations

```bash
make help                # all operator targets
make qa                  # full QA suite on a production server (BH_CHAOS=1)
make ci                  # the 9-stage CI pipeline, locally (lint → rollback-drill)
make deploy              # health-gated atomic release deploy (auto-rollback)
make rollback            # roll back to the previous release
make backup              # consistent DB + media snapshot with integrity check
```

Production runbook: **docs/DEPLOYMENT.md** (environments, Docker, nginx/SSL, migrations, backup/restore, CI/CD, rollback, legal checklist).

## Configuration

Copy `.env.example` → `.env` (never commit real secrets — production refuses to boot without `JWT_SECRET` / `FIELD_ENC_KEY`). Generate strong secrets: `bash scripts/gen-secrets.sh`.

## Documentation map

| Document | Scope |
|---|---|
| `docs/PRD.md` | product scope, 154 FR + 25 NFR, phase roadmap |
| `docs/ARCHITECTURE.md` · `ARCHITECTURE-DIAGRAM.md` | system design |
| `docs/BACKEND.md` · `DATABASE.md` · `DATABASE-ERD.md` | API + data layer |
| `docs/SECURITY.md` · `THREAT-MODEL.md` | security architecture |
| `docs/QA.md` | the 10-type test catalog + bug memory (REG-*) |
| `docs/OBSERVABILITY.md` · `PERFORMANCE.md` · `RELIABILITY.md` | operations deep-dives |
| `docs/DEPLOYMENT.md` | environments + release engineering |
| `docs/BUSINESS-RULES.md` | 14 rule families (BR-*) |
| `docs/ADR/` | 23 architecture decision records |

## Contribution

See `CONTRIBUTING.md` — the mandatory cycle (implement → test → fix → security check → documentation → commit) and the CI gates every change must pass.

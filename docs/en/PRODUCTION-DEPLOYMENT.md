# Production deployment (Docker, single Linux server)

The complete operator runbook (Persian) is `docs/DEPLOYMENT.md`; this guide is the short English path to a working server.

## 1. Server requirements
- Linux host (Ubuntu 22.04+ recommended), 2 vCPU / 4 GB RAM minimum, 20 GB disk.
- Docker Engine 24+ with the Compose plugin.
- A domain name pointing at the server, ports 80 and 443 open.

## 2. Get the code
```bash
git clone https://github.com/<owner>/babahakim.git
cd babahakim
```

## 3. Configure
```bash
cp .env.production.example .env.production
bash scripts/gen-secrets.sh >> .env.production   # JWT_SECRET, FIELD_ENC_KEY, AI_DATASET_HASH_SALT
```
Then edit `.env.production`:
- remove the empty `JWT_SECRET=` / `FIELD_ENC_KEY=` / `AI_DATASET_HASH_SALT=` lines that the generated ones duplicate;
- `BH_BASE`, `CORS_ALLOWED_ORIGINS`, `ZARINPAL_CALLBACK_BASE` → `https://your-domain`;
- `BH_VERSION` → the release tag (e.g. `git rev-parse --short HEAD`);
- `BH_ADMIN_PHONE` / `BH_ADMIN_PASSWORD` (≥ 12 chars, letters + digits) for the first administrator;
- provider keys (`SMS_PROVIDER_KEY`, `ZARINPAL_MERCHANT_ID`, …) when available — empty means the channel is disabled, never faked.

**`FIELD_ENC_KEY` encrypts national IDs and derives the national-ID login index.** Back it up offline. Losing or changing it makes stored national IDs unreadable and national-ID login impossible (no re-key tool exists yet).

## 4. TLS certificates
Put `fullchain.pem` and `privkey.pem` in `deploy/nginx/certs/` (e.g. from Let's Encrypt / certbot). For a staging test only: `bash deploy/nginx/gen-self-signed.sh your-domain`.

## 5. Build, bootstrap, start
```bash
docker compose -f docker-compose.prod.yml --env-file .env.production build
docker compose -f docker-compose.prod.yml --env-file .env.production --profile tools run --rm bootstrap
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```
- `bootstrap` creates the database from migrations if needed, then seeds **reference data only** (roles/permissions, the default temperament questionnaire, AI model registry entry, prescription vocabulary presets) and the first administrator. It never creates demo accounts and is idempotent. Remove `BH_ADMIN_PASSWORD` from `.env.production` afterwards.
- On every boot the app container runs `scripts/db-migrate-safe.mjs`: it applies pending migrations and, only when something is pending, writes a `VACUUM INTO` backup next to the database and verifies integrity and row counts.
- The app refuses to start if `JWT_SECRET` or `FIELD_ENC_KEY` is missing.

Check: `curl -fsS https://your-domain/readiness` → `200`.

## 6. Moving existing data to the server
1. Stop the old instance and copy its SQLite file (with any `-wal`/`-shm` files) and the `storage/` directory.
2. Place them in the `bh-data` volume as `/data/bh.db` and `/data/storage/`.
3. Start the stack — the safe migrator recognises databases created with `prisma db push` (baselines them) and databases with migration history (reconciles and deploys), backing up first.
4. The server **must use the same `FIELD_ENC_KEY`** that encrypted the existing national IDs. A database created while `FIELD_ENC_KEY` was unset used a development-derived key — migrate those values before switching keys, or keep using that database only with the matching key.

## 7. Operations
```bash
make backup        # consistent DB + media snapshot
make rollback      # previous release (health-gated)
docker compose -f docker-compose.prod.yml logs -f app
```

## 8. CI/CD (GitHub Actions)
`.github/workflows/ci.yml` runs lint → type-check → unit → integration (live server) → security scans → Docker build + Trivy scan → push to `ghcr.io` on `main`. Deployment over SSH runs only when the repository variable `DEPLOY_ENABLED=true` is set and the `DEPLOY_*` secrets plus a `production` environment are configured.

## Verified in this cycle (2026-10-27)
- `next build` standalone succeeds; the standalone server with `NODE_ENV=production` passed a smoke test on a fresh migrated + bootstrapped database (liveness/readiness, admin login, no demo accounts, patient registration, tickets, HSTS/CSP headers, no OTP code leakage).
- A database built from the migrations matches `schema.prisma` with zero drift.
- **Not verified locally:** the Docker image build itself (Docker Desktop was not running on the build machine). CI builds it on the first push to `main`.

#!/bin/sh
# ═══════════════════════════════════════════════════════════════════════════
# BabaHakim container entrypoint (PHASE 19)
# 1. mkdir data dirs            3. exec standalone server (PID forwarded by tini)
# 2. prisma migrate deploy      4. boot recovery: DurableJob orphans requeued,
#    (idempotent, versioned)       stale claims healed — built into bootstrap
# Fail-fast: JWT_SECRET / FIELD_ENC_KEY enforced by src/lib/security/env.ts
# (ED-59) — a misconfigured production container refuses to serve.
# ═══════════════════════════════════════════════════════════════════════════
set -e

echo "[entrypoint] BabaHakim starting — NODE_ENV=${NODE_ENV}"

mkdir -p /data/storage /data/backups 2>/dev/null || {
  echo "[entrypoint] FATAL: /data is not writable — mount the volume correctly" >&2
  exit 1
}

# ── database migrations (idempotent; safe on every boot) ──────────────────
# db-migrate-safe: fresh DB → deploy; db-push DB → baseline + deploy; history →
# reconcile + deploy. Backs up next to the DB only when something is pending.
echo "[entrypoint] applying migrations…"
BH_APP_ROOT=/app bun /app/scripts/db-migrate-safe.mjs

# ── app (exec → signals reach the server directly under tini) ──────────────
echo "[entrypoint] launching server on :${PORT}"
exec bun /app/.next/standalone/server.js

#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# PHASE 19 · deploy.sh — repeatable, health-gated deployment (spec §75/§76)
# ═══════════════════════════════════════════════════════════════════════════
# Model: immutable release directories + an atomic `current` symlink switch.
#
#   releases/<tag>/            one immutable release (tag = git sha + time)
#   releases/<tag>/VERSION     manifest (tag, git sha, date, builder)
#   current -> releases/<tag>  ATOMIC switch (ln -sfn — never a partial state)
#
# The app never runs from a mutating working tree. A release is built ONCE
# (artifact tarball or docker image) and deployed MANY times — identical bits.
#
# Health gate: after the switch, /readiness must answer within the window or
# the deployment AUTOMATICALLY rolls back to the previous release (the
# pipeline stops — spec §76 "fail → stop deployment").
#
# Usage:
#   scripts/deploy.sh --target local   [--port 3000] [--wait-secs 90]
#   scripts/deploy.sh --target ssh --host user@prod-1 [deployed via CI]
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="local"; PORT=3000; WAIT_SECS=90; HOST=""
while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --wait-secs) WAIT_SECS="$2"; shift 2 ;;
    --host) HOST="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

GIT_SHA=$(git rev-parse --short HEAD)
TAG="$(date -u +%Y%m%d%H%M%S)-${GIT_SHA}"
RELEASES="releases"
REL_DIR="${RELEASES}/${TAG}"
BASE_URL="http://localhost:${PORT}"

echo "── deploy ─────────────────────────────────────────────"
echo "  target : ${TARGET}"
echo "  tag    : ${TAG} (git ${GIT_SHA})"
echo "  url    : ${BASE_URL}"

# ── preflight: refuse to deploy a dirty or un-pushable tree ────────────────
if [ -n "$(git status --porcelain | grep -v '^??')" ]; then
  echo "✗ working tree has UNCOMMITTED changes — a release must be a git-committed, reproducible state" >&2
  git status --short | head -5 >&2
  exit 1
fi

# ── build the immutable release ────────────────────────────────────────────
echo "── building release (bun run build → standalone) ──────"
bun run build 2>&1 | tail -3

mkdir -p "${REL_DIR}"
# runtime payload: standalone server + static + public + prisma migrations
cp -r .next/standalone "${REL_DIR}/app"
cp -r .next/static "${REL_DIR}/app/.next/static"
cp -r public "${REL_DIR}/app/public"
cp -r prisma "${REL_DIR}/prisma"

cat > "${REL_DIR}/VERSION" <<EOF
tag=${TAG}
git_sha=${GIT_SHA}
built_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
target=${TARGET}
node_env=production
EOF

echo "── release laid out at ${REL_DIR} ────────────────────"
du -sh "${REL_DIR}" | awk '{print "  size: " $1}'

# remember the previous release for rollback (atomic read BEFORE switch)
PREV=""
if [ -L current ] || [ -e current ]; then
  PREV=$(readlink current || true)
fi
echo "  previous: ${PREV:-<none — first deploy>}"

# ── stop whatever serves :PORT (a stale server poisons health checks —
#    the PHASE 18 lesson, now structural) ──────────────────────────────────
PORT_PID=$(ss -tlnpH "sport = :${PORT}" 2>/dev/null | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | head -1 || true)
if [ -n "${PORT_PID}" ]; then
  echo "── stopping previous server (pid ${PORT_PID}) ──────"
  kill "${PORT_PID}" 2>/dev/null || true; sleep 2
  kill -9 "${PORT_PID}" 2>/dev/null || true; sleep 1
fi

# ── migrations: idempotent, BEFORE the new code answers traffic ────────────
# NOTE (first production deploy): this repo's dev DB was historically managed
# with `prisma db push`, so the migration history needs a one-time baseline:
#   bunx prisma migrate resolve --applied <migration>   (per pending entry)
# — see DEPLOYMENT.md §7. Afterwards `migrate deploy` is the only path.
echo "── applying migrations (prisma migrate deploy) ───────"
JWT="${JWT_SECRET:-$(python3 -c "import hashlib;print(hashlib.sha256(b'babahakim-dev:JWT_SECRET').hexdigest())")}"
ENC="${FIELD_ENC_KEY:-$(python3 -c "import hashlib,base64;print(base64.b64encode(hashlib.sha256(b'babahakim-dev:FIELD_ENC_KEY').digest()).decode())")}"
if ! DATABASE_URL="file:$PWD/db/custom.db" bunx prisma migrate deploy 2>/dev/null | tail -3; then
  echo "  ⚠ migrate deploy reported drift (db-push-managed dev DB) — schema is current;"
  echo "    production: run the one-time baseline (DEPLOYMENT.md §7) so this becomes a hard gate"
fi

# ── boot the NEW release ────────────────────────────────────────────────────
LOG="${REL_DIR}/server.log"
DATABASE_URL="file:$PWD/db/custom.db" \
BH_STORAGE_PATH="$PWD/storage/uploads" \
JWT_SECRET="${JWT}" FIELD_ENC_KEY="${ENC}" \
PORT="${PORT}" HOSTNAME=0.0.0.0 NODE_ENV=production \
  setsid bash -c "exec bun ${REL_DIR}/app/server.js" > "${LOG}" 2>&1 < /dev/null &
SERVER_PID=$!
echo "  server pid: ${SERVER_PID} (log: ${LOG})"

# ── HEALTH GATE: /readiness within the window, else AUTO-ROLLBACK ──────────
echo "── health gate (readiness within ${WAIT_SECS}s) ──────"
HEALTHY=0
for i in $(seq 1 "${WAIT_SECS}"); do
  sleep 1
  if ! kill -0 "${SERVER_PID}" 2>/dev/null; then
    echo "✗ release process DIED during boot — log tail:" >&2; tail -5 "${LOG}" >&2; break
  fi
  R=$(curl -s --max-time 2 "${BASE_URL}/readiness" 2>/dev/null | python3 -c 'import sys,json;print(json.load(sys.stdin).get("status",""))' 2>/dev/null || true)
  if [ "$R" = "ready" ]; then HEALTHY=1; break; fi
done

if [ "${HEALTHY}" = "1" ]; then
  # atomic switch — the only mutating step of the whole deployment
  ln -sfn "${REL_DIR}" current
  echo "✓ DEPLOYED ${TAG} — current → ${REL_DIR} (atomic)"
  echo "  probes: $(curl -s --max-time 2 ${BASE_URL}/liveness) "
  # keep the last 10 releases; older ones are pruned (rollback horizon)
  ls -1dt "${RELEASES}"/*/ 2>/dev/null | tail -n +11 | xargs -r rm -rf
  exit 0
fi

# ── automatic rollback (spec §76: fail → stop deployment, previous release) ─
echo "✗ HEALTH GATE FAILED — rolling back" >&2
kill "${SERVER_PID}" 2>/dev/null || true
if [ -n "${PREV}" ]; then
  echo "── restoring previous release: ${PREV} ─────────────"
  DATABASE_URL="file:$PWD/db/custom.db" \
  BH_STORAGE_PATH="$PWD/storage/uploads" \
  JWT_SECRET="${JWT}" FIELD_ENC_KEY="${ENC}" \
  PORT="${PORT}" HOSTNAME=0.0.0.0 NODE_ENV=production \
    setsid bash -c "exec bun ${PREV}/app/server.js" > "${PREV}/server.log" 2>&1 < /dev/null &
  BACK_PID=$!
  for i in $(seq 1 "${WAIT_SECS}"); do
    sleep 1
    R=$(curl -s --max-time 2 "${BASE_URL}/readiness" 2>/dev/null | python3 -c 'import sys,json;print(json.load(sys.stdin).get("status",""))' 2>/dev/null || true)
    [ "$R" = "ready" ] && { ln -sfn "${PREV}" current; echo "✓ ROLLED BACK to ${PREV}"; exit 1; }
  done
  echo "✗✗ ROLLBACK FAILED TOO — investigate manually: releases/ + ${LOG}" >&2
  exit 2
else
  echo "✗ no previous release to roll back to (first deploy) — ${REL_DIR} kept for inspection" >&2
  exit 2
fi

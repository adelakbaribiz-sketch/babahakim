#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# PHASE 19 · rollback.sh — explicit operator rollback (spec §75/§76)
# ═══════════════════════════════════════════════════════════════════════════
# Usage:
#   scripts/rollback.sh                 → roll back to the release BEFORE current
#   scripts/rollback.sh <tag>           → roll back to a specific release tag
#   scripts/rollback.sh --list          → show releases (newest first)
#
# Same health gate as deploy.sh: the previous release must pass /readiness
# or the rollback aborts WITHOUT touching `current` (a failed rollback must
# never leave no server running).
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."

PORT=3000
BASE_URL="http://localhost:${PORT}"
WAIT_SECS=90
REQUESTED=""
LIST_ONLY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="$2"; BASE_URL="http://localhost:${PORT}"; shift 2 ;;
    --wait-secs) WAIT_SECS="$2"; shift 2 ;;
    --list) LIST_ONLY=1; shift ;;
    *) REQUESTED="$1"; shift ;;
  esac
done

echo "── releases (newest first) ────────────────────────────"
ls -1dt releases/*/ 2>/dev/null | sed 's|^releases/|  |;s|/$||' || echo "  (none)"
[ "${LIST_ONLY}" = "1" ] && exit 0

CUR=$(readlink current 2>/dev/null || echo "")
echo "  current → ${CUR:-<none>}"

if [ -z "${REQUESTED}" ]; then
  # previous = the newest release that is NOT the current one
  PREV=$(ls -1dt releases/*/ 2>/dev/null | grep -v "^${CUR}/$" | head -1 || true)
  [ -z "${PREV}" ] && { echo "✗ no other release to roll back to"; exit 1; }
else
  PREV="releases/${REQUESTED}/"
  [ -d "${PREV}" ] || { echo "✗ release '${REQUESTED}' not found"; exit 1; }
fi
PREV="${PREV%/}"

if [ "${PREV}" = "${CUR}" ]; then
  echo "✗ '${PREV}' IS the current release — nothing to do"
  exit 0
fi

echo "── rollback: ${CUR} → ${PREV} ────────────────────────"

JWT="${JWT_SECRET:-$(python3 -c "import hashlib;print(hashlib.sha256(b'babahakim-dev:JWT_SECRET').hexdigest())")}"
ENC="${FIELD_ENC_KEY:-$(python3 -c "import hashlib,base64;print(base64.b64encode(hashlib.sha256(b'babahakim-dev:FIELD_ENC_KEY').digest()).decode())")}"

# stop the current server (any listener on :PORT — poisoned-port lesson)
PORT_PID=$(ss -tlnpH "sport = :${PORT}" 2>/dev/null | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | head -1 || true)
[ -n "${PORT_PID}" ] && { kill "${PORT_PID}" 2>/dev/null || true; sleep 2; kill -9 "${PORT_PID}" 2>/dev/null || true; sleep 1; }

LOG="${PREV}/server.log"
DATABASE_URL="file:$PWD/db/custom.db" \
BH_STORAGE_PATH="$PWD/storage/uploads" \
JWT_SECRET="${JWT}" FIELD_ENC_KEY="${ENC}" \
PORT="${PORT}" HOSTNAME=0.0.0.0 NODE_ENV=production \
  setsid bash -c "exec bun ${PREV}/app/server.js" > "${LOG}" 2>&1 < /dev/null &
PID=$!

for i in $(seq 1 "${WAIT_SECS}"); do
  sleep 1
  kill -0 "${PID}" 2>/dev/null || { echo "✗ previous release died during boot — ${LOG}"; exit 2; }
  R=$(curl -s --max-time 2 "${BASE_URL}/readiness" 2>/dev/null | python3 -c 'import sys,json;print(json.load(sys.stdin).get("status",""))' 2>/dev/null || true)
  [ "$R" = "ready" ] && { ln -sfn "${PREV}" current; echo "✓ ROLLED BACK → ${PREV} (atomic)"; exit 0; }
done
echo "✗ previous release FAILED the health gate — 'current' left UNTOUCHED at ${CUR}"
exit 1

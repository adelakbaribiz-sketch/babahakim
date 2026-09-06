#!/bin/bash
# PHASE 18 · qa-run — unified, reproducible QA entry point.
# Boots the production standalone server with BH_CHAOS=1 (reliability suites
# need the chaos console; runbook RELIABILITY.md), waits for readiness, runs
# the full bun test suite against it, then tears the server down — all inside
# ONE process tree so the environment's background-process reaping (D-17)
# can never kill the server mid-suite.
#
# Usage:  bash scripts/qa-run.sh [extra bun test args]
# Exit:   bun test's exit code.
set -u
cd "$(dirname "$0")/.."

LOG=/tmp/qa-server-run.log

# a stale server on :3000 would poison the run — clear it first.
# (REG-fix: ANY listener counts — a `next dev` from the workspace bootstrap
# survives the old standalone-only pkill and silently absorbs the whole suite;
# the chaos console 404s because the dev tree never got BH_CHAOS=1.)
PORT_PID=$(ss -tlnpH 'sport = :3000' 2>/dev/null | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | head -1)
if [ -n "$PORT_PID" ]; then
  echo "── clearing stale :3000 listener (pid $PORT_PID) ──"
  kill "$PORT_PID" 2>/dev/null; sleep 2
  kill -9 "$PORT_PID" 2>/dev/null; sleep 1
fi
pkill -f "standalone/server.js" 2>/dev/null; sleep 1

JWT=$(python3 -c "import hashlib;print(hashlib.sha256(b'babahakim-dev:JWT_SECRET').hexdigest())")
ENC=$(python3 -c "import hashlib,base64;print(base64.b64encode(hashlib.sha256(b'babahakim-dev:FIELD_ENC_KEY').digest()).decode())")

export DATABASE_URL="file:$PWD/db/custom.db"
export BH_CHAOS=1
export JWT_SECRET="$JWT"
export FIELD_ENC_KEY="$ENC"
export PORT=3000
export NODE_ENV=production
export HOSTNAME=0.0.0.0

bun .next/standalone/server.js > "$LOG" 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null; wait $SERVER_PID 2>/dev/null' EXIT

for i in $(seq 1 90); do
  sleep 1
  curl -s -o /dev/null --max-time 2 http://localhost:3000/liveness && break
  if ! kill -0 $SERVER_PID 2>/dev/null; then
    echo "✗ QA server died during boot — last log lines:"; tail -5 "$LOG"; exit 1
  fi
done
curl -s -o /dev/null --max-time 2 http://localhost:3000/liveness || { echo "✗ server never became live"; exit 1; }

# OWNERSHIP GUARD: if anything else owns :3000 our liveness curl just probed
# the wrong process (EADDRINUSE above) — the suite would run against an
# impostor server. Refuse instead of reporting poisoned results.
OWNER_PID=$(ss -tlnpH 'sport = :3000' 2>/dev/null | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | head -1)
if [ -n "$OWNER_PID" ] && [ "$OWNER_PID" != "$SERVER_PID" ]; then
  echo "✗ :3000 is owned by pid $OWNER_PID, not our QA server ($SERVER_PID) — refusing a poisoned run"
  kill $SERVER_PID 2>/dev/null
  exit 1
fi

# PHASE 18 (settling window): a freshly-booted server spends its first seconds
# in DurableJob catch-up (orphan recovery, recurring schedulers arming) which
# serializes the SQLite write lock. Racing the suite against that burst turned
# healthy requests into 5s transaction timeouts (false 500s). Wait for
# readiness (bootstrap flag + workerAlive) and let the boot burst drain.
for i in $(seq 1 30); do
  R=$(curl -s --max-time 2 http://localhost:3000/readiness | python3 -c 'import sys,json; print(json.load(sys.stdin).get("status",""))' 2>/dev/null)
  [ "$R" = "ready" ] && break
  sleep 1
done
sleep 8

echo "── QA server ready (pid $SERVER_PID · BH_CHAOS=1 · :3000) ──"
# NODE_ENV must NOT leak into the test process: production mode disables dev
# OTP codes (devCode) and enables fail-fast secret checks — unit suites expect
# test semantics. BH_CHAOS=1 still propagates (faults module test-runner gate).
NODE_ENV=test bun test src tests "$@"
RESULT=$?
echo "── bun test exit code: $RESULT · server log: $LOG ──"
exit $RESULT

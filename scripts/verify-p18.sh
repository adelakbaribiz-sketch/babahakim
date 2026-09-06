#!/bin/bash
# PHASE 18 · verification bundle — server + pentest + smoke in ONE process
# tree (D-17: the environment reaps background servers ~30s after the
# spawning command ends, so cross-command server survival is impossible).
# Usage: bash scripts/verify-p18.sh
set -u
cd "$(dirname "$0")/.."

LOG=/tmp/p18-verify-server.log
PORT_PID=$(ss -tlnpH 'sport = :3000' 2>/dev/null | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | head -1)
[ -n "$PORT_PID" ] && { kill "$PORT_PID" 2>/dev/null; sleep 2; kill -9 "$PORT_PID" 2>/dev/null; sleep 1; }
pkill -f "standalone/server.js" 2>/dev/null; sleep 1

JWT=$(python3 -c "import hashlib;print(hashlib.sha256(b'babahakim-dev:JWT_SECRET').hexdigest())")
ENC=$(python3 -c "import hashlib,base64;print(base64.b64encode(hashlib.sha256(b'babahakim-dev:FIELD_ENC_KEY').digest()).decode())")
DATABASE_URL="file:$PWD/db/custom.db" BH_CHAOS=1 JWT_SECRET="$JWT" FIELD_ENC_KEY="$ENC" \
  PORT=3000 NODE_ENV=production HOSTNAME=0.0.0.0 \
  bun .next/standalone/server.js > "$LOG" 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null; wait $SERVER_PID 2>/dev/null' EXIT

for i in $(seq 1 90); do
  sleep 1
  curl -s -o /dev/null --max-time 2 http://localhost:3000/liveness && break
  kill -0 $SERVER_PID 2>/dev/null || { echo "✗ server died"; tail -5 "$LOG"; exit 1; }
done
for i in $(seq 1 30); do
  R=$(curl -s --max-time 2 http://localhost:3000/readiness | python3 -c 'import sys,json; print(json.load(sys.stdin).get("status",""))' 2>/dev/null)
  [ "$R" = "ready" ] && break
  sleep 1
done
sleep 5

echo "════ PENTEST ════"
bash tests/security-pentest.sh 2>&1 | tail -4
echo "════ SMOKE P18 ════"
bash scripts/smoke-phase18.sh 2>&1 | tail -12
echo "════ done (server torn down) ════"

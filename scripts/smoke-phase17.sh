#!/bin/bash
# PHASE 17 smoke test — reliability engineering against the live server
# (BH_CHAOS=1): chaos drill + DLQ lifecycle + crash recovery + idempotency.
set -u
BASE="http://localhost:3000"
JAR="/tmp/p17-admin.jar"
PJAR="/tmp/p17-patient.jar"
PASS=0; FAILS=0
ok()   { PASS=$((PASS+1)); echo "  ✓ $1"; }
bad()  { FAILS=$((FAILS+1)); echo "  ✗ $1"; }
need() { if [ "$1" = "$2" ]; then ok "$3"; else bad "$3 (got '$1' want '$2')"; fi }

echo "── PHASE 17 SMOKE ───────────────────────────────────────────"

# 0) server + chaos console reachable (404 without BH_CHAOS would stop here)
READY=$(curl -s "$BASE/readiness" | python3 -c 'import sys,json; print(json.load(sys.stdin)["status"])' 2>/dev/null)
need "$READY" "ready" "readiness: ready"

rm -f "$JAR"
curl -s -c "$JAR" "$BASE/liveness" > /dev/null
CSRF=$(grep ta_csrf "$JAR" | awk '{print $7}')
curl -s -c "$JAR" -b "$JAR" -H 'Content-Type: application/json' -H "x-csrf-token: $CSRF" -H "Origin: $BASE" -X POST "$BASE/api/v1/auth/login" -H "X-Forwarded-For: 127.77.0.1" -d '{"phone":"09120000001","password":"Pass1234"}' -o /dev/null
CSRF=$(grep ta_csrf "$JAR" | awk '{print $7}')
chaos() { curl -s -m 30 -b "$JAR" -H 'Content-Type: application/json' -H "x-csrf-token: $CSRF" -H "Origin: $BASE" -H "X-Forwarded-For: 127.77.0.1" -X POST "$BASE/api/v1/admin/chaos" -d "$1"; }

echo "── FS-1: Database Down (TTL drill) ─────────────────────────"
ARM=$(chaos '{"action":"activate","fault":"db:down","ttlMs":3000}')
echo "$ARM" | grep -q '"db:down"' && ok "fault armed" || bad "fault arm failed: $ARM"
# admin snapshot = DB-heavy and NEVER cached — the honest outage probe
# (products is cache-shielded: a warm catalog serves 200 straight from RAM)
S503=$(curl -s -o /tmp/p17-503.json -w '%{http_code}' -b "$JAR" -H "X-Forwarded-For: 127.77.0.9" "$BASE/api/v1/admin/observability")
need "$S503" "503" "db-dependent request → 503"
grep -q 'SERVICE_UNAVAILABLE' /tmp/p17-503.json && ok "code = SERVICE_UNAVAILABLE" || bad "wrong error code"
RA=$(curl -s -D - -o /dev/null -b "$JAR" -H "X-Forwarded-For: 127.77.0.9" "$BASE/api/v1/admin/observability" | grep -i 'retry-after' | head -1 | tr -d '\r')
echo "$RA" | grep -q "5" && ok "Retry-After: 5 present" || bad "Retry-After missing"
NR=$(curl -s "$BASE/readiness" | python3 -c 'import sys,json; print(json.load(sys.stdin)["status"])' 2>/dev/null)
need "$NR" "not_ready" "readiness flipped not_ready"
sleep 4
RCV=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -H "X-Forwarded-For: 127.77.0.9" "$BASE/api/v1/admin/observability")
need "$RCV" "200" "recovery after TTL (fault self-cleared)"
chaos '{"action":"deactivate","fault":"db:down"}' > /dev/null

echo "── FS-2: Cache Down (degrade-to-loader) ────────────────────"
chaos '{"action":"activate","fault":"cache:down","ttlMs":4000}' > /dev/null
# bust any warm catalog entry first, then verify the loader serves it live
C200=$(curl -s -o /dev/null -w '%{http_code}' -H "X-Forwarded-For: 127.77.0.8" "$BASE/api/v1/products?sort=createdAt")
need "$C200" "200" "catalog served from loader during cache outage"
chaos '{"action":"deactivate","fault":"cache:down"}' > /dev/null

echo "── FS-6/FS-7: DLQ lifecycle + crash recovery ───────────────"
INJ=$(chaos '{"action":"inject-job","type":"smoke.probe.unknown"}')
JOBID=$(echo "$INJ" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("jobId",""))' 2>/dev/null)
[ -n "$JOBID" ] && ok "job injected ($JOBID)" || bad "inject failed: $INJ"
sleep 4
DEADQ=$(curl -s -b "$JAR" "$BASE/api/v1/admin/jobs?status=DEAD&limit=50")
echo "$DEADQ" | python3 -c "
import sys, json
d = json.load(sys.stdin)
rows = [j for j in d.get('jobs', []) if j['id'] == '$JOBID']
print('DEAD' if rows and rows[0]['status'] == 'DEAD' else 'NOTDEAD')
" | grep -q DEAD && ok "job dead-lettered & listed" || bad "job not in DLQ"
RP=$(curl -s -b "$JAR" -H "x-csrf-token: $CSRF" -H "Origin: $BASE" -H "X-Forwarded-For: 127.77.0.1" -X POST "$BASE/api/v1/admin/jobs/$JOBID/replay")
echo "$RP" | grep -q '"ok":true' && ok "DLQ replay accepted" || bad "replay failed: $RP"
STALE=$(chaos '{"action":"inject-stale-running","type":"metrics-sampler"}')
SJID=$(echo "$STALE" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("jobId",""))' 2>/dev/null)
REC=$(chaos '{"action":"recover"}')
echo "$REC" | python3 -c 'import sys,json; d=json.load(sys.stdin); exit(0 if d.get("requeued",0) >= 1 else 1)' && ok "stale RUNNING requeued (recovery)" || bad "recovery requeued=0"
sleep 4
DONEQ=$(curl -s -b "$JAR" "$BASE/api/v1/admin/jobs?type=metrics-sampler&limit=100")
echo "$DONEQ" | python3 -c "
import sys, json
d = json.load(sys.stdin)
rows = [j for j in d.get('jobs', []) if j['id'] == '$SJID']
print('DONE' if rows and rows[0]['status'] == 'DONE' else 'NOTDONE')
" | grep -q DONE && ok "recovered job completed" || bad "recovered job not DONE"

echo "── FS-4: idempotent checkout (double POST) ─────────────────"
rm -f "$PJAR"
curl -s -c "$PJAR" "$BASE/liveness" > /dev/null
PCSRF=$(grep ta_csrf "$PJAR" | awk '{print $7}')
curl -s -c "$PJAR" -b "$PJAR" -H 'Content-Type: application/json' -H "x-csrf-token: $PCSRF" -H "Origin: $BASE" -X POST "$BASE/api/v1/auth/login" -H "X-Forwarded-For: 127.88.0.2" -d '{"phone":"09120000006","password":"Pass1234"}' -o /dev/null
PCSRF=$(grep ta_csrf "$PJAR" | awk '{print $7}')
# clear cart, add one item, checkout twice
CART=$(curl -s -b "$PJAR" "$BASE/api/v1/cart")
for IID in $(echo "$CART" | python3 -c 'import sys,json; [print(i["id"]) for i in json.load(sys.stdin).get("items",[])]' 2>/dev/null); do
  curl -s -b "$PJAR" -X DELETE -H "x-csrf-token: $PCSRF" -H "Origin: $BASE" -H "X-Forwarded-For: 127.88.0.2" "$BASE/api/v1/cart?itemId=$IID" -o /dev/null
done
PID=$(curl -s -b "$PJAR" "$BASE/api/v1/products?limit=50" | python3 -c 'import sys,json; ps=[p for p in json.load(sys.stdin)["products"] if p.get("stock",0)>0]; print(ps[0]["id"] if ps else "")')
curl -s -b "$PJAR" -H 'Content-Type: application/json' -H "x-csrf-token: $PCSRF" -H "Origin: $BASE" -H "X-Forwarded-For: 127.88.0.2" -X POST "$BASE/api/v1/cart" -d "{\"productId\":\"$PID\",\"quantity\":1}" -o /dev/null
CO1=$(curl -s -D /tmp/p17-h1.txt -b "$PJAR" -H 'Content-Type: application/json' -H "x-csrf-token: $PCSRF" -H "Origin: $BASE" -H "X-Forwarded-For: 127.88.0.2" -X POST "$BASE/api/v1/orders" -d '{}')
CO2=$(curl -s -D /tmp/p17-h2.txt -b "$PJAR" -H 'Content-Type: application/json' -H "x-csrf-token: $PCSRF" -H "Origin: $BASE" -H "X-Forwarded-For: 127.88.0.2" -X POST "$BASE/api/v1/orders" -d '{}')
OID1=$(echo "$CO1" | python3 -c 'import sys,json; d=json.load(sys.stdin); print((d.get("order") or d).get("id",""))' 2>/dev/null)
OID2=$(echo "$CO2" | python3 -c 'import sys,json; d=json.load(sys.stdin); print((d.get("order") or d).get("id",""))' 2>/dev/null)
[ -n "$OID1" ] && need "$OID2" "$OID1" "duplicate checkout → SAME order id" || bad "first checkout failed: $(echo $CO1 | head -c 120)"
grep -qi 'idempotency-replayed: true' /tmp/p17-h2.txt && ok "Idempotency-Replayed header on 2nd POST" || bad "replay header missing"

echo "── FS-9: control-plane authz ────────────────────────────────"
U401=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/admin/chaos")
need "$U401" "401" "chaos unauthenticated → 401"
P403=$(curl -s -o /dev/null -w '%{http_code}' -b "$PJAR" "$BASE/api/v1/admin/jobs")
need "$P403" "403" "jobs non-admin → 403"

echo "── audit gate ──────────────────────────────────────────────"
node scripts/reliability-audit.mjs > /tmp/p17-gate.log 2>&1 && ok "reliability-audit REL1..REL10 PASSED" || bad "audit gate failed (see /tmp/p17-gate.log)"

echo ""
echo "SMOKE PHASE 17: $PASS passed, $FAILS failed"
[ "$FAILS" -eq 0 ] && exit 0 || exit 1

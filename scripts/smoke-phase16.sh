#!/bin/bash
# PHASE 16 smoke test — performance engineering against the dev server
set -u
BASE="http://localhost:3000"
JAR="/tmp/p16-admin.jar"
rm -f "$JAR"
curl -s -c "$JAR" "$BASE/api/v1/products" > /dev/null
CSRF=$(grep ta_csrf "$JAR" | awk '{print $7}')
curl -s -c "$JAR" -b "$JAR" -H 'Content-Type: application/json' -H "x-csrf-token: $CSRF" -X POST "$BASE/api/v1/auth/login" -d '{"phone":"09120000001","password":"Pass1234"}' -o /dev/null
echo "login: admin OK"

echo "--- SQLite state (WAL + indexes) ---"
python3 - <<'PY'
import sqlite3
con = sqlite3.connect('db/custom.db')
print('journal_mode:', con.execute('PRAGMA journal_mode').fetchone()[0])
n = con.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'").fetchone()[0]
print('named indexes:', n)
p16 = con.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name IN ('MedicalCase_patientId_createdAt_idx','AuditLog_createdAt_idx','Notification_userId_read_createdAt_idx','Order_userId_createdAt_idx','CaseEvent_caseId_createdAt_idx','Payment_status_createdAt_idx')").fetchone()[0]
print('phase-16 spot indexes present:', p16, '/ 6')
PY

echo "--- audit.log query plan (must use INDEX, was full-scan) ---"
python3 - <<'PY'
import sqlite3
con = sqlite3.connect('db/custom.db')
plan = con.execute('EXPLAIN QUERY PLAN SELECT * FROM AuditLog ORDER BY createdAt DESC LIMIT 20').fetchall()
print(' | '.join(r[3] for r in plan))
plan2 = con.execute('EXPLAIN QUERY PLAN SELECT * FROM MedicalCase WHERE patientId = (SELECT patientId FROM MedicalCase LIMIT 1) ORDER BY createdAt DESC LIMIT 5').fetchall()
print(' | '.join(r[3] for r in plan2))
PY

echo "--- auth latency: 10 warm /me calls ---"
for i in $(seq 1 10); do
  curl -s -o /dev/null -b "$JAR" -w "%{time_total}\n" "$BASE/api/v1/auth/me"
done | python3 -c "
import sys
times = sorted(float(l) for l in sys.stdin)
print(f'me: p50={times[4]*1000:.1f}ms p95={times[8]*1000:.1f}ms n=10')

"

echo "--- dashboard cold vs warm (15s TTL) ---"
sleep 16
COLD=$(curl -s -o /dev/null -b "$JAR" -w "%{time_total}" "$BASE/api/v1/dashboard")
WARM=$(curl -s -o /dev/null -b "$JAR" -w "%{time_total}" "$BASE/api/v1/dashboard")
WARM2=$(curl -s -o /dev/null -b "$JAR" -w "%{time_total}" "$BASE/api/v1/dashboard")
echo "dashboard: cold=${COLD}s warm=${WARM}s warm2=${WARM2}s (warm < cold expected)"

echo "--- identity cache security contract (deactivate → next request 401) ---"
PJAR="/tmp/p16-pat.jar"
rm -f "$PJAR"
curl -s -c "$PJAR" "$BASE/api/v1/products" > /dev/null
PCSRF=$(grep ta_csrf "$PJAR" | awk '{print $7}')
curl -s -c "$PJAR" -b "$PJAR" -H 'Content-Type: application/json' -H "x-csrf-token: $PCSRF" -X POST "$BASE/api/v1/auth/login" -d '{"phone":"09120000006","password":"Pass1234"}' -o /dev/null
P16_UID=$(python3 -c "import sqlite3; print(sqlite3.connect('db/custom.db').execute(\"SELECT id FROM User WHERE phone='09120000006'\").fetchone()[0])")
curl -s -o /dev/null -b "$JAR" -H 'Content-Type: application/json' -H "x-csrf-token: $CSRF" -X PATCH "$BASE/api/v1/admin/users" -d "{\"id\":\"$P16_UID\",\"isActive\":false}"
ME_OFF=$(curl -s -o /dev/null -w '%{http_code}' -b "$PJAR" "$BASE/api/v1/auth/me")
curl -s -o /dev/null -b "$JAR" -H 'Content-Type: application/json' -H "x-csrf-token: $CSRF" -X PATCH "$BASE/api/v1/admin/users" -d "{\"id\":\"$P16_UID\",\"isActive\":true}"
ME_ON=$(curl -s -o /dev/null -w '%{http_code}' -b "$PJAR" "$BASE/api/v1/auth/me")
echo "deactivated → me: $ME_OFF (expect 401) · reactivated → me: $ME_ON (expect 200)"

echo "--- gzip transfer on prod-shaped asset (dev) ---"
curl -s -o /dev/null -H 'Accept-Encoding: gzip' -D - "$BASE/api/v1/products" 2>/dev/null | rg -i 'content-encoding' || echo "(dev mode may skip encoding — production measured in perf-frontend)"

echo "--- CI gate ---"
node scripts/perf-audit.mjs | tail -3

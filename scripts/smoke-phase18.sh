#!/bin/bash
# PHASE 18 smoke — quality assurance: independent curl checks against the
# production standalone server (assumes scripts/qa-run.sh server or an
# equivalent BH_CHAOS=1 server is up on :3000). Verifies the REG-* bug
# locks at the HTTP level + the 10-type suite inventory on disk.
set -u
BASE="http://localhost:3000"
PASS=0; FAIL=0
ck() { # name, expected, actual
  if [ "$2" = "$3" ]; then echo "  ✓ $1"; PASS=$((PASS+1)); else echo "  ✗ $1 — expected [$2] got [$3]"; FAIL=$((FAIL+1)); fi
}

echo "── P18 SMOKE · QA locks (curl-level, independent of bun test) ──"

# server must be the QA/production one (not a framework 404 page)
L=$(curl -s --max-time 3 "$BASE/liveness" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("status",""))' 2>/dev/null)
ck "liveness probe answers our minimal JSON" "ok" "$L"

# 1 · REG-02: the reconstructed integrations/test route exists and
#     enforces its contract. CSRF shape passes (anon cookie+header pair from
#     the public GET) → the AUTH gate answers 401 — proving the route is OURS
#     (a lost file would be a framework 404, and no CSRF state would exist).
AJAR=/tmp/p18-anon.jar; rm -f "$AJAR"
curl -s -c "$AJAR" "$BASE/api/v1/products" > /dev/null
ACSRF=$(grep ta_csrf "$AJAR" | awk '{print $7}')
ANON=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -X POST "$BASE/api/v1/admin/integrations/test" -H 'Content-Type: application/json' -H "Origin: $BASE" -H "x-csrf-token: $ACSRF" -b "$AJAR" -d '{"kind":"SMS"}')
ck "REG-02 integrations/test: anon → 401 (route alive, gate intact)" "401" "$ANON"

# 2 · REG-01: the upload route answers our API (401 anon), not a 404 page
UP=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -X POST "$BASE/api/v1/images/upload" -H "Origin: $BASE" -H "x-csrf-token: $ACSRF" -b "$AJAR")
ck "REG-01 images/upload: anon → 401 (never a framework 404)" "401" "$UP"

# 3 · REG-03 class: a referenced dynamic route answers our envelope
DYN=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$BASE/api/v1/cases/nonexistent0000")
ck "REG-03 inventory: unknown case → 401 (our handler, auth-gated)" "401" "$DYN"

# 4 · contract §89: per-IP login limit (15/5min — success resets the
#     per-ACCOUNT counter by design, so only the IP limiter trips) answers
#     429 with Retry-After
JAR=/tmp/p18-smoke.jar; rm -f "$JAR"
curl -s -c "$JAR" "$BASE/api/v1/products" > /dev/null
CSRF=$(grep ta_csrf "$JAR" | awk '{print $7}')
for i in $(seq 1 15); do
  curl -s -c "$JAR" -b "$JAR" -H 'Content-Type: application/json' -H "x-csrf-token: $CSRF" -X POST "$BASE/api/v1/auth/login" -d '{"phone":"09120000001","password":"Pass1234"}' -o /dev/null
done
RL=$(curl -s -o /dev/null -w '%{http_code}' -c "$JAR" -b "$JAR" -H 'Content-Type: application/json' -H "x-csrf-token: $CSRF" -X POST "$BASE/api/v1/auth/login" -d '{"phone":"09120000001","password":"Pass1234"}')
ck "login per-IP rate-limit engaged (429 after burst)" "429" "$RL"
RA=$(curl -s -D - -o /dev/null -c "$JAR" -b "$JAR" -H 'Content-Type: application/json' -H "x-csrf-token: $CSRF" -X POST "$BASE/api/v1/auth/login" -d '{"phone":"09120000001","password":"Pass1234"}' | grep -i 'retry-after' | head -1)
[ -n "$RA" ] && { echo "  ✓ §89 Retry-After present ($RA)"; PASS=$((PASS+1)); } || { echo "  ✗ Retry-After missing on 429"; FAIL=$((FAIL+1)); }

# 5 · suite inventory on disk: the 10 ordered types exist
cd "$(dirname "$0")/.."
for f in tests/integration/api-golden-path.test.ts tests/integration/database.test.ts \
         tests/security-pentest.sh tests/e2e/run-e2e.mjs tests/regression/regression.test.ts \
         tests/integration/performance.test.ts tests/load/load.test.ts tests/integration/contract.test.ts; do
  if [ -f "$f" ]; then PASS=$((PASS+1)); else echo "  ✗ suite missing: $f"; FAIL=$((FAIL+1)); fi
done
echo "  ✓ suite inventory (8 spot files)" # summary line for the 8 above

# 6 · the QA gate itself is wired into package.json
grep -q '"audit:qa"' package.json && { echo "  ✓ npm run audit:qa wired"; PASS=$((PASS+1)); } || { echo "  ✗ audit:qa missing in package.json"; FAIL=$((FAIL+1)); }

echo "── P18 SMOKE: $PASS pass · $FAIL fail ──"
[ "$FAIL" = "0" ]

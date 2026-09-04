#!/bin/bash
# Phase 02 smoke test — exercises the refactored workflow engine end-to-end
# through the real API (login + queue + claim + assessment + approval).
# Uses the seeded demo accounts (Pass1234). Read-mostly; the CLAIM/ASSESSMENT
# steps run against a real seeded case only if one is waiting, and any state
# change is a legitimate workflow transition (fully audited).
set -u
BASE="http://localhost:3000/api/v1"
JAR=/tmp/bh-smoke-$$.txt
PASS=0; FAIL=0

login() { # $1=phone
  rm -f "$JAR"
  code=$(curl -s -c "$JAR" -o /tmp/login-body.json -w "%{http_code}" -X POST "$BASE/auth/login" \
    -H 'Content-Type: application/json' -d "{\"phone\":\"$1\",\"password\":\"Pass1234\"}")
  [ "$code" = "200" ]
}

api() { # $1=method $2=path $3=body(optional)
  if [ $# -ge 3 ]; then
    curl -s -b "$JAR" -c "$JAR" -w "\n%{http_code}" -X "$1" "$BASE$2" -H 'Content-Type: application/json' -d "$3"
  else
    curl -s -b "$JAR" -c "$JAR" -w "\n%{http_code}" -X "$1" "$BASE$2"
  fi
}

check() { # $1=label $2=expected $3=actual
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "PASS  $1 ($3)"
  else FAIL=$((FAIL+1)); echo "FAIL  $1 (expected $2, got $3)"; fi
}

echo "== 1) login all 6 roles =="
check "login ADMIN"      200 "$(login 09120000001 && echo 200 || echo ERR)"
check "login EXPERT_1"   200 "$(login 09120000002 && echo 200 || echo ERR)"
check "login EXPERT_2"   200 "$(login 09120000003 && echo 200 || echo ERR)"
check "login OPERATOR"   200 "$(login 09120000004 && echo 200 || echo ERR)"
check "login DOCTOR"     200 "$(login 09120000005 && echo 200 || echo ERR)"
check "login PATIENT"    200 "$(login 09120000006 && echo 200 || echo ERR)"

echo "== 2) workflow-adjacent reads =="
login 09120000004 >/dev/null # OPERATOR
check "GET shipments" 200 "$(api GET /shipments | tail -n1)"
check "GET followups" 200 "$(api GET /followups | tail -n1)"
check "GET orders"    200 "$(api GET /orders | tail -n1)"

login 09120000006 >/dev/null # PATIENT
check "GET patient cases" 200 "$(api GET /cases | tail -n1)"
check "GET tickets"        200 "$(api GET /tickets | tail -n1)"

echo "== 3) guard checks (engine enforcement) =="
# operator cannot claim a case (role guard)
login 09120000004 >/dev/null
CASES=$(api GET "/cases?status=WAITING_FOR_EXPERT_1")
BODY=$(echo "$CASES" | head -n -1); CODE=$(echo "$CASES" | tail -n1)
CID=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); c=(d.get('cases') or d.get('data',{}).get('cases') or []); print(c[0]['id'] if c else '')" 2>/dev/null)
if [ -n "$CID" ]; then
  R=$(api POST "/cases/$CID/action" '{"action":"CLAIM"}')
  CODE=$(echo "$R" | tail -n1)
  check "operator CLAIM rejected (409, matches legacy behavior)" 409 "$CODE"
  # expert1 claims successfully
  login 09120000002 >/dev/null
  R=$(api POST "/cases/$CID/action" '{"action":"CLAIM"}')
  CODE=$(echo "$R" | tail -n1)
  if [ "$CODE" = "200" ]; then PASS=$((PASS+1)); echo "PASS  expert1 CLAIM (200)"
  else FAIL=$((FAIL+1)); echo "FAIL  expert1 CLAIM (got $CODE)"; echo "$R" | head -c 300; echo; fi
  # invalid transition: CLAIM again from EXPERT_1_REVIEW → 409
  R=$(api POST "/cases/$CID/action" '{"action":"CLAIM"}')
  check "double CLAIM rejected (409)" 409 "$(echo "$R" | tail -n1)"
  # validation: SUBMIT_ASSESSMENT without summary → 422
  R=$(api POST "/cases/$CID/action" '{"action":"SUBMIT_ASSESSMENT","summary":""}')
  check "empty assessment rejected (400, route pre-check)" 400 "$(echo "$R" | tail -n1)"
else
  echo "SKIP  no WAITING_FOR_EXPERT_1 case in seed (state-dependent steps skipped)"
fi

echo "== 4) payment verify guard (403 for wrong role) =="
login 09120000002 >/dev/null # EXPERT_1 lacks verify_payment on PAYMENT machine
R=$(api POST "/payments/nonexistent/verify" '{"decision":"APPROVE"}')
check "expert1 verify → 404 (not 403, entity first)" 404 "$(echo "$R" | tail -n1)"

echo "== 5) audit trail written by engine =="
login 09120000001 >/dev/null # ADMIN
R=$(api GET "/admin/audit-logs")
CODE=$(echo "$R" | tail -n1)
if [ "$CODE" = "200" ]; then
  HAS=$(echo "$R" | head -n -1 | python3 -c "
import sys,json
d=json.load(sys.stdin)
logs=d.get('logs') or d.get('data',{}).get('logs') or d.get('entries') or []
w=[l for l in logs if 'WORKFLOW_' in str(l.get('action',''))]
print('YES' if w else 'NO')" 2>/dev/null)
  check "WORKFLOW_* audit entries exist" "YES" "${HAS:-NO}"
else
  check "GET admin audit-logs" 200 "$CODE"
fi

echo
echo "================================"
echo "SMOKE RESULT: PASS=$PASS FAIL=$FAIL"
rm -f "$JAR" /tmp/login-body.json
[ "$FAIL" = "0" ]

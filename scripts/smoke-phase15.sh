#!/bin/bash
# PHASE 15 smoke test — observability against the dev server
set -u
BASE="http://localhost:3000"
JAR="/tmp/p15-admin.jar"
rm -f "$JAR"
curl -s -c "$JAR" "$BASE/api/v1/products" > /dev/null
CSRF=$(grep ta_csrf "$JAR" | awk '{print $7}')
LOGIN=$(curl -s -c "$JAR" -b "$JAR" -H 'Content-Type: application/json' -H "x-csrf-token: $CSRF" -X POST "$BASE/api/v1/auth/login" -d '{"phone":"09120000001","password":"Pass1234"}' | head -c 60)
echo "login: ${LOGIN:0:40}…"

echo "--- probes (public) ---"
for p in /liveness /readiness /health; do
  curl -s -o /tmp/p15-probe.json -w "$p → %{http_code} " "$BASE$p"
  head -c 90 /tmp/p15-probe.json; echo ""
done

echo "--- correlation propagation ---"
curl -s -D /tmp/p15-h1 -o /dev/null -b "$JAR" -H 'X-Correlation-ID: corr_smoke_15' -H "traceparent: 00-$(printf 'a%.0s' {1..32})-$(printf 'b%.0s' {1..16})-01" "$BASE/api/v1/products"
echo "echo corr:  $(grep -i x-correlation-id /tmp/p15-h1)"
echo "traceparent: $(grep -i '^traceparent' /tmp/p15-h1 | head -c 60)…"
echo "request-id: $(grep -i x-request-id /tmp/p15-h1)"

echo "--- admin observability snapshot ---"
curl -s -b "$JAR" "$BASE/api/v1/admin/observability" | python3 -c "
import json,sys; d=json.load(sys.stdin)
print('health:', d['health']['status'], '| db:', d['db']['pingOk'], d['db']['pingMs'], 'ms')
print('workerAlive:', d['queue']['workerAlive'], '| pending:', d['queue']['pending'])
api_req = sum(v for k,v in d['metrics']['counters'].items() if k.startswith('api_requests_total'))
db_q = sum(v for k,v in d['metrics']['counters'].items() if k.startswith('db_queries_total'))
print('api requests counted:', api_req, '| db queries counted:', db_q)
print('series points:', len(d['series']), '| alerts:', len(d['alerts']), '| open:', d['openAlertCount'])
print('business gauges:', {k:v for k,v in list(d['metrics']['gauges'].items()) if k.startswith('biz_')})
print('log ring:', d['logs']['ringSize'], '| durable:', d['logs']['durableCount'])
"

echo "--- log search (q + lvl) ---"
curl -s -b "$JAR" "$BASE/api/v1/admin/logs?lvl=warn&limit=3" | python3 -c "
import json,sys; d=json.load(sys.stdin)
print('rows:', len(d['logs']), 'total:', d['meta']['total'])
for r in d['logs'][:2]: print('  ', r['lvl'], r['svc'], r['msg'][:60])
"

echo "--- alerts list ---"
curl -s -b "$JAR" "$BASE/api/v1/admin/alerts?limit=5" | python3 -c "
import json,sys; d=json.load(sys.stdin)
print('alerts:', len(d['alerts']), 'total:', d['meta']['total'])"

echo "--- authz: patient probes (expect 403/401) ---"
rm -f /tmp/p15-pat.jar
curl -s -c /tmp/p15-pat.jar "$BASE/api/v1/products" > /dev/null
PCSRF=$(grep ta_csrf /tmp/p15-pat.jar | awk '{print $7}')
curl -s -c /tmp/p15-pat.jar -b /tmp/p15-pat.jar -H 'Content-Type: application/json' -H "x-csrf-token: $PCSRF" -X POST "$BASE/api/v1/auth/login" -d '{"phone":"09120000006","password":"Pass1234"}' -o /dev/null
echo "patient → observability: $(curl -s -o /dev/null -w '%{http_code}' -b /tmp/p15-pat.jar "$BASE/api/v1/admin/observability")"
echo "patient → logs:          $(curl -s -o /dev/null -w '%{http_code}' -b /tmp/p15-pat.jar "$BASE/api/v1/admin/logs")"
echo "anon → observability:    $(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/admin/observability")"

echo "--- anti-unbounded: deep log page → 422 ---"
curl -s -o /dev/null -w "%{http_code}\n" -b "$JAR" "$BASE/api/v1/admin/logs?page=9999&limit=100"

#!/bin/bash
# PHASE 14 smoke test — search + reporting + exports against dev server
set -u
BASE="http://localhost:3000"
JAR="/tmp/p14-admin.jar"
rm -f "$JAR"
# fetch csrf cookie first (double-submit), then login as admin
curl -s -c "$JAR" "$BASE/api/v1/products" > /dev/null
CSRF=$(grep ta_csrf "$JAR" | awk '{print $7}')
LOGIN=$(curl -s -c "$JAR" -b "$JAR" -H 'Content-Type: application/json' -H "x-csrf-token: $CSRF" -X POST "$BASE/api/v1/auth/login" -d '{"phone":"09120000001","password":"Pass1234"}' | head -c 120)
echo "login: $LOGIN"

echo "--- catalog (admin) ---"
curl -s -b "$JAR" "$BASE/api/v1/reports" | python3 -c "import json,sys; d=json.load(sys.stdin); print('reports:', len(d['reports'])); [print(' ', r['id'], '|', r['category'], '|', r['permission']) for r in d['reports'][:6]]"

echo "--- run revenue summary ---"
curl -s -b "$JAR" "$BASE/api/v1/reports/financial.revenue-summary?groupBy=day" | python3 -c "
import json,sys; d=json.load(sys.stdin)
r=d['report']; print('meta:', {k:r['meta'][k] for k in ['from','to','cached','truncated','totalRows','ms']})
print('rows:', len(r['rows']), 'first:', r['rows'][0] if r['rows'] else None)
print('summary keys:', [s['key'] for s in (r.get('summary') or [])])"

echo "--- run custom dataset (payments, groupBy=none) ---"
curl -s -b "$JAR" "$BASE/api/v1/reports/custom.dataset?dataset=payments&groupBy=none" | python3 -c "
import json,sys; d=json.load(sys.stdin); r=d.get('report') or d
print('rows:', len(r.get('rows',[])), 'meta truncated:', r['meta']['truncated'], 'note:', r['meta'].get('noteFa'))"

echo "--- window too wide (500d) → 422 ---"
FROM=$(python3 -c "import datetime; print((datetime.date.today()-datetime.timedelta(days=500)).isoformat())")
curl -s -o /dev/null -w "%{http_code}\n" -b "$JAR" "$BASE/api/v1/reports/financial.revenue-summary?from=$FROM"

echo "--- deep pagination → 422 ---"
curl -s -o /dev/null -w "%{http_code}\n" -b "$JAR" "$BASE/api/v1/products?page=9999&limit=100"

echo "--- export CSV ---"
curl -s -D /tmp/p14-h1 -b "$JAR" "$BASE/api/v1/reports/business.top-products/export?format=csv" -o /tmp/p14.csv
grep -iE "content-type|content-disposition|x-rows" /tmp/p14-h1 | head -3
head -c 300 /tmp/p14.csv | od -c | head -3

echo "--- export XLSX ---"
curl -s -D /tmp/p14-h2 -b "$JAR" "$BASE/api/v1/reports/financial.expenses/export?format=xlsx&groupBy=month" -o /tmp/p14.xlsx
grep -iE "content-type" /tmp/p14-h2 | head -1; ls -la /tmp/p14.xlsx
python3 -c "
import zipfile
z = zipfile.ZipFile('/tmp/p14.xlsx')
print('zip entries:', z.namelist())
print('test bad file:', z.testzip())" 2>&1 | head -4
python3 -c "
import openpyxl
wb = openpyxl.load_workbook('/tmp/p14.xlsx')
ws = wb.active
print('sheet:', ws.title, 'rtl:', ws.sheet_view.rightToLeft)
for row in ws.iter_rows(min_row=1, max_row=6, values_only=True): print(' ', row)
" 2>&1 | head -8

echo "--- export PDF ---"
curl -s -D /tmp/p14-h3 -b "$JAR" "$BASE/api/v1/reports/financial.revenue-summary/export?format=pdf&groupBy=day" -o /tmp/p14.pdf
grep -iE "content-type" /tmp/p14-h3 | head -1; ls -la /tmp/p14.pdf
head -c 20 /tmp/p14.pdf | od -c | head -2

echo "--- async export (POST) ---"
curl -s -b "$JAR" -H 'Content-Type: application/json' -H "x-csrf-token: $CSRF" -X POST "$BASE/api/v1/reports/financial.payments/export" -d '{"format":"pdf","lang":"fa","params":{"groupBy":"day"}}'
echo; sleep 3
echo "--- my exports ---"
curl -s -b "$JAR" "$BASE/api/v1/reports/exports" | python3 -c "import json,sys; d=json.load(sys.stdin); print('exports:', len(d['exports'])); [print(' ', e['id'], e['fileName'], e['sizeBytes']) for e in d['exports'][:3]]"

echo "--- global search (admin: 'سارا') ---"
curl -s -b "$JAR" --get --data-urlencode "q=سارا" "$BASE/api/v1/search" | python3 -c "
import json,sys; d=json.load(sys.stdin)
print('ms:', d['ms'], 'groups:', [g['kind'] for g in d['groups']])
for g in d['groups'][:3]: print(' ', g['kind'], '→', [h['title'] for h in g['hits'][:2]])"

echo "--- global search (products: 'روغن' or 'zinc') ---"
curl -s -b "$JAR" --get --data-urlencode "q=شربت" "$BASE/api/v1/search" | python3 -c "
import json,sys; d=json.load(sys.stdin)
print('groups:', [g['kind'] for g in d['groups']])"

echo "--- legacy /admin/reports (bounded adapter) ---"
curl -s -b "$JAR" "$BASE/api/v1/admin/reports" | python3 -c "
import json,sys; d=json.load(sys.stdin)
print('keys:', sorted(d.keys()))
print('byDay len:', len(d['byDay']), 'topProducts:', len(d['topProducts']), 'summary:', d['summary'])"

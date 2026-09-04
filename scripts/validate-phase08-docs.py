#!/usr/bin/env python3
# ── PHASE 08 validator: BACKEND.md + registries + gates + code markers ─────
# Same family as validate-phase01..07-docs.py — honest, mechanical checks.
import re, subprocess, sys, json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def read(p):
    with open(os.path.join(ROOT, p), encoding='utf-8') as f:
        return f.read()

errors, warnings = [], []

# 1) deliverables exist
for p in ['docs/BACKEND.md', 'scripts/backend-audit.mjs', 'tests/integration/api-golden-path.test.ts',
          'src/server/__tests__/backend-core.test.ts', 'src/server/api/handler.ts',
          'src/server/domain/policies.ts', 'src/server/infrastructure/jobs.ts',
          'src/server/infrastructure/cache.ts', 'src/server/infrastructure/events.ts',
          'src/server/infrastructure/uow.ts', 'src/server/infrastructure/bootstrap.ts']:
    if not os.path.exists(os.path.join(ROOT, p)):
        errors.append(f'missing deliverable: {p}')

be = read('docs/BACKEND.md')
# 2) mandated sections (12 standards + audit + tests + versioning)
for kw in ['ممیزی', 'معماری لایه‌ای', 'Validation', 'Business Logic', 'Authorization', 'Transactions',
           'Error Handling', 'Logging', 'Caching', 'Background Jobs', 'Events', 'نسخه‌بندی',
           'Pagination', 'Filtering', 'Sorting', 'تست', 'گیت معماری', 'بدهی']:
    if kw not in be:
        errors.append(f'BACKEND.md missing section keyword: {kw}')
# 3) audit findings A1..A16 present
for i in range(1, 17):
    if f'A{i} ' not in be and f'A{i} |' not in be:
        errors.append(f'BACKEND.md missing audit finding A{i}')
# 4) ED-93..105 registry in BACKEND + BR
for i in range(93, 106):
    if f'ED-{i}' not in be:
        errors.append(f'BACKEND.md missing ED-{i}')
br = read('docs/BUSINESS-RULES.md')
for i in range(93, 106):
    if f'| ED-{i} ' not in br:
        errors.append(f'BUSINESS-RULES.md missing ED-{i} row')
# 5) PRD roadmap + doc index + RTM
prd = read('docs/PRD.md')
if 'Phase 08' not in prd or 'BACKEND.md' not in prd:
    errors.append('PRD.md missing phase 08 row / doc index entry')
rtm = read('docs/REQUIREMENTS-TRACEABILITY-MATRIX.md')
if 'ED-01..ED-134' not in rtm or 'PHASE 08' not in rtm:
    errors.append('RTM missing ED-105 range or phase-08 note')
# 6) package.json gate script
pkg = json.loads(read('package.json'))
if pkg.get('scripts', {}).get('audit:backend') != 'node scripts/backend-audit.mjs':
    errors.append('package.json missing audit:backend script')
# 7) live architecture gate must PASS
r = subprocess.run(['node', 'scripts/backend-audit.mjs'], capture_output=True, text=True, cwd=ROOT)
if r.returncode != 0:
    errors.append('backend-audit gate FAILED (must be 0 violations)')
else:
    m = re.search(r'route files\n', r.stdout)
# 8) no route imports @/lib/db (structural re-check, independent of the gate)
viol = 0
for dirpath, _, files in os.walk(os.path.join(ROOT, 'src/app/api')):
    for fn in files:
        if fn == 'route.ts':
            src = open(os.path.join(dirpath, fn), encoding='utf-8').read()
            for bad in ["from '@/lib/db'", 'from "@/lib/db"', 'from \'@/lib/notify\'', 'executeTransition', 'genCode(']:
                if bad in src:
                    viol += 1
                    errors.append(f'{os.path.join(dirpath, fn)}: forbidden marker {bad!r}')
# 9) error taxonomy codes documented
for code in ['VALIDATION', 'AUTH_REQUIRED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'BUSINESS_RULE', 'RATE_LIMITED', 'INTERNAL']:
    if code not in be:
        errors.append(f'BACKEND.md missing error code {code}')
# 10) CJK stray scan (project language policy: fa/en only)
for mch in re.finditer(r'[\u4e00-\u9fff\u3040-\u30ff]', be):
    ctx = be[max(0, mch.start()-40):mch.start()+40].replace('\n', ' ')
    errors.append(f'BACKEND.md stray CJK char: …{ctx}…')
# 11) secret scan on new files
SECRET = re.compile(r'(-----BEGIN|api[_-]?key\s*[:=]\s*[A-Za-z0-9]{16,}|secret\s*[:=]\s*[\'"][^\'"]{12,})', re.I)
for p in ['docs/BACKEND.md', 'src/server/api/handler.ts', 'src/server/core/logger.ts']:
    if SECRET.search(read(p)):
        errors.append(f'possible secret in {p}')

print(f'validate-phase08-docs — errors: {len(errors)} warnings: {len(warnings)}')
for e in errors: print('  ✗', e)
for w in warnings: print('  ⚠', w)
sys.exit(1 if errors else 0)

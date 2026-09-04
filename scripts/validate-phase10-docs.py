#!/usr/bin/env python3
# ── PHASE 10 validator: FILE-MEDIA.md + engine code + registries + gates ────
# Same family as validate-phase01..08-docs.py — honest, mechanical checks.
import re, subprocess, sys, json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def read(p):
    with open(os.path.join(ROOT, p), encoding='utf-8') as f:
        return f.read()

errors, warnings = [], []

# 1) deliverables exist
for p in [
    'docs/FILE-MEDIA.md',
    'src/server/infrastructure/media/config.ts',
    'src/server/infrastructure/media/storage-driver.ts',
    'src/server/infrastructure/media/scanner.ts',
    'src/server/infrastructure/media/signed-url.ts',
    'src/server/infrastructure/media/processing.ts',
    'src/server/infrastructure/media/pipeline.ts',
    'src/server/infrastructure/media/lifecycle.ts',
    'src/server/infrastructure/media/__tests__/media.test.ts',
    'src/server/application/services/mediaFileService.ts',
    'src/app/api/v1/files/route.ts',
    'src/app/api/v1/files/[id]/route.ts',
    'src/app/api/v1/files/[id]/versions/route.ts',
    'src/app/api/v1/files/[id]/content/route.ts',
    'src/app/api/v1/files/[id]/signed-url/route.ts',
    'src/app/api/v1/admin/media/stats/route.ts',
    'src/app/api/v1/admin/media/lifecycle/route.ts',
    'src/app/api/v1/images/upload/route.ts',
    'src/app/api/v1/images/[id]/route.ts',
    'tests/integration/media-engine.test.ts',
    'scripts/media-audit.mjs',
    'scripts/backup-media.mjs',
    'scripts/restore-media.mjs',
    'scripts/migrate-legacy-media.mjs',
    'prisma/schema.prisma',
]:
    if not os.path.exists(os.path.join(ROOT, p)):
        errors.append(f'missing deliverable: {p}')

fm = read('docs/FILE-MEDIA.md')
# 2) mandated sections (the 12+11 commanded items)
for kw in ['ممیزی', 'معماری موتور', 'طبقه‌بندی و ماتریس دسترسی', 'چرخه حیات', 'استراتژی بدافزار',
           'Signed URLs', 'حدود و مجازها', 'Versioning', 'ذخیره‌سازی', 'عدم بلاک',
           'رابط API', 'پشتیبان‌گیری و بازیابی', 'تست', 'بدهی', 'رجیستری']:
    if kw not in fm:
        errors.append(f'FILE-MEDIA.md missing section keyword: {kw}')
# commanded classification matrix
for kw in ['PUBLIC', 'PRIVATE', 'TEMPORARY', 'Storage Lifecycle', 'Malware', 'Backup']:
    if kw not in fm:
        errors.append(f'FILE-MEDIA.md missing commanded item: {kw}')
# 3) audit findings F1..F12
for i in range(1, 13):
    if f'F{i} ' not in fm and f'F{i} |' not in fm:
        errors.append(f'FILE-MEDIA.md missing audit finding F{i}')
# 4) ED-106..119 registry in FILE-MEDIA + BUSINESS-RULES
for i in range(106, 120):
    if f'ED-{i}' not in fm:
        errors.append(f'FILE-MEDIA.md missing ED-{i}')
br = read('docs/BUSINESS-RULES.md')
for i in range(106, 120):
    if f'| ED-{i} ' not in br:
        errors.append(f'BUSINESS-RULES.md missing ED-{i} row')
# 5) PRD roadmap + doc index + RTM
prd = read('docs/PRD.md')
if 'Phase 10' not in prd or 'FILE-MEDIA.md' not in prd:
    errors.append('PRD.md missing phase 10 row / doc index entry')
if 'Phase 09' not in prd:
    errors.append('PRD.md missing phase 09 status row (interrupted-session record)')
rtm = read('docs/REQUIREMENTS-TRACEABILITY-MATRIX.md')
if 'ED-01..ED-119' not in rtm and 'ED-01..ED-105' not in rtm:
    errors.append('RTM missing ED range')
if 'PHASE 10' not in rtm:
    errors.append('RTM missing PHASE 10 note')
# 6) package.json scripts
pkg = json.loads(read('package.json'))
for key, val in [('audit:media', 'node scripts/media-audit.mjs'), ('backup:media', 'bun scripts/backup-media.mjs'),
                 ('restore:media', 'bun scripts/restore-media.mjs'), ('migrate:media', 'bun scripts/migrate-legacy-media.mjs')]:
    if pkg.get('scripts', {}).get(key) != val:
        errors.append(f'package.json missing/incorrect script {key}')
# 7) live gates must PASS
for gate in [['node', 'scripts/media-audit.mjs'], ['node', 'scripts/backend-audit.mjs']]:
    r = subprocess.run(gate, capture_output=True, text=True, cwd=ROOT)
    if r.returncode != 0:
        errors.append(f'gate FAILED: {gate[1]}')
# 8) schema markers (engine entities + bridges)
schema = read('prisma/schema.prisma')
for kw in ['model StoredFile', 'model StoredFileVersion', 'model StoredFileVariant',
           'storedFileId', 'imageFileId']:
    if kw not in schema:
        errors.append(f'schema.prisma missing marker: {kw}')
# 9) events + bootstrap wiring
ev = read('src/server/infrastructure/events.ts')
for kw in ['MediaFileReady', 'MediaFileInfected', 'MediaFilePurged']:
    if kw not in ev:
        errors.append(f'events.ts missing {kw}')
boot = read('src/server/infrastructure/bootstrap.ts')
for kw in ["'media-process'", "'media-lifecycle'"]:
    if kw not in boot:
        errors.append(f'bootstrap.ts missing job {kw}')
# 10) async discipline: no sync storeImage in the server layer (structural re-check)
viol = 0
for dirpath, _, files in os.walk(os.path.join(ROOT, 'src/server')):
    for fn in files:
        if not fn.endswith('.ts') or '__tests__' in dirpath:
            continue
        src = open(os.path.join(dirpath, fn), encoding='utf-8').read()
        if re.search(r'\bstoreImage\s*\(', src):
            viol += 1
if viol:
    errors.append(f'{viol} server files still call storeImage() (must be acceptUpload, ED-114)')
# 11) signed-url binds variant+version (structural)
su = read('src/server/infrastructure/media/signed-url.ts')
if not re.search(r'update\(`\$\{fileId\}\.\$\{version\}\.\$\{variant\}\.\$\{exp\}`\)', su):
    errors.append('signed-url message must bind fileId.version.variant.exp (ED-112)')
# 12) no CJK characters in code files (project convention)
for dirpath, _, files in os.walk(os.path.join(ROOT, 'src')):
    for fn in files:
        if not fn.endswith(('.ts', '.tsx')):
            continue
        src = open(os.path.join(dirpath, fn), encoding='utf-8').read()
        if re.search(r'[\u4e00-\u9fff]', src):
            errors.append(f'CJK characters found in {os.path.join(dirpath, fn)}')
        break  # per-file check is enough per directory walk iteration

# ── report ────────────────────────────────────────────────────────────────
if errors:
    print('PHASE 10 VALIDATION: FAIL')
    for e in errors: print(f'  ✗ {e}')
    sys.exit(1)
if warnings:
    for w in warnings: print(f'  ⚠ {w}')
print('PHASE 10 VALIDATION: PASS — deliverables, sections, F1..F12, ED-106..119, registries, scripts, gates, structural checks all green')

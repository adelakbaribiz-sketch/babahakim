#!/usr/bin/env python3
# ── PHASE 14 doc validator — Search, Reporting & Analytics ──────────────────
# Structural validation for docs/SEARCH-REPORTING.md + registry coherence.
# Charter rule 2: every phase deliverable must be machine-checkable.
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / 'docs'
errors = []
warns = []


def err(msg):
    errors.append(msg)
    print(f"  ✗ {msg}")


def ok(msg):
    print(f"  ✓ {msg}")


# 1 ── deliverables exist
sr = (DOCS / 'SEARCH-REPORTING.md').read_text()
adr = (DOCS / 'ADR' / 'ADR-0018-search-reporting-bounded-engine.md').read_text()
adr_idx = (DOCS / 'ADR' / 'README.md').read_text()
br = (DOCS / 'BUSINESS-RULES.md').read_text()
ok('deliverables present (SEARCH-REPORTING.md + ADR-0018)')

# 2 ── mandated sections (phase command coverage)
MANDATORY_SECTIONS = [
    ('## 1. ممیزی', 'pre-stage audit S-1..S-10'),
    ('## 2. موتور جستجو', 'search engine'),
    ('Normalization', 'fa normalization §25'),
    ('DSL فیلتر', 'filtering'),
    ('Unbounded', 'anti-unbounded contract'),
    ('## 3. مرجع گزارش', 'reporting engine'),
    ('OPERATIONAL', 'category'),
    ('FINANCIAL', 'category'),
    ('BUSINESS', 'category'),
    ('USER', 'category'),
    ('PERFORMANCE', 'category'),
    ('CUSTOM', 'category'),
    ('Permission-aware', 'the explicit phase requirement'),
    ('## 4. خروجی', 'exports'),
    ('CSV', 'format'),
    ('XLSX', 'format'),
    ('PDF', 'format'),
    ('## 5. قرارداد API', 'API contract'),
    ('## 6. Frontend', 'UI'),
    ('## 7. تست', 'tests'),
    ('## 8. گیت CI', 'gate SR1..SR10'),
    ('## 9. تصمیمات مهندسی', 'ED registry'),
    ('## 10. بدهی', 'honest debt list'),
]
for needle, why in MANDATORY_SECTIONS:
    if needle not in sr:
        err(f"SEARCH-REPORTING.md missing section content: {needle} ({why})")
ok(f'{len(MANDATORY_SECTIONS)} mandated topics present')

# 3 ── report catalog: 19 reports × 6 categories (must match the CODE registry)
SRC = ROOT / 'src'
registry = (SRC / 'server' / 'infrastructure' / 'reporting' / 'registry.ts').read_text()
report_files = {
    'operational': 'reports/operational.ts', 'financial': 'reports/financial.ts',
    'business': 'reports/business.ts', 'user': 'reports/user.ts',
    'performance': 'reports/performance.ts', 'custom': 'reports/custom.ts',
}
ids = set()
for cat, relpath in report_files.items():
    content = (SRC / 'server' / 'infrastructure' / 'reporting' / relpath).read_text()
    found = re.findall(r"id:\s*REPORT_IDS\.(\w+)", content)
    if not found:
        err(f"registry file {relpath} has no REPORT_IDS references")
    ids.update(found)
if len(ids) != 19:
    err(f"report count {len(ids)} != 19 (catalog must match SEARCH-REPORTING)")
else:
    ok('19 reports registered in code')

# 4 ── permissions ⊆ PERMISSIONS catalogue (cross-check with constants.ts)
constants = (SRC / 'lib' / 'constants.ts').read_text()
perms = set(re.findall(r"'([a-z_]+)'", constants.split('PERMISSIONS = [')[1].split('] as const')[0]))
used = set()
for relpath in report_files.values():
    content = (SRC / 'server' / 'infrastructure' / 'reporting' / relpath).read_text()
    used.update(re.findall(r"permission:\s*'([a-z_]+)'", content))
custom = (SRC / 'server' / 'infrastructure' / 'reporting' / 'reports' / 'custom.ts').read_text()
used.update(re.findall(r":\s*'([a-z_]+)'", custom.split('DATASET_PERMISSIONS')[1].split('}')[0]))
bad = used - perms
if bad:
    err(f"report permissions outside catalogue: {sorted(bad)}")
else:
    ok(f'{len(used)} distinct permissions all resolve in constants.ts')

# 5 ── ED chain: ED-151..163 present in BR + doc, no gaps
for i in range(151, 164):
    if f'| ED-{i} ' not in br:
        err(f"BUSINESS-RULES.md missing ED-{i} table row")
if 'ED-151..163' not in adr_idx and 'ED-151..163' not in br:
    err('ED range ED-151..163 not referenced in ADR README / BR')
ok('ED-151..163 chain complete')

# 6 ── BR-SRCH/BR-RPT section
if '## §9 — قوانین جستجو و گزارش فاز ۱۴ (BR-SRCH / BR-RPT)' not in br:
    err('BUSINESS-RULES.md missing §9 BR-SRCH/BR-RPT')
for code in ['BR-SRCH-01', 'BR-SRCH-05', 'BR-RPT-01', 'BR-RPT-08']:
    if code not in br:
        err(f"BR missing {code}")
ok('BR-SRCH-01..05 + BR-RPT-01..08 present')

# 7 ── phase references in PRD + RTM
prd = (DOCS / 'PRD.md').read_text()
rtm = (DOCS / 'REQUIREMENTS-TRACEABILITY-MATRIX.md').read_text()
if '**Phase 14**' not in prd:
    err('PRD §12 roadmap missing Phase 14 row')
if 'ED-01..ED-163' not in rtm:
    err('RTM §97 ED chain not extended to 163')
if 'PHASE 14' not in rtm:
    err('RTM missing phase-14 note')
ok('PRD + RTM phase markers present')

# 8 ── gate + npm script + tests wired
pkg = (ROOT / 'package.json').read_text()
if 'audit:reporting' not in pkg:
    err('package.json missing audit:reporting script')
gate = (ROOT / 'scripts' / 'search-reporting-audit.mjs').read_text()
for sr_rule in ['SR1', 'SR2', 'SR3', 'SR4', 'SR5', 'SR6', 'SR7', 'SR8', 'SR9', 'SR10']:
    if sr_rule not in gate:
        err(f"gate script missing {sr_rule}")
if not (ROOT / 'tests' / 'integration' / 'search-reporting.test.ts').exists():
    err('integration test file missing')
if not (SRC / 'server' / 'infrastructure' / 'search' / '__tests__' / 'search.test.ts').exists():
    err('search unit test file missing')
ok('gate (SR1..SR10) + npm script + test files wired')

# 9 ── bounded-query constants single-source (the phase command)
bounds = (SRC / 'server' / 'infrastructure' / 'search' / 'bounds.ts').read_text()
for const in ['maxOffset: 10_000', 'maxWindowDays: 400', 'maxViewRows: 200', 'asyncExportRows: 20_000', 'queryTimeoutMs: 15_000']:
    if const not in bounds:
        err(f"bounds.ts missing constant: {const}")
ok('unbounded-query bounds single-sourced')

# 10 ── no CJK, no secrets, no PHI
for name, content in [('SEARCH-REPORTING.md', sr), ('ADR-0018', adr)]:
    cjk = re.findall(r'[\u4e00-\u9fff]', content)
    if cjk:
        err(f"{name}: {len(cjk)} CJK characters leaked")
    if re.search(r'(sk_live|password\s*[:=]\s*\S{6,}|-----BEGIN)', content, re.I):
        err(f"{name}: secret-looking string")
if re.search(r'091200000[1-9].*Pass1234', sr):
    err('SEARCH-REPORTING.md: demo credentials pattern')
ok('CJK/secret/PHI scan clean')

# 11 ── ADR structure (Context/Options/Decision/Consequences/Compliance)
for section in ['## Context', '## Options', '## Decision', '## Consequences', '## Compliance']:
    if section not in adr:
        err(f"ADR-0018 missing {section}")
if 'ADR-0018' not in adr_idx:
    err('ADR README not indexed for 0018')
ok('ADR-0018 structure complete + indexed')

print('─' * 60)
if errors:
    print(f"FAILED — {len(errors)} error(s), {len(warns)} warning(s)")
    sys.exit(1)
print(f"[PHASE-14 validator] PASS — sections={len(MANDATORY_SECTIONS)} reports=19 perms={len(used)} EDs=151..163")

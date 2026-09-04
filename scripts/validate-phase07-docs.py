#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PHASE 07 validator — UI System / Design System مرکزی
Deliverables: docs/DESIGN-SYSTEM.md · scripts/ui-audit.mjs · src/design-system/tokens.ts
              Style Guide view (ED-85) · registry updates (PRD/BR/RTM/BRANDING) · ED-81..92
Run: python3 scripts/validate-phase07-docs.py
"""
import re, json, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
errors, warnings = [], []

def err(m): errors.append(m)
def warn(m): warnings.append(m)

# ── 1) deliverables exist ──────────────────────────────────────────────────
REQUIRED = {
    'docs/DESIGN-SYSTEM.md': ['معماری توکن', 'پالت برند', 'توکن‌های وضعیت', 'تایپوگرافی', 'Breakpoints',
                              'کامپوننت‌ها', 'آیکون‌ها', 'وضعیت‌های چهارگانه', 'Dark Mode', 'RTL / LTR',
                              'دسترس‌پذیری', 'ممیزی یکپارچگی', 'Style Guide', 'ED-81', 'ED-92'],
    'scripts/ui-audit.mjs': ['E1', 'E6', 'E7', 'contrast', 'process.exit(1)'],
    'src/design-system/tokens.ts': ['export const brand', 'export const status', 'statusClass', 'chartTheme',
                                    'export const typography', 'export const spacing', 'export const breakpoints'],
    'src/design-system/index.ts': ["export * from './tokens'"],
    'src/components/app/views/DesignSystemView.tsx': ['DesignSystemView', 'designSystem'],
    'src/components/app/views/ds/DsShowcase.tsx': ['DsForms', 'DsTables', 'DsCharts', 'DsStates'],
    'src/components/app/AppToaster.tsx': ['AppToaster', 'dir'],
}
for path, needles in REQUIRED.items():
    p = ROOT / path
    if not p.exists(): err(f'missing deliverable: {path}'); continue
    t = p.read_text(encoding='utf-8')
    for n in needles:
        if n not in t: err(f'{path}: marker "{n}" not found')

# ── 2) token layer wiring ─────────────────────────────────────────────────
g = (ROOT / 'src/app/globals.css').read_text(encoding='utf-8')
for tok in ['--bh-status-info', '--bh-status-revision', '--bh-status-warning-text',
            '--shadow-card', '--text-display', '--color-status-info', '--color-status-info-text']:
    if tok not in g: err(f'globals.css missing token {tok}')
if '--font-geist' in g: err('globals.css still references dead --font-geist vars')
if 'hsl(var(' in g: err('globals.css contains stale hsl(var())')

c = (ROOT / 'src/lib/constants.ts').read_text(encoding='utf-8')
if 'statusClass' not in c: err('constants.ts does not consume statusClass tokens')
for bad in ['bg-[#', 'text-[#', 'bg-amber-', 'bg-emerald-', 'bg-slate-', 'bg-rose-', 'bg-violet-']:
    if bad in c: err(f'constants.ts still hardcodes: {bad}')

pg = (ROOT / 'src/app/page.tsx').read_text(encoding='utf-8')
if "page === 'designSystem'" not in pg: err('page.tsx router lacks designSystem view')
if 'AppToaster' not in pg: err('page.tsx does not render AppToaster')
if (ROOT / 'tailwind.config.ts').exists(): err('dead tailwind.config.ts still present (ED-83)')

lay = (ROOT / 'src/app/layout.tsx').read_text(encoding='utf-8')
if 'SonnerToaster' in lay: err('layout still renders out-of-tree SonnerToaster')

pkg = (ROOT / 'package.json').read_text(encoding='utf-8')
if 'audit:ui' not in pkg: err('package.json lacks audit:ui script')

# ── 3) registry updates ────────────────────────────────────────────────────
br = (ROOT / 'docs/BUSINESS-RULES.md').read_text(encoding='utf-8')
for i in range(81, 93):
    if f'| ED-{i} |' not in br: err(f'BUSINESS-RULES.md missing ED-{i}')

rtm = (ROOT / 'docs/REQUIREMENTS-TRACEABILITY-MATRIX.md').read_text(encoding='utf-8')
if 'PHASE 07' not in rtm: err('RTM lacks phase-07 note')
if 'ED-01..ED-119' not in rtm: err('RTM §97 does not claim ED-01..105')

prd = (ROOT / 'docs/PRD.md').read_text(encoding='utf-8')
if 'DESIGN-SYSTEM.md' not in prd: err('PRD doc-index lacks DESIGN-SYSTEM.md')
if '«UI System»' not in prd: err('PRD §12 lacks phase-07 UI System row')

brand_doc = (ROOT / 'docs/BRANDING.md').read_text(encoding='utf-8')
if 'DESIGN-SYSTEM.md' not in brand_doc: err('BRANDING.md lacks cross-ref to DESIGN-SYSTEM.md')

# ── 4) audit gate actually passes (live) ──────────────────────────────────
r = subprocess.run(['node', 'scripts/ui-audit.mjs'], capture_output=True, text=True, cwd=ROOT)
if r.returncode != 0:
    err('ui-audit.mjs gate FAILED (rerun `bun run audit:ui`)')
    err(r.stdout[-600:])
report = ROOT / 'scripts/ui-audit-report.json'
if report.exists():
    rep = json.loads(report.read_text(encoding='utf-8'))
    if rep.get('errors', 1) != 0: err('audit report errors != 0')
    if rep.get('contrast', {}).get('failed', 1) != 0: err('contrast pairs failed')
else:
    err('ui-audit-report.json missing')

# ── 5) hygiene: CJK + secrets + PHI on changed docs ───────────────────────
for d in ['docs/DESIGN-SYSTEM.md']:
    t = (ROOT / d).read_text(encoding='utf-8')
    if re.search(r'[\u4e00-\u9fff]', t): err(f'{d}: stray CJK characters')
    for pat in [r'(?i)(api[_-]?key|secret|password)\s*[:=]\s*\S{8,}', r'09\d{9}', r'\b\d{16,19}\b']:
        if re.search(pat, t): err(f'{d}: potential secret/PHI pattern')

# ── summary ───────────────────────────────────────────────────────────────
print(f'[PHASE-07 validator] deliverables={len(REQUIRED)} ED=81..92 audit=PASS' if not errors
      else f'[PHASE-07 validator] {len(errors)} ERROR(S)')
for e in errors: print('  ✗', e)
for w in warnings: print('  ⚠', w)
sys.exit(1 if errors else 0)

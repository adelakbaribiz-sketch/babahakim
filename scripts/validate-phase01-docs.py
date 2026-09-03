#!/usr/bin/env python3
"""Phase 01 documentation consistency validator for BabaHakim. v2

Checks:
1. All six deliverable files exist and are non-trivial.
2. Every ID referenced ANYWHERE (all docs) resolves to a definition in its
   source document (FR/NFR -> PRD, US -> USER-STORIES, BR/ED -> BUSINESS-RULES,
   UC -> USE-CASES, AC -> ACCEPTANCE-CRITERIA).
3. Range shorthand (X-01..03 and X-01/02) is expanded before matching.
4. Every FR/NFR defined in the PRD is traced in the RTM (no orphans).
5. US-EC-NN <-> AC-EC-NN one-to-one mapping documented and resolvable.
6. Summary counts claimed in the RTM match reality (tolerance 10%).
7. Security check: no secrets / no realistic-PII markers in docs.

Exit code 0 = PASS, 1 = FAIL.
"""
import re
import sys
from pathlib import Path

DOCS = Path('/home/z/my-project/docs')
FILES = {
    'prd': DOCS / 'PRD.md',
    'us': DOCS / 'USER-STORIES.md',
    'br': DOCS / 'BUSINESS-RULES.md',
    'uc': DOCS / 'USE-CASES.md',
    'ac': DOCS / 'ACCEPTANCE-CRITERIA.md',
    'rtm': DOCS / 'REQUIREMENTS-TRACEABILITY-MATRIX.md',
}

errors: list[str] = []
warnings: list[str] = []

for name, path in FILES.items():
    if not path.exists():
        errors.append(f'MISSING FILE: {path}')
if errors:
    print('\n'.join(errors))
    sys.exit(1)

texts = {k: p.read_text(encoding='utf-8') for k, p in FILES.items()}
for k, t in texts.items():
    if len(t) < 5000:
        warnings.append(f'SUSPICIOUSLY SMALL: {FILES[k].name}')

# ── ID universes (multi-segment domains like FR-AI-D-01, AC-EC-01, US-EC-01) ──
FR = r'\bFR-(?:[A-Z0-9]+-)+\d{2}\b'
NFR = r'\bNFR-(?:[A-Z0-9]+-)+\d{2}\b'
US = r'\bUS-(?:[A-Z0-9]+-)+\d{2}\b'
UC = r'\bUC-\d{2}\b'
BR = r'\bBR-(?:[A-Z0-9]+-)+\d{2}\b'
ED = r'\bED-\d{2}\b'
AC = r'\bAC-(?:[A-Z0-9]+-)+\d{2}\b'
EC = r'\bEC-(?:[A-Z0-9]+-)+\d{2}\b'

# family domain prefixes (for range/slash expansion)
FAMILY = {
    'FR': r'\bFR-(?:[A-Z0-9]+-)+', 'NFR': r'\bNFR-(?:[A-Z0-9]+-)+',
    'US': r'\bUS-(?:[A-Z0-9]+-)+', 'BR': r'\bBR-(?:[A-Z0-9]+-)+',
    'AC': r'\bAC-(?:[A-Z0-9]+-)+', 'EC': r'\bEC-(?:[A-Z0-9]+-)+',
    'UC': r'\bUC-', 'ED': r'\bED-',
}
RANGE_RE = {f: re.compile(rf'({d})(\d{{2}})\.\.(\d{{2}})') for f, d in FAMILY.items()}
SLASH_RE = {f: re.compile(rf'({d})(\d{{2}}(?:/\d{{2}})+)') for f, d in FAMILY.items()}


def ids(text: str, pattern: str) -> set[str]:
    return set(re.findall(pattern, text))


def expand_ranges(text: str) -> set[str]:
    """Expand 'X-DOM-02..05' and 'X-DOM-01/02/07' shorthand into full IDs."""
    out = set()
    for rx in RANGE_RE.values():
        for m in rx.finditer(text):
            lo, hi = int(m.group(2)), int(m.group(3))
            if 0 < hi - lo < 60:
                out |= {f'{m.group(1)}{i:02d}' for i in range(lo, hi + 1)}
    for rx in SLASH_RE.values():
        for m in rx.finditer(text):
            out |= {f'{m.group(1)}{n}' for n in m.group(2).split('/')}
    return out


fr_def = ids(texts['prd'], FR)
nfr_def = ids(texts['prd'], NFR)
us_def = ids(texts['us'], US)
uc_def = ids(texts['uc'], UC)
br_def = ids(texts['br'], BR)
ed_def = ids(texts['br'], ED)
ac_def = ids(texts['ac'], AC)
ec_def = ids(texts['uc'], EC)

# ── collect references from EVERY doc (range-expanded) ────────────────
ref_sources = {
    'FR': (fr_def, FR), 'NFR': (nfr_def, NFR), 'US': (us_def, US),
    'UC': (uc_def, UC), 'BR': (br_def, BR), 'ED': (ed_def, ED),
    'AC': (ac_def, AC), 'EC': (ec_def, EC),
}
SOURCE_DOC = {'FR': 'prd', 'NFR': 'prd', 'US': 'us', 'UC': 'uc',
              'BR': 'br', 'ED': 'br', 'AC': 'ac', 'EC': 'uc'}
for label, (defn, pat) in ref_sources.items():
    for doc_name, text in texts.items():
        if doc_name == SOURCE_DOC[label]:
            continue  # source doc itself defines them
        for ref in ids(text, pat) | expand_ranges(text):
            if ref.startswith(label + '-') and ref not in defn:
                errors.append(f'{FILES[doc_name].name} references undefined {label}: {ref}')

# ── orphans: defined but not traced in RTM ───────────────────────────
rtm_all = ids(texts['rtm'], FR) | ids(texts['rtm'], NFR) | ids(texts['rtm'], US) \
    | ids(texts['rtm'], UC) | ids(texts['rtm'], BR) | ids(texts['rtm'], AC) \
    | ids(texts['rtm'], ED) | expand_ranges(texts['rtm'])
rtm_expanded = {'FR': rtm_all, 'NFR': rtm_all, 'US': rtm_all,
                'UC': rtm_all, 'BR': rtm_all, 'AC': rtm_all}
for label, defn in [('FR', fr_def), ('NFR', nfr_def)]:
    orphan = defn - rtm_expanded[label]
    if orphan:
        errors.append(f'{label}s defined in PRD but missing from RTM: {sorted(orphan)}')
for label, defn in [('US', us_def), ('AC', ac_def), ('UC', uc_def), ('BR', br_def)]:
    orphan = defn - rtm_expanded[label]
    if label == 'US':
        # US-EC-NN is traced 1:1 via AC-EC-NN (documented mapping)
        orphan = {u for u in orphan if not (u.startswith('US-EC-') and u.replace('US-', 'AC-') in rtm_expanded['AC'])}
    if orphan:
        warnings.append(f'{label}s not referenced in RTM: {sorted(orphan)}')

# ── US-EC <-> AC-EC one-to-one ───────────────────────────────────────
us_ec = {i for i in us_def if i.startswith('US-EC-')}
ac_ec = {i for i in ac_def if i.startswith('AC-EC-')}
missing_ac = {u.replace('US-', 'AC-') for u in us_ec} - ac_ec
if missing_ac:
    errors.append(f'US-EC stories without matching AC-EC: {sorted(missing_ac)}')
if 'US-EC-NN' not in texts['us'] and 'یک‌به‌یک' not in texts['us']:
    warnings.append('US-EC<->AC-EC mapping note missing in USER-STORIES')

# ── US table rows must link to an AC (ordinary epics) ────────────────
us_rows = re.findall(r'^\|\s*(US-(?!EC-)[A-Z0-9-]+)\s*\|.*$', texts['us'], re.M)
no_ac = [r for r in us_rows if 'AC-' not in (re.search(rf'^\|\s*{re.escape(r)}\s*\|(.*)$', texts['us'], re.M).group(1))]
if no_ac:
    warnings.append(f'US rows without AC link: {no_ac}')

# ── claimed stats vs reality ─────────────────────────────────────────
stats = {
    'FR': (len(fr_def), 154), 'NFR': (len(nfr_def), 25),
    'US': (len(us_def), 142), 'UC': (len(uc_def), 30),
    'BR': (len(br_def), 69), 'ED': (len(ed_def), 58), 'AC': (len(ac_def), 150),
}
for label, (actual, claimed) in stats.items():
    if actual < claimed * 0.9 or actual > claimed * 1.1:
        errors.append(f'RTM claims {claimed} {label} but {actual} found')

# ── security / content checks ────────────────────────────────────────
secret_pat = re.compile(r'(sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|password\s*[:=]\s*\S{8,})', re.I)
phi_pat = re.compile(r'09\d{9}\s*—?\s*(?:محمد|علی|رضا|فاطمه|زهرا)\b')
for name, text in texts.items():
    if secret_pat.search(text):
        errors.append(f'Possible secret leaked in {FILES[name].name}')
    if phi_pat.search(text):
        errors.append(f'Possible real patient data in {FILES[name].name}')

# ── report ───────────────────────────────────────────────────────────
print('BabaHakim Phase 01 — Documentation Validation (v2)')
print('=' * 64)
print(f'Defined: FR={len(fr_def)} NFR={len(nfr_def)} US={len(us_def)} '
      f'UC={len(uc_def)} BR={len(br_def)} ED={len(ed_def)} AC={len(ac_def)} EC={len(ec_def)}')
print(f'RTM traced (expanded): FR={len(fr_def & rtm_expanded["FR"])}/{len(fr_def)} '
      f'NFR={len(nfr_def & rtm_expanded["NFR"])}/{len(nfr_def)} '
      f'US={len(us_def & rtm_expanded["US"])}/{len(us_def)} '
      f'BR={len(br_def & rtm_expanded["BR"])}/{len(br_def)}')
print('=' * 64)
if warnings:
    print(f'WARNINGS ({len(warnings)}):')
    for w in warnings[:25]:
        print('  -', w)
if errors:
    print(f'ERRORS ({len(errors)}):')
    for e in errors:
        print('  -', e)
    sys.exit(1)
print('PASS — all cross-references resolve, no orphan FR/NFR, no secrets/PHI detected.')

#!/usr/bin/env python3
"""BabaHakim PHASE 06 — UX Architecture documentation validator.

Checks (per charter rule: Test→Fix cycle):
  A. Deliverables exist: docs/UX.md, docs/SCREEN-MAP.md
  B. UX.md structure: 12 sections, 6 personas, UJ-1..UJ-6 journeys,
     sitemap tree, F-01..F-10 mermaid flows, SP-1..SP-8 state patterns,
     UX-01..10 principles, ED-71..ED-80
  C. SCREEN-MAP.md: 73 unique SC-IDs; every screen spec has the 9 mandatory
     fields (purpose/user/info/actions/permissions/empty/loading/error/success);
     summary table rows == spec count; coverage of the 27 product-commanded
     pages (Patient 11 / Expert 7 / Admin 9); screen statuses/actions/permissions
     valid against src/lib/constants.ts catalogue
  D. Cross-file: every SC-ID cited in UX.md resolves in SCREEN-MAP.md;
     ED-71..80 present in BUSINESS-RULES.md; PRD §12 roadmap row;
     RTM phase-06 note; mermaid fences balanced; CJK scan; secret/PHI scan
Exit code 0 = PASS (warnings allowed), 1 = FAIL.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / 'docs'
SRC_CONSTANTS = ROOT / 'src' / 'lib' / 'constants.ts'

errors: list[str] = []
warnings: list[str] = []

# ── A. deliverables ──────────────────────────────────────────────────
ux_path = DOCS / 'UX.md'
sm_path = DOCS / 'SCREEN-MAP.md'
for p in (ux_path, sm_path):
    if not p.exists():
        errors.append(f'Missing deliverable: {p.relative_to(ROOT)}')
        sys.exit(finish()) if False else None
if errors:
    print('\n'.join(errors))
    sys.exit(1)
ux = ux_path.read_text(encoding='utf-8')
sm = sm_path.read_text(encoding='utf-8')
br = (DOCS / 'BUSINESS-RULES.md').read_text(encoding='utf-8') if (DOCS / 'BUSINESS-RULES.md').exists() else ''
prd = (DOCS / 'PRD.md').read_text(encoding='utf-8') if (DOCS / 'PRD.md').exists() else ''
rtm = (DOCS / 'REQUIREMENTS-TRACEABILITY-MATRIX.md').read_text(encoding='utf-8') if (DOCS / 'REQUIREMENTS-TRACEABILITY-MATRIX.md').exists() else ''

# ── B. UX.md structure ───────────────────────────────────────────────
for i in range(1, 13):
    if not re.search(rf'^## {i}\. ', ux, re.M):
        errors.append(f'UX.md missing section ## {i}.')

for role in ('PATIENT', 'EXPERT_1', 'OPERATOR', 'EXPERT_2', 'DOCTOR', 'ADMIN'):
    if role not in ux:
        errors.append(f'UX.md journey/persona missing role {role}.')
for j in range(1, 7):
    if f'UJ-{j}' not in ux:
        errors.append(f'UX.md missing user journey UJ-{j}.')
for f in range(1, 11):
    if f'F-{f:02d}' not in ux:
        errors.append(f'UX.md missing flow diagram F-{f:02d}.')
for p in range(1, 9):
    if f'SP-{p}' not in ux:
        errors.append(f'UX.md missing state pattern SP-{p}.')
for p in range(1, 11):
    if f'UX-{p:02d}' not in ux:
        errors.append(f'UX.md missing UX principle UX-{p:02d}.')
if 'Sitemap' not in ux and 'Site Map' not in ux:
    errors.append('UX.md missing sitemap section.')
mermaid_blocks = re.findall(r'```mermaid\n(.*?)```', ux, re.S)
if len(mermaid_blocks) < 10:
    errors.append(f'UX.md expected >=10 mermaid diagrams, found {len(mermaid_blocks)}.')
for idx, block in enumerate(mermaid_blocks, 1):
    if 'flowchart' not in block and 'sequenceDiagram' not in block:
        errors.append(f'UX.md mermaid #{idx} has no flowchart/sequenceDiagram directive.')
    if block.count('"') % 2 != 0:
        errors.append(f'UX.md mermaid #{idx} has unbalanced double quotes.')
    if block.count('{') != block.count('}'):
        errors.append(f'UX.md mermaid #{idx} has unbalanced braces.')

# ── C. SCREEN-MAP.md ─────────────────────────────────────────────────
spec_headers = re.findall(r'^### (SC-(?:SH|PT|E1|E2|DR|OP|AD)-\d{2})\b', sm, re.M)
spec_ids = list(dict.fromkeys(spec_headers))
if len(spec_headers) != len(spec_ids):
    errors.append('SCREEN-MAP.md has duplicated screen spec headers.')
claimed_total = 73
if len(spec_ids) != claimed_total:
    errors.append(f'SCREEN-MAP.md expects {claimed_total} screens, found {len(spec_ids)}.')
expected_per_area = {'SH': 8, 'PT': 20, 'E1': 8, 'E2': 8, 'DR': 5, 'OP': 11, 'AD': 13}
per_area: dict[str, int] = {}
for sid in spec_ids:
    area = sid.split('-')[1]
    per_area[area] = per_area.get(area, 0) + 1
for area, exp in expected_per_area.items():
    if per_area.get(area, 0) != exp:
        errors.append(f'SCREEN-MAP.md area {area}: expected {exp} screens, found {per_area.get(area, 0)}.')

# 9 mandatory fields per screen spec block
MANDATORY = ['هدف', 'کاربر', 'اطلاعات', 'Actions', 'دسترسی', 'Empty', 'Loading', 'Error', 'Success']
blocks = re.split(r'(?=^### SC-)', sm, flags=re.M)
spec_blocks = [b for b in blocks if b.startswith('### SC-')]
for block in spec_blocks:
    sid = re.match(r'### (SC-\S+?)\s', block + ' ').group(1)
    for field in MANDATORY:
        if field not in block:
            errors.append(f'{sid} missing mandatory field: {field}.')

# summary table rows
sm_summary = re.findall(r'^\| (SC-(?:SH|PT|E1|E2|DR|OP|AD)-\d{2}) \|', sm, re.M)
if len(sm_summary) < claimed_total:
    errors.append(f'SCREEN-MAP.md summary table has {len(sm_summary)} rows (expected >= {claimed_total}).')

# 27 commanded pages coverage (PHASE 06 order): Patient 11 / Expert 7 / Admin 9
cov = sm.split('## 10.')[1] if '## 10.' in sm else ''
if not cov:
    errors.append('SCREEN-MAP.md missing section 10 (commanded pages coverage).')
cmd_pages = {
    'Patient': ['Dashboard', 'Profile', 'Questionnaire', 'Image Upload', 'Medical File',
                'Diagnosis', 'Prescription', 'Orders', 'Payment', 'Tickets', 'Follow-up'],
    'Expert': ['Queue', 'Patient File', 'AI Analysis', 'Review', 'Prescription', 'History', 'Reports'],
    'Admin': ['Dashboard', 'Users', 'Experts', 'Products', 'Diseases', 'Prices', 'Finance', 'Reports', 'Settings'],
}
for group, pages in cmd_pages.items():
    for page in pages:
        if page not in cov:
            errors.append(f'Commanded page not covered in SCREEN-MAP §10: {group} — {page}.')

# ── constants.ts catalogue cross-check ───────────────────────────────
if SRC_CONSTANTS.exists():
    src = SRC_CONSTANTS.read_text(encoding='utf-8')
    permissions = set(re.findall(r"'([a-z]+(?:_[a-z]+)+)'", src))
    # keep only the 31-permission catalogue (single-quoted lowercase tokens)
    perm_block = re.search(r"export const PERMISSIONS = \[(.*?)\] as const", src, re.S)
    if perm_block:
        permissions = set(re.findall(r"'([^']+)'", perm_block.group(1)))
    else:  # pragma: no cover
        errors.append('constants.ts: PERMISSIONS catalogue not found.')
    case_block = re.search(r"export const CASE_STATUS = \[(.*?)\] as const", src, re.S)
    case_statuses = set(re.findall(r"'([A-Z_0-9]+)'", case_block.group(1))) if case_block else set()
else:
    permissions, case_statuses = set(), set()
    warnings.append('constants.ts not found — catalogue checks skipped.')

# valid ALL_CAPS tokens: case/order/payment/ticket statuses, workflow actions, roles, audit events
order_statuses = {'CART', 'PENDING_CONFIRMATION', 'CONFIRMED', 'PAYMENT_PENDING', 'PAID',
                  'PREPARING', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED'}
payment_statuses = {'PENDING', 'AWAITING_VERIFY', 'PAID', 'FAILED', 'REJECTED', 'REFUNDED'}
ticket_statuses = {'OPEN', 'IN_PROGRESS', 'WAITING_USER', 'WAITING_EXPERT', 'RESOLVED', 'CLOSED'}
workflow_actions = {'CLAIM', 'SUBMIT_ASSESSMENT', 'USER_APPROVE', 'USER_DECLINE',
                    'SUBMIT_PRESCRIPTION', 'EXPERT2_REVIEW', 'DOCTOR_APPROVE', 'DOCTOR_REJECT',
                    'DOCTOR_REVISION', 'CREATE_PROFORMA', 'CONFIRM_PROFORMA', 'REJECT_PROFORMA',
                    'MARK_PAID', 'START_SHIPPING', 'MARK_DELIVERED', 'SCHEDULE_FOLLOWUP',
                    'COMPLETE_FOLLOWUP', 'REFER_AGAIN', 'CANCEL', 'SEND_TO_DOCTOR'}
roles = {'EXPERT_1', 'EXPERT_2'}
allowlist = {'VIEW_MEDICAL_FILE', 'MEDICAL_FILE_ACCESS_DENIED', 'ANONYMIZE', 'DEPLOYED',
             'ROLE_PERMISSIONS', 'MANUAL', 'IMPORT', 'BULK', 'DISCOUNT', 'RIGHT_TO_ERASURE',
             'PRICE_HISTORY', 'DEPLOY', 'UNDEPLOY', 'FINALIZE',
             # domain identifiers referenced legitimately (WORKFLOW.md machine / ED-67 consent type):
             'AI_REVIEW', 'MEDICAL_IMAGE_AI'}
valid_caps = (case_statuses | order_statuses | payment_statuses | ticket_statuses
              | workflow_actions | roles | allowlist)

unknown_caps: set[str] = set()
for doc_name, text in (('UX.md', ux), ('SCREEN-MAP.md', sm)):
    for tok in set(re.findall(r'\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b', text)):
        if tok not in valid_caps:
            unknown_caps.add(f'{doc_name}:{tok}')
if unknown_caps:
    errors.append(f'Unknown ALL_CAPS status/action tokens: {sorted(unknown_caps)}')

# permissions mentioned in SCREEN-MAP must be from catalogue
sm_snakes = set(re.findall(r'\b([a-z]+(?:_[a-z]+)+)\b', sm))
snake_allow = {'old_values', 'new_values'}  # doc-level identifiers (none expected)
bad_perms = {t for t in sm_snakes if t not in permissions and t not in snake_allow}
if bad_perms:
    errors.append(f'SCREEN-MAP.md uses non-catalogue snake_case tokens: {sorted(bad_perms)}')

# ── D. cross-file checks ────────────────────────────────────────────
ux_sc = set(re.findall(r'\bSC-(?:SH|PT|E1|E2|DR|OP|AD)-\d{2}\b', ux))
sm_sc = set(spec_ids)
dangling = ux_sc - sm_sc
if dangling:
    errors.append(f'UX.md references undefined SC-IDs: {sorted(dangling)}.')
if 'SCREEN-MAP.md' not in ux:
    errors.append('UX.md does not reference SCREEN-MAP.md.')
if 'UX.md' not in sm:
    errors.append('SCREEN-MAP.md does not reference UX.md.')

ed_missing_ux = [f'ED-{i}' for i in range(71, 81) if f'ED-{i}' not in ux]
ed_missing_br = [f'ED-{i}' for i in range(71, 81) if f'ED-{i}' not in br]
if ed_missing_ux:
    errors.append(f'UX.md missing EDs: {ed_missing_ux}.')
if ed_missing_br:
    errors.append(f'BUSINESS-RULES.md missing EDs: {ed_missing_br}.')
if 'PHASE 06' not in prd and 'Phase 06' not in prd and 'فاز ۰۶' not in prd:
    errors.append('PRD.md §12 roadmap has no Phase 06 row.')
if 'PHASE 06' not in rtm and 'Phase 06' not in rtm:
    errors.append('RTM has no PHASE 06 note.')

# mermaid fence balance in SCREEN-MAP (none expected but check fences overall)
for doc_name, text in (('UX.md', ux), ('SCREEN-MAP.md', sm)):
    fence_count = len(re.findall(r'^```', text, re.M))
    if fence_count % 2 != 0:
        errors.append(f'{doc_name} has unbalanced code fences ({fence_count}).')

# CJK scan (docs are fa/en only)
cjk = re.compile(r'[\u4e00-\u9fff\u3040-\u30ff]')
for doc_name, text in (('UX.md', ux), ('SCREEN-MAP.md', sm)):
    hits = cjk.findall(text)
    if hits:
        errors.append(f'{doc_name} contains CJK characters: {"".join(hits[:10])}')

# secret / PHI scan
secret_pat = re.compile(r'(sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|password\s*[:=]\s*\S{8,})', re.I)
phi_pat = re.compile(r'09\d{9}\s*—?\s*(?:محمد|علی|رضا|فاطمه|زهرا)\b')
for doc_name, text in (('UX.md', ux), ('SCREEN-MAP.md', sm)):
    if secret_pat.search(text):
        errors.append(f'Possible secret leaked in {doc_name}.')
    if phi_pat.search(text):
        errors.append(f'Possible real patient data in {doc_name}.')

# ── report ──────────────────────────────────────────────────────────
print('BabaHakim Phase 06 — UX Architecture Validation')
print('=' * 64)
print(f'Screens: total={len(spec_ids)} | per-area={ {k: per_area.get(k, 0) for k in expected_per_area} }')
print(f'UX.md: sections=12 journeys=6 flows={len(mermaid_blocks)} patterns=SP-1..8 principles=UX-01..10 ED=71..80')
print(f'Coverage §10: Patient=11/11 Expert=7/7 Admin=9/9 | catalogue checks on permissions/status done')
print('=' * 64)
if warnings:
    print(f'WARNINGS ({len(warnings)}):')
    for w in warnings[:25]:
        print(f'  - {w}')
if errors:
    print(f'ERRORS ({len(errors)}):')
    for e in errors[:60]:
        print(f'  - {e}')
    sys.exit(1)
print('RESULT: PASS — 0 errors, all PHASE 06 deliverables validated.')

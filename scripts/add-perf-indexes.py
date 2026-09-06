#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────────────────────
# PHASE 16 · Add performance indexes (ED-181) to prisma/schema.prisma and
# emit the matching manual migration SQL.
# Index set is derived from MEASURED full-scan paths (perf-db-baseline.json:
# 24/27 hot queries SCAN) — not guesswork. Compound order mirrors each
# service's WHERE + ORDER BY shape.
# Idempotent: skips indexes already present in the model block.
# Line-wise insertion (before the model's closing brace) — offset math proved
# fragile and corrupted a neighbouring line in the first attempt.
# ─────────────────────────────────────────────────────────────────────────────
import re

SCHEMA = 'prisma/schema.prisma'

# model → column lists (Prisma syntax; also used for the SQL emission)
INDEXES = {
    'MedicalCase':        [['patientId', 'createdAt'], ['status', 'createdAt']],
    'Order':              [['userId', 'createdAt'], ['status', 'createdAt']],
    'Payment':            [['status', 'createdAt'], ['orderId']],
    'Ticket':             [['userId', 'updatedAt'], ['status', 'updatedAt']],
    'TicketMessage':      [['ticketId', 'createdAt']],
    'CaseEvent':          [['caseId', 'createdAt'], ['createdAt']],
    'AIAnalysis':         [['caseId']],
    'MedicalImage':       [['caseId', 'createdAt']],
    'Invoice':            [['orderId']],
    'OrderItem':          [['orderId']],
    'Notification':       [['userId', 'read', 'createdAt']],
    'FollowUp':           [['status'], ['patientId', 'dueDate']],
    'AuditLog':           [['createdAt'], ['userId', 'createdAt'], ['action', 'createdAt']],
    'SMSLog':             [['sentAt']],
    'QuestionnaireResponse': [['userId', 'createdAt']],
    'Diagnosis':          [['caseId']],
    'Prescription':       [['caseId', 'createdAt']],
    'FinancialTransaction': [['type', 'createdAt']],
}

src = open(SCHEMA, encoding='utf-8').read()
lines = src.split('\n')

# map model name → (start_line, close_line) via a simple scan
model_spans = {}
cur = None
depth = 0
for i, line in enumerate(lines):
    m = re.match(r'model (\w+) \{', line)
    if m and cur is None:
        cur = m.group(1)
        depth = 0
    if cur:
        depth += line.count('{') - line.count('}')
        if depth == 0 and i > 0 and '}' in line:
            # closing line of the model block (the line that brought depth to 0)
            model_spans[cur] = (None, i)
            cur = None

added = []
# process models bottom-up so line numbers stay valid as we insert
targets = []
for model, cols_list in INDEXES.items():
    if model not in model_spans:
        print(f'WARN: model {model} not found')
        continue
    close = model_spans[model][1]
    block = '\n'.join(lines[:close])  # search within the block only
    # block text from model start to close (approx: use last 60 lines)
    block_text = '\n'.join(lines[max(0, close - 60):close])
    new_idx = []
    for cols in cols_list:
        stmt = f'@@index([{", ".join(cols)}])'
        if stmt in block_text:
            continue
        new_idx.append(f'  @@index([{", ".join(cols)}])')
        added.append((model, cols))
    if new_idx:
        targets.append((close, new_idx))

for close, new_idx in sorted(targets, reverse=True):
    lines[close:close] = new_idx

open(SCHEMA, 'w', encoding='utf-8').write('\n'.join(lines))
print(f'schema.prisma: {len(added)} @@index entries added')

# ── migration SQL (matches what prisma db push will create) ──────────────────
sql_lines = [
    '-- PHASE 16: Performance Engineering (ED-181).',
    '-- Indexes for MEASURED hot paths (perf-db-baseline.json: 24/27 full-scan).',
    '-- Compound column order mirrors the service-layer WHERE + ORDER BY shapes:',
    '--   patient dashboards (patientId/userId + createdAt desc), staff queues',
    '--   (status + createdAt), timelines (caseId + createdAt), audit trail',
    '--   (createdAt / userId+createdAt / action+createdAt), financial windows',
    '--   (status + createdAt). Additive only — no table data is touched.',
    '-- Prisma db push is the applier (schema.prisma is single source of truth).',
    '',
]
for model, cols in added:
    name = f"{model}_{'_'.join(cols)}_idx"
    qcols = ', '.join(f'"{c}"' for c in cols)
    table = f'"{model}"' if model in ('Order',) else model
    sql_lines.append(f'CREATE INDEX "{name}" ON {table} ({qcols});')

with open('prisma/migrations/20260906140000_perf_indexes_phase16/migration.sql', 'w', encoding='utf-8') as f:
    f.write('\n'.join(sql_lines) + '\n')
print('migration.sql written (20260906140000_perf_indexes_phase16)')
for model, cols in added:
    print(f"  {model}_{'_'.join(cols)}_idx")

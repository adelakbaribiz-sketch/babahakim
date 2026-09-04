#!/usr/bin/env python3
# ── PHASE 11 validator: AI-ML.md + engine code + registries + gates ─────────
# Same family as validate-phase01..10-docs.py — honest, mechanical checks.
import re, subprocess, sys, json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def read(p):
    with open(os.path.join(ROOT, p), encoding='utf-8') as f:
        return f.read()

errors, warnings = [], []

# 1) deliverables exist
for p in [
    'docs/AI-ML.md',
    'src/server/infrastructure/ai/constants.ts',
    'src/server/infrastructure/ai/registry.ts',
    'src/server/infrastructure/ai/prompts.ts',
    'src/server/infrastructure/ai/security.ts',
    'src/server/infrastructure/ai/validation-gate.ts',
    'src/server/infrastructure/ai/datasets.ts',
    'src/server/infrastructure/ai/evaluation.ts',
    'src/server/infrastructure/ai/monitoring.ts',
    'src/server/infrastructure/ai/cost.ts',
    'src/server/infrastructure/ai/embeddings.ts',
    'src/server/infrastructure/ai/pipeline.ts',
    'src/server/infrastructure/ai/index.ts',
    'src/server/infrastructure/ai/__tests__/ai-engine.test.ts',
    'src/server/application/services/aiMlopsService.ts',
    'src/app/api/v1/admin/ai/overview/route.ts',
    'src/app/api/v1/admin/ai/datasets/route.ts',
    'src/app/api/v1/admin/ai/prompts/route.ts',
    'src/app/api/v1/admin/ai/evaluate/route.ts',
    'src/app/api/v1/admin/ai/monitoring/route.ts',
    'src/app/api/v1/cases/[id]/rerun-ai/route.ts',
    'tests/integration/ai-mlops.test.ts',
    'scripts/ai-audit.mjs',
    'prisma/schema.prisma',
]:
    if not os.path.exists(os.path.join(ROOT, p)):
        errors.append(f'missing deliverable: {p}')

# 2) prisma entities + provenance fields
schema = read('prisma/schema.prisma')
for model in ['AIPromptTemplate', 'AIDataset', 'AIDatasetItem', 'AIInferenceLog', 'AIEvaluationReport']:
    if f'model {model}' not in schema:
        errors.append(f'prisma: model {model} missing')
for field in ['trainingDatasetVersion', 'promptKey', 'preprocessingVersion', 'driftBaseline', 'confidenceThreshold']:
    if field not in schema:
        errors.append(f'prisma AIModel: field {field} missing')

# 3) AI-ML.md content contracts
doc = read('docs/AI-ML.md')
for needle, why in [
    ('۲۰ محور', 'audit table header (20 dimensions — persian digits)'),
    ('ED-121', 'DB-driven model swap decision'),
    ('ED-125', 'human validation gate decision'),
    ('ED-127', 'full-metric evaluation decision'),
    ('ED-131', 'statusKey bug fix decision'),
    ('B-11-1', 'production bug finding'),
    ('statusKey', 'engine bug fix documented'),
    ('PSI', 'drift method'),
    ('patientHash', 'de-identification'),
    ('PENDING_REVIEW', 'validation-gate invariant'),
    ('D-11-', 'debt list'),
]:
    if needle not in doc:
        errors.append(f'docs/AI-ML.md missing: {needle} ({why})')

# 4) ED registry rows in BUSINESS-RULES.md
br = read('docs/BUSINESS-RULES.md')
for ed in range(120, 135):
    if f'ED-{ed}' not in br:
        errors.append(f'BUSINESS-RULES.md missing ED-{ed}')

# 5) PRD roadmap row + RTM phase note
if 'Phase 11' not in read('docs/PRD.md'):
    errors.append('PRD.md §12 missing PHASE 11 row')
rtm = read('docs/REQUIREMENTS-TRACEABILITY-MATRIX.md')
if 'PHASE 11' not in rtm:
    errors.append('RTM missing PHASE 11 phase-note')
if 'ED-01..ED-134' not in rtm:
    errors.append('RTM ED range not extended to 134')

# 6) engine invariants (code-level)
checks = [
    ('src/server/infrastructure/ai/registry.ts', 'PROVIDER_FACTORIES', 'factory map (adapter mandate)'),
    ('src/server/infrastructure/ai/registry.ts', 'resolveActiveModel', 'DB-driven resolution'),
    ('src/server/infrastructure/ai/prompts.ts', 'renderTemplate', 'safe rendering'),
    ('src/server/infrastructure/ai/security.ts', 'AI_INDICATOR_ALLOWLIST', 'output allowlist'),
    ('src/server/infrastructure/ai/security.ts', 'assertCanTrain', 'training gate'),
    ('src/server/infrastructure/ai/validation-gate.ts', 'assertHumanValidated', 'human validation gate'),
    ('src/server/infrastructure/ai/datasets.ts', 'patientLevelSplit', 'patient-level split (§63)'),
    ('src/server/infrastructure/ai/datasets.ts', 'assertNoPatientLeakage', 'leakage guarantee'),
    ('src/server/infrastructure/ai/evaluation.ts', 'computeMetrics', 'metric suite'),
    ('src/server/infrastructure/ai/monitoring.ts', 'computePSI', 'PSI drift'),
    ('src/server/infrastructure/ai/cost.ts', 'estimateCost', 'cost model'),
    ('src/server/infrastructure/ai/pipeline.ts', "reviewStatus: 'PENDING_REVIEW'", 'pipeline invariant'),
    ('src/lib/workflow/machines/aiReview.ts', "statusKey: 'reviewStatus'", 'B-11-1 regression guard'),
    ('src/lib/workflow/engine.ts', 'statusKey', 'engine status-key support'),
    ('src/server/infrastructure/bootstrap.ts', 'AiReviewDecided', 'feedback loop subscriber'),
    ('src/server/infrastructure/bootstrap.ts', 'ai-monitor', 'drift monitor job'),
]
for path, needle, why in checks:
    if not os.path.exists(os.path.join(ROOT, path)):
        errors.append(f'code missing: {path}')
    elif needle not in read(path):
        errors.append(f'{path} missing `{needle}` ({why})')

# 7) events catalog
events = read('src/server/infrastructure/events.ts')
for ev in ['AiReviewDecided', 'AiEvaluationCompleted', 'AiDriftDetected', 'AiBudgetAlert']:
    if ev not in events:
        errors.append(f'events catalog missing {ev}')

# 8) npm scripts
pkg = json.loads(read('package.json'))
if 'audit:ai' not in pkg.get('scripts', {}):
    errors.append('package.json missing audit:ai script')

# 9) audit gate actually passes
r = subprocess.run(['node', 'scripts/ai-audit.mjs'], capture_output=True, text=True, cwd=ROOT)
if r.returncode != 0:
    errors.append(f'ai-audit.mjs FAILED: {r.stderr.strip()[:200]}')

# 10) secret scan on the new engine (no hardcoded secrets)
for f in ['src/server/infrastructure/ai/security.ts', 'src/server/infrastructure/ai/constants.ts']:
    src = read(f)
    if re.search(r'(sk-[A-Za-z0-9]{20,}|api[_-]?key\s*[:=]\s*["\'][A-Za-z0-9]{16,})', src):
        errors.append(f'{f}: hardcoded secret pattern')
    if 'AI_DATASET_HASH_SALT' in src and 'process.env' not in src:
        errors.append(f'{f}: salt not env-driven')

# ── report ──────────────────────────────────────────────────────────────────
for w in warnings: print(f'⚠ {w}')
if errors:
    for e in errors: print(f'✗ {e}')
    print(f'\nPHASE 11 VALIDATION FAILED — {len(errors)} error(s)')
    sys.exit(1)
print('PHASE 11 VALIDATION: PASS — deliverables, registries, invariants, gates, secret scan all green')

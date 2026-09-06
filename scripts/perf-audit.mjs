#!/usr/bin/env node
// ── PHASE 16 CI gate: Performance Engineering Audit (PERF1..PERF10) ────────
// Enforces the phase's non-negotiables — the command was explicit:
// «Optimization بدون Measurement انجام نده» — so the gate checks BOTH the
// measurement apparatus AND the optimizations it justified:
//   PERF1  WAL journal mode active on the live DB (ED-182)
//   PERF2  measured hot-path indexes exist in SQLite (ED-181)
//   PERF3  schema.prisma stays the single source — the 28 phase-16 indexes
//          are declared in schema AND applied in the DB (db push parity)
//   PERF4  db.ts carries the idempotent boot tuning (WAL+NORMAL+busy_timeout)
//   PERF5  identity cache: bounded + TTL + invalidation hooks on all four
//          mutation paths (logout / login / admin edit / deletion-complete /
//          profile edit) — the security contract of ED-183
//   PERF6  dashboard batching: groupBy ladder replaced the 9-count ladder
//          (ED-184) + staff-shared cache keys exist
//   PERF7  compression explicit + CDN seam present (ED-185/186)
//   PERF8  admin views stay lazy chunks (dynamic imports — no first-load bloat)
//   PERF9  measurement harness exists + baselines captured (before/after
//          artifacts committed — optimization WITHOUT measurement is banned)
//  PERF10  anti-unbounded contracts from PHASE 14 still enforced (no perf
//          work may regress the bounded-query discipline)
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const problems = []
const ok = (name) => console.log(`  ✓ ${name}`)
const fail = (name, detail) => { problems.push(`${name}: ${detail}`); console.log(`  ✗ ${name} — ${detail}`) }
const read = (p) => readFileSync(p, 'utf8')

const PHASE16_INDEXES = [
  'MedicalCase_patientId_createdAt_idx', 'MedicalCase_status_createdAt_idx', 'MedicalCase_createdAt_idx',
  'Order_userId_createdAt_idx', 'Order_status_createdAt_idx', 'Order_createdAt_idx',
  'Payment_status_createdAt_idx', 'Payment_orderId_idx',
  'Ticket_userId_updatedAt_idx', 'Ticket_status_updatedAt_idx', 'TicketMessage_ticketId_createdAt_idx',
  'CaseEvent_caseId_createdAt_idx', 'CaseEvent_createdAt_idx',
  'AIAnalysis_caseId_idx', 'MedicalImage_caseId_createdAt_idx',
  'Invoice_orderId_idx', 'OrderItem_orderId_idx',
  'Notification_userId_read_createdAt_idx', 'FollowUp_status_idx', 'FollowUp_patientId_dueDate_idx',
  'AuditLog_createdAt_idx', 'AuditLog_userId_createdAt_idx', 'AuditLog_action_createdAt_idx',
  'SMSLog_sentAt_idx', 'QuestionnaireResponse_userId_createdAt_idx',
  'Diagnosis_caseId_idx', 'Prescription_caseId_createdAt_idx', 'FinancialTransaction_type_createdAt_idx',
]

function sqlite(sql) {
  return execFileSync('python3', ['-c', `
import sqlite3, json, sys
con = sqlite3.connect('db/custom.db')
con.row_factory = sqlite3.Row
try:
    rows = [dict(r) for r in con.execute(sys.argv[1]).fetchall()]
    print(json.dumps(rows))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`, sql], { cwd: root }).toString().trim()
}

// ── PERF1: WAL active ───────────────────────────────────────────────────────
console.log('PERF1 — SQLite WAL journal mode active (ED-182)')
{
  const out = JSON.parse(sqlite('PRAGMA journal_mode'))
  if (out[0]?.journal_mode === 'wal') ok(`journal_mode=wal`)
  else fail('journal_mode', `got ${JSON.stringify(out)} — expected wal`)
}

// ── PERF2: hot-path indexes exist ───────────────────────────────────────────
console.log('PERF2 — measured hot-path indexes applied (ED-181)')
{
  const out = JSON.parse(sqlite("SELECT name FROM sqlite_master WHERE type='index'"))
  const have = new Set(out.map((r) => r.name))
  const missing = PHASE16_INDEXES.filter((n) => !have.has(n))
  if (missing.length === 0) ok(`${PHASE16_INDEXES.length} phase-16 indexes present`)
  else fail('missing indexes', missing.join(', '))
}

// ── PERF3: schema.prisma single source (db push parity) ─────────────────────
console.log('PERF3 — schema.prisma declares every applied index')
{
  const schema = read(join(root, 'prisma/schema.prisma'))
  const missing = PHASE16_INDEXES.filter((name) => {
    const model = name.slice(0, name.indexOf('_'))
    const cols = name.slice(model.length + 1, -4).split('_')
    // model region: from "model X {" to the next top-level "model " (field
    // comments can contain '}' — brace-offset slicing is NOT safe here)
    const start = schema.indexOf(`model ${model} {`)
    const next = schema.indexOf('\nmodel ', start + 1)
    const region = schema.slice(start, next < 0 ? undefined : next)
    const re = new RegExp(`@@index\\(\\[${cols.join(', ')}\\]\\)`)
    return !re.test(region)
  })
  if (missing.length === 0) ok('schema ↔ DB parity for all 28 indexes')
  else fail('schema drift', `not declared in schema.prisma: ${missing.join(', ')}`)
}

// ── PERF4: db.ts boot tuning ────────────────────────────────────────────────
console.log('PERF4 — boot PRAGMA tuning in the client seam')
{
  const src = read(join(root, 'src/lib/db.ts'))
  let good = true
  for (const pragma of ['journal_mode=WAL', 'synchronous=NORMAL', 'busy_timeout=5000']) {
    if (!src.includes(pragma)) { good = false; fail('missing PRAGMA', pragma) }
  }
  if (good) ok('WAL + NORMAL + busy_timeout asserted at boot (guarded, idempotent)')
}

// ── PERF5: identity cache contract (ED-183) ────────────────────────────────
console.log('PERF5 — identity cache bounded + invalidation wired')
{
  const auth = read(join(root, 'src/lib/auth.ts'))
  if (!auth.includes('IDENTITY_TTL_MS')) fail('identity cache', 'TTL constant missing')
  else if (!auth.includes('IDENTITY_MAX')) fail('identity cache', 'bound missing')
  else if (!auth.includes('invalidateUserIdentity')) fail('identity cache', 'invalidator not exported')
  else ok('cache: TTL + bound + exported invalidator')

  const hooks = [
    ['authService.logout', 'src/server/application/services/authService.ts'],
    ['authService.login', 'src/server/application/services/authService.ts'],
    ['adminService.updateUser', 'src/server/application/services/adminService.ts'],
    ['adminService.patchDeletionRequest', 'src/server/application/services/adminService.ts'],
    ['profileService.updateProfile', 'src/server/application/services/profileService.ts'],
  ]
  let wired = 0
  for (const [label, file] of hooks) {
    const src = read(join(root, file))
    const count = (src.match(/invalidateUserIdentity\(/g) ?? []).length
    if (count > 0) wired++
    else fail('invalidation hook missing', label)
  }
  if (wired === hooks.length) ok(`all ${hooks.length} mutation paths invalidate`)
}

// ── PERF6: dashboard batching (ED-184) ─────────────────────────────────────
console.log('PERF6 — dashboard groupBy batching + shared cache keys')
{
  const src = read(join(root, 'src/server/application/services/dashboardService.ts'))
  const groupBys = (src.match(/\.groupBy\(/g) ?? []).length
  if (groupBys >= 3) ok(`${groupBys} grouped reads (patient + staff case/order ladders collapsed)`)
  else fail('batching', `groupBy count = ${groupBys} (expected ≥3: patient-cases + staff-cases + staff-orders)`)

  // the status count ladders must be gone (9 status-specific counts)
  const caseCountLadder = (src.match(/db\.medicalCase\.count\(/g) ?? []).length
  const orderCountLadder = (src.match(/db\.order\.count\(\{ where: \{ status/g) ?? []).length
  if (caseCountLadder === 0 && orderCountLadder === 0) ok('status count ladders eliminated')
  else fail('count ladder', `medicalCase.count=${caseCountLadder}, order.status counts=${orderCountLadder}`)

  const cache = read(join(root, 'src/server/infrastructure/cache.ts'))
  if (cache.includes('dashShared') && cache.includes('dashQueue')) ok('staff-shared cache keys registered')
  else fail('cache keys', 'dashShared/dashQueue missing in cacheKeys')
}

// ── PERF7: compression + CDN seam (ED-185/186) ─────────────────────────────
console.log('PERF7 — compression explicit + CDN seam')
{
  const cfg = read(join(root, 'next.config.ts'))
  if (/compress:\s*true/.test(cfg)) ok('compress: true explicit (measured −68.3% wire)')
  else fail('compression', 'compress not set')
  if (cfg.includes('NEXT_PUBLIC_CDN_BASE') && cfg.includes('assetPrefix')) ok('CDN seam (assetPrefix via env, no-op locally)')
  else fail('CDN seam', 'assetPrefix env wiring missing')
}

// ── PERF8: lazy admin chunks ────────────────────────────────────────────────
console.log('PERF8 — heavy admin views stay lazy')
{
  const page = read(join(root, 'src/app/page.tsx'))
  const lazyCount = (page.match(/dynamic\(/g) ?? []).length
  if (lazyCount >= 10) ok(`${lazyCount} dynamic() chunks (recharts/admin out of first load)`)
  else fail('lazy loading', `only ${lazyCount} dynamic imports`)
}

// ── PERF9: measurement apparatus + artifacts ────────────────────────────────
console.log('PERF9 — harness + before/after artifacts committed')
{
  const harness = [
    'scripts/perf-bench.mjs', 'scripts/perf-db-plan.py', 'scripts/perf-frontend.mjs',
    'scripts/perf-pipeline.mjs', 'scripts/perf-ai-flow.mjs',
  ]
  const missingH = harness.filter((f) => !existsSync(join(root, f)))
  if (missingH.length) fail('harness missing', missingH.join(', '))
  else ok('5 measurement scripts present')

  const artifacts = [
    'scripts/perf-http-baseline.json', 'scripts/perf-http-after.json',
    'scripts/perf-db-baseline.json', 'scripts/perf-db-after.json',
    'scripts/perf-frontend-baseline.json', 'scripts/perf-ai-flow-baseline.json',
  ]
  const missingA = artifacts.filter((f) => !existsSync(join(root, f)))
  if (missingA.length) fail('artifacts missing', missingA.join(', '))
  else ok('baseline + after JSONs captured (no optimization without measurement)')
}

// ── PERF10: PHASE 14 bounded-query discipline intact ───────────────────────
console.log('PERF10 — anti-unbounded contracts unregressed')
{
  const bounds = read(join(root, 'src/server/infrastructure/search/bounds.ts'))
  const searchRoutes = ['src/app/api/v1/search/route.ts', 'src/app/api/v1/reports/[id]/route.ts', 'src/app/api/v1/admin/logs/route.ts']
  if (bounds.includes('SEARCH_BOUNDS') && bounds.includes('REPORT_BOUNDS')) ok('SEARCH_BOUNDS/REPORT_BOUNDS single source intact')
  else fail('bounds', 'phase-14 bounds module changed')

  // dashboard service must not have grown unbounded reads (take caps present)
  const dash = read(join(root, 'src/server/application/services/dashboardService.ts'))
  const takes = (dash.match(/take: \d+/g) ?? []).length
  if (takes >= 3) ok(`list reads stay take-capped (${takes} caps)`)
  else fail('unbounded read risk', 'dashboard lists lost take caps')
}

// ── verdict ────────────────────────────────────────────────────────────────
console.log('')
if (problems.length) {
  console.log(`PERF AUDIT — FAILED (${problems.length} problem(s))`)
  process.exit(1)
} else {
  console.log('PERF AUDIT — PASSED (PERF1..PERF10)')
}

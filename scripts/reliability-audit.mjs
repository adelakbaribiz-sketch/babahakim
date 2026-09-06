#!/usr/bin/env node
// ── PHASE 17 CI gate: Reliability Architecture Audit (REL1..REL10) ────────
// Static + contract checks enforcing the phase's non-negotiables:
//   REL1  chaos core is double-guarded (env gate + ADMIN gate); the lib/db
//         fault seam keeps lib/* free of @/server imports (ED-137b pattern)
//   REL2  infra-failure taxonomy: db/storage outage shapes → 503
//         SERVICE_UNAVAILABLE (never a bare 500)
//   REL3  apiRoute sets Retry-After on SERVICE_UNAVAILABLE/GATEWAY_TIMEOUT
//   REL4  cache layer is disposable: cached() degrades to loader; store is
//         swappable (setCacheStore/resetCacheStore)
//   REL5  durable job queue: DurableJob rows, atomic claim (updateMany),
//         per-job timeout, tick error isolation, reset is test-guarded
//   REL6  crash recovery: stale RUNNING requeue + orphan handoff + recurring
//         job-recovery + boot recovery call in bootstrap
//   REL7  DLQ is operable: admin jobs list + replay routes exist, ADMIN-gated
//         and audited
//   REL8  request idempotency: IdempotencyRecord + unique(userId,route,key),
//         money routes protected, RUNNING→409, replay ≤32KB, TTL purge
//   REL9  readiness storage probe writes through the REAL driver (not fs.access)
//  REL10  failure-scenario test suites exist (unit FS patterns + ≥9 live
//         integration scenarios, BH_CHAOS-gated)
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const problems = []
const ok = (name) => console.log(`  ✓ ${name}`)
const fail = (name, detail) => { problems.push(`${name}: ${detail}`); console.log(`  ✗ ${name} — ${detail}`) }

function walk(dir, acc = [], filter = (f) => f.endsWith('.ts') || f.endsWith('.tsx')) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue
      walk(p, acc, filter)
    } else if (filter(p)) acc.push(p)
  }
  return acc
}

const read = (p) => readFileSync(p, 'utf8')
const serverFiles = walk(join(root, 'src/server'))
const apiFiles = walk(join(root, 'src/app/api'))
const allSrc = [...serverFiles, ...apiFiles, ...walk(join(root, 'src/lib'))]
const mustContain = (p, needles, name) => {
  const src = read(p)
  for (const n of (Array.isArray(needles) ? needles : [needles])) {
    if (!src.includes(n)) { fail(name, `${n} missing in ${p}`); return false }
  }
  ok(name)
  return true
}

// ── REL1: chaos core double-guarded + lib/db seam discipline ─────────────
console.log('REL1 — chaos core double-guarded (never armable in production)')
{
  const faults = read(join(root, 'src/server/infrastructure/faults.ts'))
  const hasEnvGate = /BH_CHAOS|BUN_TEST|NODE_ENV === 'test'/.test(faults) && faults.includes('chaosEnabled')
  const hasRefusal = faults.includes('ForbiddenError')
  hasEnvGate && hasRefusal ? ok('faults.ts: env gate + hard refusal') : fail('REL1', 'env gate/refusal missing in faults.ts')
  const chaosRoute = read(join(root, 'src/app/api/v1/admin/chaos/route.ts'))
  chaosRoute.includes("requireRole('ADMIN')") ? ok('chaos route: ADMIN-gated') : fail('REL1', 'chaos route not ADMIN-gated')
  chaosRoute.includes('chaosNotFound') ? ok('chaos route: 404-invisible when chaos disabled') : fail('REL1', 'chaos route missing invisibility guard')
  const dbLib = read(join(root, 'src/lib/db.ts'))
  // only actual import statements count (comments may mention the rule)
  const noServerImport = !/^import .*@\/server\//m.test(dbLib)
  const hasSeam = dbLib.includes('__bhDbFaultHook') && dbLib.includes('setDbFaultHook')
  noServerImport && hasSeam ? ok('db fault seam via globalThis (lib stays client-safe)') : fail('REL1', 'lib/db.ts seam/import violation')
}

// ── REL2: infra-failure taxonomy ───────────────────────────────────────────
console.log('REL2 — outage → 503 SERVICE_UNAVAILABLE taxonomy')
{
  const errors = read(join(root, 'src/server/core/errors.ts'))
  const checks = [
    [errors.includes('SERVICE_UNAVAILABLE'), 'error code exists'],
    [errors.includes('classifyInfraFailure'), 'infra classifier exists'],
    [/P1001/.test(errors) && /P2024/.test(errors), 'Prisma P1001/P2024 recognized'],
    [/ENOSPC|EIO/.test(errors), 'fs ENOSPC/EIO recognized'],
    [/SQLITE_\(CANTOPEN/.test(errors), 'SQLite corruption shapes recognized'],
    [errors.includes('retryAfterSec'), 'Retry-After seconds in details'],
  ]
  checks.every(([c]) => c) ? ok('taxonomy covers db + storage outage shapes') : fail('REL2', `missing: ${checks.filter(([c]) => !c).map(([, m]) => m).join(', ')}`)
}

// ── REL3: Retry-After header on outage responses ──────────────────────────
console.log('REL3 — outage responses carry Retry-After')
{
  const handler = read(join(root, 'src/server/api/handler.ts'))
  const has = handler.includes("'SERVICE_UNAVAILABLE'") && handler.includes('Retry-After')
  has ? ok('apiRoute sets Retry-After for SERVICE_UNAVAILABLE') : fail('REL3', 'Retry-After wiring missing')
}

// ── REL4: cache layer is disposable ────────────────────────────────────────
console.log('REL4 — cache graceful degradation (Redis-down never breaks reads)')
{
  const cache = read(join(root, 'src/server/infrastructure/cache.ts'))
  const checks = [
    [cache.includes('degrad'), 'degrade logging'],
    [cache.includes('setCacheStore'), 'swappable store'],
    [cache.includes('resetCacheStore'), 'test reset'],
    [/get:.*\.catch/.test(cache) || /\.catch\(/.test(cache), 'ops guarded'],
  ]
  checks.every(([c]) => c) ? ok('cached() degrade-to-loader + swap seam') : fail('REL4', `missing: ${checks.filter(([c]) => !c).map(([, m]) => m).join(', ')}`)
}

// ── REL5: durable job queue contracts ──────────────────────────────────────
console.log('REL5 — durable queue: rows, atomic claim, timeout, isolation')
{
  const jobs = read(join(root, 'src/server/infrastructure/jobs.ts'))
  const schema = read(join(root, 'prisma/schema.prisma'))
  const checks = [
    [jobs.includes('db.durableJob.create'), 'enqueue persists rows'],
    [jobs.includes('durableJob.updateMany') && /status: 'PENDING'/.test(jobs), 'atomic claim (updateMany status flip)'],
    [jobs.includes('withTimeout'), 'per-job timeout'],
    [jobs.includes('timed out after'), 'timeout error shape'],
    [jobs.includes('worker tick failed (isolated)'), 'tick error isolation'],
    [jobs.includes('isTestContext()'), 'reset is test-guarded'],
    [jobs.includes('JOB_TIMEOUTS'), 'per-type timeout overrides'],
    [schema.includes('model DurableJob'), 'DurableJob model'],
    [/ownerPid/.test(schema), 'owner claim optimization'],
  ]
  checks.every(([c]) => c) ? ok('durable queue contracts present') : fail('REL5', `missing: ${checks.filter(([c]) => !c).map(([, m]) => m).join(', ')}`)
  // no unbounded concurrency: worker processes a bounded batch per tick
  jobs.includes('CLAIM_BATCH') ? ok('bounded claim batch per tick') : fail('REL5', 'no batch bound')
}

// ── REL6: crash recovery ───────────────────────────────────────────────────
console.log('REL6 — crash recovery (stale RUNNING + orphan handoff)')
{
  const jobs = read(join(root, 'src/server/infrastructure/jobs.ts'))
  const bootstrap = read(join(root, 'src/server/infrastructure/bootstrap.ts'))
  const checks = [
    [jobs.includes('runJobRecovery'), 'recovery function'],
    [jobs.includes('STALE_RUNNING_MS'), 'stale claim cutoff'],
    [/ownerPid: null/.test(jobs), 'handoff (owner nulling)'],
    [jobs.includes('refreshMirrorFromDb'), 'mirror rebuild from DB truth'],
    [bootstrap.includes('runJobRecovery'), 'boot recovery call'],
    [bootstrap.includes("scheduleRecurring('job-recovery'"), 'recurring recovery (5min)'],
    [bootstrap.includes('purgeJobHistory'), 'job history retention'],
  ]
  checks.every(([c]) => c) ? ok('recovery wired at boot + 5min cadence') : fail('REL6', `missing: ${checks.filter(([c]) => !c).map(([, m]) => m).join(', ')}`)
}

// ── REL7: DLQ operability ──────────────────────────────────────────────────
console.log('REL7 — DLQ visible + replayable (admin-only, audited)')
{
  const jobsRoute = join(root, 'src/app/api/v1/admin/jobs/route.ts')
  const replayRoute = join(root, 'src/app/api/v1/admin/jobs/[id]/replay/route.ts')
  if (!existsSync(jobsRoute) || !existsSync(replayRoute)) fail('REL7', 'admin jobs routes missing')
  else {
    const list = read(jobsRoute)
    const replay = read(replayRoute)
    const svc = read(join(root, 'src/server/application/services/jobsService.ts'))
    const checks = [
      [list.includes("requireRole('ADMIN')"), 'list is ADMIN-gated'],
      [replay.includes("requireRole('ADMIN')"), 'replay is ADMIN-gated'],
      [svc.includes('JOB_REPLAY'), 'replay audited'],
      [svc.includes("!== 'DEAD'"), 'replay guards DEAD-only'],
      [svc.includes('max(1, Math.ceil'), 'paginated listing'],
    ]
    checks.every(([c]) => c) ? ok('DLQ list/replay contracts') : fail('REL7', `missing: ${checks.filter(([c]) => !c).map(([, m]) => m).join(', ')}`)
  }
}

// ── REL8: request idempotency ──────────────────────────────────────────────
console.log('REL8 — duplicate-request protection (money routes)')
{
  const idem = read(join(root, 'src/server/infrastructure/idempotency.ts'))
  const schema = read(join(root, 'prisma/schema.prisma'))
  const handler = read(join(root, 'src/server/api/handler.ts'))
  const checks = [
    [idem.includes('POST /api/v1/orders'), 'checkout protected'],
    [idem.includes('POST /api/v1/payments'), 'payment start protected'],
    [idem.includes('POST /api/v1/cases'), 'case creation protected'],
    [idem.includes('deriveKey'), 'derived key (headerless double-click)'],
    [idem.includes('canonicalJson'), 'canonical body hashing'],
    [idem.includes('ConflictError'), 'RUNNING → 409'],
    [idem.includes('Idempotency-Replayed'), 'replay header'],
    [idem.includes('MAX_STORED_BODY'), 'response cap (32KB)'],
    [idem.includes('purgeIdempotencyRecords'), 'TTL purge'],
    [schema.includes('model IdempotencyRecord') && schema.includes('@@unique([userId, route, key])'), 'model + composite unique'],
    [handler.includes('runIdempotent'), 'wired into apiRoute'],
  ]
  checks.every(([c]) => c) ? ok('idempotency contracts') : fail('REL8', `missing: ${checks.filter(([c]) => !c).map(([, m]) => m).join(', ')}`)
}

// ── REL9: honest storage probe ─────────────────────────────────────────────
console.log('REL9 — readiness storage probe writes via the real driver')
{
  const health = read(join(root, 'src/server/infrastructure/observability/health.ts'))
  const checks = [
    [health.includes('getStorageDriver'), 'uses the storage driver'],
    [health.includes('driver.put'), 'probe WRITES'],
    [health.includes('driver.delete'), 'probe cleans up'],
    [!/fs\.access/.test(health), 'fs.access (traverse-only) removed'],
  ]
  checks.every(([c]) => c) ? ok('writability probe (ENOSPC/EROFS/EIO flip readiness)') : fail('REL9', `missing: ${checks.filter(([c]) => !c).map(([, m]) => m).join(', ')}`)
}

// ── REL10: failure-scenario tests exist ────────────────────────────────────
console.log('REL10 — chaos drill suites (unit + live FS scenarios)')
{
  const unit = read(join(root, 'src/server/__tests__/reliability-core.test.ts'))
  const integ = read(join(root, 'tests/integration/reliability.test.ts'))
  const scenarios = ['FS-1', 'FS-2', 'FS-3', 'FS-4', 'FS-5', 'FS-6', 'FS-7', 'FS-8', 'FS-9']
  const missingScen = scenarios.filter((s) => !integ.includes(s))
  const checks = [
    [existsSync(join(root, 'src/server/__tests__/reliability-core.test.ts')), 'unit suite exists'],
    [existsSync(join(root, 'tests/integration/reliability.test.ts')), 'integration suite exists'],
    [missingScen.length === 0, `all 9 live FS scenarios present${missingScen.length ? ` (missing ${missingScen.join(',')})` : ''}`],
    [integ.includes('SERVICE_UNAVAILABLE') && integ.includes('retry-after'), '503 + Retry-After asserted live'],
    [unit.includes('timed out after'), 'per-job timeout asserted'],
    [unit.includes('recovered to PENDING'), 'crash recovery asserted'],
    [integ.includes('Idempotency-Replayed') || integ.includes('idempotency-replayed'), 'idempotent replay asserted live'],
    [integ.includes('alreadyPaid'), 'duplicate payment callback asserted'],
  ]
  checks.every(([c]) => c) ? ok('failure-scenario coverage') : fail('REL10', `missing: ${checks.filter(([c]) => !c).map(([, m]) => m).join(', ')}`)
}

// ── verdict ────────────────────────────────────────────────────────────────
console.log('')
if (problems.length) {
  console.log(`✗ RELIABILITY AUDIT FAILED — ${problems.length} problem(s)`)
  process.exit(1)
}
console.log('✓ RELIABILITY AUDIT PASSED — REL1..REL10')

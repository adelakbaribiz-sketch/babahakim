#!/usr/bin/env node
// ── PHASE 18 CI gate: Quality Assurance Audit (QA1..QA10) ─────────────────
// Enforces the phase's non-negotiables (charter §54 Testing + PHASE 18 order):
//   QA1  all 10 ordered test types exist with real suites (unit, integration,
//        api, database, security, e2e, regression, performance, load, contract)
//   QA2  route inventory: every /api/v1 path referenced by tests/frontend is
//        backed by a route file on disk (the REG-01/REG-02 lost-file class)
//   QA3  the PHASE 18 bug fixes are committed and locked (restored routes in
//        git, engine optimistic-concurrency, 5xx/4xx metric split)
//   QA4  regression catalog: every dated bug has a REG-* lock in the suite
//   QA5  the unified QA runner boots a chaos-enabled production server, keeps
//        NODE_ENV out of the test process, settles before racing, tears down
//   QA6  load suite enforces §79 races + honest budgets (zero 5xx, p95, exactly-once)
//   QA7  contract suite pins spec §85/§86/§87 (envelope, version, request-id,
//        pagination, Retry-After, method discipline)
//   QA8  database suite pins constraints under concurrency, soft-delete
//        isolation, append-only price history, FK integrity, schema parity
//   QA9  test hygiene: no .skip/.only/TODO hacks; suites carry provenance
//        headers; the shared client caches sessions (login rate-limit safe)
//  QA10  coverage QUALITY markers: critical paths mapped (golden journey,
//        money, RBAC matrix, isolation) — numbers alone are not the goal
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const problems = []
const ok = (name) => console.log(`  ✓ ${name}`)
const fail = (name, detail) => { problems.push(`${name}: ${detail}`); console.log(`  ✗ ${name} — ${detail}`) }

function walk(dir, filter = (f) => f.endsWith('.ts') || f.endsWith('.tsx'), acc = []) {
  if (!existsSync(dir)) return acc
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue
      walk(p, filter, acc)
    } else if (filter(p)) acc.push(p)
  }
  return acc
}

const read = (p) => readFileSync(p, 'utf8')

// ── QA1: all 10 ordered test types exist with real suites ────────────────
console.log('QA1 — the 10 ordered test types exist as real suites')
{
  const required = [
    ['unit (domain/policy/security/workflow engines)', ['src/server/__tests__/backend-core.test.ts', 'src/lib/security/__tests__/security.test.ts', 'src/lib/workflow/__tests__/workflow.test.ts']],
    ['integration (live server)', ['tests/integration/api-golden-path.test.ts']],
    ['api (negative/edge + golden)', ['tests/integration/api-golden-path.test.ts', 'tests/integration/contract.test.ts']],
    ['database', ['tests/integration/database.test.ts']],
    ['security (pentest + authz matrix)', ['tests/security-pentest.sh', 'tests/integration/authz.test.ts']],
    ['e2e (browser, critical journeys)', ['tests/e2e/run-e2e.mjs']],
    ['regression (bug memory)', ['tests/regression/regression.test.ts']],
    ['performance (measurement-first)', ['tests/integration/performance.test.ts']],
    ['load (§79 concurrency + budgets)', ['tests/load/load.test.ts']],
    ['contract (§85/§86/§87)', ['tests/integration/contract.test.ts']],
  ]
  for (const [name, files] of required) {
    const missing = files.filter((f) => !existsSync(join(root, f)))
    if (missing.length) fail(`suite ${name}`, `missing ${missing.join(', ')}`)
    else ok(`suite ${name}`)
  }
}

// ── QA2: route inventory — no referenced route without a handler ─────────
console.log('QA2 — route inventory: referenced API paths have handlers')
{
  const actual = new Set()
  for (const f of walk(join(root, 'src/app/api'))) {
    if (!f.endsWith('/route.ts')) continue
    let url = '/api' + f.replace(join(root, 'src/app/api'), '').replace('/route.ts', '')
    url = url.replace(/\/\[[^\]]+\]/g, '/{P}')
    actual.add(url.replace(/\/+$/, ''))
  }
  const refFiles = [
    ...walk(join(root, 'tests'), (f) => f.endsWith('.ts') || f.endsWith('.mjs')),
    join(root, 'src/contexts/app.tsx'),
  ]
  const refs = new Set()
  for (const f of refFiles) {
    if (!existsSync(f)) continue
    const src = read(f)
    for (const m of src.matchAll(/\/api\/v1\/[A-Za-z0-9_\-./[\]${}]*/g)) {
      let p = m[0].split('?')[0]
      p = p.replace(/\$\{[^}]*\}/g, '{P}') // ${expr} → {P} (template refs)
      p = p.replace(/\$\{[^}]*$/, '') // unterminated fragment (e.g. ${artifact!.id}) → drop the tail
      p = p.replace(/\/\*+/g, '/{P}').replace(/\/\[[^\]]+\]/g, '/{P}') // comments: /files/[id] → /files/{P}
      p = p.replace(/\/{2,}/g, '/') // collapse accidental doubles
      if (p && p !== '/api/v1' && !/\.(ts|mjs)$/.test(p)) refs.add(p)
    }
  }
  // The actual route set is authoritative. A ref resolves when it equals a
  // route, when it is a string-concat prefix ('/api/v1/images/' + id), or
  // when it fits a route's dynamic pattern ({P} → [^/]+). Literals that only
  // differ in the id segment (case_does_not_exist00) legitimately resolve.
  const match = (ref) => {
    if (actual.has(ref)) return true
    if (ref.endsWith('/') && [...actual].some((a) => a.startsWith(ref))) return true
    return [...actual].some((a) => {
      const rx = new RegExp('^' + a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{P\\\}/g, '[^/]+') + '$')
      return rx.test(ref)
    })
  }
  const missing = [...refs].filter((r) => !match(r) && !r.endsWith('/nope.nope'))
  if (missing.length) fail('route inventory', `referenced but no handler: ${missing.slice(0, 5).join(', ')}`)
  else ok(`route inventory (${actual.size} routes, ${refs.size} references all resolve)`)
}

// ── QA3: PHASE 18 bug fixes are committed AND wired ──────────────────────
console.log('QA3 — PHASE 18 critical fixes are committed and wired')
{
  let tracked = ''
  try { tracked = execSync('git ls-files', { cwd: root, encoding: 'utf8' }) } catch { fail('git ls-files', 'git unavailable') }
  for (const f of ['src/app/api/v1/images/upload/route.ts', 'src/app/api/v1/admin/integrations/test/route.ts']) {
    if (!tracked.includes(f)) fail(`restored route committed: ${f}`, 'file exists on disk but is NOT tracked by git (the REG-01/REG-02 class)')
    else ok(`restored route committed: ${f}`)
  }
  // REG-02 root-cause lock: a BARE ignore pattern (e.g. `test`) matches any
  // path segment and silently swallows source dirs like /integrations/test/.
  // Ignore patterns that can hit src/ must be anchored (/path) or extension-scoped.
  const gi = read(join(root, '.gitignore'))
  const bare = []
  for (const line of gi.split('\n')) {
    const l = line.trim()
    if (!l || l.startsWith('#') || l.startsWith('!')) continue
    if (!l.includes('/') && !l.includes('.') && ['test', 'tests', 'src', 'app', 'api', 'docs', 'scripts'].includes(l)) bare.push(l)
  }
  if (bare.length) fail('gitignore hygiene', `bare directory pattern(s) ${bare.join(', ')} can swallow source paths (REG-02 root cause) — anchor them (/dir)`)
  else ok('gitignore: no bare directory patterns that can swallow source paths')
  const engine = read(join(root, 'src/lib/workflow/engine.ts'))
  if (/updateMany\(\{\s*where:\s*\{\s*id:\s*input\.entityId,\s*\[statusKey\]:\s*currentStatus/.test(engine) && engine.includes('raced.count === 0')) {
    ok('engine optimistic-concurrency on the machine source status (§79)')
  } else fail('engine optimistic-concurrency', 'conditional updateMany guard missing in engine.ts')

  const handler = read(join(root, 'src/server/api/handler.ts'))
  if (handler.includes('METRIC_NAMES.apiRejected') && /status >= 500\?/.test(handler.replace(/\s/g, ' ').replace('if (status >= 500) inc', 'status >= 500? inc')) || /if \(status >= 500\) inc\(METRIC_NAMES\.apiErrors/.test(handler)) {
    ok('api metric 5xx/4xx split wired (api_errors vs api_rejected)')
  } else fail('api metric split', 'handler.ts 5xx/4xx counter split missing')

  const notif = read(join(root, 'src/server/application/services/supportService.ts'))
  if (notif.includes('skip: query.offset') && notif.includes('listMeta(query.page, query.limit, total)')) {
    ok('notifications pagination contract fixed (ED-100)')
  } else fail('notifications pagination', 'listNotifications pagination still violates ED-100')
}

// ── QA4: regression catalog — every dated bug has a REG-* lock ───────────
console.log('QA4 — regression catalog covers the PHASE 18 bug ledger')
{
  const reg = read(join(root, 'tests/regression/regression.test.ts'))
  const locks = {
    'REG-01 upload route lost': "REG-01 images/upload route exists",
    'REG-02 integrations/test route never committed': "REG-02 admin/integrations/test route",
    'REG-03 route inventory class-lock': 'REG-03 critical route inventory',
    'REG-04 alert reopen-after-resolve (P17 P2002)': 'REG-04 alert engine',
    'REG-05 business-today paidAt→verifiedAt (P15)': 'REG-05 business-today aggregate',
    'REG-06 4xx→api_errors false CRITICAL (P15)': 'REG-06 client errors',
    'REG-07 patient SQL-side isolation (P14 S-1)': 'REG-07 patient data isolation',
  }
  for (const [name, needle] of Object.entries(locks)) {
    if (reg.includes(needle)) ok(`locked: ${name}`)
    else fail(`locked: ${name}`, `needle "${needle}" missing from regression suite`)
  }
}

// ── QA5: the unified QA runner contract ──────────────────────────────────
console.log('QA5 — qa-run.sh runner: chaos boot, env isolation, settle, teardown')
{
  const runner = read(join(root, 'scripts/qa-run.sh'))
  const checks = [
    ['boots production standalone with BH_CHAOS=1', /BH_CHAOS=1/.test(runner) && runner.includes('standalone/server.js')],
    ['NODE_ENV isolated from the test process', runner.includes('NODE_ENV=test bun test')],
    ['readiness + settle window before racing', runner.includes('/readiness') && /sleep 8/.test(runner)],
    ['teardown trap (no orphan server)', runner.includes("trap 'kill $SERVER_PID")],
  ]
  for (const [name, cond] of checks) {
    if (cond) ok(name)
    else fail('runner', `${name} missing`)
  }
}

// ── QA6: load suite enforces §79 races + honest budgets ──────────────────
console.log('QA6 — load suite: §79 races + zero-5xx + p95 budgets')
{
  const load = read(join(root, 'tests/load/load.test.ts'))
  const checks = [
    ['claim race (two concurrent CLAIMs, one winner)', load.includes('CLAIM') && load.includes('toHaveLength(1)')],
    ['double-checkout exactly-once', load.includes('myOrders.length).toBe(1)')],
    ['sustained read budget (zero 5xx + p95)', load.includes('toBe(0)') && load.includes('p95') && load.includes('toBeLessThan(1500)')],
    ['concurrent price change append-only history', load.includes('currentPrice') && load.includes('append-only, no overwrite')],
  ]
  for (const [name, cond] of checks) {
    if (cond) ok(name)
    else fail('load suite', `${name} missing`)
  }
}

// ── QA7: contract suite pins §85/§86/§87 ─────────────────────────────────
console.log('QA7 — contract suite pins the wire contract (§85/§86/§87)')
{
  const c = read(join(root, 'tests/integration/contract.test.ts'))
  const checks = [
    ['§85 versioning header on success + every error', c.includes("x-api-version") && c.includes("toBe('v1')")],
    ['§86 envelope {error first, code, requestId, details}', c.includes("keys[0]).toBe('error')") && c.includes('data.requestId')],
    ['§87 request-id header ↔ body equality (log-traceable)', c.includes("res.headers.get('x-request-id')")],
    ['pagination flat contract across 3 list endpoints', c.includes('flat pagination fields')],
    ['§89 rate-limit Retry-After', c.includes('retry-after')],
    ['method discipline (405 never 500)', c.includes('never 500')],
  ]
  for (const [name, cond] of checks) {
    if (cond) ok(name)
    else fail('contract suite', `${name} missing`)
  }
}

// ── QA8: database suite pins integrity contracts ─────────────────────────
console.log('QA8 — database suite: constraints, soft-delete, price history, parity')
{
  const d = read(join(root, 'tests/integration/database.test.ts'))
  const checks = [
    ['schema ↔ database parity (both directions)', d.includes('drift in BOTH directions')],
    ['unique constraints under concurrent writes (P2002)', d.includes('exactly ONE winner')],
    ['FK enforcement (P2003)', d.includes('P2003')],
    ['append-only price history', d.includes('never destroyed, always appended')],
    ['soft-delete isolation (hidden from reads, row survives)', d.includes('stays in the table')],
    ['money invariants (PAID⇒verifiedAt, no negatives)', d.includes('verifiedAt: null') && d.includes('data-level sanity')],
    ['WAL durability contract', d.includes('journal_mode=WAL')],
  ]
  for (const [name, cond] of checks) {
    if (cond) ok(name)
    else fail('database suite', `${name} missing`)
  }
}

// ── QA9: test hygiene ────────────────────────────────────────────────────
console.log('QA9 — test hygiene: no silent skips, provenance headers, session cache')
{
  const testFiles = [...walk(join(root, 'tests'), (f) => f.endsWith('.test.ts')), ...walk(join(root, 'src'), (f) => f.endsWith('.test.ts'))]
  const dirty = []
  for (const f of testFiles) {
    const src = read(f)
    if (/\.skip\(|\.only\(|\.todo\(/.test(src)) dirty.push(`${f}: skip/only/todo`)
    if (/\b(TODO|FIXME|HACK)\b/.test(src)) dirty.push(`${f}: TODO/FIXME marker`)
  }
  if (dirty.length) fail('hygiene', dirty.slice(0, 4).join('; '))
  else ok(`hygiene clean across ${testFiles.length} test files`)

  const helpers = read(join(root, 'tests/helpers/client.ts'))
  if (helpers.includes('staffSessions') && helpers.includes('login:acct')) ok('shared client caches sessions (per-account login rate-limit safe)')
  else fail('shared client', 'session cache missing in tests/helpers/client.ts')
}

// ── QA10: coverage QUALITY markers (critical paths mapped) ───────────────
console.log('QA10 — coverage quality: critical paths are explicitly mapped')
{
  const golden = read(join(root, 'tests/integration/api-golden-path.test.ts'))
  const authz = read(join(root, 'tests/integration/authz.test.ts'))
  const load = read(join(root, 'tests/load/load.test.ts'))
  const reg = read(join(root, 'tests/regression/regression.test.ts'))
  const checks = [
    ['patient golden journey (questionnaire→upload→case→AI→workflow→payment→shipment)', golden.includes('CONFIRM_PROFORMA') && golden.includes('MARK_DELIVERED')],
    ['money path atomicity + idempotency', golden.includes('idempotent') && load.includes('never two orders')],
    ['6-role RBAC matrix + patient isolation', authz.includes('AUTHZ-1 admin surface RBAC matrix') && authz.includes('AUTHZ-2 patient isolation')],
    ['route inventory regression (lost-file class)', reg.includes('REG-03 critical route inventory')],
  ]
  for (const [name, cond] of checks) {
    if (cond) ok(name)
    else fail('coverage quality', `${name} not pinned`)
  }
}

console.log('─'.repeat(56))
if (problems.length) {
  console.log(`PHASE 18 QA GATE — FAILED (${problems.length} problem${problems.length > 1 ? 's' : ''})`)
  process.exit(1)
}
console.log('PHASE 18 QA GATE — PASSED (QA1..QA10)')

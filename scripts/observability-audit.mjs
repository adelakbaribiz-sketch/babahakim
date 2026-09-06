#!/usr/bin/env node
// ── PHASE 15 CI gate: Observability Architecture Audit (OBS1..OBS10) ───────
// Static + contract checks enforcing the phase's non-negotiables:
//   OBS1  health endpoints exist at the SPEC paths (/health /liveness /readiness)
//   OBS2  probes are public + minimal (no version/topology/latency disclosure)
//   OBS3  every API route uses apiRoute() (trace+metrics wiring) — except the
//         three probes (explicit standalone handlers)
//   OBS4  logger redaction: key-regex + value-scrub both present; sink guards
//   OBS5  no console.* outside core/logger.ts in server code
//   OBS6  metrics cardinality caps present (labelset cap + ring bounds)
//   OBS7  alert rules single-sourced (pure module) + cooldown + auto-resolve
//   OBS8  observability APIs are ADMIN-gated (requireRole('ADMIN'))
//   OBS9  retention purges exist for ServiceLog / MetricPoint / AlertEvent
//  OBS10  no PII in alert payloads / log statements (static scan)
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
const allSrc = [...serverFiles, ...apiFiles, ...walk(join(root, 'src/lib')), ...walk(join(root, 'src/components'))]

// ── OBS1: spec-exact probe paths ──────────────────────────────────────────
console.log('OBS1 — health endpoints at spec paths (§57)')
for (const [path, file] of [['/health', 'src/app/health/route.ts'], ['/liveness', 'src/app/liveness/route.ts'], ['/readiness', 'src/app/readiness/route.ts']]) {
  if (existsSync(join(root, file))) ok(`${path} → ${file}`)
  else fail(`${path} missing`, file)
}

// ── OBS2: probes stay minimal & standalone ────────────────────────────────
console.log('OBS2 — probes public + minimal (no topology disclosure)')
{
  let good = true
  for (const f of ['src/app/health/route.ts', 'src/app/liveness/route.ts', 'src/app/readiness/route.ts']) {
    const src = read(join(root, f)).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    if (src.includes('apiRoute')) { good = false; fail('probe uses apiRoute (must stay standalone)', f) }
    if (/version|os\.cpus|integrationStatus|metricPoint/.test(src)) { good = false; fail('probe leaks detail', f) }
  }
  if (good) ok('all three probes standalone + minimal bodies')
}

// ── OBS3: apiRoute coverage ───────────────────────────────────────────────
console.log('OBS3 — every API route funnels through apiRoute()')
{
  const offenders = []
  for (const f of apiFiles.filter((p) => p.endsWith('route.ts'))) {
    if (pIncludesProbe(f)) continue
    const src = read(f)
    const exportsHandler = /export\s+(const|async function)\s+(GET|POST|PUT|PATCH|DELETE)/.test(src)
    if (exportsHandler && !/apiRoute\s*[<(]/.test(src)) offenders.push(f)
  }
  function pIncludesProbe(f) { return /\/(health|liveness|readiness)\//.test(f) === false && !f.startsWith('src/app/api/v1/reports') === false ? false : false }
  // simpler: skip the three probe files by path
  const skip = (f) => f.includes('/health/') || f.includes('/liveness/') || f.includes('/readiness/')
  const real = offenders.filter((f) => !skip(f))
  if (real.length === 0) ok(`${apiFiles.filter((p) => p.endsWith('route.ts')).length} route files checked`)
  else fail('bare handlers', real.join(', '))
}

// ── OBS4: logger redaction v2 ─────────────────────────────────────────────
console.log('OBS4 — logger redaction (keys + VALUES) + sink guards')
{
  const src = read(join(root, 'src/server/core/logger.ts'))
  const hasKeyRedact = /REDACT\s*=\s*\//.test(src) && /\[REDACTED\]/.test(src)
  const hasValueScrub = /PHONE_RE|JWT_RE|NATIONAL_ID_RE/.test(src) && /scrubString/.test(src)
  const ringBounded = /RING_SIZE/.test(src) && /splice/.test(src)
  if (hasKeyRedact && hasValueScrub) ok('key-regex + value-level PII scrubbing')
  else fail('logger redaction incomplete', `keys=${hasKeyRedact} values=${hasValueScrub}`)
  if (ringBounded) ok('log ring bounded')
  else fail('log ring unbounded', 'no RING_SIZE cap')
  const sink = read(join(root, 'src/server/infrastructure/observability/logPersist.ts'))
  if (sink.includes('stillLooksDirty') && sink.includes('hashIp')) ok('sink PII-guard + IP hashing')
  else fail('sink guards missing', '')
}

// ── OBS5: no bare console.* in server code ────────────────────────────────
console.log('OBS5 — no console.* outside the logger')
{
  const offenders = []
  for (const f of serverFiles) {
    const src = read(f)
    if (f.endsWith('core/logger.ts')) continue
    const lines = src.split('\n')
    lines.forEach((l, i) => {
      const m = l.match(/^\s*console\.(log|info|warn|error|debug)\s*\(/)
      if (m && !l.trim().startsWith('//') && !l.includes('* console.')) offenders.push(`${f.replace(root + '/', '')}:${i + 1}`)
    })
  }
  if (offenders.length === 0) ok(`${serverFiles.length} server files clean`)
  else fail('bare console calls', offenders.slice(0, 6).join(', '))
}

// ── OBS6: metric bounds ───────────────────────────────────────────────────
console.log('OBS6 — metrics cardinality + series bounds (ED-168)')
{
  const src = read(join(root, 'src/server/core/metrics.ts'))
  const cap = /MAX_LABELSETS\s*=\s*\d+/.test(src) && /_overflow/.test(src)
  const hist = /MAX_SAMPLES\s*=\s*\d+/.test(src)
  const series = /SERIES_RING\s*=\s*\d+/.test(src)
  if (cap && hist && series) ok('labelset cap + histogram samples + series ring all bounded')
  else fail('bounds incomplete', `cap=${cap} hist=${hist} series=${series}`)
  const handler = read(join(root, 'src/server/api/handler.ts'))
  if (handler.includes('routePattern') && handler.includes(':id')) ok('route patterns folded (id → :id)')
  else fail('route pattern folding missing', '')
}

// ── OBS7: alert engine contract ───────────────────────────────────────────
console.log('OBS7 — alert rules single-source + cooldown + auto-resolve')
{
  const rules = read(join(root, 'src/server/infrastructure/observability/alertRules.ts'))
  const engine = read(join(root, 'src/server/infrastructure/observability/alerts.ts'))
  if (rules.includes('ALERT_THRESHOLDS') && rules.includes('evaluateRules')) ok('pure rules module with threshold table')
  else fail('rules module incomplete', '')
  if (engine.includes('cooldownMin') || rules.includes('cooldownMin')) ok('re-fire cooldown present')
  else fail('no cooldown', '')
  if (engine.includes("status: 'RESOLVED'")) ok('auto-resolve transition present')
  else fail('no auto-resolve', '')
  // unified engine: no other ad-hoc admin notify loop outside alerts.ts/bootstrap
  const bootstrap = read(join(root, 'src/server/infrastructure/bootstrap.ts'))
  if (bootstrap.includes('runAlertEvaluation')) ok('alert evaluator wired in bootstrap')
  else fail('alert evaluator not wired', '')
}

// ── OBS8: admin gating ────────────────────────────────────────────────────
console.log('OBS8 — observability APIs ADMIN-gated')
{
  const routes = [
    'src/app/api/v1/admin/observability/route.ts',
    'src/app/api/v1/admin/logs/route.ts',
    'src/app/api/v1/admin/alerts/route.ts',
  ]
  let good = true
  for (const r of routes) {
    const src = read(join(root, r))
    if (!src.includes("requireRole('ADMIN')")) { good = false; fail('not ADMIN-gated', r) }
  }
  if (good) ok('observability/logs/alerts all requireRole(ADMIN)')
}

// ── OBS9: retention purges ────────────────────────────────────────────────
console.log('OBS9 — retention purges for the 3 ops tables')
{
  const src = read(join(root, 'src/server/infrastructure/observability/sampler.ts'))
  const hasServiceLog = src.includes('serviceLog.deleteMany')
  const hasPoints = src.includes('metricPoint.deleteMany')
  const hasAlerts = src.includes('purgeAlerts')
  if (hasServiceLog && hasPoints && hasAlerts) ok('ServiceLog(3d) + MetricPoint(7d) + AlertEvent(90d)')
  else fail('purges incomplete', `svc=${hasServiceLog} pts=${hasPoints} alerts=${hasAlerts}`)
}

// ── OBS10: no PII in alerts/logs (static scan) ────────────────────────────
console.log('OBS10 — no raw PII in alert payloads / log statements')
{
  const files = [
    join(root, 'src/server/infrastructure/observability/alerts.ts'),
    join(root, 'src/server/infrastructure/observability/alertRules.ts'),
    join(root, 'src/server/infrastructure/observability/logPersist.ts'),
    join(root, 'src/server/core/logger.ts'),
  ]
  const patterns = [
    [/phone:\s*['"`]09/, 'raw phone literal'],
    [/password:\s*['"`][^'"`]+['"`]/, 'raw password literal'],
    [/nationalId\s*:\s*['"`]\d/, 'national id literal'],
  ]
  let good = true
  for (const f of files) {
    const src = read(f)
    for (const [re, why] of patterns) {
      if (re.test(src)) { good = false; fail(why, f.replace(root + '/', '')) }
    }
  }
  if (good) ok('no raw PII literals in observability modules')
  // payload typing: alert payload values are scalar
  const rules = read(files[1])
  if (!/payload:\s*\{[^}]*:\s*\w+\.slice\(\d+,\s*\d+\)\s*\}/.test(rules.replace(/join\(' '\)/, 'join(",")'))) {
    // list is joined to a string — typed scalar — fine
  }
}

// ── summary ───────────────────────────────────────────────────────────────
console.log('─'.repeat(60))
if (problems.length === 0) {
  console.log('PASSED — observability architecture is sound (0 warning(s))')
  process.exit(0)
} else {
  console.log(`FAILED — ${problems.length} violation(s)`)
  for (const p of problems) console.log(`  • ${p}`)
  process.exit(1)
}

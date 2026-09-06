#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 16 · HTTP/API performance benchmark (MEASUREMENT, not optimization)
// Command: "Optimization بدون Measurement انجام نده" — this script is the
// before/after ruler for API latency, cache behaviour and per-endpoint DB load.
//
//   node scripts/perf-bench.mjs --tag baseline
//
// What it measures (against the running dev server, warm):
//   • client wall-clock p50/p95/p99 per endpoint (N iterations, 3 warmups)
//   • per-endpoint DB query count + server-side db_query_ms / api_latency_ms
//     (from the PHASE 15 metrics registry via /api/v1/admin/observability,
//     with the observability endpoint's own cost measured and subtracted)
//   • cache hit vs miss: cold sample after TTL expiry + warm loop
// Output: scripts/perf-http-<tag>.json + console table
// ─────────────────────────────────────────────────────────────────────────────
const BASE = process.env.BH_BASE || 'http://localhost:3000'
const args = process.argv.slice(2)
const TAG = args.includes('--tag') ? args[args.indexOf('--tag') + 1] : (args[0] || 'baseline')
const N = args.includes('--n') ? parseInt(args[args.indexOf('--n') + 1], 10) : 30
const fs = await import('node:fs')
const path = await import('node:path')

const pct = (arr, p) => {
  if (!arr.length) return null
  const s = [...arr].sort((a, b) => a - b)
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] * 100) / 100
}
const now = () => performance.now()

// ── cookie jar (minimal: Set-Cookie parsing, name=value pairs) ───────────────
function newJar() { return new Map() }
function absorb(jar, res) {
  const raw = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean)
  for (const c of raw) {
    const [pair] = c.split(';')
    const eq = pair.indexOf('=')
    if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1))
  }
}
const cookieHeader = (jar) => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')

// ── session bootstrap (same flow as the smoke scripts) ───────────────────────
async function login(phone, password) {
  const jar = newJar()
  let res = await fetch(`${BASE}/api/v1/products`)
  absorb(jar, res)
  const csrf = jar.get('ta_csrf')
  res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf, cookie: cookieHeader(jar) },
    body: JSON.stringify({ phone, password }),
  })
  absorb(jar, res)
  if (!res.ok) throw new Error(`login failed for ${phone}: ${res.status}`)
  return { jar, csrf: jar.get('ta_csrf'), cookie: cookieHeader(jar) }
}

const ADMIN = await login('09120000001', 'Pass1234')
const PATIENT = await login('09120000006', 'Pass1234')

// ── metrics snapshots (PHASE 15 registry, via admin observability) ───────────
async function metrics() {
  const res = await fetch(`${BASE}/api/v1/admin/observability`, { headers: { cookie: ADMIN.cookie } })
  const d = await res.json()
  return d.data ?? d
}
function dbCounters(m) {
  // db_queries_total{entity,op} → per-entity totals (route attributioon)
  const out = {}
  for (const [k, v] of Object.entries(m.metrics.counters)) {
    if (k.startsWith('db_queries_total')) out[k] = v
  }
  return out
}
function diffCounters(a, b) {
  const out = {}
  for (const [k, v] of Object.entries(b)) {
    const d = v - (a[k] ?? 0)
    if (d > 0) out[k] = d
  }
  return out
}
// measure the observability endpoint's own DB cost (subtracted from deltas)
const m1 = await metrics(); const m2 = await metrics()
const OBS_SELF = diffCounters(dbCounters(m1), dbCounters(m2))
const OBS_SELF_TOTAL = Object.values(OBS_SELF).reduce((a, b) => a + b, 0)

// ── request helper ───────────────────────────────────────────────────────────
async function req(jar, path, opts = {}) {
  const t0 = now()
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { cookie: cookieHeader(jar), ...(opts.headers || {}) } })
  const ms = now() - t0
  await res.arrayBuffer().catch(() => {})
  return { ms, status: res.status }
}

async function bench(name, jar, path, opts = {}) {
  for (let i = 0; i < 3; i++) await req(jar, path, opts) // warmup
  const before = await metrics()
  const times = []
  const statuses = new Map()
  for (let i = 0; i < N; i++) {
    const r = await req(jar, path, opts)
    times.push(r.ms)
    statuses.set(r.status, (statuses.get(r.status) ?? 0) + 1)
  }
  const after = await metrics()
  const dbDelta = diffCounters(dbCounters(before), dbCounters(after))
  // remove this segment's 2 observability calls (each ≈ OBS_SELF)
  for (const k of Object.keys(dbDelta)) {
    const self = OBS_SELF[k] ?? 0
    dbDelta[k] -= 2 * self
    if (dbDelta[k] <= 0) delete dbDelta[k]
  }
  const dbTotal = Object.values(dbDelta).reduce((a, b) => a + b, 0)
  const result = {
    name, path, n: N,
    p50: pct(times, 50), p95: pct(times, 95), p99: pct(times, 99),
    mean: Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 100) / 100,
    dbQueriesPerReq: Math.round((dbTotal / N) * 10) / 10,
    dbDelta: dbDelta,
    statuses: Object.fromEntries(statuses),
  }
  console.log(
    `${name.padEnd(26)} p50 ${String(result.p50).padStart(8)}ms  p95 ${String(result.p95).padStart(8)}ms  `
    + `db/req ${String(result.dbQueriesPerReq).padStart(6)}  ${[...statuses.keys()].join(',')}`,
  )
  return result
}

async function cold(name, jar, path, ttlMs, samples = 1) {
  // wait for cache expiry, then single timed request = true COLD (miss)
  const results = []
  for (let s = 0; s < samples; s++) {
    await new Promise((r) => setTimeout(r, ttlMs + 1500))
    const r = await req(jar, path)
    results.push({ ms: Math.round(r.ms * 100) / 100, status: r.status })
    console.log(`${(name + ' [COLD]').padEnd(26)}     ${String(r.ms.toFixed(1)).padStart(8)}ms  (status ${r.status})`)
  }
  return results
}

console.log(`\nBH perf-http  tag=${TAG}  N=${N}  base=${BASE}`)
console.log(`observability self-cost: ${OBS_SELF_TOTAL} db queries/call (subtracted)\n`)

const results = {}

// ── 1. auth overhead (isolates framework + getAuth DB lookup) ────────────────
results['auth/me'] = await bench('auth/me', ADMIN.jar, '/api/v1/auth/me')

// ── 2. public catalog (cache 60s) ────────────────────────────────────────────
results['products'] = await bench('products (warm)', ADMIN.jar, '/api/v1/products')

// ── 3. dashboards (cache 15s) ────────────────────────────────────────────────
results['dashboard/admin'] = await bench('dashboard/admin (warm)', ADMIN.jar, '/api/v1/dashboard')
results['dashboard/patient'] = await bench('dashboard/patient (warm)', PATIENT.jar, '/api/v1/dashboard')

// ── 4. lists (uncached) ──────────────────────────────────────────────────────
results['cases/admin'] = await bench('cases/admin', ADMIN.jar, '/api/v1/cases?limit=20')
results['cases/patient'] = await bench('cases/patient', PATIENT.jar, '/api/v1/cases?limit=20')
results['orders/patient'] = await bench('orders/patient', PATIENT.jar, '/api/v1/orders?limit=20')
results['notifications/patient'] = await bench('notifications', PATIENT.jar, '/api/v1/notifications?limit=20')
results['audit-logs/admin'] = await bench('audit-logs/admin', ADMIN.jar, '/api/v1/admin/audit-logs?limit=20')

// ── 5. search (PHASE 14 engine) ─────────────────────────────────────────────
results['search'] = await bench('search q=سارا', ADMIN.jar, `/api/v1/search?q=${encodeURIComponent('سارا')}`)

// ── 6. report execution (PHASE 14 runner, per-category TTL) ─────────────────
results['report'] = await bench('report case-status', ADMIN.jar, '/api/v1/reports/operational.case-status')

// ── 7. cold (cache-miss) measurements — after TTL expiry ────────────────────
console.log()
results['_cold'] = {
  dashboardAdmin: await cold('dashboard/admin', ADMIN.jar, '/api/v1/dashboard', 15_000, 2),
  dashboardPatient: await cold('dashboard/patient', PATIENT.jar, '/api/v1/dashboard', 15_000, 2),
  products: await cold('products', ADMIN.jar, '/api/v1/products', 60_000, 1),
  report: await cold('report custom.dataset', ADMIN.jar, '/api/v1/reports/custom.dataset?dataset=payments&groupBy=none', 30_000, 1),
}

// ── 8. write path (login: bcrypt + JWT + refresh insert + audit insert) ──────
// login rate limit = 5 per account / 5 min → only 3 samples, patient account
const loginTimes = []
for (let i = 0; i < 3; i++) {
  const jar = newJar()
  let res = await fetch(`${BASE}/api/v1/products`)
  absorb(jar, res)
  const t0 = now()
  res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': jar.get('ta_csrf'), cookie: cookieHeader(jar) },
    body: JSON.stringify({ phone: '09120000006', password: 'Pass1234' }),
  })
  const ms = now() - t0
  await res.json().catch(() => {})
  loginTimes.push(Math.round(ms * 100) / 100)
  console.log(`${'auth/login [WRITE]'.padEnd(26)}     ${ms.toFixed(1).padStart(8)}ms`)
}
results['auth/login'] = { samples: loginTimes, mean: Math.round((loginTimes.reduce((a, b) => a + b, 0) / 3) * 100) / 100 }

// ── server-side histogram view (route → api_latency_ms p50/p95/p99) ─────────
const final = await metrics()
const routeLat = {}
for (const [k, h] of Object.entries(final.metrics.histograms)) {
  if (k.startsWith('api_latency_ms')) routeLat[k] = { p50: h.p50, p95: h.p95, p99: h.p99, count: h.count }
}

const out = {
  tag: TAG, base: BASE, n: N, generatedAt: new Date().toISOString(),
  obsSelfDbQueries: OBS_SELF_TOTAL,
  results, routeLatencyServer: routeLat,
}
const file = path.join(path.dirname(new URL(import.meta.url).pathname), `perf-http-${TAG}.json`)
fs.writeFileSync(file, JSON.stringify(out, null, 2))
console.log(`\nwritten → ${file}`)

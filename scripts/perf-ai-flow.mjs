#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 16 · End-to-end AI Processing measurement — the CORE product flow:
// patient uploads tongue photo (202) → media worker validates (job) →
// patient creates case with image → ai-analysis job runs → analysis lands.
// Measures each hop + the queue's job_duration_ms for media/ai jobs.
//   node scripts/perf-ai-flow.mjs --tag baseline
// Output: scripts/perf-ai-flow-<tag>.json
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.BH_BASE || 'http://localhost:3000'
const args = process.argv.slice(2)
const TAG = args.includes('--tag') ? args[args.indexOf('--tag') + 1] : (args[0] || 'baseline')
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..')

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
async function login(phone, password) {
  const jar = newJar()
  let res = await fetch(`${BASE}/api/v1/products`)
  absorb(jar, res)
  res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': jar.get('ta_csrf'), cookie: cookieHeader(jar) },
    body: JSON.stringify({ phone, password }),
  })
  absorb(jar, res)
  return { jar, csrf: jar.get('ta_csrf'), cookie: cookieHeader(jar) }
}

const PATIENT = await login('09120000006', 'Pass1234')
const pngBytes = fs.readFileSync(path.join(ROOT, 'scripts', 'perf-tongue-test.png'))
const results = { tag: TAG, generatedAt: new Date().toISOString() }

// 1. upload (patient-owned, no case)
const form = new FormData()
form.append('file', new Blob([pngBytes], { type: 'image/png' }), 'perf-ai-flow.png')
form.append('type', 'TONGUE')
const t0 = performance.now()
const up = await fetch(`${BASE}/api/v1/images/upload`, {
  method: 'POST', headers: { cookie: PATIENT.cookie, 'x-csrf-token': PATIENT.csrf }, body: form,
})
const acceptedMs = performance.now() - t0
const upJson = await up.json().catch(() => ({}))
const imageId = upJson?.image?.id
console.log(`upload 202: ${acceptedMs.toFixed(0)}ms imageId=${imageId}`)
results.upload = { acceptedMs: Math.round(acceptedMs), imageId }

// 2. poll image → VALIDATED
let imageState = null
const t1 = performance.now()
while (performance.now() - t1 < 20_000) {
  await new Promise((r) => setTimeout(r, 400))
  const r2 = await fetch(`${BASE}/api/v1/images/${imageId}`, { headers: { cookie: PATIENT.cookie } })
  const j2 = await r2.json().catch(() => ({}))
  imageState = j2?.image?.status
  if (imageState === 'VALIDATED' || imageState === 'REJECTED') break
}
const validateMs = performance.now() - t1
console.log(`media worker: ${validateMs.toFixed(0)}ms → ${imageState}`)
results.mediaValidate = { ms: Math.round(validateMs), state: imageState }

// 3. create case with the image
let caseId = null
if (imageState === 'VALIDATED') {
  const t2 = performance.now()
  const c3 = await fetch(`${BASE}/api/v1/cases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: PATIENT.cookie, 'x-csrf-token': PATIENT.csrf },
    body: JSON.stringify({ description: 'PHASE16 perf measurement case', imageId, priority: 'NORMAL' }),
  })
  const c3json = await c3.json().catch(() => ({}))
  const createMs = performance.now() - t2
  caseId = c3json?.case?.id
  console.log(`case created: ${createMs.toFixed(0)}ms (status ${c3.status}) caseId=${caseId}`)
  results.createCase = { ms: Math.round(createMs), caseId, status: c3.status }
}

// 4. poll the case until an AI analysis exists (ai-analysis job completes)
if (caseId) {
  const t3 = performance.now()
  let done = false
  let lastShape = null
  while (performance.now() - t3 < 30_000) {
    await new Promise((r) => setTimeout(r, 400))
    const r4 = await fetch(`${BASE}/api/v1/cases/${caseId}`, { headers: { cookie: PATIENT.cookie } })
    const j4 = await r4.json().catch(() => ({}))
    const c = j4?.case ?? {}
    lastShape = { status: c.status, analyses: (c.analyses ?? []).length }
    if ((c.analyses ?? []).length > 0) { done = true; break }
  }
  const aiMs = performance.now() - t3
  console.log(`ai-analysis: ${aiMs.toFixed(0)}ms done=${done} ${JSON.stringify(lastShape)}`)
  results.aiAnalysis = { ms: Math.round(aiMs), done, caseState: lastShape }
}

// 5. queue metrics (job durations incl. ai-analysis + media-process)
const obs = await fetch(`${BASE}/api/v1/admin/observability`, { headers: { cookie: (await login('09120000001', 'Pass1234')).cookie } })
const m = (await obs.json()).metrics
results.jobDurationMs = {}
for (const [k, v] of Object.entries(m.histograms)) {
  if (k.startsWith('job_duration_ms') && /ai-analysis|media-process/.test(k)) {
    results.jobDurationMs[k] = { p50: v.p50, p95: v.p95, count: v.count }
  }
}
console.log('job durations:', JSON.stringify(results.jobDurationMs))

fs.writeFileSync(path.join(ROOT, 'scripts', `perf-ai-flow-${TAG}.json`), JSON.stringify(results, null, 2))
console.log(`written → scripts/perf-ai-flow-${TAG}.json`)

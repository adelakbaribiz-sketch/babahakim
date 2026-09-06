#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 16 · File Processing & AI Processing measurement (async pipeline cost)
//   node scripts/perf-pipeline.mjs --tag baseline
// Measures the PHASE 10/11 async pipelines end-to-end against the dev server:
//   1. File Processing — POST /api/v1/images/upload (202) then poll
//      GET /api/v1/images/[id] until the media worker finishes (variants,
//      checksums, classification). 202-latency = request-path cost; total =
//      pipeline latency. Repeats ×3.
//   2. AI Processing — POST /api/v1/cases/[id]/rerun-ai, poll the case's
//      analysis status; also reads queue job_duration_ms for ai-analysis.
//   3. Queue — job duration histogram per type from the metrics registry.
// Output: scripts/perf-pipeline-<tag>.json
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const BASE = process.env.BH_BASE || 'http://localhost:3000'
const args = process.argv.slice(2)
const TAG = args.includes('--tag') ? args[args.indexOf('--tag') + 1] : (args[0] || 'baseline')
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..')

// minimal cookie jar
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

const ADMIN = await login('09120000001', 'Pass1234')

// generate a deterministic test PNG (640×480 — passes the ≥480px quality gate
// so the FULL pipeline — variants/thumbnail/compression — is exercised)
const pngPath = path.join(ROOT, 'scripts', 'perf-tongue-test.png')
await new Promise((resolve, reject) => {
  const py = spawn('python3', ['-c', `
import struct, zlib
w, h = 640, 480
# build rows properly
rows = b''
for y in range(h):
    rows += b'\\x00'
    for x in range(w):
        rows += bytes([(x * 3) % 256, (y * 7) % 256, (x + y) % 256])
def chunk(tag, data):
    c = tag + data
    return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c))
png = b'\\x89PNG\\r\\n\\x1a\\n'
png += chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
png += chunk(b'IDAT', zlib.compress(rows, 6))
png += chunk(b'IEND', b'')
open('${pngPath.replace(/'/g, "'\\''")}', 'wb').write(png)
print('ok')
`])
  py.stdout.on('data', (d) => process.stdout.write(d))
  py.stderr.on('data', (d) => process.stdout.write(d))
  py.on('close', resolve)
  py.on('error', reject)
})
const pngBytes = fs.readFileSync(pngPath)

// find a case with an image to rerun AI on
const casesRes = await fetch(`${BASE}/api/v1/cases?limit=50`, { headers: { cookie: ADMIN.cookie } })
const casesJson = await casesRes.json()
const caseList = casesJson.cases ?? casesJson.data?.cases ?? []
// a case in an AI-rerunnable state (workforce queue) — CLOSED cases reject rerun
const RERUNNABLE = ['NEW', 'WAITING_FOR_EXPERT_1', 'WAITING_FOR_EXPERT_2', 'EXPERT_1_REVIEW']
const targetCase = caseList.find((c) => RERUNNABLE.includes(c.status)) ?? caseList[0] ?? null
console.log(`target case: ${targetCase?.code ?? targetCase?.id} (${caseList.length} fetched)`)
const caseId = targetCase?.id

const results = { tag: TAG, base: BASE, generatedAt: new Date().toISOString() }

// ── 1. File Processing (media pipeline) ──────────────────────────────────────
const uploads = []
for (let i = 0; i < 3; i++) {
  const form = new FormData()
  form.append('file', new Blob([pngBytes], { type: 'image/png' }), `perf-test-${i}.png`)
  form.append('type', 'TONGUE')
  if (caseId) form.append('caseId', caseId)
  const t0 = performance.now()
  const res = await fetch(`${BASE}/api/v1/images/upload`, {
    method: 'POST',
    headers: { cookie: ADMIN.cookie, 'x-csrf-token': ADMIN.csrf },
    body: form,
  })
  const accepted202 = performance.now() - t0
  const body = await res.json().catch(() => ({}))
  const imageId = body?.data?.image?.id ?? body?.data?.id ?? body?.image?.id
  uploads.push({ acceptedMs: Math.round(accepted202), status: res.status, imageId })
  console.log(`upload#${i + 1}  202 in ${accepted202.toFixed(0)}ms (status ${res.status}) imageId=${imageId ?? '?'}`)
  if (imageId) {
    // poll until processed (variant pipeline done) — max 30s
    const t1 = performance.now()
    let state = null
    for (let p = 0; p < 60; p++) {
      await new Promise((r) => setTimeout(r, 500))
      const r2 = await fetch(`${BASE}/api/v1/images/${imageId}`, { headers: { cookie: ADMIN.cookie } })
      const j2 = await r2.json().catch(() => ({}))
      const img = j2?.image ?? j2?.data?.image ?? {}
      state = img.status
      // terminal: ACTIVE (processed & accepted) or REJECTED (quality gate)
      if (state && /ACTIVE|REJECTED|READY|DONE/i.test(String(state))) break
    }
    const totalMs = performance.now() - t1
    uploads[uploads.length - 1].pipelineMs = Math.round(totalMs)
    uploads[uploads.length - 1].finalState = state
    console.log(`          pipeline done in ${totalMs.toFixed(0)}ms (state=${state})`)
  }
}
results.fileProcessing = uploads

// ── 2. AI Processing (rerun pipeline) ────────────────────────────────────────
const ai = { caseId, attempts: [] }
if (caseId) {
  for (let i = 0; i < 2; i++) {
    const t0 = performance.now()
    const res = await fetch(`${BASE}/api/v1/cases/${caseId}/rerun-ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: ADMIN.cookie, 'x-csrf-token': ADMIN.csrf },
      body: '{}',
    })
    const accepted = performance.now() - t0
    const body = await res.json().catch(() => ({}))
    // poll case for a new analysis (max 30s)
    const t1 = performance.now()
    let done = false
    let lastStatus = null
    for (let p = 0; p < 60; p++) {
      await new Promise((r) => setTimeout(r, 500))
      const r2 = await fetch(`${BASE}/api/v1/cases/${caseId}`, { headers: { cookie: ADMIN.cookie } })
      const j2 = await r2.json().catch(() => ({}))
      const c = j2?.case ?? j2?.data?.case ?? {}
      const analyses = c.analyses ?? c.aiAnalyses ?? []
      lastStatus = analyses[0]?.status ?? c.status
      if ((analyses[0] && /COMPLETED|DONE|REVIEW/i.test(String(analyses[0].status))) || /EXPERT|DOCTOR|WAITING/i.test(String(c.status))) { done = true; break }
    }
    const total = performance.now() - t1
    ai.attempts.push({ acceptedMs: Math.round(accepted), status: res.status, pipelineMs: Math.round(total), done, lastStatus })
    console.log(`rerun-ai#${i + 1}  accepted in ${accepted.toFixed(0)}ms (status ${res.status}) → pipeline ${total.toFixed(0)}ms done=${done}`)
  }
}
results.aiProcessing = ai

// ── 3. Queue job durations (PHASE 15 histogram registry) ─────────────────────
const obs = await fetch(`${BASE}/api/v1/admin/observability`, { headers: { cookie: ADMIN.cookie } })
const obsJson = await obs.json()
const m = (obsJson.data ?? obsJson).metrics
results.queueJobs = {}
for (const [k, v] of Object.entries(m.counters)) {
  if (k.startsWith('queue_jobs_total')) results.queueJobs[k] = v
}
results.jobDurationMs = {}
for (const [k, v] of Object.entries(m.histograms)) {
  if (k.startsWith('job_duration_ms') || k.startsWith('queue_latency')) results.jobDurationMs[k] = { p50: v.p50, p95: v.p95, count: v.count }
}
console.log('queue jobs:', JSON.stringify(results.queueJobs))
console.log('job durations:', JSON.stringify(results.jobDurationMs))

const file = path.join(ROOT, 'scripts', `perf-pipeline-${TAG}.json`)
fs.writeFileSync(file, JSON.stringify(results, null, 2))
console.log(`\nwritten → ${file}`)

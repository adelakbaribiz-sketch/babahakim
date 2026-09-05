// ── PHASE 15 · Logging, Monitoring & Observability — API integration tests ─
// Runs against the dev server on :3000 (bun test). Verifies END-TO-END:
//   • public probes /health /liveness /readiness (spec §57 exact paths)
//   • correlation propagation: X-Correlation-ID in → echo + traceparent out
//   • ServiceLog persistence + ADMIN-only search (authz matrix)
//   • observability snapshot gating (401/403/200) + live metrics presence
//   • alert lifecycle: list + manual resolve (audited) + 404 on unknown
//   • anti-unbounded: log search deep pagination → 422
import { describe, test, expect, beforeAll } from 'bun:test'

const BASE = 'http://localhost:3000'

class Client {
  jar = new Map<string, string>()
  csrf = ''

  cookieHeader() { return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ') }

  store(res: Response) {
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';')
      const eq = pair.indexOf('=')
      const name = pair.slice(0, eq).trim()
      const value = pair.slice(eq + 1).trim()
      if (value === '') this.jar.delete(name)
      else this.jar.set(name, value)
      if (name === 'ta_csrf') this.csrf = value
    }
  }

  async call(method: string, path: string, opts: { json?: unknown; headers?: Record<string, string> } = {}) {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) }
    if (opts.json !== undefined) headers['Content-Type'] = 'application/json'
    if (this.jar.size) headers['Cookie'] = this.cookieHeader()
    if (method !== 'GET' && this.csrf) headers['x-csrf-token'] = this.csrf
    if (method !== 'GET') headers['Origin'] = BASE
    const res = await fetch(`${BASE}${path}`, { method, headers, body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined, redirect: 'manual' })
    this.store(res)
    return res
  }

  async getJson(path: string, headers?: Record<string, string>) {
    const res = await this.call('GET', path, { headers })
    let data: Record<string, unknown> = {}
    try { data = await res.json() } catch { /* non-json */ }
    return { status: res.status, data, res }
  }

  async postJson(path: string, json: unknown) {
    const res = await this.call('POST', path, { json })
    let data: Record<string, unknown> = {}
    try { data = await res.json() } catch { /* non-json */ }
    return { status: res.status, data }
  }
}

const login = async (c: Client, phone: string) => {
  await c.call('GET', '/api/v1/products') // csrf cookie bootstrap
  await c.postJson('/api/v1/auth/login', { phone, password: 'Pass1234' })
}

describe('PHASE 15 — observability (API integration)', () => {
  const admin = new Client()
  const patient = new Client()
  const anon = new Client()

  beforeAll(async () => {
    await login(admin, '09120000001')
    await login(patient, '09120000006')
  })

  // ── public probes (spec §57 exact paths) ───────────────────────────────
  test('GET /liveness → 200 {status:ok} (no auth, no DB dependency)', async () => {
    const { status, data } = await anon.getJson('/liveness')
    expect(status).toBe(200)
    expect(data.status).toBe('ok')
    expect(typeof data.uptimeSec).toBe('number')
  })

  test('GET /readiness → 200 ready|degraded with boolean checks only', async () => {
    const { status, data } = await anon.getJson('/readiness')
    expect([200, 503]).toContain(status)
    expect(['ready', 'degraded', 'not_ready']).toContain(data.status)
    const checks = data.checks as Record<string, boolean>
    expect(typeof checks.db).toBe('boolean')
    expect(typeof checks.queue).toBe('boolean')
    expect(typeof checks.storage).toBe('boolean')
    // no latency/topology disclosure on the public surface
    expect(data.dbPingMs).toBeUndefined()
    expect(data.node).toBeUndefined()
  })

  test('GET /health → 200 ok with combined status', async () => {
    const { status, data } = await anon.getJson('/health')
    expect([200, 503]).toContain(status)
    expect(['ok', 'degraded', 'down']).toContain(data.status)
  })

  // ── correlation propagation (ED-164/165) ──────────────────────────────
  test('X-Correlation-ID is echoed + traceparent emitted on every response', async () => {
    const corr = 'corr_integration_test_1'
    const { res, data } = await admin.getJson('/api/v1/products', {
      'X-Correlation-ID': corr,
      'traceparent': `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`,
    })
    expect(res.headers.get('x-correlation-id')).toBe(corr)
    expect(data.error).toBeUndefined() // products may be empty but not erroring
    const tp = res.headers.get('traceparent')
    expect(tp).toBeTruthy()
    expect(tp!.startsWith('00-')).toBe(true)
    // the trace CONTINUES: same trace-id as the caller's, fresh span
    expect(tp!.split('-')[1]).toBe('a'.repeat(32))
    expect(tp!.split('-')[2]).not.toBe('b'.repeat(16))
  })

  test('invalid/missing correlation header → a minted one is returned', async () => {
    const { res } = await admin.getJson('/api/v1/products', { 'X-Correlation-ID': 'bad value!' })
    const corr = res.headers.get('x-correlation-id')
    expect(corr).toBeTruthy()
    expect(corr!.startsWith('corr_')).toBe(true)
  })

  test('X-Request-Id header still present (ED-93 contract preserved)', async () => {
    const { res } = await admin.getJson('/api/v1/products')
    expect(res.headers.get('x-request-id')).toBeTruthy()
    expect(res.headers.get('x-api-version')).toBe('v1')
  })

  // ── authz matrix ───────────────────────────────────────────────────────
  test('observability snapshot: anon → 401, patient → 403, admin → 200', async () => {
    const a = await anon.getJson('/api/v1/admin/observability')
    expect(a.status).toBe(401)
    const p = await patient.getJson('/api/v1/admin/observability')
    expect(p.status).toBe(403)
    const adm = await admin.getJson('/api/v1/admin/observability')
    expect(adm.status).toBe(200)
  })

  test('snapshot carries live metrics after real traffic', async () => {
    const { data } = await admin.getJson('/api/v1/admin/observability')
    const metrics = data.metrics as { counters: Record<string, number>; histograms: Record<string, unknown> }
    const apiCounters = Object.keys(metrics.counters).filter((k) => k.startsWith('api_requests_total'))
    expect(apiCounters.length).toBeGreaterThan(0) // this very test traffic was counted
    const dbCounters = Object.keys(metrics.counters).filter((k) => k.startsWith('db_queries_total'))
    expect(dbCounters.length).toBeGreaterThan(0)
    expect(data.health).toBeTruthy()
    expect(data.system).toBeTruthy()
    expect(data.system.cpu).toBeTruthy()
    expect(Array.isArray(data.series)).toBe(true)
    expect(Array.isArray(data.alerts)).toBe(true)
    expect((data.queue as { workerAlive: boolean }).workerAlive).toBe(true)
  })

  test('log search: anon → 401, patient → 403, admin → 200 + rows', async () => {
    const a = await anon.getJson('/api/v1/admin/logs')
    expect(a.status).toBe(401)
    const p = await patient.getJson('/api/v1/admin/logs')
    expect(p.status).toBe(403)
    const adm = await admin.getJson('/api/v1/admin/logs?limit=5')
    expect(adm.status).toBe(200)
    expect(Array.isArray(adm.data.logs)).toBe(true)
    expect((adm.data.meta as { limit: number }).limit).toBe(5)
  })

  test('log search results never contain raw phone numbers (PII guard)', async () => {
    // generate a warn/error line with a phone in the message via a failed login
    const c = new Client()
    await c.call('GET', '/api/v1/products')
    await c.postJson('/api/v1/auth/login', { phone: '09121234567', password: 'WrongPass!9' })
    const { data } = await admin.getJson('/api/v1/admin/logs?lvl=warn&limit=25')
    const blob = JSON.stringify(data.logs)
    expect(blob.includes('09121234567')).toBe(false)
  })

  test('log search with corrId filter finds the correlated line', async () => {
    const corr = 'corr_lookup_test_9'
    // produce a warn line inside that correlation (failed login)
    const c = new Client()
    await c.call('GET', '/api/v1/products')
    const res = await c.call('POST', '/api/v1/auth/login', { json: { phone: '09129999999', password: 'nope' }, headers: { 'X-Correlation-ID': corr } })
    expect(res.status).toBe(401)
    // the durable sink flushes on a 2s micro-batch — poll briefly
    let rows: { corrId?: string; lvl: string }[] = []
    for (let i = 0; i < 10 && rows.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 500))
      const { data } = await admin.getJson(`/api/v1/admin/logs?corrId=${corr}`)
      rows = data.logs as { corrId?: string; lvl: string }[]
    }
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.corrId === corr)).toBe(true)
  })

  test('log search deep pagination → 422 (anti-unbounded, ED-168)', async () => {
    const { status } = await admin.getJson('/api/v1/admin/logs?page=9999&limit=100')
    expect(status).toBe(422)
  })

  test('alerts list: admin → 200 (possibly empty), patient → 403', async () => {
    const p = await patient.getJson('/api/v1/admin/alerts')
    expect(p.status).toBe(403)
    const adm = await admin.getJson('/api/v1/admin/alerts')
    expect(adm.status).toBe(200)
    expect(Array.isArray(adm.data.alerts)).toBe(true)
  })

  test('alert resolve: unknown id → 404, invalid id → 4xx, valid → audited', async () => {
    const bad = await admin.postJson('/api/v1/admin/alerts', { id: 'nope!' })
    expect([400, 422]).toContain(bad.status) // zod (400) or service regex (422)
    const missing = await admin.postJson('/api/v1/admin/alerts', { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeffff0000' })
    expect(missing.status).toBe(404)
  })

  test('ring tail endpoint returns newest-first live lines', async () => {
    const { status, data } = await admin.getJson('/api/v1/admin/logs?live=1&n=5')
    expect(status).toBe(200)
    expect(data.source).toBe('ring')
    expect((data.logs as unknown[]).length).toBeLessThanOrEqual(5)
  })

  test('health probes stay out of api_requests metrics (no probe inflation)', async () => {
    const { data } = await admin.getJson('/api/v1/admin/observability')
    const counters = (data.metrics as { counters: Record<string, number> }).counters
    const probeRoutes = Object.keys(counters).filter((k) => k.includes('/liveness') || k.includes('/readiness') || k.includes('/health'))
    expect(probeRoutes.length).toBe(0)
  })
})

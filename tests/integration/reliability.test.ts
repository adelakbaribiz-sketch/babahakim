// ── PHASE 17 · Reliability Engineering — LIVE failure-scenario tests ───────
// Runs against the running server on :3000 (BH_CHAOS=1 — the chaos console
// is 404-invisible without it). Every commanded failure scenario is drilled
// END-TO-END with REAL HTTP traffic and REAL infrastructure reactions:
//
//   FS-1  Database Down      → 503 SERVICE_UNAVAILABLE + Retry-After +
//                              readiness not_ready + db_errors metric + recovery
//   FS-2  Cache/Redis Down   → requests still 200 (degrade-to-loader)
//   FS-3  Worker Down        → readiness degraded + NATURAL self-heal ≤40s
//   FS-4  Duplicate Request  → idempotent checkout replay (same order id +
//                              Idempotency-Replayed header)
//   FS-5  Payment duplicate  → callback idempotent (alreadyPaid) + no second
//                              payment row for the order
//   FS-6  Job failure → DLQ  → unknown-type job dead-letters, is listed,
//                              replays, dead-letters again (attempts grow)
//   FS-7  Crash recovery     → stale RUNNING claim requeued → executed DONE
//   FS-8  Storage Failure    → upload → 503 STORAGE + readiness degraded +
//                              recovery after TTL
//   FS-9  Authz matrix       → chaos/jobs admin-gated (401/403), replay 404/409
//
// (External-API failure / circuit breaker / API timeout: covered by the
// PHASE 13 integrations suite + reliability-core unit tests; network failure
// classification: PHASE 13 unit tests — cited, not duplicated here.)
import { describe, test, expect, beforeAll } from 'bun:test'

const BASE = 'http://localhost:3000'

class Client {
  jar = new Map<string, string>()
  csrf = ''
  /** unique client IP (XFF) — each test client gets its own rate-limit
   * buckets, the established pattern from the PHASE 13 test suite */
  constructor(private clientIp = `127.0.10.${Math.floor(Math.random() * 200) + 1}`) {}

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

  async call(method: string, path: string, opts: { json?: unknown; headers?: Record<string, string>; body?: FormData } = {}) {
    const headers: Record<string, string> = { ...(opts.headers ?? {}), 'X-Forwarded-For': this.clientIp }
    if (opts.json !== undefined) headers['Content-Type'] = 'application/json'
    if (this.jar.size) headers['Cookie'] = this.cookieHeader()
    if (method !== 'GET' && this.csrf) headers['x-csrf-token'] = this.csrf
    if (method !== 'GET') headers['Origin'] = BASE
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.body,
      redirect: 'manual',
    })
    this.store(res)
    return res
  }

  async getJson(path: string, headers?: Record<string, string>) {
    const res = await this.call('GET', path, { headers })
    let data: Record<string, unknown> = {}
    try { data = await res.json() } catch { /* non-json */ }
    return { status: res.status, data, res }
  }

  async postJson(path: string, json?: unknown, headers?: Record<string, string>) {
    const res = await this.call('POST', path, { json: json ?? {}, headers })
    let data: Record<string, unknown> = {}
    try { data = await res.json() } catch { /* non-json */ }
    return { status: res.status, data, res }
  }

  async postForm(path: string, form: FormData) {
    const res = await this.call('POST', path, { body: form })
    let data: Record<string, unknown> = {}
    try { data = await res.json() } catch { /* non-json */ }
    return { status: res.status, data, res }
  }
}

async function login(phone: string): Promise<Client> {
  const c = new Client()
  await c.getJson('/liveness') // mint csrf cookie
  const { status } = await c.postJson('/api/v1/auth/login', { phone, password: 'Pass1234' })
  if (status !== 200) throw new Error(`login failed for ${phone}: ${status}`)
  return c
}

async function probeReadiness(): Promise<{ status: string; checks: Record<string, unknown> }> {
  const res = await fetch(`${BASE}/readiness`)
  return (await res.json()) as { status: string; checks: Record<string, unknown> }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

async function pollUntil(deadlineMs: number, fn: () => Promise<boolean>): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < deadlineMs) {
    if (await fn()) return true
    await sleep(500)
  }
  return false
}

async function clearCart(c: Client): Promise<void> {
  const { status, data } = await c.getJson('/api/v1/cart')
  if (status !== 200) return
  const items = (data.items ?? []) as { id: string }[]
  for (const it of items) {
    await c.call('DELETE', `/api/v1/cart?itemId=${it.id}`)
  }
}

let admin: Client
let patient: Client

beforeAll(async () => {
  admin = await login('09120000001') // ADMIN
  patient = await login('09120000006') // PATIENT (سارا)
})

// ═══════════════ FS-1 · Database Down ═══════════════════════════════════════

describe('FS-1 Database Down → 503 + Retry-After + not_ready + recovery', () => {
  test('every db-dependent request answers honest 503 (not opaque 500)', async () => {
    const act = await admin.postJson('/api/v1/admin/chaos', { action: 'activate', fault: 'db:down', ttlMs: 4000 })
    expect(act.status).toBe(200)
    expect(act.data.armed).toEqual(['db:down'])

    const { status, data, res } = await patient.getJson('/api/v1/notifications')
    expect(status).toBe(503)
    expect(data.code).toBe('SERVICE_UNAVAILABLE')
    expect((data.details as { dependency?: string })?.dependency).toBe('db')
    expect(String(data.error)).toContain('پایگاه داده')
    expect(res.headers.get('retry-after')).toBe('5') // paced retry hint

    const ready = await probeReadiness()
    expect(ready.status).toBe('not_ready')
    expect(ready.checks.db).toBe(false)

    // fault is time-boxed — the database "comes back" by itself
    const recovered = await pollUntil(10_000, async () => (await probeReadiness()).status === 'ready')
    expect(recovered).toBe(true)
    const after = await patient.getJson('/api/v1/notifications')
    expect(after.status).toBe(200)

    await admin.postJson('/api/v1/admin/chaos', { action: 'deactivate', fault: 'db:down' })
  })

  test('the outage was COUNTED (db_errors_total rose — observability sees it)', async () => {
    const { status, data } = await admin.getJson('/api/v1/admin/observability')
    expect(status).toBe(200)
    const counters = (data.metrics as { counters: Record<string, number> }).counters
    const dbErrors = Object.entries(counters)
      .filter(([k]) => k.startsWith('db_errors_total'))
      .reduce((sum, [, v]) => sum + v, 0)
    expect(dbErrors).toBeGreaterThan(0)
  })
})

// ═══════════════ FS-2 · Cache (Redis) Down ══════════════════════════════════

describe('FS-2 Cache layer Down → graceful degradation to loader', () => {
  test('catalog requests still succeed with a failing cache store', async () => {
    const act = await admin.postJson('/api/v1/admin/chaos', { action: 'activate', fault: 'cache:down', ttlMs: 5000 })
    expect(act.status).toBe(200)

    const first = await patient.getJson('/api/v1/products')
    expect(first.status).toBe(200) // degraded path — loader served, never a 500
    expect(Array.isArray(first.data.products)).toBe(true)

    await admin.postJson('/api/v1/admin/chaos', { action: 'deactivate', fault: 'cache:down' })
    const second = await patient.getJson('/api/v1/products')
    expect(second.status).toBe(200)
  })
})

// ═══════════════ FS-3 · Worker Down → natural self-heal ═════════════════════

describe('FS-3 Worker Down → readiness degraded → self-heals', () => {
  test('worker death is VISIBLE and the loop restarts itself ≤40s', async () => {
    const act = await admin.postJson('/api/v1/admin/chaos', { action: 'activate', fault: 'worker:down', ttlMs: 90_000 })
    expect(act.status).toBe(200)

    const degraded = await probeReadiness()
    expect(degraded.status).toBe('degraded') // db ok, worker dead
    expect(degraded.checks.queue).toBe(false)

    // NATURAL self-heal: recurring schedulers (metrics-sampler, 30s) enqueue →
    // ensureWorker() revives the loop. No manual restart anywhere.
    const healed = await pollUntil(40_000, async () => {
      const r = await probeReadiness()
      return r.checks.queue === true
    })
    expect(healed).toBe(true)
    const ready = await probeReadiness()
    expect(ready.status).toBe('ready')

    await admin.postJson('/api/v1/admin/chaos', { action: 'deactivate', fault: 'worker:down' })
  }, 70_000)
})

// ═══════════════ FS-4 · Duplicate Request (idempotent checkout) ═════════════

describe('FS-4 Duplicate Request → idempotent replay (no double order)', () => {
  test('double-click checkout returns the SAME order + replay header', async () => {
    // fresh cart for this run (stale items from other suites break checkout)
    await clearCart(patient)
    const products = await patient.getJson('/api/v1/products?limit=50')
    const items = products.data.products as { id: string; stock: number }[]
    const buyable = items.find((p) => p.stock > 0)
    expect(buyable).toBeDefined()
    const add = await patient.postJson('/api/v1/cart', { productId: buyable!.id, quantity: 1 })
    expect(add.status).toBe(200)

    // unique body per run: the 24h idempotency window would otherwise REPLAY
    // a previous run's order instead of executing a fresh checkout
    const runTag = `fs4-${Date.now()}`
    const first = await patient.postJson('/api/v1/orders', { note: runTag })
    expect(first.status).toBe(200)
    const order1 = (first.data.order ?? first.data) as { id: string; code: string }

    // identical duplicate (double-click): same user, same route, same body
    const dup = await patient.postJson('/api/v1/orders', { note: runTag })
    expect(dup.status).toBe(200)
    expect(dup.res.headers.get('idempotency-replayed')).toBe('true')
    const order2 = (dup.data.order ?? dup.data) as { id: string }
    expect(order2.id).toBe(order1.id) // the SAME order — no double charge

    // and a THIRD hit keeps replaying (24h window)
    const third = await patient.postJson('/api/v1/orders', { note: runTag })
    expect(third.res.headers.get('idempotency-replayed')).toBe('true')

    // cleanup: cart already cleared by checkout — verify no residual items
    const cart = await patient.getJson('/api/v1/cart')
    const cartItems = (cart.data.items ?? []) as unknown[]
    expect(cartItems.length).toBe(0)
  })
})

// ═══════════════ FS-5 · Payment duplicates (callback + start) ═══════════════

describe('FS-5 Duplicate Payment callback + duplicate start', () => {
  test('gateway callback twice → alreadyPaid replay; second start refused', async () => {
    // build an order to pay (fresh cart)
    await clearCart(patient)
    const products = await patient.getJson('/api/v1/products?limit=50')
    const items = products.data.products as { id: string; stock: number }[]
    const buyable = items.find((p) => p.stock > 0)
    expect(buyable).toBeDefined()
    await patient.postJson('/api/v1/cart', { productId: buyable!.id, quantity: 1 })
    // unique body per run — a repeated body would replay the PREVIOUS run's
    // paid order (idempotency window is 24h, by design)
    const co = await patient.postJson('/api/v1/orders', { note: `fs5-${Date.now()}` })
    const order = (co.data.order ?? co.data) as { id: string }

    // start a ZARINPAL (mock) payment
    const start = await patient.postJson('/api/v1/payments', { orderId: order.id, method: 'ZARINPAL' })
    expect(start.status).toBe(200)
    const pay = start.data.payment as { id: string; authority: string }
    expect(pay.authority).toBeTruthy()

    // duplicate start for the same order: the IDEMPOTENCY layer replays the
    // original response (same payment, no second gateway session) — the
    // strongest form of "پرداخت تکراری سفارش دوباره ثبت نکند"
    const start2 = await patient.postJson('/api/v1/payments', { orderId: order.id, method: 'ZARINPAL' })
    expect(start2.status).toBe(200)
    expect(start2.res.headers.get('idempotency-replayed')).toBe('true')
    const pay2 = start2.data.payment as { id: string }
    expect(pay2.id).toBe(pay.id) // same payment — no second session

    // the callback is CSRF-exempt (gateway) — hit it twice
    const cb1 = await fetch(`${BASE}/api/v1/payments/zarinpal/callback?authority=${pay.authority}&status=OK`, { redirect: 'manual' })
    expect(cb1.status).toBe(200)
    const cb1Body = (await cb1.json()) as { ok?: boolean; alreadyPaid?: boolean }
    expect(cb1Body.ok).toBe(true)

    const cb2 = await fetch(`${BASE}/api/v1/payments/zarinpal/callback?authority=${pay.authority}&status=OK`, { redirect: 'manual' })
    expect(cb2.status).toBe(200)
    const cb2Body = (await cb2.json()) as { ok?: boolean; alreadyPaid?: boolean }
    expect(cb2Body.alreadyPaid).toBe(true) // duplicate callback = idempotent replay

    // exactly ONE payment row exists for this order
    const payments = await patient.getJson('/api/v1/payments?limit=50')
    const list = (payments.data.payments ?? payments.data) as { orderId?: string; order?: { id: string } }[]
    const forThisOrder = list.filter((p) => p.orderId === order.id || p.order?.id === order.id)
    expect(forThisOrder.length).toBe(1)
  })
})

// ═══════════════ FS-6 · Job failure → DLQ → replay ══════════════════════════

describe('FS-6 Failed job → Dead Letter Queue → replay lifecycle', () => {
  test('unknown-type job dead-letters, is listed, replays, dead-letters again', async () => {
    const inj = await admin.postJson('/api/v1/admin/chaos', { action: 'inject-job', type: 'chaos.probe.unknown' })
    expect(inj.status).toBe(200)
    const jobId = inj.data.jobId as string

    // worker claims it ≤5s → no handler → DEAD (DLQ)
    const appeared = await pollUntil(10_000, async () => {
      const { status, data } = await admin.getJson('/api/v1/admin/jobs?status=DEAD&limit=50')
      if (status !== 200) return false
      return (data.jobs as { id: string }[]).some((j) => j.id === jobId)
    })
    expect(appeared).toBe(true)

    // replay: resets to PENDING with a CLEAN attempt counter — runs again
    // → no handler → DEAD again (attempts 1 after the reset)
    const replay = await admin.postJson(`/api/v1/admin/jobs/${jobId}/replay`)
    expect(replay.status).toBe(200)

    const reDead = await pollUntil(10_000, async () => {
      const { status, data } = await admin.getJson('/api/v1/admin/jobs?status=DEAD&limit=50')
      if (status !== 200) return false
      const row = (data.jobs as { id: string; attempts: number }[]).find((j) => j.id === jobId)
      return row !== undefined && row.attempts >= 1
    })
    expect(reDead).toBe(true) // full DLQ lifecycle: die → inspect → replay → die again
  }, 20_000)
})

// ═══════════════ FS-7 · Crash recovery (stale RUNNING claim) ════════════════

describe('FS-7 Worker crash mid-job → automatic recovery', () => {
  test('stale RUNNING job is requeued and COMPLETES after recovery', async () => {
    const inj = await admin.postJson('/api/v1/admin/chaos', { action: 'inject-stale-running', type: 'metrics-sampler' })
    expect(inj.status).toBe(200)
    const jobId = inj.data.jobId as string

    const rec = await admin.postJson('/api/v1/admin/chaos', { action: 'recover' })
    expect(rec.status).toBe(200)
    expect(rec.data.requeued as number).toBeGreaterThanOrEqual(1)

    const done = await pollUntil(15_000, async () => {
      const { status, data } = await admin.getJson(`/api/v1/admin/jobs?type=metrics-sampler&limit=100`)
      if (status !== 200) return false
      return (data.jobs as { id: string; status: string }[]).some((j) => j.id === jobId && j.status === 'DONE')
    })
    expect(done).toBe(true) // crashed job recovered AND completed
  }, 20_000)
})

// ═══════════════ FS-8 · Storage Failure ═════════════════════════════════════

describe('FS-8 Storage Down → 503 STORAGE + readiness degraded + recovery', () => {
  test('upload during storage outage → honest 503, probe flips, TTL restores', async () => {
    const act = await admin.postJson('/api/v1/admin/chaos', { action: 'activate', fault: 'storage:down', ttlMs: 5000 })
    expect(act.status).toBe(200)

    const ready = await probeReadiness()
    expect(ready.status).toBe('degraded') // writability probe FAILS now (honest)
    expect(ready.checks.storage).toBe(false)

    // multipart upload with a real tongue-test PNG
    const png = await Bun.file('scripts/perf-tongue-test.png').arrayBuffer()
    const form = new FormData()
    form.append('file', new Blob([png], { type: 'image/png' }), 'fs8-storage-down.png')
    form.append('type', 'TONGUE')
    const up = await patient.postForm('/api/v1/images/upload', form)
    expect(up.status).toBe(503) // STORAGE outage — not a 500 crash
    expect(up.data.code).toBe('SERVICE_UNAVAILABLE')
    expect((up.data.details as { dependency?: string })?.dependency).toBe('storage')

    // fault is time-boxed: storage "recovers" by itself
    const recovered = await pollUntil(10_000, async () => (await probeReadiness()).status === 'ready')
    expect(recovered).toBe(true)
    await admin.postJson('/api/v1/admin/chaos', { action: 'deactivate', fault: 'storage:down' })
  }, 30_000)
})

// ═══════════════ FS-9 · Security matrix for the new control planes ══════════

describe('FS-9 chaos/jobs control planes are admin-gated', () => {
  test('unauthenticated → 401, non-admin → 403, bad targets → 404/409/400', async () => {
    // unauthenticated
    const anon = await fetch(`${BASE}/api/v1/admin/chaos`)
    expect(anon.status).toBe(401)
    const anonJobs = await fetch(`${BASE}/api/v1/admin/jobs`)
    expect(anonJobs.status).toBe(401)

    // patient (non-admin)
    const pat = await patient.getJson('/api/v1/admin/chaos')
    expect(pat.status).toBe(403)
    const patJobs = await patient.getJson('/api/v1/admin/jobs')
    expect(patJobs.status).toBe(403)
    const patReplay = await patient.postJson('/api/v1/admin/jobs/job_nonexistent/replay')
    expect(patReplay.status).toBe(403)

    // admin: status view works, invalid fault name → 400
    const status = await admin.getJson('/api/v1/admin/chaos')
    expect(status.status).toBe(200)
    expect(status.data.chaos).toBe(true)
    const bad = await admin.postJson('/api/v1/admin/chaos', { action: 'activate', fault: 'nuclear:meltdown' })
    expect(bad.status).toBe(400)

    // replay of an unknown job → 404
    const nf = await admin.postJson('/api/v1/admin/jobs/job_does_not_exist/replay')
    expect(nf.status).toBe(404)

    // replay of a non-DEAD job → 409 (find a DONE metrics-sampler row)
    const jobs = await admin.getJson('/api/v1/admin/jobs?type=metrics-sampler&status=DONE&limit=1')
    const doneRow = (jobs.data.jobs as { id: string }[])[0]
    if (doneRow) {
      const conflict = await admin.postJson(`/api/v1/admin/jobs/${doneRow.id}/replay`)
      expect(conflict.status).toBe(409)
    }
  })
})

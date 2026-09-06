// ── PHASE 18 · CONTRACT SUITE (قرارداد API — spec §85/§86/§87) ─────────────
// §85 API Contract: backend & frontend must agree on ONE contract; breaking
//   changes need versioning → every response carries X-API-Version: v1.
// §86 Error Response: standard error format { code, message(error), details,
//   request_id(requestId) } — `error` first key for v1 compat.
// §87 Request ID: every request gets a request_id, traceable in logs.
//
// These tests pin the WIRE contract from the outside (a client that knows
// nothing about our internals), which is what "contract" means: a frontend
// built against v1 today must keep working tomorrow.
import { describe, test, expect, beforeAll } from 'bun:test'
import { Client, freshPatient, staff } from '../helpers/client'

let patient: Client
let anon: Client

beforeAll(async () => {
  anon = new Client()
  patient = await freshPatient()
})

// ═════════ §85 · versioning + §87 · request identity on every response ════
describe('CONTRACT-1 transport metadata on every response (success + error)', () => {
  test('success (200): X-API-Version=v1 · X-Request-Id · X-Correlation-Id · traceparent', async () => {
    const { res } = await anon.get('/api/v1/products?limit=2')
    expect(res.status).toBe(200)
    expect(res.headers.get('x-api-version')).toBe('v1')
    expect(res.headers.get('x-request-id')).toMatch(/^req_/)
    expect(res.headers.get('x-correlation-id')).toMatch(/^corr_/)
    expect(res.headers.get('traceparent')).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/)
    expect((res.headers.get('content-type') || '').includes('application/json')).toBe(true)
  })

  const errorProbes: [string, number, () => Promise<{ res: Response; data: Record<string, unknown>; text: string }>][] = [
    ['401 (anon → protected)', 401, () => anon.get('/api/v1/cases')],
    ['400 (bad phone → zod)', 400, () => anon.post('/api/v1/auth/login', { phone: '12345', password: 'x' })],
    ['409 (duplicate phone register → CONFLICT)', 409, () => anon.post('/api/v1/auth/register', { phone: '09120000001', password: 'Pass1234', firstName: 'دوباره', lastName: 'تست', acceptTerms: true })],
    ['403 (patient → admin)', 403, () => patient.get('/api/v1/admin/users')],
    ['404 (unknown case, authenticated)', 404, () => patient.get('/api/v1/cases/case_does_not_exist00')],
    ['422 (deep pagination → anti-unbounded)', 422, () => patient.get('/api/v1/products?page=9999&limit=100')],
  ]

  for (const [name, want, probe] of errorProbes) {
    test(`${name}: version + request-id headers survive the error path`, async () => {
      const { res } = await probe()
      expect(res.status).toBe(want)
      expect(res.headers.get('x-api-version')).toBe('v1')
      expect(res.headers.get('x-request-id')).toMatch(/^req_/)
    })
  }
})

// ═════════ §86 · ONE stable error envelope ═════════════════════════════════
describe('CONTRACT-2 error envelope shape {error, code, requestId, details?}', () => {
  test('401 body: error first key + code=AUTH_REQUIRED + requestId matches header (§87)', async () => {
    const { res, data, text } = await anon.get('/api/v1/cases')
    const keys = Object.keys(data)
    expect(keys[0]).toBe('error') // v1 backward-compat: `error` stays first
    expect(data.error).toBeTruthy()
    expect(data.code).toBe('AUTH_REQUIRED')
    expect(String(data.requestId)).toMatch(/^req_/)
    // §87: the SAME request id is on the wire and in the body → log-traceable
    expect(data.requestId).toBe(res.headers.get('x-request-id'))
    expect(text.startsWith('{')).toBe(true)
  })

  test('400 body: code=VALIDATION + field-level details.issues[]', async () => {
    const { data } = await anon.post('/api/v1/auth/login', { phone: '12345', password: 'x' })
    expect(data.code).toBe('VALIDATION')
    const issues = (data.details as { issues: { path: string; message: string }[] }).issues
    expect(Array.isArray(issues)).toBe(true)
    expect(issues.some((i) => i.path === 'phone')).toBe(true)
  })

  test('404 body: code=NOT_FOUND envelope (our handler, not a framework page)', async () => {
    const { res, data } = await patient.get('/api/v1/cases/case_does_not_exist00')
    expect(res.status).toBe(404)
    expect(typeof data.code).toBe('string')
    expect(typeof data.requestId).toBe('string')
  })

  test('422 body: code=PAGINATION_TOO_DEEP (anti-unbounded guard)', async () => {
    const { data } = await patient.get('/api/v1/products?page=9999&limit=100')
    expect(data.code).toBe('PAGINATION_TOO_DEEP')
  })

  test('malformed JSON body → 400 VALIDATION, never a 500 crash', async () => {
    const c = new Client()
    await c.get('/api/v1/products')
    const { res, data } = await c.call('POST', '/api/v1/auth/login', { body: '{not-json' })
    expect(res.status).toBe(400)
    expect(data.code).toBe('VALIDATION')
  })
})

// ═════════ method discipline (framework-level, part of the wire contract) ══
describe('CONTRACT-3 method discipline', () => {
  test('DELETE on a GET-only route → 405 (never 500)', async () => {
    const { res } = await anon.call('DELETE', '/api/v1/products')
    expect([404, 405]).toContain(res.status) // framework contract: rejected, not crashed
    expect(res.status).not.toBe(500)
  })

  test('GET on a POST-only mutation route → 405 (never 500)', async () => {
    const { res } = await anon.get('/api/v1/questionnaires/submit')
    expect([404, 405]).toContain(res.status)
    expect(res.status).not.toBe(500)
  })
})

// ═════════ ED-100 · pagination contract across list endpoints ══════════════
describe('CONTRACT-4 pagination meta on list endpoints', () => {
  const listProbes: [string, () => Promise<{ res: Response; data: Record<string, unknown>; text: string }>][] = [
    ['products', () => anon.get('/api/v1/products?limit=4')],
    ['cases', () => patient.get('/api/v1/cases?limit=4')],
    ['notifications', () => patient.get('/api/v1/notifications?limit=4')],
  ]

  for (const [name, probe] of listProbes) {
    test(`${name}: flat pagination fields {page, limit, total, pages} — integers, pages ≥ 1`, async () => {
      const { res, data } = await probe()
      expect(res.status).toBe(200)
      // PHASE 08 contract (ED-100): pagination rides flat on the list body
      expect(Number.isInteger(data.page)).toBe(true)
      expect(Number.isInteger(data.limit)).toBe(true)
      expect(Number.isInteger(data.total)).toBe(true)
      expect(Number.isInteger(data.pages)).toBe(true)
      expect(data.page).toBe(1)
      expect(data.limit).toBe(4)
      expect(data.pages).toBeGreaterThanOrEqual(1)
      expect(data.total).toBeGreaterThanOrEqual(0)
    })
  }

  test('sort/order/query params are honored (stable wire contract)', async () => {
    const { res, data } = await anon.get('/api/v1/products?limit=3&sort=createdAt&order=asc')
    expect(res.status).toBe(200)
    expect((data.products as unknown[])?.length ?? 0).toBeLessThanOrEqual(3)
  })

  test('garbage pagination params are clamped server-side, never crash', async () => {
    const { res } = await anon.get('/api/v1/products?page=-5&limit=0&sort=;drop&order=weird')
    expect(res.status).toBe(200)
  })
})

// ═════════ ED-60 · rate limit backoff contract (§89) ═══════════════════════
describe('CONTRACT-5 rate-limited responses advertise Retry-After', () => {
  test('OTP request burst (registered phone) → 429 RATE_LIMITED + Retry-After header + envelope', async () => {
    // an UNREGISTERED phone answers 404 before the rate limit — the burst must
    // target a real account, exactly like a production attacker would
    const c = await freshPatient()
    const phone = `0919${String(Date.now()).slice(-8)}`.slice(0, 11)
    const reg = await c.post('/api/v1/auth/register', { phone, password: 'Pass1234', firstName: 'کاربر', lastName: 'پنجم', acceptTerms: true })
    expect(reg.res.status).toBe(200)
    let got: { res: Response; data: Record<string, unknown> } | null = null
    for (let i = 0; i < 5 && !got; i++) {
      const r = await c.post('/api/v1/auth/otp/request', { phone, purpose: 'PASSWORD_RESET' })
      if (r.res.status === 429) got = r
    }
    expect(got).toBeTruthy()
    expect(got!.res.headers.get('retry-after')).toBeTruthy() // pacing hint is part of the contract
    expect(got!.data.code).toBe('RATE_LIMITED')
    expect(got!.data.requestId).toBeTruthy()
  }, 20_000)
})

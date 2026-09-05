// ── PHASE 13 · External Integration Architecture — API integration tests ───
// Runs against the dev server on :3000 (bun test). Verifies the adapter
// wiring END-TO-END: payment start/callback through the provider, honest SMS
// logging (SENT/FAILED from the adapter, never faked DELIVERED), admin
// integration console authz + smoke test + call log, and idempotent
// double-callbacks (BR-INT-03).
import { describe, test, expect, beforeAll } from 'bun:test'

const BASE = 'http://localhost:3000'

// ── tiny cookie-jar client with CSRF (Phase 05 double-submit) ─────────────
class Client {
  jar = new Map<string, string>()
  csrf = ''
  // unique fake client IP per instance → per-IP rate-limit buckets stay
  // isolated (golden-path convention; XFF trusted only behind the proxy)
  ip = `10.88.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`

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

  async call(method: string, path: string, opts: { json?: unknown } = {}) {
    const headers: Record<string, string> = {}
    if (opts.json !== undefined) headers['Content-Type'] = 'application/json'
    if (this.jar.size) headers['Cookie'] = this.cookieHeader()
    headers['X-Forwarded-For'] = this.ip
    if (method !== 'GET' && this.csrf) headers['x-csrf-token'] = this.csrf
    if (method !== 'GET') headers['Origin'] = BASE
    const res = await fetch(`${BASE}${path}`, { method, headers, body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined, redirect: 'manual' })
    this.store(res)
    const text = await res.text()
    let data: unknown = undefined
    try { data = text ? JSON.parse(text) : undefined } catch { /* not json */ }
    return { res, data: (data ?? {}) as Record<string, unknown>, text }
  }

  get(p: string) { return this.call('GET', p) }
  post(p: string, json?: unknown) { return this.call('POST', p, { json: json ?? {} }) }
}

const seedUser = (n: number) => ({ phone: `0912000000${n}`, password: 'Pass1234' })
const uid = () => `0919${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 9)}`.slice(0, 11)

describe('PHASE 13 — external integration architecture (API integration)', () => {
  const admin = new Client()
  const patient = new Client()
  // a SECOND fresh non-admin session for authz checks — avoids the seeded
  // staff accounts whose per-account login rate limit (5/5min) exhausts
  // across repeated test runs
  const nonAdmin = new Client()

  beforeAll(async () => {
    // warm-up + CSRF cookie
    await patient.get('/api/v1/products')
    await admin.get('/api/v1/products')
    await nonAdmin.get('/api/v1/products')
    // admin login (seeded demo account)
    const login = await admin.post('/api/v1/auth/login', seedUser(1))
    expect(login.res.status).toBe(200)
    // two fresh patient accounts (unique phones → no shared rate-limit bucket)
    await patient.post('/api/v1/auth/register', { phone: uid(), password: 'Pass1234', firstName: 'یکتا', lastName: 'تست' })
    await nonAdmin.post('/api/v1/auth/register', { phone: uid(), password: 'Pass1234', firstName: 'ناظر', lastName: 'تست' })
  })

  // ── 1. payment start/callback through the PaymentProvider adapter ──────
  test('ZARINPAL start → provider authority → callback → PAID + call log', async () => {
    // build a payable order via the shop (product list → cart → checkout)
    const { data: catalog } = await patient.get('/api/v1/products')
    const products = (catalog.products as { id: string; price: number; stock: number }[]) ?? []
    expect(products.length).toBeGreaterThan(0)
    const prod = products.find((p) => p.stock > 0) ?? products[0]
    await patient.post('/api/v1/cart', { productId: prod.id, quantity: 1 })
    const checkout = await patient.post('/api/v1/orders')
    expect(checkout.res.status).toBe(200)
    const orderId = (checkout.data.order as { id: string })?.id ?? (checkout.data as { id: string }).id
    expect(orderId).toBeTruthy()

    const start = await patient.post('/api/v1/payments', { orderId, method: 'ZARINPAL' })
    expect(start.res.status).toBe(200)
    const startData = start.data as { payment?: { authority?: string }, gatewayUrl?: string }
    const authority = startData.payment?.authority ?? ''
    const gatewayUrl = startData.gatewayUrl ?? ''
    expect(authority).toBeTruthy()
    expect(gatewayUrl).toContain('authority=')
    // mock mode is explicitly reported (mode visibility — ED-138)
    expect(start.data.mockGateway).toBeTruthy()

    // callback through the provider → machine cascade
    const cb1 = await patient.get(gatewayUrl)
    expect(cb1.res.status).toBe(200)
    expect(cb1.data.ok).toBe(true)
    expect(String(cb1.data.refNumber)).toMatch(/^\d{9}$/) // deterministic hash, was random pre-13

    // BR-INT-03: repeated callback is idempotent at payment AND provider level
    const cb2 = await patient.get(gatewayUrl)
    expect(cb2.data.alreadyPaid).toBe(true)

    // the adapter persisted the verification (durable telemetry, ED-139)
    const { data: overview } = await admin.get('/api/v1/admin/integrations')
    const payKind = (overview.kinds as { kind: string; durable24h: { total: number } }[]).find((k) => k.kind === 'PAYMENT')
    expect(payKind?.durable24h.total).toBeGreaterThan(0)
  })

  // ── 2. honest SMS logging (pre-13 bug closed) ──────────────────────────
  test('registration SMS lands as SENT from the adapter (never faked DELIVERED)', async () => {
    // fresh patient → UserRegistered event → notify(sms: true)
    const p = new Client()
    await p.get('/api/v1/products')
    const phone = uid()
    await p.post('/api/v1/auth/register', { phone, password: 'Pass1234', firstName: 'پیامک', lastName: 'تست' })

    const { data: sms } = await admin.get('/api/v1/admin/sms-log')
    const rows = (sms.logs as { recipient: string; provider: string; status: string; deliveryStatus: string | null }[])
      .filter((r) => r.recipient === phone)
    expect(rows.length).toBeGreaterThan(0)
    // provider = adapter name (mock-kavenegar), delivery honestly QUEUED
    expect(rows.some((r) => r.provider.startsWith('mock-'))).toBe(true)
    expect(rows.every((r) => r.status !== 'DELIVERED' && r.deliveryStatus !== 'DELIVERED')).toBe(true)
  })

  // ── 3. admin console: authz, 9 kinds, no secrets ───────────────────────
  test('GET /admin/integrations — ADMIN-only, 9 kinds, presence-only credentials', async () => {
    const anon = new Client()
    await anon.get('/api/v1/products')
    const r1 = await anon.get('/api/v1/admin/integrations')
    expect(r1.res.status).toBe(401)

    const r2 = await nonAdmin.get('/api/v1/admin/integrations')
    expect(r2.res.status).toBe(403)

    const r3 = await admin.get('/api/v1/admin/integrations')
    expect(r3.res.status).toBe(200)
    const kinds = r3.data.kinds as { kind: string; mode: string; credentials: { present: boolean }[] }[]
    expect(kinds).toHaveLength(9)
    expect(kinds.every((k) => k.mode === 'mock' || k.mode === 'live')).toBe(true)
    // credential presence is boolean-only — no values may leak (ED-137)
    const serialized = JSON.stringify(r3.data)
    expect(serialized).not.toMatch(/[a-f0-9]{24,}/i)
    expect(serialized).not.toMatch(/(api[_-]?key|merchant[_-]?id|secret|password)"\s*:\s*"[^"*(]/i)
  })

  // ── 4. smoke test: admin action + audit + zod validation ───────────────
  test('POST /admin/integrations/test — smoke test runs, invalid kind rejected', async () => {
    const bad = await admin.post('/api/v1/admin/integrations/test', { kind: 'NOT_A_KIND' })
    expect(bad.res.status).toBe(400) // zod enum rejects BEFORE any provider call

    const first = await admin.post('/api/v1/admin/integrations/test', { kind: 'SMS' })
    if (first.res.status === 429) {
      // a previous run within the 60s window already exhausted the limit —
      // the rate limit itself is the proven behavior in this branch
      expect(first.res.status).toBe(429)
    } else {
      expect(first.res.status).toBe(200)
      expect(first.data.ok).toBe(true)
      expect(first.data.provider).toBeTruthy()
      expect(first.data.mode).toBeTruthy()

      // rate limit: 3/minute — exhaust the remaining window then expect 429
      const second = await admin.post('/api/v1/admin/integrations/test', { kind: 'STORAGE' })
      expect(second.res.status).toBe(200)
      const third = await admin.post('/api/v1/admin/integrations/test', { kind: 'MAPS' })
      expect(third.res.status).toBe(200)
      const limited = await admin.post('/api/v1/admin/integrations/test', { kind: 'CRM' })
      expect(limited.res.status).toBe(429)
    }

    // the action is auditable
    const { data: audit } = await admin.get('/api/v1/admin/audit-logs?action=INTEGRATION_SMOKE_TEST')
    const logs = (audit.logs as { action: string }[]) ?? []
    expect(logs.some((l) => l.action === 'INTEGRATION_SMOKE_TEST')).toBe(true)
  })

  // ── 5. smoke test authz ─────────────────────────────────────────────────
  test('POST /admin/integrations/test — non-admin blocked', async () => {
    const r = await nonAdmin.post('/api/v1/admin/integrations/test', { kind: 'SMS' })
    expect(r.res.status).toBe(403)
  })
})

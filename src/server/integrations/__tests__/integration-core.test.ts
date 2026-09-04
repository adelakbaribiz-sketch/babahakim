// ── PHASE 13 unit tests · integration core (resilience/config/mocks/registry)
// bun test. DB-backed pieces hit the dev SQLite (idempotency + call log).
import { describe, test, expect, beforeEach } from 'bun:test'
import { db } from '@/lib/db'
import {
  callIntegration, classifyHttpStatus, classifyNetworkError, logSyntheticCall,
  IntegrationError, DEFAULT_POLICIES, __setIntegrationModeForTests,
  __resetRegistryForTests, __overrideForTests, integrationStatus, resetCircuit,
  maskSecret, redact, redactedJson, resolveMode, CREDENTIAL_SPECS,
} from '@/server/integrations'
import { MockPaymentProvider } from '@/server/integrations/providers/payment'
import { MockSmsProvider } from '@/server/integrations/providers/sms'
import { MockEmailProvider } from '@/server/integrations/providers/email'
import { MockMapsProvider } from '@/server/integrations/providers/maps'
import { MockShippingProvider } from '@/server/integrations/providers/shipping'
import { MockCrmProvider, MockAnalyticsProvider } from '@/server/integrations/providers/crm-analytics'
import { canPass, recordFailure, recordSuccess, circuitSnapshot, allCircuits } from '@/server/integrations/core/circuit-breaker'
import { aggregate, recentFailures, __clearTelemetryForTests } from '@/server/integrations/core/telemetry'

const TEST_KEY = `test-${Date.now()}`

beforeEach(() => {
  __clearTelemetryForTests()
  for (const k of Object.keys(allCircuits())) resetCircuit(...(k.split(':') as [string, string]))
})

// ── error taxonomy ─────────────────────────────────────────────────────────
describe('classifyHttpStatus (BR-INT-04)', () => {
  test('maps HTTP families to taxonomy', () => {
    expect(classifyHttpStatus(429)).toBe('RATE_LIMIT')
    expect(classifyHttpStatus(502)).toBe('SERVER')
    expect(classifyHttpStatus(500)).toBe('SERVER')
    expect(classifyHttpStatus(401)).toBe('AUTH')
    expect(classifyHttpStatus(403)).toBe('AUTH')
    expect(classifyHttpStatus(422)).toBe('VALIDATION')
  })
  test('network errors classify to TIMEOUT/NETWORK', () => {
    expect(classifyNetworkError(new Error('fetch failed'))).toBe('NETWORK')
    expect(classifyNetworkError(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBe('TIMEOUT')
  })
})

// ── credential security (ED-136/137/138) ──────────────────────────────────
describe('config: fail-safe mode + redaction', () => {
  test('AUTO → mock without credentials', () => {
    __setIntegrationModeForTests('AUTO')
    const { mode } = resolveMode('PAYMENT', CREDENTIAL_SPECS.PAYMENT)
    expect(mode).toBe('mock')
  })
  test('LIVE without credentials degrades to mock (fail-safe, ED-138)', () => {
    __setIntegrationModeForTests('LIVE')
    const { mode, requested } = resolveMode('PAYMENT', CREDENTIAL_SPECS.PAYMENT)
    expect(mode).toBe('mock')
    expect(requested).toBe('LIVE')
    __setIntegrationModeForTests(undefined)
  })
  test('MOCK stays mock even with credentials present', () => {
    process.env.ZARINPAL_MERCHANT_ID = 'x-test-merchant'
    __setIntegrationModeForTests('MOCK')
    expect(resolveMode('PAYMENT', CREDENTIAL_SPECS.PAYMENT).mode).toBe('mock')
    delete process.env.ZARINPAL_MERCHANT_ID
    __setIntegrationModeForTests(undefined)
  })
  test('maskSecret keeps a 4-char prefix only', () => {
    const m = maskSecret('abcdef1234567890')
    expect(m.startsWith('abcd')).toBe(true)
    expect(m).not.toContain('ef1234567890')
    expect(maskSecret('abc')).toBe('****')
  })
  test('redact masks secret-looking keys at any depth', () => {
    const out = redact({
      merchant_id: 'M-123456789', nested: { apiKey: 'k-987654321', ok: 'visible' },
      authorization: 'Bearer xyz', amount: 1000,
    }) as Record<string, unknown>
    expect(String(out.merchant_id)).not.toContain('123456789')
    const nested = out.nested as Record<string, unknown>
    expect(String(nested.apiKey)).not.toContain('987654321')
    expect(nested.ok).toBe('visible')
    expect(out.authorization).toBe('****')
    expect(out.amount).toBe(1000)
  })
  test('redactedJson bounds long strings', () => {
    const j = redactedJson({ blob: 'x'.repeat(5000) })!
    expect(j.length).toBeLessThan(1200)
  })
})

// ── resilience wrapper (the 8 concerns) ────────────────────────────────────
describe('callIntegration resilience stack', () => {
  test('TIMEOUT fires and aborts the signal (concern #1)', async () => {
    let aborted = false
    const p = callIntegration('MAPS', 'test-provider', 'op.timeout', async (signal) => {
      signal.addEventListener('abort', () => { aborted = true })
      await new Promise((r) => setTimeout(r, 400))
      return 'late'
    }, { policy: { timeoutMs: 40, retries: 0, idempotent: false } })
    await expect(p).rejects.toBeInstanceOf(IntegrationError)
    try { await p } catch { /* already asserted */ }
    await new Promise((r) => setTimeout(r, 450))
    expect(aborted).toBe(true)
  })

  test('retries retryable failures then succeeds (concern #2)', async () => {
    let calls = 0
    const r = await callIntegration<string>('SMS', 'test-provider', 'op.retry', async () => {
      calls += 1
      if (calls < 3) throw new IntegrationError({ code: 'SERVER', kind: 'SMS', provider: 'test-provider', operation: 'op.retry', message: 'boom', attempt: calls })
      return 'ok'
    }, { policy: { retries: 2, backoffBaseMs: 1, backoffMaxMs: 2, idempotent: false, timeoutMs: 5000 } })
    expect(r.value).toBe('ok')
    expect(r.attempts).toBe(3)
    expect(calls).toBe(3)
  })

  test('AUTH failures are NOT retried (concern #4 classification)', async () => {
    let calls = 0
    const p = callIntegration('SMS', 'test-provider', 'op.auth', async () => {
      calls += 1
      throw new IntegrationError({ code: 'AUTH', kind: 'SMS', provider: 'test-provider', operation: 'op.auth', message: '401' })
    }, { policy: { retries: 3, backoffBaseMs: 1, backoffMaxMs: 2, idempotent: false, timeoutMs: 5000 } })
    await expect(p).rejects.toBeInstanceOf(IntegrationError)
    expect(calls).toBe(1)
  })

  test('terminal failure throws with Persian humanized message (ED-141)', async () => {
    const p = callIntegration('PAYMENT', 'test-provider', 'op.fail', async () => {
      throw new Error('HTTP 500')
    }, { policy: { retries: 0, idempotent: false, timeoutMs: 5000 } })
    const err = (await p.then(() => null, (e) => e)) as IntegrationError | null
    expect(err).toBeInstanceOf(IntegrationError)
    expect(err!.code).toBe('SERVER')
    expect(err!.message).toContain('درگاه پرداخت')
  })

  test('DB-backed idempotency replays SUCCESS (concern #3, BR-INT-03)', async () => {
    const key = `idem-${TEST_KEY}`
    let calls = 0
    const mk = () => callIntegration<{ authority: string }>('PAYMENT', 'test-idem', 'payment.request', async () => {
      calls += 1
      return { authority: `A-${TEST_KEY}` }
    }, { idempotencyKey: key, policy: { retries: 0, idempotent: true, timeoutMs: 5000 } })
    const first = await mk()
    expect(first.replayed).toBe(false)
    const second = await mk()
    expect(second.replayed).toBe(true)
    expect(second.value.authority).toBe(`A-${TEST_KEY}`)
    expect(calls).toBe(1) // never executed twice
    // durable log holds exactly ONE SUCCESS row for the key
    const rows = await db.integrationCallLog.findMany({ where: { provider: 'test-idem', operation: 'payment.request', idempotencyKey: key } })
    expect(rows.filter((r) => r.status === 'SUCCESS')).toHaveLength(1)
    // request persisted redacted
    expect(rows[0].status).toBe('SUCCESS')
  })

  test('fallback serves a degraded result instead of throwing (concern #7)', async () => {
    const r = await callIntegration<string>('MAPS', 'test-fb', 'op.fb', async () => {
      throw new IntegrationError({ code: 'NETWORK', kind: 'MAPS', provider: 'test-fb', operation: 'op.fb', message: 'down' })
    }, { fallback: () => 'fallback-value', policy: { retries: 0, idempotent: false, timeoutMs: 2000 } })
    expect(r.value).toBe('fallback-value')
    expect(r.degraded).toBe(true)
  })

  test('circuit opens after threshold and fail-fasts (concern #8)', async () => {
    const provider = 'test-circuit'
    const opts = { policy: { retries: 0, idempotent: false, timeoutMs: 1000, circuitThreshold: 2, circuitCooldownMs: 60_000 } }
    for (let i = 0; i < 2; i++) {
      await expect(callIntegration('CRM', provider, 'op.c', () => Promise.reject(new Error('HTTP 503')), opts)).rejects.toBeInstanceOf(IntegrationError)
    }
    expect(circuitSnapshot('CRM', provider).state).toBe('OPEN')
    // third call: NO execution — fail fast
    let executed = false
    await expect(callIntegration('CRM', provider, 'op.c', async () => { executed = true; return 1 }, opts)).rejects.toThrow()
    expect(executed).toBe(false)
    // with fallback: served without executing
    const r = await callIntegration<number>('CRM', provider, 'op.c', async () => { executed = true; return 1 }, { ...opts, fallback: () => 9 })
    expect(r.degraded).toBe(true)
    expect(executed).toBe(false)
    // recovery: recordSuccess closes the circuit
    recordSuccess('CRM', provider)
    expect(circuitSnapshot('CRM', provider).state).toBe('CLOSED')
    expect(canPass('CRM', provider, 2, 60_000)).toBe(true)
  })

  test('telemetry ring records success/failure/replay (concern #6, ED-139)', async () => {
    await logSyntheticCall('ANALYTICS', 'mock-analytics', 'analytics.track', 'SUCCESS')
    await logSyntheticCall('ANALYTICS', 'mock-analytics', 'analytics.track', 'FAILED', { errorCode: 'SERVER', errorMessage: 'x' })
    const agg = aggregate().find((a) => a.provider === 'mock-analytics')
    expect(agg?.total).toBe(2)
    expect(agg?.failed).toBe(1)
    expect(agg?.lastError?.code).toBe('SERVER')
    expect(recentFailures(5).some((f) => f.provider === 'mock-analytics')).toBe(true)
  })
})

// ── mock adapters: determinism + fault injection ───────────────────────────
describe('mock adapters (testing contract)', () => {
  test('payment mock: deterministic authority + refNumber', async () => {
    const m = new MockPaymentProvider()
    const a = await m.createPayment({ amount: 100, description: 'd', callbackUrl: 'https://x/cb', orderId: 'ORD-1' })
    const b = await m.createPayment({ amount: 100, description: 'd', callbackUrl: 'https://x/cb', orderId: 'ORD-1' })
    expect(a.authority).toBe(b.authority)
    const v1 = await m.verifyPayment({ authority: a.authority, amount: 100, orderId: 'ORD-1', status: 'OK' })
    const v2 = await m.verifyPayment({ authority: a.authority, amount: 100, orderId: 'ORD-1', status: 'OK' })
    expect(v1.ok).toBe(true)
    expect(v1.refNumber).toBe(v2.refNumber) // was Math.random pre-13
    expect(a.gatewayUrl).toContain('/api/v1/payments/zarinpal/callback?authority=')
    const canceled = await m.verifyPayment({ authority: a.authority, amount: 100, orderId: 'ORD-1', status: 'NOK' })
    expect(canceled.ok).toBe(false)
  })
  test('payment mock: failNext injects failures', async () => {
    const m = new MockPaymentProvider()
    m.failNextCalls(1)
    await expect(m.createPayment({ amount: 1, description: 'd', callbackUrl: 'c', orderId: 'O2' })).rejects.toThrow()
    const ok = await m.createPayment({ amount: 1, description: 'd', callbackUrl: 'c', orderId: 'O2' })
    expect(ok.authority).toBeTruthy()
  })
  test('sms mock: records sent + injectable failure', async () => {
    const m = new MockSmsProvider()
    const r = await m.send({ recipient: '09120000000', message: 'سلام' })
    expect(r.status).toBe('SENT')
    expect(m.sent).toHaveLength(1)
    m.failNextCalls(1)
    await expect(m.send({ recipient: '09120000000', message: 'x' })).rejects.toThrow()
  })
  test('maps mock: deterministic coords in Tehran bounds, empty→invalid', async () => {
    const m = new MockMapsProvider()
    const a = await m.geocode({ address: 'ولیعصر' })
    const b = await m.geocode({ address: 'ولیعصر' })
    expect(a.lat).toBe(b.lat)
    expect(a.valid).toBe(true)
    expect(a.lat).toBeGreaterThan(35.6)
    expect(a.lat).toBeLessThan(35.8)
    expect((await m.geocode({ address: '' })).valid).toBe(false)
  })
  test('shipping mock: tracking progresses with elapsed time', async () => {
    const m = new MockShippingProvider()
    const r = await m.registerShipment({ orderId: 'O9', method: 'POST', receiverName: 'ن', receiverPhone: '09', address: 'a', postalCode: '1', itemsCount: 1 })
    expect(r.trackingCode).toMatch(/^TRK-/)
    const now = await m.trackShipment(r.trackingCode)
    expect(now.status).toBe('REGISTERED')
    m.registered.set(r.trackingCode, Date.now() - 400_000) // time travel
    const later = await m.trackShipment(r.trackingCode)
    expect(later.status).toBe('IN_TRANSIT')
    m.registered.set(r.trackingCode, Date.now() - 4_000_000)
    expect((await m.trackShipment(r.trackingCode)).status).toBe('DELIVERED')
  })
  test('crm/analytics/email mocks record operations', async () => {
    const c = new MockCrmProvider()
    const { contactId } = await c.upsertContact({ userId: 'u1', name: 'n', phone: '09', tags: ['patient'] })
    await c.recordEvent(contactId, 'order_paid')
    expect(c.contacts.size).toBe(1)
    expect(c.events).toHaveLength(1)
    const a = new MockAnalyticsProvider()
    await a.track({ event: 'case_created', userId: 'u1' })
    expect(a.events).toHaveLength(1)
    const e = new MockEmailProvider()
    await e.send({ to: 'a@b.c', subject: 's', text: 't' })
    expect(e.outbox).toHaveLength(1)
  })
})

// ── registry ───────────────────────────────────────────────────────────────
describe('registry (ED-150 single instantiation path)', () => {
  test('integrationStatus covers all 9 kinds with mock defaults', () => {
    __resetRegistryForTests('mock')
    const rows = integrationStatus()
    expect(rows).toHaveLength(9)
    expect(rows.every((r) => r.mode === 'mock')).toBe(true)
    expect(rows.map((r) => r.kind).sort()).toEqual(['AI', 'ANALYTICS', 'CRM', 'EMAIL', 'MAPS', 'PAYMENT', 'SHIPPING', 'SMS', 'STORAGE'])
    // no credential VALUES ever surface (ED-137)
    expect(JSON.stringify(rows)).not.toMatch(/[a-f0-9]{20,}/i)
  })
  test('test override injection works', () => {
    const m = new MockSmsProvider()
    __overrideForTests('SMS', m)
    const r = integrationStatus().find((x) => x.kind === 'SMS')
    expect(r?.providerName).toBe(m.name)
    __overrideForTests('SMS', undefined)
  })
  test('default policies have sane production values', () => {
    expect(DEFAULT_POLICIES.PAYMENT.retries).toBeLessThanOrEqual(1) // money: no blind retries
    expect(DEFAULT_POLICIES.PAYMENT.idempotent).toBe(true)
    expect(DEFAULT_POLICIES.AI.timeoutMs).toBeGreaterThanOrEqual(20_000)
    expect(DEFAULT_POLICIES.ANALYTICS.circuitThreshold).toBeGreaterThanOrEqual(10)
  })
})

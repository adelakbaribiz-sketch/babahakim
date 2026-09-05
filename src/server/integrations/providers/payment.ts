// ── BabaHakim Integration · Payment Provider (PHASE 13, ED-142) ───────────
// Spec §27: PaymentProvider interface so the gateway is SWAPPABLE.
// Zarinpal PG v4 (request/verify) live adapter + deterministic mock with
// fault injection for testing. App services never see HTTP details — they
// see createPayment / verifyPayment contracts or IntegrationError.
import { createHash } from 'crypto'
import { callIntegration, logSyntheticCall } from '../core/resilience'
import { resolveMode, paymentSettings, zarinpalMerchantId, CREDENTIAL_SPECS } from '../core/config'
import { IntegrationError } from '../core/types'

export interface CreatePaymentInput {
  amount: number // Toman (Rial on the wire is provider's business — adapter converts)
  description: string
  callbackUrl: string
  mobile?: string | null
  orderId: string
}

export interface CreatePaymentResult {
  authority: string
  gatewayUrl: string
  raw?: unknown
}

export interface VerifyPaymentInput {
  authority: string
  amount: number
  orderId: string
  /** gateway-reported status (callback `status` param); 'OK' = user-approved */
  status: string
}

export interface VerifyPaymentResult {
  ok: boolean
  refNumber?: string
  cardPan?: string | null
  raw?: unknown
}

export interface PaymentProvider {
  readonly name: string
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>
  verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult>
  healthCheck(): Promise<{ ok: boolean; latencyMs: number; detail: string }>
}

// ── Zarinpal live adapter (PG v4) ──────────────────────────────────────────
const ZARINPAL_BASE = {
  sandbox: 'https://sandbox.zarinpal.com/pg/v4/payment',
  live: 'https://payment.zarinpal.com/pg/v4/payment',
} as const

export class ZarinpalProvider implements PaymentProvider {
  readonly name = 'zarinpal'
  private merchantId: string
  private sandbox: boolean

  constructor(merchantId: string) {
    this.merchantId = merchantId
    this.sandbox = paymentSettings().sandbox
  }

  private apiUrl(action: 'request' | 'verify'): string {
    return `${this.sandbox ? ZARINPAL_BASE.sandbox : ZARINPAL_BASE.live}/${action}.json`
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const res = await callIntegration<CreatePaymentResult>(
      'PAYMENT', this.name, 'payment.request',
      async (signal) => {
        const r = await fetch(this.apiUrl('request'), {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({
            merchant_id: this.merchantId,
            amount: input.amount * 10, // Toman → Rial
            callback_url: input.callbackUrl,
            description: input.description,
            metadata: { mobile: input.mobile || undefined, order_id: input.orderId },
          }),
          signal,
        })
        if (!r.ok) throw new IntegrationError({ code: r.status >= 500 ? 'SERVER' : r.status === 401 || r.status === 403 ? 'AUTH' : 'VALIDATION', kind: 'PAYMENT', provider: this.name, operation: 'payment.request', message: `Zarinpal HTTP ${r.status}`, httpStatus: r.status })
        const j = (await r.json()) as { data?: { authority?: string; code?: number; message?: string }; errors?: unknown }
        const authority = j?.data?.authority
        if (!authority || (j?.data?.code !== 100 && j?.data?.code !== 101)) {
          throw new IntegrationError({ code: 'PROVIDER', kind: 'PAYMENT', provider: this.name, operation: 'payment.request', message: `Zarinpal rejected request: ${j?.data?.message || JSON.stringify(j?.errors ?? j)}` })
        }
        return {
          authority,
          gatewayUrl: `${this.sandbox ? 'https://sandbox.zarinpal.com/pg/StartPay/' : 'https://payment.zarinpal.com/pg/StartPay/'}${authority}`,
          raw: { code: j.data.code },
        }
      },
      { request: { amount: input.amount, orderId: input.orderId, merchantId: this.merchantId }, idempotencyKey: `req:${input.orderId}`, related: { type: 'ORDER', id: input.orderId }, policy: { retries: 0 } },
    )
    return res.value
  }

  async verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult> {
    const res = await callIntegration<VerifyPaymentResult>(
      'PAYMENT', this.name, 'payment.verify',
      async (signal) => {
        // user canceled / gateway reported non-OK → deterministic, no HTTP
        if (input.status !== 'OK') return { ok: false, raw: { status: input.status } }
        const r = await fetch(this.apiUrl('verify'), {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ merchant_id: this.merchantId, amount: input.amount * 10, authority: input.authority }),
          signal,
        })
        if (!r.ok) throw new IntegrationError({ code: r.status >= 500 ? 'SERVER' : r.status === 401 || r.status === 403 ? 'AUTH' : 'VALIDATION', kind: 'PAYMENT', provider: this.name, operation: 'payment.verify', message: `Zarinpal HTTP ${r.status}`, httpStatus: r.status })
        const j = (await r.json()) as { data?: { code?: number; ref_id?: number; card_pan?: string; message?: string }; errors?: unknown }
        const code = j?.data?.code
        // 100 = verified, 101 = already verified (double callback) — both OK
        if (code === 100 || code === 101) {
          return { ok: true, refNumber: String(j?.data?.ref_id ?? ''), cardPan: j?.data?.card_pan ?? null, raw: { code } }
        }
        return { ok: false, raw: { code, message: j?.data?.message } }
      },
      { request: { authority: input.authority, amount: input.amount, orderId: input.orderId }, idempotencyKey: `verify:${input.authority}`, related: { type: 'ORDER', id: input.orderId }, policy: { retries: 0 } },
    )
    return res.value
  }

  async healthCheck(): Promise<{ ok: boolean; latencyMs: number; detail: string }> {
    const t0 = Date.now()
    try {
      await callIntegration('PAYMENT', this.name, 'payment.health', async (signal) => {
        const r = await fetch(this.apiUrl('request'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ merchant_id: 'healthcheck', amount: 1000, callback_url: 'https://invalid.local/callback', description: 'healthcheck' }), signal })
        return r.status
      }, { policy: { retries: 0, timeoutMs: 6_000, idempotent: false } })
      return { ok: true, latencyMs: Date.now() - t0, detail: 'reachable' }
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - t0, detail: e instanceof Error ? e.message : 'unreachable' }
    }
  }
}

// ── Mock adapter (deterministic + fault injection) ─────────────────────────
// Same contract; authority/refNumber derive from a SHA-256 of the input so
// tests are reproducible. faultNext* helpers let tests exercise timeout,
// retry and failure paths without a real network.
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock-zarinpal'
  private failNext = 0
  private slowNextMs = 0

  failNextCalls(n: number): void { this.failNext = n }
  slowNextCalls(ms: number): void { this.slowNextMs = ms }
  reset(): void { this.failNext = 0; this.slowNextMs = 0 }

  private hash(seed: string): string {
    return createHash('sha256').update(`mock-payment:${seed}`).digest('hex')
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    if (this.slowNextMs > 0) { await new Promise((r) => setTimeout(r, this.slowNextMs)); this.slowNextMs = 0 }
    if (this.failNext > 0) {
      this.failNext -= 1
      await logSyntheticCall('PAYMENT', this.name, 'payment.request', 'FAILED', { errorCode: 'SERVER', errorMessage: 'mock injected failure', related: { type: 'ORDER', id: input.orderId } })
      throw new IntegrationError({ code: 'SERVER', kind: 'PAYMENT', provider: this.name, operation: 'payment.request', message: 'mock injected failure' })
    }
    const authority = this.hash(`req:${input.orderId}`).slice(0, 36)
    await logSyntheticCall('PAYMENT', this.name, 'payment.request', 'SUCCESS', { related: { type: 'ORDER', id: input.orderId } })
    return {
      authority,
      // local simulator route — the SAME contract the live gateway uses
      gatewayUrl: `/api/v1/payments/zarinpal/callback?authority=${authority}&status=OK`,
      raw: { mock: true },
    }
  }

  async verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult> {
    if (this.failNext > 0) {
      this.failNext -= 1
      await logSyntheticCall('PAYMENT', this.name, 'payment.verify', 'FAILED', { errorCode: 'SERVER', errorMessage: 'mock injected failure', related: { type: 'ORDER', id: input.orderId } })
      throw new IntegrationError({ code: 'SERVER', kind: 'PAYMENT', provider: this.name, operation: 'payment.verify', message: 'mock injected failure' })
    }
    if (input.status !== 'OK') {
      await logSyntheticCall('PAYMENT', this.name, 'payment.verify', 'SUCCESS', { related: { type: 'ORDER', id: input.orderId } })
      return { ok: false, raw: { status: input.status } }
    }
    // deterministic ref number (test reproducibility — was Math.random pre-13)
    const refNumber = 100_000_000 + (parseInt(this.hash(`ref:${input.authority}`).slice(0, 8), 16) % 900_000_000)
    await logSyntheticCall('PAYMENT', this.name, 'payment.verify', 'SUCCESS', { related: { type: 'ORDER', id: input.orderId } })
    return { ok: true, refNumber: String(refNumber), cardPan: '6037**********', raw: { mock: true } }
  }

  async healthCheck(): Promise<{ ok: boolean; latencyMs: number; detail: string }> {
    return { ok: true, latencyMs: 1, detail: 'mock' }
  }
}

/** Resolve the payment provider by mode (ED-138 fail-safe). */
export function getPaymentProvider(): PaymentProvider {
  const { mode } = resolveMode('PAYMENT', CREDENTIAL_SPECS.PAYMENT)
  if (mode === 'live') {
    const merchantId = zarinpalMerchantId()
    if (merchantId) return new ZarinpalProvider(merchantId)
  }
  return new MockPaymentProvider()
}

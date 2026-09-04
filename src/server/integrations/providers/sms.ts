// ── BabaHakim Integration · SMS Provider (PHASE 13, ED-143) ───────────────
// Spec §32: every SMS persisted with recipient/template/content/provider/
// status/delivery/error. Closes the pre-13 integrity bug where notify()
// wrote KAVENEGAR/SENT/DELIVERED rows with ZERO network calls.
// Live: Kavenegar REST. Mock: deterministic + fault injection.
import { callIntegration, logSyntheticCall } from '../core/resilience'
import { resolveMode, smsSettings, smsProviderKey, CREDENTIAL_SPECS } from '../core/config'
import { IntegrationError, IntegrationErrorCode } from '../core/types'

export interface SendSmsInput {
  recipient: string // E.164-ish mobile, normalized
  message: string
  templateId?: string // provider template for transactional sends
}

export interface SendSmsResult {
  messageId: string
  status: 'SENT' | 'QUEUED'
  raw?: unknown
}

export interface SmsProvider {
  readonly name: string
  send(input: SendSmsInput): Promise<SendSmsResult>
  /** provider delivery lookup (best-effort; mock reports DELIVERED) */
  deliveryStatus(messageId: string): Promise<'DELIVERED' | 'QUEUED' | 'FAILED' | 'UNKNOWN'>
  healthCheck(): Promise<{ ok: boolean; latencyMs: number; detail: string }>
}

/** Kavenegar numeric error codes → integration taxonomy (subset). */
const KAVENEGAR_CODES: Record<number, IntegrationErrorCode> = {
  412: 'VALIDATION', // incorrect mobile
  417: 'VALIDATION', // SMS text invalid
  419: 'RATE_LIMIT', // quota exceeded
  42: 'RATE_LIMIT',  // daily send limit
  20: 'AUTH',        // API key invalid
  11: 'SERVER',
}

// ── Kavenegar live adapter ─────────────────────────────────────────────────
export class KavenegarProvider implements SmsProvider {
  readonly name = 'kavenegar'
  private apiKey: string
  private sender: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
    this.sender = smsSettings().sender
  }

  async send(input: SendSmsInput): Promise<SendSmsResult> {
    const res = await callIntegration<SendSmsResult>(
      'SMS', this.name, 'sms.send',
      async (signal) => {
        const form = new URLSearchParams({ receptor: input.recipient, message: input.message })
        if (this.sender) form.set('sender', this.sender)
        const r = await fetch(`https://api.kavenegar.com/v1/${this.apiKey}/sms/send.json`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
          body: form.toString(),
          signal,
        })
        if (r.status === 429) {
          const retryAfter = Number(r.headers.get('retry-after') || '') * 1000
          throw new IntegrationError({ code: 'RATE_LIMIT', kind: 'SMS', provider: this.name, operation: 'sms.send', message: 'Kavenegar rate limit', httpStatus: 429, retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined })
        }
        if (r.status === 401 || r.status === 403) throw new IntegrationError({ code: 'AUTH', kind: 'SMS', provider: this.name, operation: 'sms.send', message: 'Kavenegar auth failed', httpStatus: r.status })
        if (r.status >= 500) throw new IntegrationError({ code: 'SERVER', kind: 'SMS', provider: this.name, operation: 'sms.send', message: `Kavenegar HTTP ${r.status}`, httpStatus: r.status })
        const j = (await r.json()) as { return?: { status?: number; message?: string }; entries?: { messageid?: number }[] }
        const status = j?.return?.status
        if (status !== 200) {
          const code = KAVENEGAR_CODES[status ?? 0] ?? 'PROVIDER'
          throw new IntegrationError({ code, kind: 'SMS', provider: this.name, operation: 'sms.send', message: `Kavenegar ${status}: ${j?.return?.message ?? 'send rejected'}` })
        }
        return { messageId: String(j?.entries?.[0]?.messageid ?? ''), status: 'SENT', raw: { status } }
      },
      {
        // privacy (ED-137): PII stays in SMSLog only — the call log carries a
        // masked recipient (last 4) for correlation without duplication
        request: { recipientMasked: input.recipient.slice(-4), template: input.templateId, messageLen: input.message.length },
        related: input.templateId ? { type: 'NOTIFICATION', id: input.templateId } : undefined,
        policy: { retries: 2 },
      },
    )
    return res.value
  }

  async deliveryStatus(messageId: string): Promise<'DELIVERED' | 'QUEUED' | 'FAILED' | 'UNKNOWN'> {
    try {
      const res = await callIntegration<{ status: number }>('SMS', this.name, 'sms.status', async (signal) => {
        const r = await fetch(`https://api.kavenegar.com/v1/${this.apiKey}/sms/status.json?messageid=${encodeURIComponent(messageId)}`, { signal })
        if (!r.ok) return { status: -1 }
        const j = (await r.json()) as { entries?: { status?: number }[] }
        return { status: j?.entries?.[0]?.status ?? -1 }
      }, { policy: { retries: 1, idempotent: false } })
      const s = res.value.status
      if (s === 10) return 'DELIVERED'
      if (s === 1 || s === 2 || s === 3) return 'QUEUED'
      if (s === 14 || s === 4 || s === 5 || s === 6 || s === 13) return 'FAILED'
      return 'UNKNOWN'
    } catch {
      return 'UNKNOWN'
    }
  }

  async healthCheck(): Promise<{ ok: boolean; latencyMs: number; detail: string }> {
    const t0 = Date.now()
    try {
      await callIntegration('SMS', this.name, 'sms.health', async (signal) => {
        const r = await fetch(`https://api.kavenegar.com/v1/${this.apiKey}/account/info.json`, { signal })
        return r.status
      }, { policy: { retries: 0, timeoutMs: 6_000, idempotent: false } })
      return { ok: true, latencyMs: Date.now() - t0, detail: 'reachable' }
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - t0, detail: e instanceof Error ? e.message : 'unreachable' }
    }
  }
}

// ── Mock adapter ───────────────────────────────────────────────────────────
export class MockSmsProvider implements SmsProvider {
  readonly name = 'mock-kavenegar'
  private failNext = 0
  private slowNextMs = 0
  /** sent messages visible to tests */
  readonly sent: SendSmsInput[] = []

  failNextCalls(n: number): void { this.failNext = n }
  slowNextCalls(ms: number): void { this.slowNextMs = ms }
  reset(): void { this.failNext = 0; this.slowNextMs = 0; this.sent.length = 0 }

  async send(input: SendSmsInput): Promise<SendSmsResult> {
    if (this.slowNextMs > 0) { await new Promise((r) => setTimeout(r, this.slowNextMs)); this.slowNextMs = 0 }
    if (this.failNext > 0) {
      this.failNext -= 1
      await logSyntheticCall('SMS', this.name, 'sms.send', 'FAILED', { errorCode: 'SERVER', errorMessage: 'mock injected failure', related: { type: 'NOTIFICATION', id: input.templateId ?? '' } })
      throw new IntegrationError({ code: 'SERVER', kind: 'SMS', provider: this.name, operation: 'sms.send', message: 'mock injected failure' })
    }
    this.sent.push(input)
    await logSyntheticCall('SMS', this.name, 'sms.send', 'SUCCESS', { related: { type: 'NOTIFICATION', id: input.templateId ?? '' } })
    return { messageId: `mock-${this.sent.length}-${Date.now()}`, status: 'SENT', raw: { mock: true } }
  }

  async deliveryStatus(_messageId: string): Promise<'DELIVERED' | 'QUEUED' | 'FAILED' | 'UNKNOWN'> {
    return 'DELIVERED'
  }

  async healthCheck(): Promise<{ ok: boolean; latencyMs: number; detail: string }> {
    return { ok: true, latencyMs: 1, detail: 'mock' }
  }
}

/** Resolve the SMS provider by mode (ED-138 fail-safe). */
export function getSmsProvider(): SmsProvider {
  const { mode } = resolveMode('SMS', CREDENTIAL_SPECS.SMS)
  if (mode === 'live') {
    const key = smsProviderKey()
    if (key) return new KavenegarProvider(key)
  }
  return new MockSmsProvider()
}

// ── BabaHakim Integration · Email Provider (PHASE 13, ED-144) ─────────────
// Spec §31: Notification Engine channels include Email "if available".
// Live: generic HTTP mailer (Resend-compatible POST /send). Mock: recorded.
// The channel is opt-in via EMAIL_ENABLED (default off) — see ED-144.
import { callIntegration } from '../core/resilience'
import { resolveMode, emailSettings, emailApiKey, CREDENTIAL_SPECS } from '../core/config'
import { IntegrationError } from '../core/types'

export interface SendEmailInput {
  to: string
  subject: string
  text: string
  html?: string
}

export interface SendEmailResult {
  messageId: string
  raw?: unknown
}

export interface EmailProvider {
  readonly name: string
  send(input: SendEmailInput): Promise<SendEmailResult>
  healthCheck(): Promise<{ ok: boolean; latencyMs: number; detail: string }>
}

/** Is the email channel active at all? (opt-in — ED-144) */
export function emailChannelEnabled(): boolean {
  return emailSettings().enabled && resolveMode('EMAIL', CREDENTIAL_SPECS.EMAIL).mode === 'live'
}

// ── live adapter (Resend-compatible) ───────────────────────────────────────
export class HttpMailerProvider implements EmailProvider {
  readonly name = 'http-mailer'
  constructor(private url: string, private apiKey: string) {}

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const res = await callIntegration<SendEmailResult>(
      'EMAIL', this.name, 'email.send',
      async (signal) => {
        const r = await fetch(`${this.url.replace(/\/$/, '')}/send`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
          body: JSON.stringify({ from: emailSettings().from, to: [input.to], subject: input.subject, text: input.text, html: input.html }),
          signal,
        })
        if (r.status === 429) throw new IntegrationError({ code: 'RATE_LIMIT', kind: 'EMAIL', provider: this.name, operation: 'email.send', message: 'mailer rate limit', httpStatus: 429 })
        if (r.status === 401 || r.status === 403) throw new IntegrationError({ code: 'AUTH', kind: 'EMAIL', provider: this.name, operation: 'email.send', message: 'mailer auth failed', httpStatus: r.status })
        if (r.status >= 500) throw new IntegrationError({ code: 'SERVER', kind: 'EMAIL', provider: this.name, operation: 'email.send', message: `mailer HTTP ${r.status}`, httpStatus: r.status })
        if (!r.ok) throw new IntegrationError({ code: 'VALIDATION', kind: 'EMAIL', provider: this.name, operation: 'email.send', message: `mailer rejected: HTTP ${r.status}`, httpStatus: r.status })
        const j = (await r.json().catch(() => ({}))) as { id?: string }
        return { messageId: j.id ?? 'unknown', raw: { status: r.status } }
      },
      { request: { to: input.to, subject: input.subject }, policy: { retries: 2 } },
    )
    return res.value
  }

  async healthCheck(): Promise<{ ok: boolean; latencyMs: number; detail: string }> {
    // no standard health endpoint — a HEAD on base URL is enough for reachability
    const t0 = Date.now()
    try {
      await callIntegration('EMAIL', this.name, 'email.health', async (signal) => fetch(this.url, { method: 'HEAD', signal }).then((r) => r.status), { policy: { retries: 0, timeoutMs: 6_000, idempotent: false } })
      return { ok: true, latencyMs: Date.now() - t0, detail: 'reachable' }
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - t0, detail: e instanceof Error ? e.message : 'unreachable' }
    }
  }
}

// ── mock ───────────────────────────────────────────────────────────────────
export class MockEmailProvider implements EmailProvider {
  readonly name = 'mock-mailer'
  readonly outbox: SendEmailInput[] = []
  private failNext = 0

  failNextCalls(n: number): void { this.failNext = n }
  reset(): void { this.failNext = 0; this.outbox.length = 0 }

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    if (this.failNext > 0) {
      this.failNext -= 1
      throw new IntegrationError({ code: 'SERVER', kind: 'EMAIL', provider: this.name, operation: 'email.send', message: 'mock injected failure' })
    }
    this.outbox.push(input)
    return { messageId: `mock-email-${this.outbox.length}`, raw: { mock: true } }
  }

  async healthCheck(): Promise<{ ok: boolean; latencyMs: number; detail: string }> {
    return { ok: true, latencyMs: 1, detail: 'mock' }
  }
}

/** Resolve by mode. NOTE: even in live mode the channel stays off unless
 *  EMAIL_ENABLED=true (emailChannelEnabled above). */
export function getEmailProvider(): EmailProvider {
  const { mode } = resolveMode('EMAIL', CREDENTIAL_SPECS.EMAIL)
  if (mode === 'live') {
    const s = emailSettings()
    if (s.url) return new HttpMailerProvider(s.url, emailApiKey())
  }
  return new MockEmailProvider()
}

// ── BabaHakim Integration · CRM + Analytics Providers (PHASE 13, ED-149) ──
// CRM: contact sync (marketing/referral cohorts — spec Referral entity).
// Analytics: product usage events (fire-and-forget — never blocks a request).
// Both follow the same Adapter/Provider pattern; live adapters are thin HTTP
// clients behind the resilience stack, mocks record for tests.

// ═══════════════════════════ CRM ══════════════════════════════════════════
import { createHash } from 'crypto'
import { callIntegration, callIntegrationQuietly } from '../core/resilience'
import { resolveMode, CREDENTIAL_SPECS, crmSettings, crmApiKey, analyticsSettings, analyticsApiKey } from '../core/config'
import { IntegrationError } from '../core/types'

export interface CrmContact {
  userId: string
  name: string
  phone: string
  email?: string | null
  city?: string | null
  tags: string[] // e.g. 'patient', 'referral', 'followup-due'
}

export interface CrmProvider {
  readonly name: string
  upsertContact(contact: CrmContact): Promise<{ contactId: string }>
  recordEvent(contactId: string, event: string): Promise<void>
  healthCheck(): Promise<{ ok: boolean; latencyMs: number; detail: string }>
}

export class HttpCrmProvider implements CrmProvider {
  readonly name = 'http-crm'
  constructor(private url: string, private apiKey: string) {}

  async upsertContact(contact: CrmContact): Promise<{ contactId: string }> {
    const res = await callIntegration<{ contactId: string }>(
      'CRM', this.name, 'crm.upsert',
      async (signal) => {
        const r = await fetch(`${this.url.replace(/\/$/, '')}/contacts`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey },
          body: JSON.stringify({ externalId: contact.userId, name: contact.name, phone: contact.phone, email: contact.email, city: contact.city, tags: contact.tags }),
          signal,
        })
        if (r.status === 401 || r.status === 403) throw new IntegrationError({ code: 'AUTH', kind: 'CRM', provider: this.name, operation: 'crm.upsert', message: 'CRM auth failed', httpStatus: r.status })
        if (r.status >= 500) throw new IntegrationError({ code: 'SERVER', kind: 'CRM', provider: this.name, operation: 'crm.upsert', message: `CRM HTTP ${r.status}`, httpStatus: r.status })
        if (!r.ok) throw new IntegrationError({ code: 'VALIDATION', kind: 'CRM', provider: this.name, operation: 'crm.upsert', message: `CRM rejected contact (HTTP ${r.status})`, httpStatus: r.status })
        const j = (await r.json().catch(() => ({}))) as { id?: string }
        return { contactId: j.id ?? contact.userId }
      },
      { request: { userId: contact.userId, tags: contact.tags }, idempotencyKey: `crm:${contact.userId}`, policy: { retries: 2 } },
    )
    return res.value
  }

  async recordEvent(contactId: string, event: string): Promise<void> {
    await callIntegrationQuietly('CRM', this.name, 'crm.event', async (signal) => {
      await fetch(`${this.url.replace(/\/$/, '')}/contacts/${encodeURIComponent(contactId)}/events`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey },
        body: JSON.stringify({ event }), signal,
      })
      return { event }
    }, { request: { contactId, event }, policy: { retries: 1 } })
  }

  async healthCheck(): Promise<{ ok: boolean; latencyMs: number; detail: string }> {
    const t0 = Date.now()
    try {
      await callIntegration('CRM', this.name, 'crm.health', async (signal) => fetch(this.url, { method: 'HEAD', signal }).then((r) => r.status), { policy: { retries: 0, timeoutMs: 6_000, idempotent: false } })
      return { ok: true, latencyMs: Date.now() - t0, detail: 'reachable' }
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - t0, detail: e instanceof Error ? e.message : 'unreachable' }
    }
  }
}

export class MockCrmProvider implements CrmProvider {
  readonly name = 'mock-crm'
  readonly contacts = new Map<string, CrmContact>()
  readonly events: { contactId: string; event: string }[] = []
  private failNext = 0

  failNextCalls(n: number): void { this.failNext = n }
  reset(): void { this.failNext = 0; this.contacts.clear(); this.events.length = 0 }

  async upsertContact(contact: CrmContact): Promise<{ contactId: string }> {
    if (this.failNext > 0) { this.failNext -= 1; throw new IntegrationError({ code: 'SERVER', kind: 'CRM', provider: this.name, operation: 'crm.upsert', message: 'mock injected failure' }) }
    const id = createHash('sha256').update(`mock-crm:${contact.userId}`).digest('hex').slice(0, 12)
    this.contacts.set(id, contact)
    return { contactId: id }
  }

  async recordEvent(contactId: string, event: string): Promise<void> {
    this.events.push({ contactId, event })
  }

  async healthCheck(): Promise<{ ok: boolean; latencyMs: number; detail: string }> {
    return { ok: true, latencyMs: 1, detail: 'mock' }
  }
}

export function getCrmProvider(): CrmProvider {
  const { mode } = resolveMode('CRM', CREDENTIAL_SPECS.CRM)
  if (mode === 'live') {
    const url = crmSettings().url
    if (url) return new HttpCrmProvider(url, crmApiKey())
  }
  return new MockCrmProvider()
}

// ═══════════════════════════ Analytics ════════════════════════════════════
export interface AnalyticsEvent {
  event: string // e.g. 'case_created', 'order_paid'
  userId?: string | null
  props?: Record<string, string | number | boolean>
}

export interface AnalyticsProvider {
  readonly name: string
  track(event: AnalyticsEvent): Promise<void>
  healthCheck(): Promise<{ ok: boolean; latencyMs: number; detail: string }>
}

export class HttpAnalyticsProvider implements AnalyticsProvider {
  readonly name = 'http-analytics'
  constructor(private endpoint: string, private apiKey: string) {}

  async track(event: AnalyticsEvent): Promise<void> {
    // fire-and-forget: quiet wrapper — analytics NEVER breaks a request
    await callIntegrationQuietly('ANALYTICS', this.name, 'analytics.track', async (signal) => {
      await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey },
        body: JSON.stringify({ event: event.event, userId: event.userId, props: event.props, at: new Date().toISOString() }),
        signal,
      })
      return { event: event.event }
    }, { request: { event: event.event, userId: event.userId }, policy: { retries: 1, timeoutMs: 5_000 } })
  }

  async healthCheck(): Promise<{ ok: boolean; latencyMs: number; detail: string }> {
    return { ok: true, latencyMs: 0, detail: 'fire-and-forget' }
  }
}

export class MockAnalyticsProvider implements AnalyticsProvider {
  readonly name = 'mock-analytics'
  readonly events: AnalyticsEvent[] = []

  async track(event: AnalyticsEvent): Promise<void> {
    this.events.push(event)
  }

  async healthCheck(): Promise<{ ok: boolean; latencyMs: number; detail: string }> {
    return { ok: true, latencyMs: 1, detail: 'mock' }
  }
}

export function getAnalyticsProvider(): AnalyticsProvider {
  const { mode } = resolveMode('ANALYTICS', CREDENTIAL_SPECS.ANALYTICS)
  if (mode === 'live') {
    const endpoint = analyticsSettings().endpoint
    if (endpoint) return new HttpAnalyticsProvider(endpoint, analyticsApiKey())
  }
  return new MockAnalyticsProvider()
}

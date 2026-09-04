// ── BabaHakim Integration · Shipping Provider (PHASE 13, ED-148) ──────────
// Spec §29: courier registration + tracking (tracking_code, delivery status).
// No live courier contract is signed yet → the live adapter raises a clear
// NotImplemented error ONLY if explicitly forced to LIVE (ED-138 fail-safe
// keeps AUTO deployments on the mock). Mock: deterministic tracking code and
// time-based status progression so order flows are fully exercisable.
import { createHash } from 'crypto'
import { callIntegration } from '../core/resilience'
import { resolveMode, CREDENTIAL_SPECS, shippingSettings, shippingApiKey } from '../core/config'
import { IntegrationError } from '../core/types'

export interface RegisterShipmentInput {
  orderId: string
  method: 'MOTORCYCLE' | 'CAR' | 'POST'
  receiverName: string
  receiverPhone: string
  address: string
  postalCode: string
  itemsCount: number
}

export interface RegisterShipmentResult {
  trackingCode: string
  estimatedDeliveryAt: string
  raw?: unknown
}

export type ShipmentTrackStatus = 'REGISTERED' | 'PICKED_UP' | 'IN_TRANSIT' | 'DELIVERED' | 'FAILED'

export interface TrackShipmentResult {
  status: ShipmentTrackStatus
  events: { at: string; code: string; noteFa: string }[]
  raw?: unknown
}

export interface ShippingProvider {
  readonly name: string
  registerShipment(input: RegisterShipmentInput): Promise<RegisterShipmentResult>
  trackShipment(trackingCode: string): Promise<TrackShipmentResult>
  healthCheck(): Promise<{ ok: boolean; latencyMs: number; detail: string }>
}

/** Live courier adapter — reserved until a real API contract exists (D-13-3). */
export class HttpCourierProvider implements ShippingProvider {
  readonly name = 'http-courier'
  constructor(private url: string, private apiKey: string) {}

  private notImplemented(operation: string): never {
    throw new IntegrationError({
      code: 'PROVIDER', kind: 'SHIPPING', provider: this.name, operation,
      message: `live courier contract not implemented yet (provider URL ${this.url}) — keep SHIPPING on mock (D-13-3)`,
    })
  }

  async registerShipment(_input: RegisterShipmentInput): Promise<RegisterShipmentResult> {
    this.notImplemented('shipping.register')
  }

  async trackShipment(_trackingCode: string): Promise<TrackShipmentResult> {
    this.notImplemented('shipping.track')
  }

  async healthCheck(): Promise<{ ok: boolean; latencyMs: number; detail: string }> {
    return { ok: false, latencyMs: 0, detail: 'live courier adapter not implemented (D-13-3)' }
  }
}

// ── mock: deterministic, time-progressive ─────────────────────────────────
const TRACK_STATUS_LADDER: { afterMs: number; status: ShipmentTrackStatus; noteFa: string }[] = [
  { afterMs: 0, status: 'REGISTERED', noteFa: 'مرسوله در سیستم ثبت شد' },
  { afterMs: 60_000, status: 'PICKED_UP', noteFa: 'مرسوله تحویل پیک/پست شد' },
  { afterMs: 300_000, status: 'IN_TRANSIT', noteFa: 'مرسوله در مسیر است' },
  { afterMs: 3_600_000, status: 'DELIVERED', noteFa: 'مرسوله تحویل داده شد' },
]

export class MockShippingProvider implements ShippingProvider {
  readonly name = 'mock-courier'
  /** registeredAt by tracking code — visible to tests */
  readonly registered = new Map<string, number>()
  private failNext = 0

  failNextCalls(n: number): void { this.failNext = n }
  reset(): void { this.failNext = 0; this.registered.clear() }

  private hash(seed: string): string {
    return createHash('sha256').update(`mock-shipping:${seed}`).digest('hex')
  }

  async registerShipment(input: RegisterShipmentInput): Promise<RegisterShipmentResult> {
    if (this.failNext > 0) {
      this.failNext -= 1
      throw new IntegrationError({ code: 'SERVER', kind: 'SHIPPING', provider: this.name, operation: 'shipping.register', message: 'mock injected failure' })
    }
    const trackingCode = `TRK-${this.hash(input.orderId).slice(0, 10).toUpperCase()}`
    this.registered.set(trackingCode, Date.now())
    return {
      trackingCode,
      estimatedDeliveryAt: new Date(Date.now() + 86_400_000).toISOString(),
      raw: { mock: true },
    }
  }

  async trackShipment(trackingCode: string): Promise<TrackShipmentResult> {
    const t0 = this.registered.get(trackingCode)
    if (!t0) return { status: 'FAILED', events: [], raw: { unknown: true } }
    const elapsed = Date.now() - t0
    const events = TRACK_STATUS_LADDER
      .filter((s) => elapsed >= s.afterMs)
      .map((s) => ({ at: new Date(t0 + s.afterMs).toISOString(), code: s.status, noteFa: s.noteFa }))
    const status = events.length > 0 ? events[events.length - 1].code as ShipmentTrackStatus : 'REGISTERED'
    return { status, events, raw: { mock: true } }
  }

  async healthCheck(): Promise<{ ok: boolean; latencyMs: number; detail: string }> {
    return { ok: true, latencyMs: 1, detail: 'mock' }
  }
}

export function getShippingProvider(): ShippingProvider {
  const { mode } = resolveMode('SHIPPING', CREDENTIAL_SPECS.SHIPPING)
  if (mode === 'live') {
    const url = shippingSettings().url
    if (url) return new HttpCourierProvider(url, shippingApiKey())
  }
  return new MockShippingProvider()
}

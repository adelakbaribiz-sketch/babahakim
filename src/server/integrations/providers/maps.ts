// ── BabaHakim Integration · Maps Provider (PHASE 13, ED-145) ──────────────
// Purpose: address/postal validation for shipping (spec §29 postal_code) —
// geocode an address to coordinates + a normalized form. Live: OSM Nominatim
// (key-less; usage policy requires a real User-Agent, set via MAPS_USER_AGENT).
// Mock: deterministic coordinates within Tehran bounds for testing.
import { createHash } from 'crypto'
import { callIntegration } from '../core/resilience'
import { resolveMode, mapsSettings, CREDENTIAL_SPECS } from '../core/config'
import { IntegrationError } from '../core/types'

export interface GeocodeInput {
  address: string
  postalCode?: string | null
}

export interface GeocodeResult {
  lat: number
  lng: number
  formatted: string
  valid: boolean
  raw?: unknown
}

export interface MapsProvider {
  readonly name: string
  geocode(input: GeocodeInput): Promise<GeocodeResult>
  healthCheck(): Promise<{ ok: boolean; latencyMs: number; detail: string }>
}

// ── Nominatim live adapter ─────────────────────────────────────────────────
export class NominatimProvider implements MapsProvider {
  readonly name = 'nominatim'
  private userAgent: string

  constructor() {
    this.userAgent = mapsSettings().userAgent
  }

  async geocode(input: GeocodeInput): Promise<GeocodeResult> {
    const res = await callIntegration<GeocodeResult>(
      'MAPS', this.name, 'maps.geocode',
      async (signal) => {
        const q = encodeURIComponent(input.postalCode ? `${input.address}, ${input.postalCode}` : input.address)
        const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&accept-language=fa`, {
          headers: { 'user-agent': this.userAgent, accept: 'application/json' },
          signal,
        })
        if (r.status === 403) throw new IntegrationError({ code: 'AUTH', kind: 'MAPS', provider: this.name, operation: 'maps.geocode', message: 'Nominatim blocked the User-Agent (policy)', httpStatus: 403 })
        if (r.status >= 500) throw new IntegrationError({ code: 'SERVER', kind: 'MAPS', provider: this.name, operation: 'maps.geocode', message: `Nominatim HTTP ${r.status}`, httpStatus: r.status })
        if (r.status === 429) throw new IntegrationError({ code: 'RATE_LIMIT', kind: 'MAPS', provider: this.name, operation: 'maps.geocode', message: 'Nominatim rate limit (1 req/s policy)', httpStatus: 429 })
        const j = (await r.json()) as { lat?: string; lon?: string; display_name?: string }[]
        const hit = Array.isArray(j) ? j[0] : undefined
        if (!hit?.lat || !hit?.lon) return { lat: 0, lng: 0, formatted: '', valid: false, raw: { count: (j as unknown[])?.length ?? 0 } }
        return { lat: Number(hit.lat), lng: Number(hit.lon), formatted: hit.display_name ?? '', valid: true, raw: { name: hit.display_name } }
      },
      // privacy (ED-137): no raw address/postal in the call log — length + last 3
      { request: { addressLen: input.address.length, postalMasked: input.postalCode ? input.postalCode.slice(-3) : null }, policy: { retries: 1 } },
    )
    return res.value
  }

  async healthCheck(): Promise<{ ok: boolean; latencyMs: number; detail: string }> {
    const t0 = Date.now()
    try {
      await callIntegration('MAPS', this.name, 'maps.health', async (signal) => {
        const r = await fetch('https://nominatim.openstreetmap.org/status?format=json', { headers: { 'user-agent': this.userAgent }, signal })
        return r.status
      }, { policy: { retries: 0, timeoutMs: 6_000, idempotent: false } })
      return { ok: true, latencyMs: Date.now() - t0, detail: 'reachable' }
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - t0, detail: e instanceof Error ? e.message : 'unreachable' }
    }
  }
}

// ── mock (deterministic) ───────────────────────────────────────────────────
export class MockMapsProvider implements MapsProvider {
  readonly name = 'mock-nominatim'
  private failNext = 0

  failNextCalls(n: number): void { this.failNext = n }
  reset(): void { this.failNext = 0 }

  async geocode(input: GeocodeInput): Promise<GeocodeResult> {
    if (this.failNext > 0) {
      this.failNext -= 1
      throw new IntegrationError({ code: 'SERVER', kind: 'MAPS', provider: this.name, operation: 'maps.geocode', message: 'mock injected failure' })
    }
    const h = parseInt(createHash('sha256').update(`mock-maps:${input.address}:${input.postalCode ?? ''}`).digest('hex').slice(0, 8), 16)
    if (!input.address.trim()) return { lat: 0, lng: 0, formatted: '', valid: false }
    return {
      lat: 35.65 + (h % 1000) / 10_000,   // ~35.65..35.75 N
      lng: 51.30 + ((h >> 10) % 1000) / 10_000, // ~51.30..51.40 E
      formatted: `تهران — ${input.address}`,
      valid: true,
      raw: { mock: true },
    }
  }

  async healthCheck(): Promise<{ ok: boolean; latencyMs: number; detail: string }> {
    return { ok: true, latencyMs: 1, detail: 'mock' }
  }
}

export function getMapsProvider(): MapsProvider {
  const { mode } = resolveMode('MAPS', CREDENTIAL_SPECS.MAPS)
  if (mode === 'live') return new NominatimProvider()
  return new MockMapsProvider()
}

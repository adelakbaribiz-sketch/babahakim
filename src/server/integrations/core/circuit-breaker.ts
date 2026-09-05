// ── BabaHakim External Integration Core · Circuit Breaker (PHASE 13) ──────
// Per (kind, provider) breaker: CLOSED → OPEN (N consecutive failures) →
// HALF_OPEN (cooldown elapsed, one probe) → CLOSED on success / OPEN again.
// OPEN = fail fast without touching the provider (protects user latency and
// the provider from retry storms). In-memory + HMR-safe global: fine for the
// single-process deployment; multi-instance needs Redis (documented D-13-2).
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN'

interface BreakerEntry {
  state: CircuitState
  consecutiveFailures: number
  openedAt: number        // ms epoch
  lastFailureAt: number | null
  lastFailureCode?: string
  probeInFlight: boolean
}

const g = globalThis as unknown as { __bhIntegrationBreakers?: Map<string, BreakerEntry> }
const breakers: Map<string, BreakerEntry> = g.__bhIntegrationBreakers ?? new Map()
g.__bhIntegrationBreakers = breakers

function key(kind: string, provider: string): string {
  return `${kind}:${provider}`
}

function entryFor(kind: string, provider: string): BreakerEntry {
  const k = key(kind, provider)
  let e = breakers.get(k)
  if (!e) {
    e = { state: 'CLOSED', consecutiveFailures: 0, openedAt: 0, lastFailureAt: null, probeInFlight: false }
    breakers.set(k, e)
  }
  return e
}

export interface CircuitSnapshot {
  state: CircuitState
  consecutiveFailures: number
  openedAt: number | null
  lastFailureCode?: string
}

export function circuitSnapshot(kind: string, provider: string): CircuitSnapshot {
  const e = entryFor(kind, provider)
  // lazily transition OPEN → HALF_OPEN once cooldown elapsed
  return { state: e.state, consecutiveFailures: e.consecutiveFailures, openedAt: e.state === 'OPEN' ? e.openedAt : null, lastFailureCode: e.lastFailureCode }
}

/** May a call pass right now? (false = breaker OPEN, fail fast) */
export function canPass(kind: string, provider: string, threshold: number, cooldownMs: number): boolean {
  const e = entryFor(kind, provider)
  if (e.state === 'CLOSED') return true
  if (e.state === 'OPEN') {
    if (Date.now() - e.openedAt >= cooldownMs) {
      e.state = 'HALF_OPEN'
      e.probeInFlight = true
      return true // single probe allowed
    }
    return false
  }
  // HALF_OPEN: only the probe may pass
  return e.probeInFlight
}

export function recordSuccess(kind: string, provider: string): void {
  const e = entryFor(kind, provider)
  e.state = 'CLOSED'
  e.consecutiveFailures = 0
  e.probeInFlight = false
}

/** returns true when this failure CAUSED the breaker to open */
export function recordFailure(kind: string, provider: string, threshold: number, code: string): boolean {
  const e = entryFor(kind, provider)
  e.consecutiveFailures += 1
  e.lastFailureAt = Date.now()
  e.lastFailureCode = code
  e.probeInFlight = false
  if (e.state === 'HALF_OPEN' || e.consecutiveFailures >= threshold) {
    const wasOpen = e.state === 'OPEN'
    e.state = 'OPEN'
    e.openedAt = Date.now()
    return !wasOpen || e.consecutiveFailures === threshold
  }
  return false
}

/** ADMIN smoke-test helper: reset breaker state for a provider. */
export function resetCircuit(kind: string, provider: string): void {
  breakers.delete(key(kind, provider))
}

/** All breaker states (admin overview). */
export function allCircuits(): Record<string, CircuitSnapshot> {
  const out: Record<string, CircuitSnapshot> = {}
  for (const [k, e] of breakers) {
    out[k] = { state: e.state, consecutiveFailures: e.consecutiveFailures, openedAt: e.state === 'OPEN' ? e.openedAt : null, lastFailureCode: e.lastFailureCode }
  }
  return out
}

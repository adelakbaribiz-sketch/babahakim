// ── BabaHakim External Integration Core · Types (PHASE 13, ED-135) ────────
// Canonical vocabulary shared by every adapter in the Provider Layer.
// Nine integration kinds (audit scope of the PHASE 13 command):
//   PAYMENT · SMS · EMAIL · MAPS · AI · STORAGE · SHIPPING · CRM · ANALYTICS
export const INTEGRATION_KINDS = [
  'PAYMENT', 'SMS', 'EMAIL', 'MAPS', 'AI', 'STORAGE', 'SHIPPING', 'CRM', 'ANALYTICS',
] as const

export type IntegrationKind = (typeof INTEGRATION_KINDS)[number]

/** Adapter execution mode. AUTO = live only when credentials are complete. */
export type IntegrationMode = 'LIVE' | 'MOCK' | 'AUTO'

/** Resolved mode actually used by the registry (never 'AUTO' at runtime). */
export type ResolvedMode = 'live' | 'mock'

/** Error taxonomy — drives retry classification and failure handling. */
export type IntegrationErrorCode =
  | 'TIMEOUT'        // deadline exceeded (resilience wrapper)
  | 'NETWORK'        // fetch/ECONN/DNS failure — retryable
  | 'RATE_LIMIT'     // HTTP 429 — retryable with backoff
  | 'SERVER'         // provider 5xx — retryable
  | 'AUTH'           // 401/403 — credential problem, NOT retryable
  | 'VALIDATION'     // 4xx business rejection — NOT retryable
  | 'PROVIDER'       // provider-level logical failure (parsed error body)
  | 'CIRCUIT_OPEN'   // fail-fast before the call (breaker open)
  | 'PARSE'          // response did not match the expected shape

/** Is this error class worth another attempt? (BR-INT-04) */
export function isRetryableCode(code: IntegrationErrorCode): boolean {
  return code === 'TIMEOUT' || code === 'NETWORK' || code === 'RATE_LIMIT' || code === 'SERVER'
}

/** Uniform integration error — one shape for logs, telemetry and UI. */
export class IntegrationError extends Error {
  readonly code: IntegrationErrorCode
  readonly kind: IntegrationKind
  readonly provider: string
  readonly operation: string
  readonly httpStatus?: number
  readonly attempt: number
  readonly retryAfterMs?: number
  /** true when the resilience layer served a fallback instead of throwing */
  readonly degraded: boolean

  constructor(init: {
    code: IntegrationErrorCode, kind: IntegrationKind, provider: string, operation: string,
    message: string, httpStatus?: number, attempt?: number, retryAfterMs?: number, degraded?: boolean,
  }) {
    super(init.message)
    this.name = 'IntegrationError'
    this.code = init.code
    this.kind = init.kind
    this.provider = init.provider
    this.operation = init.operation
    this.httpStatus = init.httpStatus
    this.attempt = init.attempt ?? 1
    this.retryAfterMs = init.retryAfterMs
    this.degraded = init.degraded ?? false
  }
}

/** Resilience policy — the 8 cross-cutting concerns in one object. */
export interface ResiliencePolicy {
  /** hard deadline per ATTEMPT (ms) — concern #1 Timeout */
  timeoutMs: number
  /** extra attempts after the first (0 = single shot) — concern #2 Retry */
  retries: number
  /** exponential backoff base (ms), jittered ±30% */
  backoffBaseMs: number
  /** max backoff per retry (ms) */
  backoffMaxMs: number
  /** enable DB-backed idempotent replay — concern #3 Idempotency */
  idempotent: boolean
  /** consecutive failures before the breaker opens — concern #8 Fallback/fast-fail */
  circuitThreshold: number
  /** breaker cooldown before a half-open probe (ms) */
  circuitCooldownMs: number
}

/** Default policies per kind (sane production values; overridable per call). */
export const DEFAULT_POLICIES: Record<IntegrationKind, ResiliencePolicy> = {
  // money path: generous deadline, no blind retries (idempotency guard first)
  PAYMENT:    { timeoutMs: 15_000, retries: 1, backoffBaseMs: 500, backoffMaxMs: 2_000, idempotent: true,  circuitThreshold: 4, circuitCooldownMs: 120_000 },
  SMS:        { timeoutMs: 10_000, retries: 2, backoffBaseMs: 400, backoffMaxMs: 3_200, idempotent: true,  circuitThreshold: 6, circuitCooldownMs: 60_000 },
  EMAIL:      { timeoutMs: 10_000, retries: 2, backoffBaseMs: 400, backoffMaxMs: 3_200, idempotent: true,  circuitThreshold: 6, circuitCooldownMs: 60_000 },
  MAPS:       { timeoutMs: 8_000,  retries: 1, backoffBaseMs: 300, backoffMaxMs: 1_200, idempotent: false, circuitThreshold: 8, circuitCooldownMs: 30_000 },
  AI:         { timeoutMs: 30_000, retries: 1, backoffBaseMs: 800, backoffMaxMs: 3_000, idempotent: true,  circuitThreshold: 5, circuitCooldownMs: 90_000 },
  STORAGE:    { timeoutMs: 20_000, retries: 1, backoffBaseMs: 500, backoffMaxMs: 2_000, idempotent: false, circuitThreshold: 8, circuitCooldownMs: 60_000 },
  SHIPPING:   { timeoutMs: 12_000, retries: 2, backoffBaseMs: 500, backoffMaxMs: 4_000, idempotent: true,  circuitThreshold: 5, circuitCooldownMs: 90_000 },
  CRM:        { timeoutMs: 8_000,  retries: 2, backoffBaseMs: 300, backoffMaxMs: 2_000, idempotent: true,  circuitThreshold: 8, circuitCooldownMs: 60_000 },
  // fire-and-forget by design: failures never bubble (concern #8)
  ANALYTICS:  { timeoutMs: 5_000,  retries: 1, backoffBaseMs: 200, backoffMaxMs: 800,  idempotent: false, circuitThreshold: 10, circuitCooldownMs: 30_000 },
}

/** Call context persisted to IntegrationCallLog (redacted before persist). */
export interface IntegrationCallMeta {
  idempotencyKey?: string
  related?: { type: string; id: string }
}

/** Result envelope for idempotent replay: value re-hydrated from the log. */
export interface IntegrationCallResult<T> {
  value: T
  replayed: boolean
  degraded: boolean
  attempts: number
  latencyMs: number
}

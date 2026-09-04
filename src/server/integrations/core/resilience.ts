// ── BabaHakim External Integration Core · Resilience (PHASE 13, ED-140) ───
// THE wrapper every live adapter call goes through. Implements the 8
// cross-cutting concerns mandated by the PHASE 13 command:
//   1 Timeout     — hard per-attempt deadline (AbortSignal + race)
//   2 Retry       — classified (network/timeout/429/5xx only), exp backoff
//                   with jitter, honors Retry-After
//   3 Idempotency — DB-backed SUCCESS replay via unique(provider,operation,key)
//   4 ErrorHandling — uniform IntegrationError taxonomy (BR-INT-04)
//   5 Logging     — structured, REDACTED payloads (ED-137)
//   6 Monitoring  — in-memory telemetry ring + durable IntegrationCallLog
//   7 Fallback    — optional provider fallback + circuit fail-fast
//   8 Circuit     — per (kind,provider) breaker (circuit-breaker.ts)
//
// Callers never see raw fetch/timeout semantics: they get values or an
// IntegrationError with a stable code. DB writes are best-effort — telemetry
// outages must NEVER break a business flow.
import { db } from '@/lib/db'
import { childLogger } from '@/server/core/logger'
import {
  DEFAULT_POLICIES, IntegrationError, IntegrationKind, IntegrationErrorCode,
  isRetryableCode, IntegrationCallResult, ResiliencePolicy,
} from './types'
import { redactedJson } from './config'
import { canPass, recordFailure, recordSuccess } from './circuit-breaker'
import { pushRecord } from './telemetry'

const log = childLogger({ svc: 'integrations' })

export interface CallOptions<T> {
  /** raw request payload (REDACTED before any persistence — ED-137) */
  request?: unknown
  /** idempotency key — enables SUCCESS replay (concern #3) */
  idempotencyKey?: string
  related?: { type: string; id: string }
  /** policy overrides on top of DEFAULT_POLICIES[kind] */
  policy?: Partial<ResiliencePolicy>
  /**
   * Concern #7 Fallback: served when the call fails terminally (or the
   * circuit is open). The fallback result is marked degraded in telemetry.
   * Keep fallbacks to SAME-CONTRACT local behavior (e.g. mock provider),
   * never a silently-different business outcome.
   */
  fallback?: () => T | Promise<T>
}

/** Classify an HTTP status into the error taxonomy (BR-INT-04). */
export function classifyHttpStatus(status: number): IntegrationErrorCode {
  if (status === 429) return 'RATE_LIMIT'
  if (status >= 500) return 'SERVER'
  if (status === 401 || status === 403) return 'AUTH'
  if (status >= 400) return 'VALIDATION'
  return 'PROVIDER'
}

/** Classify a thrown fetch-level error. */
export function classifyNetworkError(e: unknown): IntegrationErrorCode {
  const name = (e as { name?: string })?.name || ''
  const msg = e instanceof Error ? e.message : String(e)
  if (name === 'AbortError' || name === 'TimeoutError') return 'TIMEOUT'
  if (/ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|network/i.test(msg)) return 'NETWORK'
  return 'PROVIDER'
}

function backoffDelay(base: number, cap: number, attempt: number): number {
  const exp = Math.min(cap, base * 2 ** Math.max(0, attempt - 1))
  const jitter = 0.7 + Math.random() * 0.6 // ±30%
  return Math.round(exp * jitter)
}

/** Persist one call row (best-effort). */
async function persist(row: {
  kind: IntegrationKind, provider: string, operation: string, idempotencyKey?: string,
  status: string, attempts: number, latencyMs?: number, httpStatus?: number,
  errorCode?: string, errorMessage?: string, requestRedacted?: string | null, responseRedacted?: string | null,
  relatedType?: string | null, relatedId?: string | null,
}): Promise<void> {
  try {
    // non-SUCCESS rows with the same idempotency key must not block a retry
    if (row.idempotencyKey) {
      await db.integrationCallLog.deleteMany({
        where: { provider: row.provider, operation: row.operation, idempotencyKey: row.idempotencyKey, status: { not: 'SUCCESS' } },
      })
    }
    await db.integrationCallLog.create({
      data: {
        kind: row.kind, provider: row.provider, operation: row.operation,
        idempotencyKey: row.idempotencyKey ?? null, status: row.status, attempts: row.attempts,
        latencyMs: row.latencyMs ?? null, httpStatus: row.httpStatus ?? null,
        errorCode: row.errorCode ?? null, errorMessage: (row.errorMessage ?? null)?.slice(0, 500) ?? null,
        requestRedacted: row.requestRedacted ?? null, responseRedacted: row.responseRedacted ?? null,
        relatedType: row.relatedType ?? null, relatedId: row.relatedId ?? null,
      },
    })
  } catch (e) {
    // unique-race on concurrent identical calls → replay path will resolve it
    // any other failure: telemetry must not break business flow
    log.warn('integration call-log write failed', { op: row.operation, error: e instanceof Error ? e.message : String(e) })
  }
}

async function findPriorSuccess(provider: string, operation: string, key: string): Promise<{ responseRedacted: string | null } | null> {
  try {
    return await db.integrationCallLog.findFirst({
      where: { provider, operation, idempotencyKey: key, status: 'SUCCESS' },
      select: { responseRedacted: true },
    })
  } catch {
    return null
  }
}

/**
 * Execute an external call with the full resilience stack.
 *
 * @param fn receives (abortSignal, attemptNumber) — pass the signal to fetch.
 * @returns value + execution metadata (replayed/degraded/attempts/latency)
 */
export async function callIntegration<T>(
  kind: IntegrationKind, provider: string, operation: string,
  fn: (signal: AbortSignal, attempt: number) => Promise<T>,
  opts: CallOptions<T> = {},
): Promise<IntegrationCallResult<T>> {
  const policy: ResiliencePolicy = { ...DEFAULT_POLICIES[kind], ...opts.policy }
  const started = Date.now()

  // ── concern #3: idempotent replay (before ANY external call) ────────────
  if (policy.idempotent && opts.idempotencyKey) {
    const prior = await findPriorSuccess(provider, operation, opts.idempotencyKey)
    if (prior?.responseRedacted) {
      try {
        const value = JSON.parse(prior.responseRedacted) as T
        pushRecord({ at: started, kind, provider, operation, status: 'REPLAYED', attempts: 0, latencyMs: Date.now() - started })
        log.info('integration replay (idempotent)', { kind, provider, operation, key: opts.idempotencyKey })
        return { value, replayed: true, degraded: false, attempts: 0, latencyMs: Date.now() - started }
      } catch {
        // stored payload unparseable → fall through to a real call
      }
    }
  }

  // ── concern #7/#8: circuit fail-fast ────────────────────────────────────
  if (!canPass(kind, provider, policy.circuitThreshold, policy.circuitCooldownMs)) {
    pushRecord({ at: started, kind, provider, operation, status: 'SKIPPED_CIRCUIT', attempts: 0, latencyMs: 0, errorCode: 'CIRCUIT_OPEN' })
    await persist({ kind, provider, operation, idempotencyKey: opts.idempotencyKey, status: 'SKIPPED_CIRCUIT', attempts: 0, latencyMs: 0, errorCode: 'CIRCUIT_OPEN', errorMessage: 'circuit open — call skipped', requestRedacted: redactedJson(opts.request), relatedType: opts.related?.type, relatedId: opts.related?.id })
    if (opts.fallback) {
      const value = await opts.fallback()
      const latencyMs = Date.now() - started
      pushRecord({ at: started, kind, provider, operation, status: 'FALLBACK', attempts: 0, latencyMs, errorCode: 'CIRCUIT_OPEN' })
      log.warn('integration degraded → fallback (circuit open)', { kind, provider, operation })
      return { value, replayed: false, degraded: true, attempts: 0, latencyMs }
    }
    throw new IntegrationError({ code: 'CIRCUIT_OPEN', kind, provider, operation, message: `${provider} circuit is open — failing fast`, attempt: 0 })
  }

  const maxAttempts = policy.retries + 1
  let lastError: IntegrationError | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const attemptStart = Date.now()
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort()
          reject(new IntegrationError({ code: 'TIMEOUT', kind, provider, operation, message: `${operation} timed out after ${policy.timeoutMs}ms (attempt ${attempt})`, attempt }))
        }, policy.timeoutMs)
      })
      const value = await Promise.race([fn(controller.signal, attempt), timeoutPromise])
      clearTimeout(timer)

      // ── success path ────────────────────────────────────────────────────
      recordSuccess(kind, provider)
      const latencyMs = Date.now() - started
      const responseRedacted = redactedJson(value)
      pushRecord({ at: attemptStart, kind, provider, operation, status: 'SUCCESS', attempts: attempt, latencyMs: Date.now() - attemptStart })
      await persist({ kind, provider, operation, idempotencyKey: opts.idempotencyKey, status: 'SUCCESS', attempts: attempt, latencyMs, requestRedacted: redactedJson(opts.request), responseRedacted, relatedType: opts.related?.type, relatedId: opts.related?.id })
      log.info('integration call ok', { kind, provider, operation, attempt, latencyMs })
      return { value, replayed: false, degraded: false, attempts: attempt, latencyMs }
    } catch (e) {
      clearTimeout(timer)
      const isIntErr = e instanceof IntegrationError
      const code: IntegrationErrorCode = isIntErr
        ? e.code
        : e instanceof Error && /HTTP \d/.test(e.message)
          ? classifyHttpStatus(Number(/HTTP (\d+)/.exec(e.message)?.[1]))
          : classifyNetworkError(e)
      const httpStatus = isIntErr ? e.httpStatus : undefined
      lastError = new IntegrationError({
        code, kind, provider, operation,
        message: e instanceof Error ? e.message : String(e),
        httpStatus, attempt,
        retryAfterMs: isIntErr ? e.retryAfterMs : undefined,
      })

      const retryable = isRetryableCode(code)
      const opened = recordFailure(kind, provider, policy.circuitThreshold, code)
      if (opened) log.error('integration circuit OPENED', { kind, provider, code, consecutive: policy.circuitThreshold })
      log.warn('integration attempt failed', { kind, provider, operation, attempt, code, retryable, error: lastError.message })

      const willRetry = retryable && attempt < maxAttempts
      if (willRetry) {
        // Retry-After (429) beats backoff when present
        const delay = lastError.retryAfterMs ?? backoffDelay(policy.backoffBaseMs, policy.backoffMaxMs, attempt)
        await new Promise((r) => setTimeout(r, delay))
        continue
      }
      break // terminal failure
    }
  }

  // ── terminal failure → fallback or throw (concerns #4/#7) ───────────────
  const latencyMs = Date.now() - started
  const err = lastError ?? new IntegrationError({ code: 'PROVIDER', kind, provider, operation, message: 'integration call failed' })
  pushRecord({ at: started, kind, provider, operation, status: 'FAILED', attempts: err.attempt, latencyMs, httpStatus: err.httpStatus, errorCode: err.code, errorMessage: err.message })
  await persist({
    kind, provider, operation, idempotencyKey: opts.idempotencyKey, status: 'FAILED', attempts: err.attempt,
    latencyMs, httpStatus: err.httpStatus, errorCode: err.code, errorMessage: err.message,
    requestRedacted: redactedJson(opts.request), relatedType: opts.related?.type, relatedId: opts.related?.id,
  })
  if (opts.fallback) {
    try {
      const value = await opts.fallback()
      pushRecord({ at: started, kind, provider, operation, status: 'FALLBACK', attempts: err.attempt, latencyMs, errorCode: err.code, errorMessage: err.message })
      log.warn('integration degraded → fallback', { kind, provider, operation, code: err.code })
      return { value, replayed: false, degraded: true, attempts: err.attempt, latencyMs }
    } catch (fbError) {
      log.error('integration fallback ALSO failed', { kind, provider, operation, error: fbError instanceof Error ? fbError.message : String(fbError) })
    }
  }
  err.message = humanize(kind, err)
  throw err
}

/** Persian user-facing text for terminal integration errors (ED-141). */
function humanize(kind: IntegrationKind, e: IntegrationError): string {
  switch (kind) {
    case 'PAYMENT': return 'درگاه پرداخت در حال حاضر پاسخگو نیست. لطفاً چند لحظه بعد دوباره تلاش کنید.'
    case 'SMS': return 'ارسال پیامک با خطا مواجه شد.'
    case 'EMAIL': return 'ارسال ایمیل با خطا مواجه شد.'
    case 'AI': return 'سرویس تحلیل هوش مصنوعی موقتاً در دسترس نیست.'
    case 'SHIPPING': return 'سرویس ارسال موقتاً در دسترس نیست.'
    default: return `سرویس خارجی (${e.provider}) موقتاً در دسترس نیست.`
  }
}

/** Fire-and-forget variant — for ANALYTICS-style calls that must never throw. */
export async function callIntegrationQuietly<T>(
  kind: IntegrationKind, provider: string, operation: string,
  fn: (signal: AbortSignal, attempt: number) => Promise<T>,
  opts: CallOptions<T> = {},
): Promise<T | null> {
  try {
    const r = await callIntegration(kind, provider, operation, fn, opts)
    return r.value
  } catch {
    return null
  }
}

/**
 * PHASE 13: telemetry-only log entry for MOCK adapters (no retry/timeout
 * semantics — mocks are deterministic). Keeps the admin console informative
 * in mock mode: traffic, latencies and failures are visible exactly as they
 * would be for live adapters (ED-139 observability parity).
 */
export async function logSyntheticCall(
  kind: IntegrationKind, provider: string, operation: string,
  status: 'SUCCESS' | 'FAILED', extra?: { errorMessage?: string; errorCode?: string; related?: { type: string; id: string } },
): Promise<void> {
  const at = Date.now()
  pushRecord({ at, kind, provider, operation, status, attempts: 1, latencyMs: 1, errorCode: extra?.errorCode, errorMessage: extra?.errorMessage })
  await persist({ kind, provider, operation, status, attempts: 1, latencyMs: 1, errorCode: extra?.errorCode, errorMessage: extra?.errorMessage, relatedType: extra?.related?.type, relatedId: extra?.related?.id })
}

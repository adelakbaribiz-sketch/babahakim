// ── BabaHakim Observability · Trace & Correlation Context (PHASE 15, ED-164)
// Request-scoped context carried with AsyncLocalStorage so EVERY layer below
// the handler (services, jobs, events, logger, metrics) sees the same ids
// without threading parameters:
//   reqId    — per HTTP request (existing ED-93 contract, X-Request-Id)
//   corrId   — cross-boundary Correlation ID (X-Correlation-ID): accepted
//              from the caller when present, minted otherwise, propagated to
//              response headers, log lines, ServiceLog rows and job payloads
//              — one id to follow a user action across route → job → event.
//   traceId/spanId — W3C traceparent (00-<32hex>-<16hex>-01). We are a
//              single deployment today, so "Distributed Trace" is realized
//              as lightweight propagation (parse in → child span per request
//              → out headers + logs + jobs). Full OTel collector export is
//              tracked as debt D-15-2 — the ids are already compatible.
// Pure Node (server-only): no DB, no Next imports — unit-testable.
import { randomUUID } from 'crypto'
import { AsyncLocalStorage } from 'async_hooks'

export const CORRELATION_HEADER = 'x-correlation-id'
export const TRACEPARENT_HEADER = 'traceparent'

export interface TraceContext {
  reqId: string
  corrId: string
  traceId: string
  spanId: string
  route?: string
  method?: string
  actorId?: string
  actorRole?: string
}

interface TraceGlobal {
  __bhTraceStore?: AsyncLocalStorage<TraceContext>
}
const g = globalThis as unknown as TraceGlobal
/** HMR-safe: one store per process, never re-created across module reloads. */
const store: AsyncLocalStorage<TraceContext> = g.__bhTraceStore ?? new AsyncLocalStorage<TraceContext>()
g.__bhTraceStore = store

const HEX32 = /^[0-9a-f]{32}$/
const HEX16 = /^[0-9a-f]{16}$/

function hex(n: number): string {
  let s = ''
  while (s.length < n) s += randomUUID().replace(/-/g, '')
  return s.slice(0, n)
}

/** Parse a W3C traceparent header; invalid → null (never throws, never logs). */
export function parseTraceparent(raw: string | null | undefined): { traceId: string; spanId: string } | null {
  if (!raw) return null
  const parts = raw.trim().split('-')
  if (parts.length !== 4 || parts[0] !== '00') return null
  const [, traceId, spanId, flags] = parts
  if (!HEX32.test(traceId) || !HEX16.test(spanId) || !/^[0-9a-f]{2}$/.test(flags)) return null
  if (traceId === '0'.repeat(32) || spanId === '0'.repeat(16)) return null
  return { traceId, spanId }
}

/** Build an outbound traceparent for the given (child) span. */
export function buildTraceparent(traceId: string, spanId: string): string {
  return `00-${traceId}-${spanId}-01`
}

export function genCorrelationId(): string {
  return `corr_${randomUUID().slice(0, 13)}`
}

/**
 * Derive the request trace from transport headers:
 *   corrId  ← X-Correlation-ID (validated ≤64 chars) or minted
 *   traceId ← traceparent.trace-id (kept so the upstream trace continues)
 *   spanId  ← fresh child span (this request), even when minting traceId
 */
export function startRequestTrace(reqId: string, headers: Headers): TraceContext {
  const incoming = parseTraceparent(headers.get(TRACEPARENT_HEADER))
  const rawCorr = (headers.get(CORRELATION_HEADER) || '').trim()
  const corrId = /^[\w.-]{4,64}$/.test(rawCorr) ? rawCorr : genCorrelationId()
  return {
    reqId,
    corrId,
    traceId: incoming?.traceId ?? hex(32),
    spanId: hex(16),
  }
}

/** Current context (or undefined outside a trace) — safe from anywhere. */
export function currentTrace(): TraceContext | undefined {
  return store.getStore()
}

/** Run `fn` inside a trace context (request scope or job scope). */
export function enterTrace<T>(ctx: TraceContext, fn: () => Promise<T>): Promise<T> {
  return store.run(ctx, fn)
}

/** Continue the trace inside a background job (new child span, ED-169). */
export function enterJobTrace(parent: Pick<TraceContext, 'corrId' | 'traceId'>, job: { id: string; type: string }): TraceContext {
  return {
    reqId: job.id, // job id plays the request-id role inside the worker
    corrId: parent.corrId,
    traceId: parent.traceId,
    spanId: hex(16),
    route: `job:${job.type}`,
  }
}

export function newSpanId(): string {
  return hex(16)
}

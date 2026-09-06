// ── BabaHakim Backend · Route Handler (PHASE 08 ED-93/94 → PHASE 15 ED-165)
// `apiRoute()` is the ONLY way route files expose handlers. It provides:
//   1. request-id + correlation + trace context (ALS — every log line,
//      metric, ServiceLog row and enqueued job inherits it, ED-164)
//   2. API version + correlation + traceparent headers on every response
//   3. structured request logging with duration (ED-95) + API metrics
//      (requests/errors/latency per ROUTE PATTERN, ED-167) — dynamic id
//      segments are folded to :id so labelsets stay bounded (ED-168)
//   4. uniform error mapping: AppError/Zod/Prisma/unknown → envelope
//   5. body parsing + Zod validation in one step (ED-96)
//
// Route bodies become pure orchestration: guard → parse → service → data.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { toAppError, ValidationError } from '@/server/core/errors'
import { genRequestId } from '@/server/core/ids'
import { childLogger, setTraceProvider } from '@/server/core/logger'
import { buildRequestContext, RequestContext } from '@/server/core/context'
import { errorBody, withMetaHeaders } from '@/server/api/envelope'
import { currentTrace, enterTrace, startRequestTrace, type TraceContext } from '@/server/core/trace'
import { inc, observe, METRIC_NAMES } from '@/server/core/metrics'
import { isIdempotencyProtected, runIdempotent } from '@/server/infrastructure/idempotency'
import '@/server/infrastructure/bootstrap'

export interface RouteCtx<P> {
  params: Promise<P>
}

/** Everything a route body may touch — no NextRequest below this line. */
export interface RouteEnv {
  reqId: string
  ctx: RequestContext
  log: ReturnType<typeof childLogger>
  trace: TraceContext
}

type Handler<P> = (req: NextRequest, route: RouteCtx<P>, env: RouteEnv) => Promise<unknown>

// trace provider wired once per module generation (idempotent, cheap)
setTraceProvider(() => currentTrace())

/** Fold dynamic path segments into :id — /api/v1/cases/cmtl…147 →
 *  /api/v1/cases/:id. Keeps metric labelsets bounded (ED-168). */
export function routePattern(pathname: string): string {
  return pathname
    .split('/')
    .map((seg) => (seg.length >= 6 && /^(?:[a-z]+[_-])?[0-9a-z]{8,}$/i.test(seg) && /\d/.test(seg) ? ':id' : seg))
    .join('/')
    .slice(0, 120)
}

export function apiRoute<P = Record<string, never>>(handler: Handler<P>) {
  return async (req: NextRequest, route?: RouteCtx<P>): Promise<NextResponse> => {
    const reqId = genRequestId()
    const pathname = new URL(req.url).pathname
    const pattern = routePattern(pathname)
    const trace = startRequestTrace(reqId, req.headers)
    const log = childLogger({ reqId, route: pattern })
    const start = Date.now()
    let status = 500
    let ctx: RequestContext | null = null
    // enterTrace wraps the WHOLE lifecycle (handler + catch + finally) so
    // warn/error request logs and the ServiceLog sink rows carry corrId/traceId
    return enterTrace(trace, async () => {
      try {
        const safeRoute: RouteCtx<P> = route ?? ({ params: Promise.resolve({} as P) } as RouteCtx<P>)
        ctx = buildRequestContext(req, reqId)
        // PHASE 17 (ED-191): duplicate-request protection on mutation-critical
        // routes — identical retries/double-clicks replay the stored response
        // instead of re-executing the business write (checkout, payments, …).
        const run = () => handler(req, safeRoute, { reqId, ctx: ctx!, log, trace })
        const data = isIdempotencyProtected(req.method, pattern)
          ? await runIdempotent(req, `${req.method} ${pattern}`, run)
          : await run()
        const res = data instanceof NextResponse ? data : NextResponse.json(data === undefined ? { ok: true } : data)
        status = res.status
        return withMetaHeaders(res, trace)
      } catch (e) {
        const err = toAppError(e)
        status = err.httpStatus
        // PHASE 18 (REG-06): the 5xx/4xx split the PHASE 15 fix documented was
        // never wired — every 4xx incremented api_errors_total, so pentest/test
        // traffic manufactured a fake error-rate and a false CRITICAL alert.
        // Server faults (5xx) stay alert-grade; client faults (4xx) count into
        // the reserved-but-unused api_rejected_total (visible, not alerting).
        if (status >= 500) inc(METRIC_NAMES.apiErrors, { code: err.code })
        else inc(METRIC_NAMES.apiRejected, { code: err.code })
        if (err.code === 'INTERNAL') {
          log.error('unhandled route error', { method: req.method, details: err.details })
        } else {
          log.warn('request rejected', { method: req.method, code: err.code, error: err.message })
        }
        const res = NextResponse.json(errorBody(err, reqId), { status: err.httpStatus })
        // PHASE 14: rate-limit backoff hint · PHASE 17 (ED-188): outage hint —
        // both carry Retry-After so well-behaved clients pace their retry.
        if (err.code === 'RATE_LIMITED' || err.code === 'SERVICE_UNAVAILABLE' || err.code === 'GATEWAY_TIMEOUT') {
          const ra = (err.details as { retryAfterSec?: number } | undefined)?.retryAfterSec
          if (ra) res.headers.set('Retry-After', String(ra))
        }
        return withMetaHeaders(res, trace)
      } finally {
        inc(METRIC_NAMES.apiRequests, { route: pattern, method: req.method, status: String(status) })
        observe(METRIC_NAMES.apiLatency, { route: pattern }, Date.now() - start)
        log.info('request', {
          method: req.method,
          path: pathname,
          status,
          ms: Date.now() - start,
          ip: (ctx ?? buildRequestContext(req, reqId)).ip,
        })
      }
    })
  }
}

/** Parse + validate JSON body with a Zod schema (throws ValidationError → 400). */
export async function parseBody<S extends z.ZodType>(req: NextRequest, schema: S): Promise<z.infer<S>> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    raw = {} // empty/unreadable body behaves as an empty object (checkout, callbacks)
  }
  const result = schema.safeParse(raw)
  if (!result.success) {
    throw new ValidationError('داده‌های ارسالی معتبر نیست', {
      issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code })),
    })
  }
  return result.data
}

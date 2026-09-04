// ── BabaHakim Backend · Route Handler (PHASE 08, ED-93/94) ────────────────
// `apiRoute()` is the ONLY way route files expose handlers. It provides:
//   1. request-id generation + propagation (header + logs + error envelope)
//   2. API version header (X-API-Version: v1) on every response (ED-101)
//   3. structured request logging with duration (ED-95)
//   4. uniform error mapping: AppError/Zod/Prisma/unknown → envelope
//   5. body parsing + Zod validation in one step (ED-96)
//
// Route bodies become pure orchestration: guard → parse → service → data.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { toAppError, ValidationError } from '@/server/core/errors'
import { genRequestId } from '@/server/core/ids'
import { childLogger } from '@/server/core/logger'
import { buildRequestContext, RequestContext } from '@/server/core/context'
import { errorBody, withMetaHeaders } from '@/server/api/envelope'
import '@/server/infrastructure/bootstrap'

export interface RouteCtx<P> {
  params: Promise<P>
}

/** Everything a route body may touch — no NextRequest below this line. */
export interface RouteEnv {
  reqId: string
  ctx: RequestContext
  log: ReturnType<typeof childLogger>
}

type Handler<P> = (req: NextRequest, route: RouteCtx<P>, env: RouteEnv) => Promise<unknown>

export function apiRoute<P = Record<string, never>>(handler: Handler<P>) {
  return async (req: NextRequest, route?: RouteCtx<P>): Promise<NextResponse> => {
    const reqId = genRequestId()
    const log = childLogger({ reqId, route: new URL(req.url).pathname })
    const start = Date.now()
    let status = 500
    try {
      const safeRoute: RouteCtx<P> = route ?? ({ params: Promise.resolve({} as P) } as RouteCtx<P>)
      const ctx = buildRequestContext(req, reqId)
      const data = await handler(req, safeRoute, { reqId, ctx, log })
      const res = data instanceof NextResponse ? data : NextResponse.json(data === undefined ? { ok: true } : data)
      status = res.status
      return withMetaHeaders(res, reqId)
    } catch (e) {
      const err = toAppError(e)
      status = err.httpStatus
      if (err.code === 'INTERNAL') {
        log.error('unhandled route error', { method: req.method, details: err.details })
      } else {
        log.warn('request rejected', { method: req.method, code: err.code, error: err.message })
      }
      const res = NextResponse.json(errorBody(err, reqId), { status: err.httpStatus })
      if (err.code === 'RATE_LIMITED') {
        const ra = (err.details as { retryAfterSec?: number } | undefined)?.retryAfterSec
        if (ra) res.headers.set('Retry-After', String(ra))
      }
      return withMetaHeaders(res, reqId)
    } finally {
      log.info('request', {
        method: req.method,
        path: new URL(req.url).pathname,
        status,
        ms: Date.now() - start,
        ip: buildRequestContext(req, reqId).ip,
      })
    }
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

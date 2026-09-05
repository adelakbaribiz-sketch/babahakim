// ── BabaHakim Backend · API Envelope (PHASE 08, ED-94) ────────────────────
// Success responses keep their domain shape (`{ cases: [...] }`, `{ order }`, …)
// so the SPA client keeps working; the route handler only attaches metadata
// headers. Error responses use ONE stable shape:
//   { error, code, details?, requestId }
// `error` stays the first key for backward compatibility with v1 clients.
import { NextResponse } from 'next/server'
import { AppError } from '@/server/core/errors'
import { buildTraceparent, CORRELATION_HEADER, TRACEPARENT_HEADER, type TraceContext } from '@/server/core/trace'

export const API_VERSION = 'v1'
export const VERSION_HEADER = 'X-API-Version'
export const REQUEST_ID_HEADER = 'X-Request-Id'

export function errorBody(err: AppError, requestId: string) {
  const body: Record<string, unknown> = { error: err.message, code: err.code, requestId }
  if (err.details !== undefined && err.details !== null) body.details = err.details
  return body
}

/** PHASE 15 (ED-165): metadata headers now carry the correlation id and an
 *  outbound traceparent (child span of the request) — callers/gateways can
 *  join our lines into their distributed trace. */
export function withMetaHeaders(res: NextResponse, trace: TraceContext | string): NextResponse {
  res.headers.set(VERSION_HEADER, API_VERSION)
  res.headers.set(REQUEST_ID_HEADER, typeof trace === 'string' ? trace : trace.reqId)
  if (typeof trace !== 'string') {
    res.headers.set(CORRELATION_HEADER, trace.corrId)
    res.headers.set(TRACEPARENT_HEADER, buildTraceparent(trace.traceId, trace.spanId))
  }
  return res
}

/** Standard list envelope (pagination contract, ED-100). */
export interface ListMeta {
  page: number
  limit: number
  total: number
  pages: number
}

export function listMeta(page: number, limit: number, total: number): ListMeta {
  return { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) }
}

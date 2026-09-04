// ── BabaHakim Backend · API Envelope (PHASE 08, ED-94) ────────────────────
// Success responses keep their domain shape (`{ cases: [...] }`, `{ order }`, …)
// so the SPA client keeps working; the route handler only attaches metadata
// headers. Error responses use ONE stable shape:
//   { error, code, details?, requestId }
// `error` stays the first key for backward compatibility with v1 clients.
import { NextResponse } from 'next/server'
import { AppError } from '@/server/core/errors'

export const API_VERSION = 'v1'
export const VERSION_HEADER = 'X-API-Version'
export const REQUEST_ID_HEADER = 'X-Request-Id'

export function errorBody(err: AppError, requestId: string) {
  const body: Record<string, unknown> = { error: err.message, code: err.code, requestId }
  if (err.details !== undefined && err.details !== null) body.details = err.details
  return body
}

export function withMetaHeaders(res: NextResponse, requestId: string): NextResponse {
  res.headers.set(VERSION_HEADER, API_VERSION)
  res.headers.set(REQUEST_ID_HEADER, requestId)
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

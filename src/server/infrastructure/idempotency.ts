// ── BabaHakim Backend · Request Idempotency (PHASE 17, ED-191) ────────────
// Duplicate-request protection for mutation-critical routes — the spec §27
// failure scenarios "کاربر همزمان چند بار کلیک کند" / "Callback دوباره" and
// the phase command's "Duplicate Request".
//
// Two key sources, in priority order:
//   1. client `Idempotency-Key` header (8–128 safe chars)
//   2. deterministic derived key = sha256(userId + route + canonical body)
//      — protects a double-click even when the client sends nothing
//
// Lifecycle of one (userId, route, key):
//   RUNNING  → identical concurrent request → 409 (original still executing)
//   DONE     → replay stored response (≤32KB) + `Idempotency-Replayed: true`
//   FAILED   → row dropped, the retry executes for real
//   stale    → RUNNING older than 5min (crashed request) → treated as FAILED
//
// Scope: authenticated POST routes whose business write is money or
// otherwise irreversible. Route opt-in lives in IDEMPOTENCY_PROTECTED.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sha256 } from '@/lib/auth'
import { getAuth } from '@/lib/auth'
import { ConflictError } from '@/server/core/errors'
import { childLogger } from '@/server/core/logger'

const log = childLogger({ svc: 'idempotency' })

const IDEMPOTENCY_HEADER = 'idempotency-key'
export const IDEMPOTENCY_REPLAYED_HEADER = 'Idempotency-Replayed'

const TTL_MS = 24 * 3600_000
const STALE_RUNNING_MS = 5 * 60_000
const MAX_STORED_BODY = 32 * 1024 // replay eligibility cap (oversized → DONE w/o body)
const HEADER_KEY_RE = /^[\w:.-]{8,128}$/

/** Mutation-critical routes under duplicate-request protection (ED-191). */
const IDEMPOTENCY_PROTECTED = new Set([
  'POST /api/v1/orders', // checkout — money (cart → order+invoice, atomic)
  'POST /api/v1/payments', // gateway session start — money
  'POST /api/v1/cases', // case creation triggers AI analysis pipeline
])

export function isIdempotencyProtected(method: string, routePattern: string): boolean {
  return IDEMPOTENCY_PROTECTED.has(`${method} ${routePattern}`)
}

// ── pure helpers (unit-tested directly) ────────────────────────────────────

/** Stable JSON: sorted keys at every depth, no whitespace — two structurally
 *  equal bodies always hash identically regardless of key order. */
export function canonicalJson(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v === undefined ? null : v
    if (Array.isArray(v)) return v.map(walk)
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = walk((v as Record<string, unknown>)[k])
    }
    return out
  }
  return JSON.stringify(walk(value))
}

export function deriveKey(userId: string, route: string, body: string): string {
  return sha256(`${userId}|${route}|${body}`).slice(0, 48)
}

// ── middleware ─────────────────────────────────────────────────────────────

async function readBodyCanonical(req: NextRequest): Promise<string> {
  try {
    const raw = await req.clone().json()
    return canonicalJson(raw)
  } catch {
    return '' // empty / non-JSON body — still a stable derivation input
  }
}

/**
 * Execute `run` under duplicate-request protection. Returns the stored
 * response on replay (NextResponse) or the fresh result otherwise.
 */
export async function runIdempotent<T>(
  req: NextRequest,
  route: string,
  run: () => Promise<T>,
): Promise<T | NextResponse> {
  if (req.method !== 'POST') return run() // protection is for mutations
  const auth = await getAuth()
  const userId = auth?.user.id
  if (!userId) return run() // unauthenticated requests are not durable writes

  const headerKey = req.headers.get(IDEMPOTENCY_HEADER) ?? ''
  const bodyCanonical = headerKey ? '' : await readBodyCanonical(req)
  const key = HEADER_KEY_RE.test(headerKey)
    ? headerKey
    : deriveKey(userId, route, bodyCanonical)

  // ── prior record? ────────────────────────────────────────────────────────
  let prior: { id: string; status: string; responseStatus: number | null; responseBody: string | null; updatedAt: Date } | null = null
  try {
    prior = await db.idempotencyRecord.findUnique({ where: { userId_route_key: { userId, route, key } } })
  } catch {
    return run() // idempotency store unavailable → DO NOT block the business flow
  }

  if (prior) {
    const staleRunning = prior.status === 'RUNNING' && Date.now() - prior.updatedAt.getTime() > STALE_RUNNING_MS
    if (prior.status === 'DONE' && !staleRunning) {
      if (prior.responseBody !== null) {
        log.info('idempotent replay', { route, key: key.slice(0, 12) })
        const res = NextResponse.json(JSON.parse(prior.responseBody), { status: prior.responseStatus ?? 200 })
        res.headers.set(IDEMPOTENCY_REPLAYED_HEADER, 'true')
        return res
      }
      // DONE but the stored response was oversized → the write happened;
      // re-executing would duplicate it. Refuse with a friendly conflict.
      throw new ConflictError('این درخواست قبلاً با موفقیت ثبت شده است')
    }
    if (prior.status === 'RUNNING' && !staleRunning) {
      throw new ConflictError('درخواست مشابه شما در حال پردازش است. لطفاً نتیجهٔ آن را دریافت کنید')
    }
    // FAILED or stale RUNNING → drop the row, execute for real
    await db.idempotencyRecord.delete({ where: { id: prior.id } }).catch(() => { /* racing purge — fine */ })
  }

  // ── claim RUNNING (unique-race → concurrent duplicate gets 409) ──────────
  try {
    await db.idempotencyRecord.create({
      data: { key, route, userId, status: 'RUNNING', expiresAt: new Date(Date.now() + TTL_MS) },
    })
  } catch {
    // unique violation = a concurrent identical request claimed it first
    throw new ConflictError('درخواست مشابه شما در حال پردازش است. لطفاً نتیجهٔ آن را دریافت کنید')
  }

  // ── execute + capture ────────────────────────────────────────────────────
  try {
    const result = await run()
    if (result instanceof NextResponse) {
      // streams/files — cannot capture cheaply; mark DONE without a body
      // (replays will 409-conflict instead of re-executing)
      await db.idempotencyRecord.update({ where: { userId_route_key: { userId, route, key } }, data: { status: 'DONE', responseStatus: result.status } }).catch(() => {})
      log.debug('idempotent: non-JSON response — replay disabled', { route })
      return result
    }
    const body = JSON.stringify(result ?? { ok: true })
    const capped = body.length <= MAX_STORED_BODY ? body : null
    if (capped === null) log.warn('idempotent: response exceeds 32KB — replay disabled', { route, bytes: body.length })
    await db.idempotencyRecord.update({
      where: { userId_route_key: { userId, route, key } },
      data: { status: 'DONE', responseStatus: 200, responseBody: capped },
    }).catch(() => {})
    return result
  } catch (e) {
    const errorCode = (e as { code?: string })?.code ?? 'ERROR'
    await db.idempotencyRecord.update({
      where: { userId_route_key: { userId, route, key } },
      data: { status: 'FAILED', errorCode: String(errorCode).slice(0, 40) },
    }).catch(() => { /* record already gone (crash purge) — fine */ })
    throw e
  }
}

/** Hard-purge expired records (24h) — operational data (ED-172). */
export async function purgeIdempotencyRecords(): Promise<number> {
  const r = await db.idempotencyRecord.deleteMany({ where: { expiresAt: { lt: new Date() } } })
  return r.count
}

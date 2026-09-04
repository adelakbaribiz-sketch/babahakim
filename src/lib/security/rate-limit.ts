// PHASE 05 — Rate limiting: in-process sliding-window counters (ED-60).
//
// Scope: single-instance dev/prod-small. Multi-replica production requires the
// Redis adapter (interface below) — see ADR-0014. Counters key by
// "<bucket>:<ip|account>" with periodic eviction to bound memory.
//
// Public API:
//   const res = rateLimit('login:ip:1.2.3.4', 5, 5 * 60_000)
//   res.allowed / res.retryAfterSec
import { NextResponse } from 'next/server'

interface Bucket {
  hits: number[] // timestamps of allowed hits inside the window
}

const buckets = new Map<string, Bucket>()
let lastSweep = 0
const SWEEP_INTERVAL = 60_000

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfterSec: number
}

/** Sliding-window limiter. O(1) amortized; sweep keeps memory bounded. */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now()
  if (now - lastSweep > SWEEP_INTERVAL) {
    lastSweep = now
    for (const [k, b] of buckets) {
      if (b.hits.length === 0 || b.hits[b.hits.length - 1] < now - windowMs - SWEEP_INTERVAL) {
        buckets.delete(k)
      }
    }
  }
  const b = buckets.get(key) || { hits: [] }
  b.hits = b.hits.filter((t) => t > now - windowMs)
  if (b.hits.length >= limit) {
    const retryAfterSec = Math.ceil((b.hits[0] + windowMs - now) / 1000)
    buckets.set(key, b)
    return { allowed: false, remaining: 0, retryAfterSec: Math.max(1, retryAfterSec) }
  }
  b.hits.push(now)
  buckets.set(key, b)
  return { allowed: true, remaining: limit - b.hits.length, retryAfterSec: 0 }
}

/** Reset a key (e.g. after successful login — forgive honest users). */
export function resetRateLimit(key: string) {
  buckets.delete(key)
}

// ── Presets (tuned per threat model T-BF-01/T-BF-02/T-OTP-03) ──────────
export const LIMITS = {
  login: { limit: 5, windowMs: 5 * 60_000 }, // per IP+account
  loginIp: { limit: 15, windowMs: 5 * 60_000 }, // per IP across accounts (spray)
  refresh: { limit: 30, windowMs: 60_000 },
  otpRequest: { limit: 3, windowMs: 10 * 60_000 }, // per phone
  otpVerify: { limit: 10, windowMs: 10 * 60_000 }, // per phone
  export: { limit: 1, windowMs: 24 * 3600_000 }, // data export: 1/day
  upload: { limit: 20, windowMs: 60_000 }, // per user
  mutation: { limit: 120, windowMs: 60_000 }, // global per-user write guard
} as const

/** Standard 429 response with Retry-After. */
export function rateLimited(res: RateLimitResult, message = 'تعداد درخواست‌ها بیش از حد مجاز است؛ کمی بعد تلاش کنید') {
  return NextResponse.json(
    { error: message, retryAfterSec: res.retryAfterSec },
    { status: 429, headers: { 'Retry-After': String(res.retryAfterSec) } },
  )
}

/** Future adapter (ADR-0014): swap in Redis INCR+EXPIRE for multi-replica. */
export interface RateLimitStore {
  hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult>
}

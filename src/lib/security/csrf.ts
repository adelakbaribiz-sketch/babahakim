// PHASE 05 — CSRF defense: double-submit cookie + Origin verification (ED-61).
//
// Model: browser-authenticated (httpOnly session cookies) SPA. Two layers:
//   1. Origin check — browsers always send Origin on cross-site POSTs; a
//      foreign origin is rejected before any app code runs (middleware).
//   2. Double-submit — `ta_csrf` cookie (readable by JS, sameSite=lax) must
//      equal the `x-csrf-token` request header. An attacker on another origin
//      cannot read our cookie (SOP) nor set custom headers cross-site without
//      a preflight against our CORS policy (which denies them).
//
// EDGE-SAFE: this module is imported by the middleware (Edge runtime) —
// only Web Crypto APIs + plain string comparison are used here. Constant-time
// comparison is unnecessary for double-submit tokens: the secret is the
// 256-bit random value itself, not the comparison (T-CSRF in THREAT-MODEL).
//
// Exemptions (middleware): external payment gateway callback (server-to-server,
// no cookies; integrity comes from gateway signature instead).

export const CSRF_COOKIE = 'ta_csrf'
export const CSRF_HEADER = 'x-csrf-token'
const CSRF_TTL_MS = 24 * 3600_000

export function newCsrfToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes) // Web Crypto — available in Edge & Node 19+
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function tokensMatch(a?: string | null, b?: string | null): boolean {
  return typeof a === 'string' && typeof b === 'string' && a.length > 0 && a.length === b.length && a === b
}

export function cookieOptions(maxAgeMs = CSRF_TTL_MS) {
  return {
    httpOnly: false, // double-submit: the SPA must read it
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: Math.floor(maxAgeMs / 1000),
  }
}

/** Verify a state-changing request: Origin (if present) must be same-host or allowlisted. */
export function originAllowed(originHeader: string | null, host: string | null): boolean {
  if (!originHeader) return true // non-browser clients (curl, servers) — CSRF is a browser attack
  if (!host) return false
  try {
    const o = new URL(originHeader)
    const sameHost = o.host === host
    const allow = (process.env.CORS_ALLOWED_ORIGINS || '')
      .split(',').map((s) => s.trim()).filter(Boolean)
    return sameHost || allow.includes(originHeader)
  } catch {
    return false // malformed Origin — reject
  }
}

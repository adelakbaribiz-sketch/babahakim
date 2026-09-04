// PHASE 05 — Global security middleware (ADR-0014, ED-61/62).
//
// Runs before every API route:
//   1. Origin/CORS enforcement on state-changing methods (same-host or allowlist)
//   2. CSRF double-submit verification (cookie `ta_csrf` == header `x-csrf-token`)
//   3. Issues the CSRF cookie on safe requests (GET/HEAD/OPTIONS) when missing
//
// Exemptions (server-to-server, no browser cookies):
//   - /api/v1/payments/zarinpal/callback (integrity = gateway signature, not CSRF)
//
// Static security headers are set in next.config.ts (applies everywhere).
// Note on rate limiting: implemented per-route in Node runtime (reliable
// single-process state); this middleware stays stateless/edge-safe.
import { NextRequest, NextResponse } from 'next/server'
import { CSRF_COOKIE, CSRF_HEADER, cookieOptions, newCsrfToken, originAllowed, tokensMatch } from '@/lib/security/csrf'

const EXEMPT_PATHS = ['/api/v1/payments/zarinpal/callback']
const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS']

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const method = req.method.toUpperCase()

  // 1) Origin/CORS gate for non-safe methods
  if (!SAFE_METHODS.includes(method)) {
    const origin = req.headers.get('origin')
    const host = req.headers.get('host')
    if (!originAllowed(origin, host)) {
      return NextResponse.json(
        { error: 'درخواست از مبدأ غیرمجاز | Cross-origin request rejected' },
        { status: 403, headers: { 'Vary': 'Origin' } },
      )
    }
    // 2) CSRF double-submit (skipped only for exempt server-to-server paths)
    if (!EXEMPT_PATHS.some((p) => pathname.startsWith(p))) {
      const cookieToken = req.cookies.get(CSRF_COOKIE)?.value
      const headerToken = req.headers.get(CSRF_HEADER)
      if (!tokensMatch(cookieToken, headerToken)) {
        return NextResponse.json(
          { error: 'توکن CSRF نامعتبر است | Invalid CSRF token', code: 'CSRF_INVALID' },
          { status: 403 },
        )
      }
    }
  }

  const res = NextResponse.next()

  // 3) Issue CSRF cookie on any request that lacks one (page loads + API GETs)
  if (!req.cookies.get(CSRF_COOKIE)) {
    res.cookies.set(CSRF_COOKIE, newCsrfToken(), cookieOptions())
  }
  return res
}

export const config = {
  // All app + API paths except Next internals and static assets
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|logo.svg).*)'],
}

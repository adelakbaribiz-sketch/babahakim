// ── BabaHakim Backend · Domain Error Taxonomy (PHASE 08, ED-94) ──────────
// Single error hierarchy for the whole backend. Application services and
// domain policies throw these; the API layer (apiRoute) maps them to the
// standard JSON envelope + HTTP status. Unknown errors collapse to INTERNAL
// with full server-side logging (never leaked to clients).
//
// Envelope (backward compatible with the v1 client contract `{ error }`):
//   { "error": "<fa message>", "code": "NOT_FOUND", "details": {...}, "requestId": "req_x" }

export type ErrorCode =
  | 'VALIDATION' | 'AUTH_REQUIRED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT'
  | 'BUSINESS_RULE' | 'RATE_LIMITED' | 'PAYLOAD_TOO_LARGE' | 'UNSUPPORTED_MEDIA_TYPE' | 'INTERNAL'
  // PHASE 14 (ED-153): unbounded-query guards
  | 'PAGINATION_TOO_DEEP' | 'WINDOW_TOO_WIDE' | 'REPORT_TIMEOUT' | 'GATEWAY_TIMEOUT'
  // PHASE 17 (ED-188): infrastructure outage — honest 503 + Retry-After.
  // The client can finally distinguish "transient outage, retry later" from
  // "server bug" (both used to collapse into an opaque 500).
  | 'SERVICE_UNAVAILABLE'

export class AppError extends Error {
  readonly code: ErrorCode
  readonly httpStatus: number
  readonly details?: unknown

  constructor(code: ErrorCode, message: string, httpStatus: number, details?: unknown) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.httpStatus = httpStatus
    this.details = details
  }
}

/** Input failed schema/business validation → 400 (v1 client parity). */
// PHASE 14 error classes live in infrastructure/search/bounds.ts (co-located
// with the guard logic they belong to; same AppError base, envelope-compatible).
export class ValidationError extends AppError {
  constructor(message = 'درخواست نامعتبر است', details?: unknown) {
    super('VALIDATION', message, 400, details)
  }
}

/** No/invalid session → 401. */
export class AuthRequiredError extends AppError {
  constructor(message = 'احراز هویت لازم است | Authentication required') {
    super('AUTH_REQUIRED', message, 401)
  }
}

/** Authenticated but not allowed (role/permission/ownership) → 403. */
export class ForbiddenError extends AppError {
  constructor(message = 'دسترسی غیرمجاز | Permission denied', details?: unknown) {
    super('FORBIDDEN', message, 403, details)
  }
}

/** Resource does not exist (or is soft-deleted) → 404. */
export class NotFoundError extends AppError {
  constructor(message = 'مورد یافت نشد', details?: unknown) {
    super('NOT_FOUND', message, 404, details)
  }
}

/** State conflict: duplicate, idempotency replay, invalid transition → 409. */
export class ConflictError extends AppError {
  constructor(message = 'درخواست با وضعیت فعلی ناسازگار است', details?: unknown) {
    super('CONFLICT', message, 409, details)
  }
}

/** Domain invariant violated (guard-level) → 422. */
export class BusinessRuleError extends AppError {
  constructor(message: string, details?: unknown) {
    super('BUSINESS_RULE', message, 422, details)
  }
}

/** Sliding-window limit tripped → 429. */
export class RateLimitError extends AppError {
  constructor(message = 'تعداد درخواست‌ها بیش از حد مجاز است', details?: { retryAfterSec: number }) {
    super('RATE_LIMITED', message, 429, details)
  }
}

/** Upload exceeds the category/role size limit → 413 (PHASE 10, ED-108). */
export class PayloadTooLargeError extends AppError {
  constructor(message = 'حجم فایل بیش از حد مجاز است', details?: { limitBytes: number; actualBytes: number }) {
    super('PAYLOAD_TOO_LARGE', message, 413, details)
  }
}

/** MIME/extension/magic-bytes not in the category allowlist → 415 (PHASE 10, ED-108). */
export class UnsupportedMediaTypeError extends AppError {
  constructor(message = 'نوع فایل مجاز نیست', details?: { allowed?: string[]; declared?: string; detected?: string }) {
    super('UNSUPPORTED_MEDIA_TYPE', message, 415, details)
  }
}

/** Unhandled → 500 (message hidden, logged with requestId). */
export class InternalError extends AppError {
  constructor(message = 'خطای داخلی سرور', details?: unknown) {
    super('INTERNAL', message, 500, details)
  }
}

/** Dependency outage (db / storage / queue) → 503 + Retry-After (PHASE 17, ED-188).
 * The message is user-facing Persian; `details.dependency` names the layer so
 * logs/metrics can group outages without leaking topology to clients. */
export type InfraDependency = 'db' | 'storage' | 'queue' | 'external'
export class ServiceUnavailableError extends AppError {
  constructor(dependency: InfraDependency, message?: string, retryAfterSec = 5) {
    const defaultMsg =
      dependency === 'db' ? 'سرویس پایگاه داده موقتاً در دسترس نیست. لطفاً چند لحظه بعد دوباره تلاش کنید.'
      : dependency === 'storage' ? 'فضای ذخیره‌سازی موقتاً در دسترس نیست. لطفاً بعداً تلاش کنید.'
      : 'سرویس موقتاً در دسترس نیست. لطفاً چند لحظه بعد دوباره تلاش کنید.'
    super('SERVICE_UNAVAILABLE', message ?? defaultMsg, 503, { dependency, retryAfterSec })
  }
}

/**
 * PHASE 17 (ED-188): recognize infrastructure-outage error shapes and map
 * them onto ServiceUnavailableError(503). Recognized shapes:
 *   Prisma P1001/P1002 (unreachable/exit) and P2024 (operation timeout)
 *   raw SQLite failures: CANTOPEN / IOERR / READONLY / CORRUPT / BUSY spill
 *   storage (fs) error codes: ENOSPC / EIO / EROFS / EACCES / EMFILE
 * Anything else returns null (caller keeps normal classification).
 */
export function classifyInfraFailure(e: unknown): InfraDependency | null {
  const err = e as { code?: string; name?: string; message?: string }
  const code = err?.code ?? ''
  const msg = err?.message ?? ''
  // storage fs codes first (EIO overlaps nothing prisma-shaped)
  if (['ENOSPC', 'EIO', 'EROFS', 'EMFILE', 'ENFILE'].includes(code)) return 'storage'
  if (code === 'EACCES' && /storage|write|read|open|dir|file/i.test(msg)) return 'storage'
  // Prisma connection-level failures
  if (['P1001', 'P1002', 'P2024'].includes(code)) return 'db'
  if (/SQLITE_(CANTOPEN|IOERR|READONLY|CORRUPT|BUSY|NOTADB)/i.test(msg)) return 'db'
  if (/database is locked|database disk image is malformed|unable to open database file/i.test(msg)) return 'db'
  return null
}

/** Coerce any thrown value into an AppError (lossless for AppError instances). */
export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e
  // Zod validation failures (zod v4: `issues`)
  const zodLike = e as { name?: string; issues?: Array<{ path: (string | number | symbol)[]; message: string; code: string }> }
  if (zodLike?.name === 'ZodError' && Array.isArray(zodLike.issues)) {
    return new ValidationError('داده‌های ارسالی معتبر نیست', {
      issues: zodLike.issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code })),
    })
  }
  // Prisma known errors → stable public contract
  const prismaLike = e as { code?: string; meta?: { target?: string[] } }
  if (prismaLike?.code === 'P2002') {
    return new ConflictError('این رکورد از قبل وجود دارد', { target: prismaLike.meta?.target })
  }
  if (prismaLike?.code === 'P2025') {
    return new NotFoundError('رکورد یافت نشد')
  }
  // PHASE 17 (ED-188): infrastructure outage → 503 + Retry-After (never a
  // bare 500 — a dead dependency is not a server bug)
  const dep = classifyInfraFailure(e)
  if (dep) return new ServiceUnavailableError(dep)
  return new InternalError('خطای داخلی سرور', {
    thrown: e instanceof Error ? { name: e.name, message: e.message, stack: e.stack?.split('\n').slice(0, 6) } : String(e),
  })
}

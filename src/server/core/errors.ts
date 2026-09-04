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
  | 'BUSINESS_RULE' | 'RATE_LIMITED' | 'INTERNAL'

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

/** Unhandled → 500 (message hidden, logged with requestId). */
export class InternalError extends AppError {
  constructor(message = 'خطای داخلی سرور', details?: unknown) {
    super('INTERNAL', message, 500, details)
  }
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
  return new InternalError('خطای داخلی سرور', {
    thrown: e instanceof Error ? { name: e.name, message: e.message, stack: e.stack?.split('\n').slice(0, 6) } : String(e),
  })
}

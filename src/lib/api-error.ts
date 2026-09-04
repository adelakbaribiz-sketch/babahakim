// ── ApiError — typed client-side mirror of the ED-94 error envelope ────────
// Carries the server error code (VALIDATION/CONFLICT/RATE_LIMITED/…), the
// request id for support correlation, and zod field errors for form display.
export class ApiError extends Error {
  readonly status: number
  readonly code?: string
  readonly requestId?: string
  /** path → message (zod 422 issues) — feeds field-level form errors */
  readonly fields: Record<string, string>

  constructor(message: string, opts: { status: number; code?: string; requestId?: string; fields?: Record<string, string> }) {
    super(message)
    this.name = 'ApiError'
    this.status = opts.status
    this.code = opts.code
    this.requestId = opts.requestId
    this.fields = opts.fields || {}
  }

  /** Support-correlation suffix shown in error toasts (ED-95 observability). */
  get supportRef(): string {
    return this.requestId ? `${this.message} (req:${this.requestId.slice(0, 8)})` : this.message
  }
}

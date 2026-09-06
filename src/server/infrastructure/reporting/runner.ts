// ── Reporting Engine · Runner (PHASE 14, ED-153/154/158) ───────────────────
// The ONLY execution path for reports (gate SR2/SR6):
//   guard → zod params → window clamp → TTL cache → wall-clock budget →
//   row-cap meta. Caches are invalidated by domain events (ED-158).
import type { AuthContext } from '@/lib/auth'
import { ForbiddenError, NotFoundError, ValidationError } from '@/server/core/errors'
import { cached, cacheStore } from '@/server/infrastructure/cache'
import { withReportTimeout, REPORT_BOUNDS } from '@/server/infrastructure/search/bounds'
import { canViewReport, getReportDef } from './registry'
import type { ReportResult, ReportRunParams } from './types'

export const REPORT_CACHE_PREFIX = 'report:'

/** event-driven invalidation (bootstrap subscribes domain events here) */
export function invalidateReportCaches(): Promise<number> {
  return cacheStore.clearPrefix(REPORT_CACHE_PREFIX)
}

export interface RunReportOptions {
  /** override view cap (export path runs with its own cap) */
  maxRows?: number
  /** skip cache (exports must reflect fresh state at click time) */
  noCache?: boolean
}

/**
 * Execute a registered report for an authenticated caller.
 * Permission-aware (def.permission + roles), bounded (window clamp + timeout
 * + row caps), cached per (report × params × role-scope).
 */
export async function runReport(
  auth: AuthContext,
  reportId: string,
  rawParams: unknown,
  opts: RunReportOptions = {},
): Promise<ReportResult> {
  const def = getReportDef(reportId)
  if (!def) throw new NotFoundError('گزارش یافت نشد')
  if (!canViewReport(auth, def)) throw new ForbiddenError('دسترسی به این گزارش ندارید')

  // zod boundary: unknown keys stripped (ED-96)
  const parsed = def.params.safeParse(rawParams ?? {})
  if (!parsed.success) {
    throw new ValidationError('پارامترهای گزارش نامعتبر است', {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    })
  }
  const params = parsed.data as ReportRunParams

  const maxRows = Math.min(opts.maxRows ?? def.maxViewRows ?? REPORT_BOUNDS.maxViewRows, REPORT_BOUNDS.maxViewRows)
  const scopeKey = auth.user.role === 'ADMIN' ? 'admin' : `${auth.user.role}:${auth.user.id}`
  const cacheKey = `${REPORT_CACHE_PREFIX}${reportId}:${scopeKey}:${JSON.stringify(params)}:${maxRows}`
  const ttl = REPORT_BOUNDS.cacheTtlMs[def.category] ?? 30_000

  const execute = async (): Promise<ReportResult> => {
    const result = await withReportTimeout(
      Promise.resolve(def.run(params, { auth })),
      def.timeoutMs ?? REPORT_BOUNDS.queryTimeoutMs,
    )
    // enforce the view cap at the runner level too (defense in depth)
    if (result.rows.length > maxRows) {
      result.rows = result.rows.slice(0, maxRows)
      result.meta.truncated = true
    }
    result.meta.cached = false
    return result
  }

  if (opts.noCache) return execute()
  const cachedResult = await cached(cacheKey, ttl, execute)
  return { ...cachedResult, meta: { ...cachedResult.meta, cached: true } }
}

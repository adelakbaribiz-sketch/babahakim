// ── BabaHakim Search & Reporting · Unbounded-Query Guards (PHASE 14, ED-153)
// The explicit phase command: «از Queryهای بسیار سنگین و Unbounded جلوگیری کن».
// Every list/report/export path funnels through these constants — they are the
// single source of truth for hard bounds (gate SR6 asserts their usage).
//
// Rationale per bound:
//   MAX_LIMIT/MAX_OFFSET     — deep offset pagination forces row-scan cost
//                              linear in offset; beyond 10k rows switch to a
//                              narrower filter (v2: keyset/cursor pagination).
//   REPORT_*                 — time-boxed aggregations, capped buckets and
//                              capped rows keep reports interactive and the
//                              SQLite engine responsive.
//   QUERY_TIMEOUT_MS         — a report that cannot answer in 15s is by
//                              definition "سنگین" and must fail loudly with a
//                              typed error instead of hanging the worker.
//   EXPORT_*                 — sync exports stay in-memory (≤ 2k rows);
//                              bigger exports go through the async job queue
//                              and land as TEMPORARY StoredFiles (24h TTL).

import { AppError } from '@/server/core/errors'

export const SEARCH_BOUNDS = {
  maxLimit: 100,
  defaultLimit: 20,
  maxPage: 500, // 500 × 100 = 50k… see offset cap below (10k hard)
  maxOffset: 10_000,
} as const

export const REPORT_BOUNDS = {
  /** default window when caller sends no range (last 30 days) */
  defaultWindowDays: 30,
  /** max window length — 13 months of history is enough for every v1 report */
  maxWindowDays: 400,
  /** earliest date a report may start from (platform inception) */
  minDate: '2024-01-01',
  /** max rows returned in the JSON view (detail tables) */
  maxViewRows: 200,
  /** max aggregation buckets (day/week/month groups) */
  maxBuckets: 400,
  /** hard wall-clock budget per report execution */
  queryTimeoutMs: 15_000,
  /** sync export row cap (env-overridable for tests: REPORT_SYNC_MAX_ROWS) */
  syncExportRows: () => {
    const v = Number(process.env.REPORT_SYNC_MAX_ROWS)
    return Number.isFinite(v) && v >= 10 ? Math.trunc(v) : 2_000
  },
  /** async export row cap — rows beyond this are dropped + flagged */
  asyncExportRows: 20_000,
  /** export artifacts live 24h as TEMPORARY StoredFiles */
  exportTtlHours: 24,
  /** cache TTLs per category (ED-158) */
  cacheTtlMs: {
    OPERATIONAL: 5 * 60_000,
    FINANCIAL: 5 * 60_000,
    BUSINESS: 5 * 60_000,
    USER: 60_000,
    PERFORMANCE: 60_000,
    CUSTOM: 30_000,
  } as Record<string, number>,
} as const

export class OffsetTooDeepError extends AppError {
  constructor(maxOffset: number) {
    super('PAGINATION_TOO_DEEP', 'دامنه صفحه‌بندی بیش از حد بزرگ است — فیلتر دقیق‌تری اعمال کنید', 422, {
      maxOffset,
      hint: 'narrow the filters or use a bounded date range',
    })
  }
}

export class WindowTooWideError extends AppError {
  constructor(maxDays: number) {
    super('WINDOW_TOO_WIDE', `بازه گزارش بیش از ${maxDays} روز نیست — بازه کوچک‌تری انتخاب کنید`, 422, {
      maxWindowDays: maxDays,
    })
  }
}

export class ReportTimeoutError extends AppError {
  constructor(ms: number) {
    super('REPORT_TIMEOUT', 'اجرای گزارش بیش از حد طول کشید — فیلترها را محدودتر کنید', 504, { budgetMs: ms })
  }
}

/** Assert offset pagination is not unboundedly deep (ED-160). */
export function assertOffsetBounded(offset: number, limit: number): void {
  if (offset + limit > SEARCH_BOUNDS.maxOffset) throw new OffsetTooDeepError(SEARCH_BOUNDS.maxOffset)
}

export interface TimeWindow { from: Date; to: Date; defaulted: boolean }

/**
 * Clamp/validate a [from,to] request window:
 *   • missing → default last N days (defaulted=true so responses can flag it)
 *   • from ≥ to, from < minDate, to > now+1d → 422
 *   • window longer than maxWindowDays → 422 (never silently truncate a
 *     financial report — honest errors beat wrong numbers)
 */
export function clampWindow(
  fromRaw: string | null | undefined,
  toRaw: string | null | undefined,
  opts: { defaultDays?: number; maxDays?: number; now?: Date } = {},
): TimeWindow {
  const maxDays = opts.maxDays ?? REPORT_BOUNDS.maxWindowDays
  const defaultDays = opts.defaultDays ?? REPORT_BOUNDS.defaultWindowDays
  const now = opts.now ?? new Date()
  const minDate = new Date(REPORT_BOUNDS.minDate + 'T00:00:00.000Z')

  let from: Date | null = fromRaw ? new Date(fromRaw) : null
  let to: Date | null = toRaw ? new Date(toRaw) : null
  const defaulted = !from && !to

  if (from && !Number.isNaN(from.getTime()) && !to) {
    to = now // open-ended "from X" → [X, now]
  }
  if (to && !Number.isNaN(to.getTime()) && !from) {
    from = new Date(to.getTime() - (defaultDays - 1) * 86_400_000) // "to Y" → last N days
  }
  if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    from = new Date(now.getTime() - (defaultDays - 1) * 86_400_000)
    to = now
  }
  // normalize to day boundaries (inclusive day range, UTC)
  from = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()))
  const toEnd = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate(), 23, 59, 59, 999))

  if (from < minDate) throw new WindowTooWideError(maxDays)
  const dayAfterTomorrow = new Date(now.getTime() + 36 * 3_600_000)
  if (toEnd > dayAfterTomorrow) throw new WindowTooWideError(maxDays)
  const days = (toEnd.getTime() - from.getTime()) / 86_400_000
  if (days > maxDays) throw new WindowTooWideError(maxDays)
  if (days < 0) throw new WindowTooWideError(maxDays)
  return { from, to: toEnd, defaulted }
}

/**
 * Race a promise against the report wall-clock budget (ED-153).
 * NB: Prisma/SQLite cannot cancel an in-flight statement — the loser is the
 * response, not the query; the bound still protects the request pipeline.
 */
export async function withReportTimeout<T>(p: Promise<T>, ms: number = REPORT_BOUNDS.queryTimeoutMs): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new ReportTimeoutError(ms)), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

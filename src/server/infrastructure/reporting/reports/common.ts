// Shared param schemas + result meta builder for report definitions.
import { z } from 'zod'
import { clampWindow, REPORT_BOUNDS, type TimeWindow } from '@/server/infrastructure/search/bounds'
import type { ReportCategory, ReportResultMeta } from '../types'

export const groupBySchema = z.enum(['day', 'week', 'month', 'none'])

export const baseParams = z.object({
  from: z.string().max(32).optional(),
  to: z.string().max(32).optional(),
  groupBy: groupBySchema.optional(),
})

export const dateOnlyParams = baseParams // time-scoped, no extra knobs

/** clamp [from,to] with report bounds; returns meta fields + window */
export function windowFor(params: { from?: string; to?: string }): TimeWindow & { fromISO: string; toISO: string; fromMs: number; toMs: number } {
  const w = clampWindow(params.from, params.to)
  return {
    ...w,
    fromISO: w.from.toISOString(), toISO: w.to.toISOString(),
    // Prisma SQLite stores DateTime as epoch-ms INTEGER — raw SQL must use these
    fromMs: w.from.getTime(), toMs: w.to.getTime(),
  }
}

export function buildMeta(
  reportId: string,
  category: ReportCategory,
  w: TimeWindow,
  opts: {
    groupBy?: string
    totalRows?: number
    viewRows?: number
    ms?: number
    cached?: boolean
    windowDefaulted?: boolean
    noteFa?: string
    noteEn?: string
  } = {},
): ReportResultMeta {
  const viewRows = opts.viewRows ?? 0
  const totalRows = opts.totalRows ?? viewRows
  return {
    reportId,
    category,
    from: w.from.toISOString(),
    to: w.to.toISOString(),
    groupBy: opts.groupBy as ReportResultMeta['groupBy'],
    generatedAt: new Date().toISOString(),
    truncated: totalRows > viewRows,
    totalRows,
    windowDefaulted: w.defaulted,
    ms: opts.ms ?? 0,
    cached: opts.cached,
    noteFa: opts.noteFa,
    noteEn: opts.noteEn,
  }
}

export const VIEW_ROWS = REPORT_BOUNDS.maxViewRows

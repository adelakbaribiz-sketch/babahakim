// ── BabaHakim Reporting Engine · Type Contract (PHASE 14, ED-154/155) ─────
// Reports are DATA, not code paths: every report is a registered definition
// (id, category, permission, params schema, bounded runner). The catalog is
// permission-aware (§ command: «گزارش‌ها باید Permission-aware باشند») and
// every runner aggregates IN SQL (ED-155 — no load-then-reduce).
import type { z } from 'zod'
import type { AuthContext } from '@/lib/auth'

export const REPORT_CATEGORIES = ['OPERATIONAL', 'FINANCIAL', 'BUSINESS', 'USER', 'PERFORMANCE', 'CUSTOM'] as const
export type ReportCategory = (typeof REPORT_CATEGORIES)[number]

export type ColumnType = 'text' | 'number' | 'money' | 'date' | 'enum' | 'percent'

export interface ReportColumn {
  key: string
  fa: string
  en: string
  type?: ColumnType
}

export interface ReportChartSeries {
  key: string
  fa: string
  en: string
  /** column type of the series values */
  type?: ColumnType
}

/** Optional time-series payload for the client chart panel (own rows). */
export interface ReportChart {
  /** row field holding the bucket label (date or group key) */
  bucketKey: string
  series: ReportChartSeries[]
  /** bucket rows (bounded ≤ maxViewRows) — separate from the detail table */
  rows: Record<string, unknown>[]
}

export interface ReportResultMeta {
  reportId: string
  category: ReportCategory
  from: string
  to: string
  groupBy?: 'day' | 'week' | 'month' | 'none'
  generatedAt: string
  /** rows exist beyond the view cap (bounded, honest truncation) */
  truncated: boolean
  totalRows: number
  windowDefaulted?: boolean
  /** honest execution budget report */
  ms: number
  cached?: boolean
  noteFa?: string
  noteEn?: string
}

export interface ReportResult {
  columns: ReportColumn[]
  rows: Record<string, unknown>[]
  totals?: Record<string, number>
  summary?: { key: string; fa: string; en: string; value: number; type?: ColumnType }[]
  chart?: ReportChart
  meta: ReportResultMeta
}

export interface ReportRunParams {
  /** ISO date or YYYY-MM-DD (clamped by clampWindow — never unbounded) */
  from?: string
  to?: string
  groupBy?: 'day' | 'week' | 'month' | 'none'
  /** extra params per report (validated by the report's own zod schema) */
  [key: string]: unknown
}

export interface ReportRunContext {
  auth: AuthContext
  /** execution budget applies at the runner level (ED-153) */
  reqId?: string
}

/**
 * A report definition. `permission` mirrors the 31-entry catalogue in
 * constants.ts (gate SR9 verifies). PATIENT never sees any report — the
 * catalogue itself is filtered by canViewReport().
 */
export interface ReportDef {
  /** kebab/dot id, stable API contract: 'financial.revenue-summary' */
  id: string
  category: ReportCategory
  fa: string
  en: string
  descFa: string
  descEn: string
  /** required permission (ADMIN bypasses, BR-RBAC-02) */
  permission: string
  /** additional role allowlist (intersection with permission holders) */
  roles?: string[]
  /** params schema — zod, unknown keys stripped (ED-96 boundary) */
  params: z.ZodType<ReportRunParams>
  /** time-scoped reports get window clamping (all v1 reports are) */
  timeScoped: boolean
  /** default groupBy when caller sends none */
  defaultGroupBy?: 'day' | 'week' | 'month' | 'none'
  /** true when the result carries a time-series chart */
  hasChart: boolean
  /** max rows in the JSON view (≤ REPORT_BOUNDS.maxViewRows) */
  maxViewRows?: number
  /** execution budget override */
  timeoutMs?: number
  /** run the report (bounded: SQL aggregation, capped rows/buckets) */
  run: (params: z.infer<ReportDef['params']>, ctx: ReportRunContext) => Promise<ReportResult>
}

export const REPORT_IDS = {
  // operational
  caseStatus: 'operational.case-status',
  queueSla: 'operational.queue-sla',
  followupCompliance: 'operational.followup-compliance',
  workflowHealth: 'operational.workflow-health',
  // financial
  revenueSummary: 'financial.revenue-summary',
  payments: 'financial.payments',
  expenses: 'financial.expenses',
  referrals: 'financial.referrals',
  // business
  topProducts: 'business.top-products',
  salesTrend: 'business.sales-trend',
  provinces: 'business.provinces',
  diseaseMix: 'business.disease-mix',
  // user
  userGrowth: 'user.growth',
  userActivity: 'user.activity',
  userRoles: 'user.roles',
  // performance
  aiPerformance: 'performance.ai',
  integrationsPerformance: 'performance.integrations',
  systemPerformance: 'performance.system',
  // custom
  customDataset: 'custom.dataset',
} as const

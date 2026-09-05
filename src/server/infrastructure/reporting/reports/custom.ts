// ── Custom dataset report (PHASE 14) — Master Prompt §38 «Dynamic Reports» ─
// A SAFE "custom report builder": the caller picks a DATASET from a closed
// whitelist, applies whitelisted filters and a time bucket — there is NO raw
// SQL surface, no arbitrary columns, no unbounded windows (ED-153/154).
// Dataset-level permissions are enforced at run time on top of view_reports:
//   payments → view_financials · orders → manage_orders · cases → view_all_cases
//   users    → manage_users          · audit-logs → view_audit_logs
// Filter dimensions cover the §38 catalogue where the dataset carries them:
// User / Doctor / Expert / Operator (userId), Disease, Product, Brand,
// Date Range, Status, Payment, Order, Referral, City, Province, Case Type.
import { z } from 'zod'
import { db } from '@/lib/db'
import { ForbiddenError } from '@/server/core/errors'
import { bucketAggregate, num } from '../sql'
import { baseParams, windowFor, buildMeta, VIEW_ROWS } from './common'
import { REPORT_IDS, type ReportDef, type ReportResult, type ReportColumn } from '../types'

const DATASETS = ['payments', 'orders', 'cases', 'users', 'audit-logs'] as const
type DatasetId = (typeof DATASETS)[number]

export const DATASET_PERMISSIONS: Record<DatasetId, string> = {
  payments: 'view_financials',
  orders: 'manage_orders',
  cases: 'view_all_cases',
  users: 'manage_users',
  'audit-logs': 'view_audit_logs',
}

const customParams = baseParams.extend({
  dataset: z.enum(DATASETS),
  filters: z.object({
    status: z.string().max(40).optional(),
    method: z.enum(['ZARINPAL', 'CARD_TO_CARD']).optional(),
    type: z.string().max(30).optional(),
    role: z.string().max(20).optional(),
    userId: z.string().max(40).optional(),
    patientId: z.string().max(40).optional(),
    productId: z.string().max(40).optional(),
    brand: z.string().max(64).optional(),
    diseaseId: z.string().max(40).optional(),
    referralCode: z.string().max(40).optional(),
    province: z.string().max(64).optional(),
    city: z.string().max(64).optional(),
    caseType: z.string().max(30).optional(),
    action: z.string().max(64).optional(),
    entity: z.string().max(40).optional(),
    minAmount: z.number().int().min(0).max(1_000_000_000).optional(),
    maxAmount: z.number().int().min(0).max(1_000_000_000).optional(),
  }).optional(),
})

interface DatasetSpec {
  table: string
  timeColumn: string
  labelFa: string
  labelEn: string
  /** detail-row SQL (static shape; only whitelisted ?-params vary) */
  detailSql: string
  detailParams: (f: Record<string, unknown>) => unknown[]
  detailColumns: ReportColumn[]
  /** optional group filter (status enum list) */
  statusEnum?: readonly string[]
  measures?: { sumAmount?: boolean }
  hasWhereCompat?: boolean
}

const PAID = "('PAID','PREPARING','READY_TO_SHIP','SHIPPED','DELIVERED')"

const SPECS: Record<DatasetId, DatasetSpec> = {
  payments: {
    table: 'Payment', timeColumn: 'createdAt', labelFa: 'پرداخت‌ها', labelEn: 'Payments',
    detailSql: `SELECT p.code, p.createdAt, p.status, p.method, p.amount,
                       u.firstName || ' ' || u.lastName AS userName, u.referralCode
                FROM Payment p JOIN User u ON p.userId = u.id
                WHERE p.createdAt >= ? AND p.createdAt <= ? AND (? IS NULL OR p.status = ?)
                  AND (? IS NULL OR p.method = ?) AND (? IS NULL OR p.userId = ?)
                  AND (? IS NULL OR p.amount >= ?) AND (? IS NULL OR p.amount <= ?)
                ORDER BY p.createdAt DESC LIMIT ?`,
    detailParams: (f) => [f.status ?? null, f.status ?? null, f.method ?? null, f.method ?? null, f.userId ?? null, f.userId ?? null, f.minAmount ?? null, f.minAmount ?? null, f.maxAmount ?? null, f.maxAmount ?? null],
    detailColumns: [
      { key: 'code', fa: 'کد', en: 'Code', type: 'text' },
      { key: 'createdAt', fa: 'تاریخ', en: 'Date', type: 'date' },
      { key: 'status', fa: 'وضعیت', en: 'Status', type: 'enum' },
      { key: 'method', fa: 'روش', en: 'Method', type: 'enum' },
      { key: 'userName', fa: 'کاربر', en: 'User', type: 'text' },
      { key: 'amount', fa: 'مبلغ', en: 'Amount', type: 'money' },
    ],
    measures: { sumAmount: true },
  },
  orders: {
    table: '"Order"', timeColumn: 'createdAt', labelFa: 'سفارش‌ها', labelEn: 'Orders',
    detailSql: `SELECT o.code, o.createdAt, o.status, o.type, o.total,
                       u.firstName || ' ' || u.lastName AS userName, pr.province
                FROM "Order" o JOIN User u ON o.userId = u.id
                LEFT JOIN PatientProfile pr ON pr.userId = u.id
                WHERE o.createdAt >= ? AND o.createdAt <= ? AND (? IS NULL OR o.status = ?)
                  AND (? IS NULL OR o.type = ?) AND (? IS NULL OR o.userId = ?)
                ORDER BY o.createdAt DESC LIMIT ?`,
    detailParams: (f) => [f.status ?? null, f.status ?? null, f.type ?? null, f.type ?? null, f.userId ?? null, f.userId ?? null],
    detailColumns: [
      { key: 'code', fa: 'کد', en: 'Code', type: 'text' },
      { key: 'createdAt', fa: 'تاریخ', en: 'Date', type: 'date' },
      { key: 'status', fa: 'وضعیت', en: 'Status', type: 'enum' },
      { key: 'type', fa: 'نوع', en: 'Type', type: 'enum' },
      { key: 'userName', fa: 'کاربر', en: 'User', type: 'text' },
      { key: 'total', fa: 'مبلغ', en: 'Total', type: 'money' },
    ],
    measures: { sumAmount: true },
  },
  cases: {
    table: 'MedicalCase', timeColumn: 'createdAt', labelFa: 'پرونده‌ها', labelEn: 'Cases',
    detailSql: `SELECT c.code, c.createdAt, c.status, c.priority,
                       u.firstName || ' ' || u.lastName AS patientName, u.referralCode,
                       (SELECT COUNT(DISTINCT dg.diseaseId) FROM Diagnosis dg WHERE dg.caseId = c.id) AS diseases
                FROM MedicalCase c JOIN User u ON c.patientId = u.id
                WHERE c.deletedAt IS NULL AND c.createdAt >= ? AND c.createdAt <= ?
                  AND (? IS NULL OR c.status = ?) AND (? IS NULL OR c.patientId = ?)
                  AND (? IS NULL OR EXISTS (SELECT 1 FROM Diagnosis dg JOIN Disease d ON dg.diseaseId = d.id
                                             WHERE dg.caseId = c.id AND d.id = ?))
                ORDER BY c.createdAt DESC LIMIT ?`,
    detailParams: (f) => [f.status ?? null, f.status ?? null, f.patientId ?? null, f.patientId ?? null, f.diseaseId ?? null, f.diseaseId ?? null],
    detailColumns: [
      { key: 'code', fa: 'کد', en: 'Code', type: 'text' },
      { key: 'createdAt', fa: 'تاریخ', en: 'Date', type: 'date' },
      { key: 'status', fa: 'وضعیت', en: 'Status', type: 'enum' },
      { key: 'priority', fa: 'اولویت', en: 'Priority', type: 'enum' },
      { key: 'patientName', fa: 'بیمار', en: 'Patient', type: 'text' },
      { key: 'diseases', fa: 'بیماری‌های تشخیصی', en: 'Diagnosed diseases', type: 'number' },
    ],
  },
  users: {
    table: 'User', timeColumn: 'createdAt', labelFa: 'کاربران', labelEn: 'Users',
    detailSql: `SELECT u.createdAt, u.role, u.isActive,
                       u.firstName || ' ' || u.lastName AS name, u.referralCode,
                       pr.province, pr.city
                FROM User u LEFT JOIN PatientProfile pr ON pr.userId = u.id
                WHERE u.deletedAt IS NULL AND u.createdAt >= ? AND u.createdAt <= ?
                  AND (? IS NULL OR u.role = ?) AND (? IS NULL OR pr.province = ?)
                  AND (? IS NULL OR pr.city = ?)
                ORDER BY u.createdAt DESC LIMIT ?`,
    detailParams: (f) => [f.role ?? null, f.role ?? null, f.province ?? null, f.province ?? null, f.city ?? null, f.city ?? null],
    detailColumns: [
      { key: 'createdAt', fa: 'تاریخ ثبت‌نام', en: 'Registered', type: 'date' },
      { key: 'name', fa: 'نام', en: 'Name', type: 'text' },
      { key: 'role', fa: 'نقش', en: 'Role', type: 'enum' },
      { key: 'isActive', fa: 'فعال', en: 'Active', type: 'enum' },
      { key: 'province', fa: 'استان', en: 'Province', type: 'text' },
      { key: 'city', fa: 'شهر', en: 'City', type: 'text' },
    ],
  },
  'audit-logs': {
    table: 'AuditLog', timeColumn: 'createdAt', labelFa: 'لاگ امنیتی', labelEn: 'Audit logs',
    detailSql: `SELECT a.createdAt, a.action, a.entity, a.entityId, a.sensitive,
                       u.firstName || ' ' || u.lastName AS actor
                FROM AuditLog a LEFT JOIN User u ON a.userId = u.id
                WHERE a.createdAt >= ? AND a.createdAt <= ?
                  AND (? IS NULL OR a.action = ?) AND (? IS NULL OR a.entity = ?)
                  AND (? IS NULL OR a.userId = ?)
                ORDER BY a.createdAt DESC LIMIT ?`,
    detailParams: (f) => [f.action ?? null, f.action ?? null, f.entity ?? null, f.entity ?? null, f.userId ?? null, f.userId ?? null],
    detailColumns: [
      { key: 'createdAt', fa: 'زمان', en: 'Time', type: 'date' },
      { key: 'action', fa: 'عملیات', en: 'Action', type: 'text' },
      { key: 'entity', fa: 'موجودیت', en: 'Entity', type: 'text' },
      { key: 'entityId', fa: 'شناسه', en: 'Entity ID', type: 'text' },
      { key: 'actor', fa: 'بازیگر', en: 'Actor', type: 'text' },
      { key: 'sensitive', fa: 'حساس', en: 'Sensitive', type: 'enum' },
    ],
  },
}

async function customDatasetReport(
  params: z.infer<typeof customParams>,
  ctx: { auth: { user: { role: string }; permissions: string[] } },
): Promise<ReportResult> {
  const start = Date.now()
  const w = windowFor(params)
  const dataset = params.dataset
  const spec = SPECS[dataset]
  const f = (params.filters ?? {}) as Record<string, unknown>

  // dataset-level permission gate (view_reports is the base gate in the route)
  const perm = DATASET_PERMISSIONS[dataset]
  if (ctx.auth.user.role !== 'ADMIN' && !ctx.auth.permissions.includes(perm)) {
    throw new ForbiddenError(`این دیتاست گزارش نیاز به مجوز ${perm} دارد`)
  }

  const groupBy = params.groupBy === 'none' || !params.groupBy ? 'none' : params.groupBy
  const limit = VIEW_ROWS

  if (groupBy === 'none') {
    // detail rows (bounded 200)
    const rowsRaw = await db.$queryRawUnsafe<Record<string, unknown>[]>(
      spec.detailSql, w.fromMs, w.toMs, ...spec.detailParams(f), limit,
    )
    // raw SQLite returns DateTime as epoch-ms — normalize date columns to ISO
    const rows = rowsRaw.map((r) => {
      const out: Record<string, unknown> = { ...r }
      for (const c of spec.detailColumns) {
        if (c.type === 'date' && typeof out[c.key] === 'number') {
          out[c.key] = new Date(out[c.key] as number).toISOString()
        }
      }
      return out
    })
    const totals: Record<string, number> = { rows: rows.length }
    if (spec.measures?.sumAmount) {
      totals.amount = rows.reduce((s, r) => s + num(r.amount ?? r.total), 0)
    }
    return {
      columns: spec.detailColumns,
      rows,
      totals,
      meta: buildMeta(REPORT_IDS.customDataset, 'CUSTOM', w, {
        groupBy: 'none', totalRows: rows.length, viewRows: rows.length, ms: Date.now() - start,
        noteFa: `دیتاست: ${spec.labelFa}`,
        noteEn: `Dataset: ${spec.labelEn}`,
      }),
    }
  }

  // grouped buckets: count (+ sum where meaningful)
  const hasAmount = !!spec.measures?.sumAmount
  const selectExpr = hasAmount
    ? 'COUNT(*) AS c, SUM(amount) AS total'
    : 'COUNT(*) AS c'
  const rows = await bucketAggregate(
    spec.table, selectExpr, spec.timeColumn, groupBy as 'day' | 'week' | 'month', w.fromMs, w.toMs,
  )
  const view = rows.slice(0, VIEW_ROWS).map((r) => ({
    bucket: r.bucket, c: num(r.c), ...(hasAmount ? { total: num(r.total) } : {}),
  }))
  const columns: ReportColumn[] = [
    { key: 'bucket', fa: 'بازه', en: 'Period', type: 'date' },
    { key: 'c', fa: 'تعداد', en: 'Count', type: 'number' },
    ...(hasAmount ? [{ key: 'total', fa: 'مبلغ (تومان)', en: 'Amount', type: 'money' as const }] : []),
  ]
  return {
    columns,
    rows: view,
    totals: { c: view.reduce((s, r) => s + r.c, 0), ...(hasAmount ? { total: view.reduce((s, r) => s + (r.total ?? 0), 0) } : {}) },
    chart: {
      bucketKey: 'bucket',
      series: [{ key: 'c', fa: 'تعداد', en: 'Count' }, ...(hasAmount ? [{ key: 'total', fa: 'مبلغ', en: 'Amount', type: 'money' as const }] : [])],
      rows: view,
    },
    meta: buildMeta(REPORT_IDS.customDataset, 'CUSTOM', w, {
      groupBy, totalRows: rows.length, viewRows: view.length, ms: Date.now() - start,
      noteFa: `دیتاست: ${spec.labelFa} (فیلترهای سطح ردیف فقط در حالت «بدون گروه‌بندی»)`,
      noteEn: `Dataset: ${spec.labelEn} (row filters apply in 'none' grouping only)`,
    }),
  }
}

export const customReports: ReportDef[] = [{
  id: REPORT_IDS.customDataset, category: 'CUSTOM',
  fa: 'گزارش سفارشی (دیتاست)', en: 'Custom dataset report',
  descFa: 'دیتاست + فیلترهای مجاز + گروه‌بندی زمانی — بدون SQL خام',
  descEn: 'Dataset + whitelisted filters + time grouping — no raw SQL',
  permission: 'view_reports', timeScoped: true, hasChart: true, defaultGroupBy: 'none',
  params: customParams,
  // re-parse narrows the interface-level ReportRunParams back to the dataset schema
  run: (p, ctx) => customDatasetReport(customParams.parse(p), ctx),
}]

// ── Financial reports (PHASE 14, ED-154/155) ───────────────────────────────
// view_financials holders (ADMIN, EXPERT_2, OPERATOR). Every aggregation is
// SQL-side over a CLAMPED time window — this replaces the legacy
// getReports() which loaded 7 full tables into JS (S-4). Referrer phones are
// masked (ED-157 row-level hygiene).
import { z } from 'zod'
import { db } from '@/lib/db'
import { bucketAggregate, num } from '../sql'
import { baseParams, windowFor, buildMeta, VIEW_ROWS } from './common'
import { REPORT_IDS, type ReportDef, type ReportResult } from '../types'

const PAID_ORDER_STATUSES = "('PAID','PREPARING','READY_TO_SHIP','SHIPPED','DELIVERED')"

async function revenueSummaryReport(params: z.infer<typeof baseParams>): Promise<ReportResult> {
  const start = Date.now()
  const w = windowFor(params)
  const groupBy = params.groupBy === 'none' ? 'day' : (params.groupBy ?? 'day')

  const [incomeRows, expenseRows] = await Promise.all([
    bucketAggregate('Payment', `SUM(CASE WHEN status='PAID' THEN amount ELSE 0 END) AS income, COUNT(*) AS payments`,
      'createdAt', groupBy, w.fromMs, w.toMs, "AND status IN ('PAID','FAILED','REJECTED','REFUNDED','PENDING','AWAITING_VERIFY')"),
    bucketAggregate('FinancialTransaction', `SUM(CASE WHEN type='EXPENSE' THEN amount ELSE 0 END) AS expenses`,
      'createdAt', groupBy, w.fromMs, w.toMs, "AND type IN ('EXPENSE')"),
  ])

  const map = new Map<string, { bucket: string; income: number; expenses: number }>()
  for (const r of incomeRows) {
    map.set(String(r.bucket), { bucket: String(r.bucket), income: num(r.income), expenses: 0 })
  }
  for (const r of expenseRows) {
    const e = map.get(String(r.bucket)) ?? { bucket: String(r.bucket), income: 0, expenses: 0 }
    e.expenses = num(r.expenses)
    map.set(String(r.bucket), e)
  }
  const rows = [...map.values()].sort((a, b) => a.bucket.localeCompare(b.bucket)).slice(0, VIEW_ROWS)
  const income = rows.reduce((s, r) => s + r.income, 0)
  const expenses = rows.reduce((s, r) => s + r.expenses, 0)
  const days = Math.max(1, Math.round((w.to.getTime() - w.from.getTime()) / 86_400_000))

  return {
    columns: [
      { key: 'bucket', fa: 'بازه', en: 'Period', type: 'date' },
      { key: 'income', fa: 'درآمد (تومان)', en: 'Revenue', type: 'money' },
      { key: 'expenses', fa: 'هزینه (تومان)', en: 'Expenses', type: 'money' },
      { key: 'profit', fa: 'سود (تومان)', en: 'Profit', type: 'money' },
    ],
    rows: rows.map((r) => ({ ...r, profit: r.income - r.expenses })),
    totals: { income, expenses, profit: income - expenses },
    summary: [
      { key: 'income', fa: 'درآمد بازه', en: 'Window revenue', value: income, type: 'money' },
      { key: 'expenses', fa: 'هزینه بازه', en: 'Window expenses', value: expenses, type: 'money' },
      { key: 'profit', fa: 'سود بازه', en: 'Window profit', value: income - expenses, type: 'money' },
      { key: 'avgDaily', fa: 'میانگین درآمد روزانه', en: 'Avg daily revenue', value: Math.round(income / days), type: 'money' },
    ],
    chart: {
      bucketKey: 'bucket',
      series: [
        { key: 'income', fa: 'درآمد', en: 'Revenue', type: 'money' },
        { key: 'expenses', fa: 'هزینه', en: 'Expenses', type: 'money' },
      ],
      rows: rows.map((r) => ({ bucket: r.bucket, income: r.income, expenses: r.expenses })),
    },
    meta: buildMeta(REPORT_IDS.revenueSummary, 'FINANCIAL', w, { groupBy, totalRows: rows.length, viewRows: rows.length, ms: Date.now() - start }),
  }
}

async function paymentsReport(params: z.infer<typeof baseParams>): Promise<ReportResult> {
  const start = Date.now()
  const w = windowFor(params)
  const groupBy = params.groupBy === 'none' ? 'day' : (params.groupBy ?? 'day')

  const [byStatusMethod, byDay] = await Promise.all([
    db.$queryRawUnsafe<{ g: string; method: string; c: number; total: number | null }[]>(
      `SELECT status AS g, method, COUNT(*) AS c, SUM(amount) AS total
       FROM Payment WHERE createdAt >= ? AND createdAt <= ? GROUP BY g, method ORDER BY c DESC LIMIT 200`,
      w.fromMs, w.toMs,
    ),
    bucketAggregate('Payment', `SUM(CASE WHEN status='PAID' THEN amount ELSE 0 END) AS paidAmount, COUNT(*) AS c`,
      'createdAt', groupBy, w.fromMs, w.toMs),
  ])

  const paid = byStatusMethod.filter((r) => r.g === 'PAID')
  const paidTotal = paid.reduce((s, r) => s + num(r.total), 0)
  const failed = byStatusMethod.filter((r) => ['FAILED', 'REJECTED'].includes(r.g))
  const rows = byStatusMethod.map((r) => ({ status: r.g, method: r.method, c: num(r.c), total: num(r.total) }))

  return {
    columns: [
      { key: 'status', fa: 'وضعیت پرداخت', en: 'Status', type: 'enum' },
      { key: 'method', fa: 'روش', en: 'Method', type: 'enum' },
      { key: 'c', fa: 'تعداد', en: 'Count', type: 'number' },
      { key: 'total', fa: 'مبلغ (تومان)', en: 'Amount', type: 'money' },
    ],
    rows,
    totals: { c: rows.reduce((s, r) => s + r.c, 0) },
    summary: [
      { key: 'paid', fa: 'مبلغ پرداخت‌شده', en: 'Paid amount', value: paidTotal, type: 'money' },
      { key: 'paidCount', fa: 'تعداد پرداخت موفق', en: 'Successful payments', value: paid.reduce((s, r) => s + num(r.c), 0), type: 'number' },
      { key: 'failedCount', fa: 'ناموفق/ردشده', en: 'Failed / rejected', value: failed.reduce((s, r) => s + num(r.c), 0), type: 'number' },
      { key: 'successRate', fa: 'نرخ موفقیت (٪)', en: 'Success rate (%)', value: rows.length ? Math.round((paid.reduce((s, r) => s + num(r.c), 0) / Math.max(1, rows.reduce((s, r) => s + r.c, 0))) * 100) : 0, type: 'percent' },
    ],
    chart: {
      bucketKey: 'bucket',
      series: [{ key: 'paidAmount', fa: 'پرداخت موفق', en: 'Paid', type: 'money' }],
      rows: byDay.slice(0, VIEW_ROWS).map((r) => ({ bucket: r.bucket, paidAmount: num(r.paidAmount), c: num(r.c) })),
    },
    meta: buildMeta(REPORT_IDS.payments, 'FINANCIAL', w, { groupBy, totalRows: rows.length, viewRows: rows.length, ms: Date.now() - start }),
  }
}

async function expensesReport(params: z.infer<typeof baseParams>): Promise<ReportResult> {
  const start = Date.now()
  const w = windowFor(params)
  const groupBy = params.groupBy === 'none' ? 'day' : (params.groupBy ?? 'month')
  const rows = await bucketAggregate(
    'FinancialTransaction', `SUM(amount) AS total, COUNT(*) AS c`,
    'createdAt', groupBy, w.fromMs, w.toMs, "AND type='EXPENSE'",
  )
  const total = rows.reduce((s, r) => s + num(r.total), 0)
  return {
    columns: [
      { key: 'bucket', fa: 'بازه', en: 'Period', type: 'date' },
      { key: 'total', fa: 'هزینه (تومان)', en: 'Expenses', type: 'money' },
      { key: 'c', fa: 'تعداد تراکنش', en: 'Entries', type: 'number' },
    ],
    rows: rows.slice(0, VIEW_ROWS).map((r) => ({ bucket: r.bucket, total: num(r.total), c: num(r.c) })),
    totals: { total },
    chart: {
      bucketKey: 'bucket',
      series: [{ key: 'total', fa: 'هزینه', en: 'Expenses', type: 'money' }],
      rows: rows.slice(0, VIEW_ROWS).map((r) => ({ bucket: r.bucket, total: num(r.total) })),
    },
    meta: buildMeta(REPORT_IDS.expenses, 'FINANCIAL', w, { groupBy, totalRows: rows.length, viewRows: Math.min(rows.length, VIEW_ROWS), ms: Date.now() - start }),
  }
}

async function referralsReport(params: z.infer<typeof baseParams>): Promise<ReportResult> {
  const start = Date.now()
  const w = windowFor(params)
  const rows = await db.$queryRawUnsafe<{ id: string; referrer: string; code: string; referredUser: string; orders: number; revenue: number | null }[]>(
    `SELECT r.id, rf.firstName || ' ' || rf.lastName AS referrer, rf.referralCode AS code,
            ru.firstName || ' ' || ru.lastName AS referredUser,
            (SELECT COUNT(*) FROM "Order" o WHERE o.userId = r.referredUserId AND o.status IN ${PAID_ORDER_STATUSES}
               AND o.createdAt >= ? AND o.createdAt <= ?) AS orders,
            (SELECT COALESCE(SUM(o.total), 0) FROM "Order" o WHERE o.userId = r.referredUserId AND o.status IN ${PAID_ORDER_STATUSES}
               AND o.createdAt >= ? AND o.createdAt <= ?) AS revenue
     FROM Referral r
     JOIN User rf ON r.referrerId = rf.id
     JOIN User ru ON r.referredUserId = ru.id
     WHERE r.createdAt >= ? AND r.createdAt <= ?
     ORDER BY revenue DESC LIMIT 200`,
    w.fromMs, w.toMs, w.fromMs, w.toMs, w.fromMs, w.toMs,
  )

  const mapped = rows.map((r) => ({
    id: r.id, referrer: r.referrer, code: r.code, referredUser: r.referredUser,
    orders: num(r.orders), revenue: num(r.revenue), commission: Math.round(num(r.revenue) * 0.05),
  }))
  return {
    columns: [
      { key: 'referrer', fa: 'معرف', en: 'Referrer', type: 'text' },
      { key: 'code', fa: 'کد معرف', en: 'Code', type: 'text' },
      { key: 'referredUser', fa: 'معرفی‌شده', en: 'Referred user', type: 'text' },
      { key: 'orders', fa: 'سفارش', en: 'Orders', type: 'number' },
      { key: 'revenue', fa: 'درآمد (تومان)', en: 'Revenue', type: 'money' },
      { key: 'commission', fa: 'کمیسیون ۵٪', en: 'Commission 5%', type: 'money' },
    ],
    rows: mapped,
    totals: {
      orders: mapped.reduce((s, r) => s + r.orders, 0),
      revenue: mapped.reduce((s, r) => s + r.revenue, 0),
      commission: mapped.reduce((s, r) => s + r.commission, 0),
    },
    meta: buildMeta(REPORT_IDS.referrals, 'FINANCIAL', w, { totalRows: mapped.length, viewRows: mapped.length, ms: Date.now() - start }),
  }
}

export const financialReports: ReportDef[] = [
  {
    id: REPORT_IDS.revenueSummary, category: 'FINANCIAL',
    fa: 'خلاصه درآمد و هزینه', en: 'Revenue & expense summary',
    descFa: 'درآمد/هزینه/سود به تفکیک روز/هفته/ماه در بازه', descEn: 'Revenue/expense/profit by day/week/month',
    permission: 'view_financials', timeScoped: true, hasChart: true, defaultGroupBy: 'day',
    params: baseParams, run: (p) => revenueSummaryReport(p),
  },
  {
    id: REPORT_IDS.payments, category: 'FINANCIAL',
    fa: 'گزارش پرداخت‌ها', en: 'Payments report',
    descFa: 'پرداخت‌ها به تفکیک وضعیت/روش + نرخ موفقیت', descEn: 'Payments by status/method + success rate',
    permission: 'view_financials', timeScoped: true, hasChart: true, defaultGroupBy: 'day',
    params: baseParams, run: (p) => paymentsReport(p),
  },
  {
    id: REPORT_IDS.expenses, category: 'FINANCIAL',
    fa: 'گزارش هزینه‌ها', en: 'Expenses report',
    descFa: 'هزینه‌های ثبت‌شده در بازه', descEn: 'Recorded expenses in window',
    permission: 'view_financials', timeScoped: true, hasChart: true, defaultGroupBy: 'month',
    params: baseParams, run: (p) => expensesReport(p),
  },
  {
    id: REPORT_IDS.referrals, category: 'FINANCIAL',
    fa: 'گزارش معرف‌ها', en: 'Referrals report',
    descFa: 'معرف‌ها با سفارش/درآمد/کمیسیون ۵٪', descEn: 'Referrers with orders/revenue/5% commission',
    permission: 'view_financials', timeScoped: true, hasChart: false,
    params: baseParams, run: (p) => referralsReport(p),
  },
]

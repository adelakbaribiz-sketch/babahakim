// ── Business reports (PHASE 14) ────────────────────────────────────────────
// Catalog/sales/demographics views for view_reports holders. SQL-side
// aggregation over clamped windows; "Order" is quoted (SQL keyword).
import { z } from 'zod'
import { db } from '@/lib/db'
import { bucketAggregate, num } from '../sql'
import { baseParams, windowFor, buildMeta, VIEW_ROWS } from './common'
import { REPORT_IDS, type ReportDef, type ReportResult } from '../types'

const PAID_ORDER_STATUSES = "('PAID','PREPARING','READY_TO_SHIP','SHIPPED','DELIVERED')"

async function topProductsReport(params: z.infer<typeof baseParams>): Promise<ReportResult> {
  const start = Date.now()
  const w = windowFor(params)
  const rows = await db.$queryRawUnsafe<{ name: string; brand: string | null; category: string | null; qty: number; revenue: number; orders: number }[]>(
    `SELECT COALESCE(oi.nameFa, '?') AS name, p.brand AS brand, p.category AS category,
            SUM(oi.quantity) AS qty, SUM(oi.total) AS revenue, COUNT(DISTINCT o.id) AS orders
     FROM OrderItem oi
     JOIN "Order" o ON oi.orderId = o.id
     LEFT JOIN Product p ON oi.productId = p.id
     WHERE o.status IN ${PAID_ORDER_STATUSES} AND o.createdAt >= ? AND o.createdAt <= ?
     GROUP BY name, brand, category ORDER BY revenue DESC LIMIT 200`,
    w.fromMs, w.toMs,
  )
  const mapped = rows.map((r) => ({
    name: r.name, brand: r.brand || '—', category: r.category || '—',
    qty: num(r.qty), revenue: num(r.revenue), orders: num(r.orders),
  }))
  return {
    columns: [
      { key: 'name', fa: 'محصول', en: 'Product', type: 'text' },
      { key: 'brand', fa: 'برند', en: 'Brand', type: 'text' },
      { key: 'category', fa: 'دسته', en: 'Category', type: 'text' },
      { key: 'qty', fa: 'تعداد فروش', en: 'Units', type: 'number' },
      { key: 'orders', fa: 'سفارش‌ها', en: 'Orders', type: 'number' },
      { key: 'revenue', fa: 'درآمد (تومان)', en: 'Revenue', type: 'money' },
    ],
    rows: mapped,
    totals: { qty: mapped.reduce((s, r) => s + r.qty, 0), revenue: mapped.reduce((s, r) => s + r.revenue, 0) },
    meta: buildMeta(REPORT_IDS.topProducts, 'BUSINESS', w, { totalRows: mapped.length, viewRows: mapped.length, ms: Date.now() - start }),
  }
}

async function salesTrendReport(params: z.infer<typeof baseParams>): Promise<ReportResult> {
  const start = Date.now()
  const w = windowFor(params)
  const groupBy = params.groupBy === 'none' ? 'day' : (params.groupBy ?? 'day')
  const rows = await bucketAggregate(
    '"Order"', `COUNT(*) AS c, SUM(CASE WHEN status IN ${PAID_ORDER_STATUSES} THEN total ELSE 0 END) AS paidValue`,
    'createdAt', groupBy, w.fromMs, w.toMs,
  )
  const mapped = rows.map((r) => ({ bucket: String(r.bucket), c: num(r.c), paidValue: num(r.paidValue) }))
  const view = mapped.slice(0, VIEW_ROWS)
  return {
    columns: [
      { key: 'bucket', fa: 'بازه', en: 'Period', type: 'date' },
      { key: 'c', fa: 'سفارش‌ها', en: 'Orders', type: 'number' },
      { key: 'paidValue', fa: 'ارزش پرداخت‌شده (تومان)', en: 'Paid value', type: 'money' },
    ],
    rows: view,
    totals: { c: view.reduce((s, r) => s + r.c, 0), paidValue: view.reduce((s, r) => s + r.paidValue, 0) },
    chart: {
      bucketKey: 'bucket',
      series: [{ key: 'paidValue', fa: 'ارزش فروش', en: 'Sales value', type: 'money' }],
      rows: view,
    },
    meta: buildMeta(REPORT_IDS.salesTrend, 'BUSINESS', w, { groupBy, totalRows: mapped.length, viewRows: view.length, ms: Date.now() - start }),
  }
}

async function provincesReport(params: z.infer<typeof baseParams>): Promise<ReportResult> {
  const start = Date.now()
  const w = windowFor(params)
  const rows = await db.$queryRawUnsafe<{ g: string; c: number; withCases: number | null }[]>(
    `SELECT COALESCE(NULLIF(pr.province, ''), 'نامشخص') AS g, COUNT(*) AS c,
            SUM(CASE WHEN EXISTS (SELECT 1 FROM MedicalCase mc WHERE mc.patientId = u.id AND mc.deletedAt IS NULL) THEN 1 ELSE 0 END) AS withCases
     FROM PatientProfile pr
     JOIN User u ON pr.userId = u.id
     WHERE u.createdAt >= ? AND u.createdAt <= ? AND u.deletedAt IS NULL
     GROUP BY g ORDER BY c DESC LIMIT 200`,
    w.fromMs, w.toMs,
  )
  const mapped = rows.map((r) => ({ province: r.g, patients: num(r.c), withCases: num(r.withCases) }))
  return {
    columns: [
      { key: 'province', fa: 'استان', en: 'Province', type: 'text' },
      { key: 'patients', fa: 'بیماران ثبت‌شده', en: 'Patients', type: 'number' },
      { key: 'withCases', fa: 'دارای پرونده', en: 'With cases', type: 'number' },
    ],
    rows: mapped,
    totals: { patients: mapped.reduce((s, r) => s + r.patients, 0) },
    meta: buildMeta(REPORT_IDS.provinces, 'BUSINESS', w, { totalRows: mapped.length, viewRows: mapped.length, ms: Date.now() - start }),
  }
}

async function diseaseMixReport(params: z.infer<typeof baseParams>): Promise<ReportResult> {
  const start = Date.now()
  const w = windowFor(params)
  const rows = await db.$queryRawUnsafe<{ g: string; cases: number; diagnoses: number; avgConfidence: number | null }[]>(
    `SELECT COALESCE(d.nameFa, d.nameEn, 'نامشخص') AS g, COUNT(DISTINCT dg.caseId) AS cases, COUNT(*) AS diagnoses,
            AVG(dg.confidence) AS avgConfidence
     FROM Diagnosis dg
     LEFT JOIN Disease d ON dg.diseaseId = d.id
     WHERE dg.createdAt >= ? AND dg.createdAt <= ?
     GROUP BY g ORDER BY cases DESC LIMIT 200`,
    w.fromMs, w.toMs,
  )
  const mapped = rows.map((r) => ({
    disease: r.g, cases: num(r.cases), diagnoses: num(r.diagnoses),
    avgConfidence: Math.round(num(r.avgConfidence) * 100) / 100,
  }))
  return {
    columns: [
      { key: 'disease', fa: 'بیماری', en: 'Disease', type: 'text' },
      { key: 'cases', fa: 'پرونده‌ها', en: 'Cases', type: 'number' },
      { key: 'diagnoses', fa: 'تشخیص‌ها', en: 'Diagnoses', type: 'number' },
      { key: 'avgConfidence', fa: 'میانگین اطمینان AI', en: 'Avg AI confidence', type: 'percent' },
    ],
    rows: mapped,
    totals: { cases: mapped.reduce((s, r) => s + r.cases, 0) },
    meta: buildMeta(REPORT_IDS.diseaseMix, 'BUSINESS', w, { totalRows: mapped.length, viewRows: mapped.length, ms: Date.now() - start }),
  }
}

export const businessReports: ReportDef[] = [
  {
    id: REPORT_IDS.topProducts, category: 'BUSINESS',
    fa: 'پرفروش‌ترین محصولات', en: 'Top products',
    descFa: 'محصولات پرفروش بازه به تفکیک برند/دسته', descEn: 'Best sellers in window by brand/category',
    permission: 'view_reports', timeScoped: true, hasChart: false,
    params: baseParams, run: (p) => topProductsReport(p),
  },
  {
    id: REPORT_IDS.salesTrend, category: 'BUSINESS',
    fa: 'روند فروش', en: 'Sales trend',
    descFa: 'سفارش‌ها و ارزش فروش در بازه', descEn: 'Orders and sales value over window',
    permission: 'view_reports', timeScoped: true, hasChart: true, defaultGroupBy: 'day',
    params: baseParams, run: (p) => salesTrendReport(p),
  },
  {
    id: REPORT_IDS.provinces, category: 'BUSINESS',
    fa: 'پراکندگی جغرافیایی', en: 'Geographic distribution',
    descFa: 'بیماران به تفکیک استان', descEn: 'Patients by province',
    permission: 'view_reports', timeScoped: true, hasChart: false,
    params: baseParams, run: (p) => provincesReport(p),
  },
  {
    id: REPORT_IDS.diseaseMix, category: 'BUSINESS',
    fa: 'ترکیب بیماری‌ها', en: 'Disease mix',
    descFa: 'بیماری‌های تشخیص‌داده‌شده در بازه', descEn: 'Diagnosed diseases in window',
    permission: 'view_reports', timeScoped: true, hasChart: false,
    params: baseParams, run: (p) => diseaseMixReport(p),
  },
]

// ── User reports (PHASE 14) ────────────────────────────────────────────────
// manage_users (ADMIN-only in practice): growth, activity, role mix.
// PII discipline (ED-157): aggregated counts by default; the activity table
// shows names but NO phones/emails — the report layer never widens PII beyond
// what the permission matrix already grants the user list.
import { z } from 'zod'
import { db } from '@/lib/db'
import { bucketAggregate, num } from '../sql'
import { baseParams, windowFor, buildMeta, VIEW_ROWS } from './common'
import { REPORT_IDS, type ReportDef, type ReportResult } from '../types'

const ROLE_KEYS = ['PATIENT', 'EXPERT_1', 'EXPERT_2', 'DOCTOR', 'OPERATOR', 'ADMIN'] as const

async function userGrowthReport(params: z.infer<typeof baseParams>): Promise<ReportResult> {
  const start = Date.now()
  const w = windowFor(params)
  const groupBy = params.groupBy === 'none' ? 'month' : (params.groupBy ?? 'month')
  const rows = await db.$queryRawUnsafe<{ bucket: string; role: string; c: number }[]>(
    `SELECT strftime('${groupBy === 'month' ? '%Y-%m' : groupBy === 'week' ? '%Y-W%W' : '%Y-%m-%d'}', "createdAt" / 1000, 'unixepoch') AS bucket, role,
            COUNT(*) AS c
     FROM User WHERE createdAt >= ? AND createdAt <= ? AND deletedAt IS NULL
     GROUP BY bucket, role ORDER BY bucket ASC`,
    w.fromMs, w.toMs,
  )

  const view = rows.slice(0, VIEW_ROWS)
  const chartRows = view.map((r) => {
    const out: Record<string, unknown> = { bucket: r.bucket }
    for (const role of ROLE_KEYS) out[role] = 0
    out[r.role] = num(r.c)
    return out
  })
  // fold duplicates (same bucket appears once per role) into single rows
  const folded = new Map<string, Record<string, unknown>>()
  for (const r of chartRows) {
    const ex = folded.get(String(r.bucket)) ?? { bucket: r.bucket }
    for (const role of ROLE_KEYS) ex[role] = num(ex[role]) + num(r[role])
    folded.set(String(r.bucket), ex)
  }
  const totalByRole: Record<string, number> = {}
  for (const r of rows) totalByRole[r.role] = (totalByRole[r.role] ?? 0) + num(r.c)

  return {
    columns: [
      { key: 'bucket', fa: 'بازه', en: 'Period', type: 'date' },
      { key: 'role', fa: 'نقش', en: 'Role', type: 'enum' },
      { key: 'c', fa: 'ثبت‌نام', en: 'Signups', type: 'number' },
    ],
    rows: view.map((r) => ({ bucket: r.bucket, role: r.role, c: num(r.c) })),
    totals: { c: rows.reduce((s, r) => s + num(r.c), 0) },
    summary: ROLE_KEYS.map((role) => ({ key: role, fa: role, en: role, value: totalByRole[role] ?? 0, type: 'number' })),
    chart: {
      bucketKey: 'bucket',
      series: ROLE_KEYS.map((role) => ({ key: role, fa: role, en: role })),
      rows: [...folded.values()],
    },
    meta: buildMeta(REPORT_IDS.userGrowth, 'USER', w, { groupBy, totalRows: rows.length, viewRows: view.length, ms: Date.now() - start }),
  }
}

async function userActivityReport(params: z.infer<typeof baseParams>): Promise<ReportResult> {
  const start = Date.now()
  const w = windowFor(params)
  const rows = await db.$queryRawUnsafe<{ id: string; name: string; role: string; cases: number; orders: number; tickets: number }[]>(
    `SELECT u.id, u.firstName || ' ' || u.lastName AS name, u.role,
       (SELECT COUNT(*) FROM MedicalCase c WHERE c.patientId = u.id AND c.createdAt >= ? AND c.createdAt <= ?) AS cases,
       (SELECT COUNT(*) FROM "Order" o WHERE o.userId = u.id AND o.createdAt >= ? AND o.createdAt <= ?) AS orders,
       (SELECT COUNT(*) FROM Ticket t WHERE t.userId = u.id AND t.createdAt >= ? AND t.createdAt <= ?) AS tickets
     FROM User u
     WHERE u.deletedAt IS NULL AND u.createdAt <= ?
     ORDER BY (SELECT COUNT(*) FROM MedicalCase c WHERE c.patientId = u.id AND c.createdAt >= ? AND c.createdAt <= ?)
            + (SELECT COUNT(*) FROM "Order" o WHERE o.userId = u.id AND o.createdAt >= ? AND o.createdAt <= ?) DESC
     LIMIT 200`,
    w.fromMs, w.toMs, w.fromMs, w.toMs, w.fromMs, w.toMs,
    w.toMs, w.fromMs, w.toMs, w.fromMs, w.toMs,
  )
  const mapped = rows.map((r) => ({ name: r.name, role: r.role, cases: num(r.cases), orders: num(r.orders), tickets: num(r.tickets) }))
  return {
    columns: [
      { key: 'name', fa: 'کاربر', en: 'User', type: 'text' },
      { key: 'role', fa: 'نقش', en: 'Role', type: 'enum' },
      { key: 'cases', fa: 'پرونده', en: 'Cases', type: 'number' },
      { key: 'orders', fa: 'سفارش', en: 'Orders', type: 'number' },
      { key: 'tickets', fa: 'تیکت', en: 'Tickets', type: 'number' },
    ],
    rows: mapped,
    totals: { cases: mapped.reduce((s, r) => s + r.cases, 0), orders: mapped.reduce((s, r) => s + r.orders, 0), tickets: mapped.reduce((s, r) => s + r.tickets, 0) },
    meta: buildMeta(REPORT_IDS.userActivity, 'USER', w, {
      totalRows: mapped.length, viewRows: mapped.length, ms: Date.now() - start,
      noteFa: 'بدون شماره تلفن/ایمیل — فقط نام و شمارنده‌ها.',
      noteEn: 'No phone/email — names and counters only.',
    }),
  }
}

async function userRolesReport(params: z.infer<typeof baseParams>): Promise<ReportResult> {
  const start = Date.now()
  const w = windowFor(params)
  // snapshot-style report: role/active mix of users CREATED in window
  const rows = await db.$queryRawUnsafe<{ g: string; isActive: number; c: number }[]>(
    `SELECT role AS g, isActive, COUNT(*) AS c
     FROM User WHERE createdAt >= ? AND createdAt <= ? AND deletedAt IS NULL
     GROUP BY g, isActive ORDER BY c DESC LIMIT 100`,
    w.fromMs, w.toMs,
  )
  const mapped = rows.map((r) => ({ role: r.g, active: r.isActive === 1, c: num(r.c) }))
  return {
    columns: [
      { key: 'role', fa: 'نقش', en: 'Role', type: 'enum' },
      { key: 'active', fa: 'فعال', en: 'Active', type: 'enum' },
      { key: 'c', fa: 'تعداد', en: 'Count', type: 'number' },
    ],
    rows: mapped,
    totals: { c: mapped.reduce((s, r) => s + r.c, 0) },
    meta: buildMeta(REPORT_IDS.userRoles, 'USER', w, { totalRows: mapped.length, viewRows: mapped.length, ms: Date.now() - start }),
  }
}

export const userReports: ReportDef[] = [
  {
    id: REPORT_IDS.userGrowth, category: 'USER',
    fa: 'رشد کاربران', en: 'User growth',
    descFa: 'ثبت‌نام‌ها به تفکیک نقش و بازه', descEn: 'Signups by role over time',
    permission: 'manage_users', timeScoped: true, hasChart: true, defaultGroupBy: 'month',
    params: baseParams, run: (p) => userGrowthReport(p),
  },
  {
    id: REPORT_IDS.userActivity, category: 'USER',
    fa: 'فعال‌ترین کاربران', en: 'Most active users',
    descFa: 'پرونده/سفارش/تیکت هر کاربر در بازه', descEn: 'Cases/orders/tickets per user in window',
    permission: 'manage_users', timeScoped: true, hasChart: false,
    params: baseParams, run: (p) => userActivityReport(p),
  },
  {
    id: REPORT_IDS.userRoles, category: 'USER',
    fa: 'ترکیب نقش‌ها', en: 'Role mix',
    descFa: 'توزیع نقش/وضعیت کاربران ثبت‌شده در بازه', descEn: 'Role/active mix of users created in window',
    permission: 'manage_users', timeScoped: true, hasChart: false,
    params: baseParams, run: (p) => userRolesReport(p),
  },
]
